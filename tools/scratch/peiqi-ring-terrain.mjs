// 采样五边形环路沿线地形/水域，定位 GAME_REJECTED_ROAD 的物理原因。
//   node tools/scratch/peiqi-ring-terrain.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const V = [{ x: -520, z: 160 }, { x: -1400, z: -480 }, { x: -1064, z: -1512 }, { x: 24, z: -1512 }, { x: 360, z: -480 }];
const chain = [V[0]];
for (let i = 0; i < V.length; i++) {
  const a = V[i], b = V[(i + 1) % V.length];
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 240));
  for (let s = 1; s <= steps; s++) chain.push({ x: a.x + (b.x - a.x) * s / steps, z: a.z + (b.z - a.z) * s / steps });
}

const client = new Client({ name: 'peiqi-ring-terrain', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  const terrain = await call('sample_terrain', { points: chain });
  const heights = (terrain.samples ?? terrain.points ?? terrain.results ?? []).map((s) => s.height_m ?? s.height ?? s.y ?? null);
  console.log('=== chain heights ===');
  chain.forEach((p, index) => {
    const previous = heights[index - 1];
    const slope = index && previous != null && heights[index] != null
      ? Math.abs(heights[index] - previous) / Math.hypot(p.x - chain[index - 1].x, p.z - chain[index - 1].z)
      : null;
    console.log(`${String(index).padStart(2)} (${p.x.toFixed(0)},${p.z.toFixed(0)}) h=${heights[index]} slope=${slope == null ? '-' : (slope * 100).toFixed(1) + '%'}`);
  });
  const water = await call('read_surface_water_mask', {
    bounds: { min_x: -1450, min_z: -1560, max_x: 400, max_z: 220 }, cell_size_m: 32, water_threshold_m: 0.02, limit: 1024,
  });
  const wet = (water.cells ?? []).filter((c) => c.water);
  console.log('=== water cells near ring ===', wet.length, wet.slice(0, 6).map((c) => ({ x: c.x, z: c.z, d: c.water_depth_m })));
} finally {
  await client.close();
}
