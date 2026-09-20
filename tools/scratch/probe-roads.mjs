// 一次性勘察：只读，打印指定范围内现状道路的完整曲线（用于确定对外接入点）。
// 运行：node tools/scratch/probe-roads.mjs [minX] [minZ] [maxX] [maxZ]
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url));
const [min_x, min_z, max_x, max_z] = (process.argv.slice(2).length === 4
  ? process.argv.slice(2).map(Number)
  : [-1558, -935, 935, 2805]);

const client = new Client({ name: 'roads-probe', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  const snap = await client.callTool({
    name: 'get_planning_map_snapshot',
    arguments: { bounds: { min_x, min_z, max_x, max_z }, max_features_per_layer: 100, include_buildings: false },
  });
  const s = snap.structuredContent?.data ?? {};
  console.log('roads=', (s.roads ?? []).length, 'truncated=', s.truncated);
  for (const r of s.roads ?? []) {
    const c = r.curve ?? {};
    const pts = [c.a, c.b, c.c, c.d].filter(Boolean).map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)})`);
    console.log(`${r.prefab ?? r.name} w=${r.width_m} id=${r.id ?? r.edge_id ?? '-'} ${pts.join(' -> ')}`);
  }
} finally {
  await client.close();
}
