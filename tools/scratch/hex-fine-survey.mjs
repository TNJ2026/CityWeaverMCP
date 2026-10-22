// 细勘：候选六边形范围内的地形与水体边界（只读）。
import { writeFile } from 'node:fs/promises';
const ROOT = 'D:/Develop/game/CityWeaverMCP';
const SDK = `file:///${ROOT}/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(`${SDK}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);

const client = new Client({ name: 'hex-fine-survey', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [`${ROOT}/mcp/server.mjs`], cwd: `${ROOT}/mcp` });
const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

try {
  await client.connect(transport);

  // 候选六边形：C=(-400,-1248)，外接圆 896 m → 顶点 (±896, 0) / (±448, ±776)
  const xs = Array.from({ length: 16 }, (_, i) => -1300 + 120 * i);   // -1300 .. 500
  const zs = Array.from({ length: 16 }, (_, j) => -2024 + 104 * j);   // -2024 .. -464
  const points = [];
  for (const z of zs) for (const x of xs) points.push({ x, z });
  const t = await call('sample_terrain', { points });
  const items = t?.data?.items ?? [];
  const map = new Map(items.map(s => [`${Math.round(s.x)}|${Math.round(s.z)}`, s.height_m]));

  console.log('=== 六边形范围地形（x -1300..500 步长120 / z -2024..-464 步长104）===');
  console.log('x:      ' + xs.map(v => String(v).padStart(7)).join(''));
  const vals = [];
  for (const z of zs) {
    const row = xs.map(x => map.get(`${x}|${z}`));
    row.forEach(v => typeof v === 'number' && vals.push(v));
    console.log(`z=${String(z).padStart(5)} ` + row.map(v => (typeof v === 'number' ? v.toFixed(1) : '  ?  ').padStart(7)).join(''));
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  console.log(`min ${lo.toFixed(1)} / max ${hi.toFixed(1)} / 起伏 ${(hi - lo).toFixed(1)} m`);
  // 逐列统计（看东侧抬升从哪里开始）
  console.log('\n逐列高程范围：');
  for (let i = 0; i < xs.length; i++) {
    const col = zs.map(z => map.get(`${xs[i]}|${z}`)).filter(v => typeof v === 'number');
    if (!col.length) continue;
    const c0 = Math.min(...col), c1 = Math.max(...col);
    if (c1 - c0 > 0.3 || c0 > 618) console.log(`  x=${String(xs[i]).padStart(5)}: ${c0.toFixed(1)} .. ${c1.toFixed(1)}  (起伏 ${(c1 - c0).toFixed(1)})`);
  }

  // 精细水体：找东侧岸线
  const w = await call('read_surface_water_mask', {
    bounds: { min_x: 380, min_z: -2100, max_x: 900, max_z: -400 },
    cell_size_m: 64, limit: 1024
  });
  await writeFile(`${ROOT}/artifacts/hex-survey-water-fine.json`, JSON.stringify(w, null, 2));
  const cells = w?.data?.cells ?? [];
  const wet = cells.filter(c => (c.depth_m ?? 0) > 0.01);
  console.log(`\n=== 东侧岸线（cell 64 m，x 380..900 / z -2100..-400）===`);
  console.log(`总格 ${cells.length}，有水 ${wet.length}`);
  if (wet.length) {
    const minx = Math.min(...wet.map(c => c.x)), maxx = Math.max(...wet.map(c => c.x));
    const minz = Math.min(...wet.map(c => c.z)), maxz = Math.max(...wet.map(c => c.z));
    const maxd = Math.max(...wet.map(c => c.depth_m));
    console.log(`水体范围 x ${minx}..${maxx} / z ${minz}..${maxz}，最深 ${maxd.toFixed(2)} m`);
    const byCol = {};
    for (const c of wet) byCol[c.x] = Math.max(byCol[c.x] ?? 0, c.depth_m);
    console.log('各 x 列最大水深: ' + Object.keys(byCol).sort((a, b) => a - b).map(x => `${x}:${byCol[x].toFixed(1)}`).join('  '));
  } else {
    console.log('该范围内无地表水');
  }
  console.log('FINE SURVEY: OK');
} catch (e) {
  console.error('FINE SURVEY: FAIL -', e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
