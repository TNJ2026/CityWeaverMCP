// 查失败点 (-1366,-583) 附近的地物与地表对象，并做更细的角度二分。
//   node tools/scratch/peiqi-bisect2.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'peiqi-bisect2', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 200)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  await call('set_simulation_speed', { speed: 'paused' });

  const landscape = await call('analyze_landscape_area', { x: -1366, z: -600, radius_m: 260, kind: 'all' });
  console.log('=== landscape near failing point ===');
  console.log(JSON.stringify(landscape).slice(0, 900));
  const listed = await call('list_landscape_objects', { x: -1366, z: -600, radius_m: 260, kind: 'all', limit: 20 });
  console.log('=== landscape objects ===');
  console.log(JSON.stringify(listed).slice(0, 900));

  const pollution = await call('sample_pollution', { points: [{ x: -1366, z: -583 }, { x: -1400, z: -600 }, { x: -1366, z: -686 }] });
  console.log('=== pollution ===', JSON.stringify(pollution).slice(0, 400));

  const V1 = { x: -1400, z: -480 };
  const test = async (label, start, end) => {
    try {
      const started = await call('preview_road', { request_id: `peiqib2_${label}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '_'), road_prefab: 'Large Road', start, end });
      const id = started.operation_id;
      let state = null;
      for (let i = 0; i < 80; i++) {
        const q = await call('get_road_operation', { operation_id: id });
        state = q.state;
        if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(state)) break;
        await sleep(200);
      }
      if (state !== 'failed') { try { await call('cancel_road_preview', { operation_id: id }); } catch { /* ignore */ } }
      console.log(JSON.stringify({ label, start, end, state }));
    } catch (e) { console.log(JSON.stringify({ label, state: 'tool_error', error: String(e.message).slice(0, 140) })); }
  };
  await test('so_from_V1', V1, { x: -1400, z: -600 });
  await test('so_to_mid', { x: -1400, z: -600 }, { x: -1366.4, z: -583.2 });
  await test('V1_x1366_z600', V1, { x: -1366.4, z: -600 });
  await test('V1_x1380_z583', V1, { x: -1380, z: -583.2 });
  await test('V1_to_mid_short', V1, { x: -1383.2, z: -531.6 });
} finally {
  await client.close();
}
