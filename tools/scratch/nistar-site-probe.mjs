// 只读：打印任意矩形内的现状道路 / 建筑 / 轨道 / 水体（用于诊断施工被拒原因）
// 运行：node tools/scratch/nistar-site-probe.mjs minX minZ maxX maxZ
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const [min_x, min_z, max_x, max_z] = process.argv.slice(2).map(Number);

const client = new Client({ name: 'nistar-site-probe', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  const snap = await client.callTool({
    name: 'get_planning_map_snapshot',
    arguments: { bounds: { min_x, min_z, max_x, max_z }, max_features_per_layer: 200, include_buildings: true },
  });
  const s = snap.structuredContent?.data ?? {};
  console.log('layers:', Object.entries(s).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}=${v.length}`).join(' '), '| truncated=', s.truncated);
  for (const r of s.roads ?? []) {
    const c = r.curve ?? {};
    const pts = [c.a, c.b, c.c, c.d].filter(Boolean).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)})`);
    console.log('ROAD', r.prefab ?? r.name, 'w=', r.width_m, pts.join('->'));
  }
  for (const b of s.buildings ?? []) {
    console.log('BLDG', b.prefab ?? b.name, '@', JSON.stringify(b.position ?? {}));
  }
  for (const t of s.tracks ?? []) {
    const c = t.curve ?? {};
    const pts = [c.a, c.b, c.c, c.d].filter(Boolean).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)})`);
    console.log('TRACK', t.prefab ?? t.name, pts.join('->'));
  }
  const mask = await client.callTool({
    name: 'read_surface_water_mask',
    arguments: { bounds: { min_x, min_z, max_x, max_z }, cell_size_m: 32, limit: 1024 },
  });
  const m = mask.structuredContent?.data ?? {};
  const cells = m.cells ?? m.items ?? [];
  const wet = cells.filter((c) => (c.depth_m ?? c.depth ?? 0) > 0.01);
  console.log('WATER cells=', cells.length, 'wet=', wet.length, wet.slice(0, 8).map((c) => `(${c.x},${c.z})=${(c.depth_m ?? c.depth).toFixed(1)}`).join(' '));
} finally {
  await client.close();
}
