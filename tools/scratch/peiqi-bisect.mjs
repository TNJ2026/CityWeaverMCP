// 二分定位被游戏拒绝的路段：在 V1 及 V1→c6 段上做不同长度/方向的极小预览。
//   node tools/scratch/peiqi-bisect.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const V1 = { x: -1400, z: -480 };
const C6 = { x: -1332.8, z: -686.4 };
const MID = { x: (V1.x + C6.x) / 2, z: (V1.z + C6.z) / 2 };

const client = new Client({ name: 'peiqi-bisect', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 200)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  await call('set_simulation_speed', { speed: 'paused' });

  const test = async (label, start, end) => {
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    try {
      const started = await call('preview_road', { request_id: `peiqibisect_${label}_${Date.now()}`, road_prefab: 'Large Road', start, end });
      const id = started.operation_id;
      let state = null, errors = null;
      for (let i = 0; i < 80; i++) {
        const q = await call('get_road_operation', { operation_id: id });
        state = q.state; errors = q.errors ?? q.native_preview?.errors ?? null;
        if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(state)) break;
        await sleep(200);
      }
      if (state !== 'failed') { try { await call('cancel_road_preview', { operation_id: id }); } catch { /* ignore */ } }
      console.log(JSON.stringify({ label, length_m: Math.round(length), state, errors }));
    } catch (e) { console.log(JSON.stringify({ label, length_m: Math.round(length), state: 'tool_error', error: String(e.message).slice(0, 160) })); }
  };

  await test('V1_to_mid', V1, MID);
  await test('mid_to_c6', MID, C6);
  await test('V1_east_120', V1, { x: V1.x + 120, z: V1.z });
  await test('V1_to_c6_full', V1, C6);
  await test('V1_south_120', V1, { x: V1.x, z: V1.z - 120 });
  await test('mid_to_c6_shift_east', { x: MID.x + 60, z: MID.z }, C6);
} finally {
  await client.close();
}
