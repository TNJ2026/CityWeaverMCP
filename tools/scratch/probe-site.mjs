// 一次性选址勘察：只读，打印已购区域内的现状道路/建筑/轨道与地表水覆盖摘要。
// 运行：node tools/scratch/probe-site.mjs
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url));
const BOUNDS = { min_x: -1558, min_z: -935, max_x: 935, max_z: 2805 };

const client = new Client({ name: 'site-probe', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));

  const snap = await client.callTool({
    name: 'get_planning_map_snapshot',
    arguments: { bounds: BOUNDS, max_features_per_layer: 300 },
  });
  const s = snap.structuredContent?.data ?? {};
  console.log('== snapshot layers ==');
  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) console.log(`${k}: ${v.length} truncated=${s.truncated ?? false}`);
  }
  console.log('truncated:', s.truncated);
  for (const r of (s.roads ?? []).slice(0, 20)) {
    console.log('road:', r.prefab ?? r.name, JSON.stringify(r.points ?? r.curve ?? '').slice(0, 160));
  }
  for (const b of (s.buildings ?? []).slice(0, 30)) {
    console.log('bldg:', b.prefab ?? b.name, 'pos=', JSON.stringify(b.position ?? {}));
  }

  // 地表水：32 米采样，统计有水的格子数与最深值
  const mask = await client.callTool({
    name: 'read_surface_water_mask',
    arguments: { bounds: BOUNDS, cell_size_m: 32, limit: 1024 },
  });
  const m = mask.structuredContent?.data ?? {};
  const cells = m.cells ?? m.items ?? [];
  let wet = 0;
  let maxDepth = 0;
  for (const c of cells) {
    const d = c.depth_m ?? c.depth ?? 0;
    if (d > 0.01) {
      wet += 1;
      if (d > maxDepth) maxDepth = d;
    }
  }
  console.log('== water ==');
  console.log('cell_size_m=', m.cell_size_m, 'returned=', cells.length, 'total=', m.total, 'wet=', wet, 'maxDepth=', maxDepth);
} finally {
  await client.close();
}
