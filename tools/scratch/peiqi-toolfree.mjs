// 试探游戏是否已释放道路工具：发起一次极小预览、轮询、取消。
//   node tools/scratch/peiqi-toolfree.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'peiqi-toolfree', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 200)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  await call('set_simulation_speed', { speed: 'paused' });
  const started = await call('preview_road', {
    request_id: `peiqi_toolfree_${Date.now()}`,
    road_prefab: 'Small Road',
    start: { x: -520, z: -700 },
    end: { x: -488, z: -700 },
  });
  const id = started.operation_id;
  let state = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const q = await call('get_road_operation', { operation_id: id });
    state = q.state;
    if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(state)) break;
    await sleep(300);
  }
  console.log(JSON.stringify({ operation_id: id, state }));
  try { await call('cancel_road_preview', { operation_id: id }); console.log('cancelled'); } catch (e) { console.log('cancel failed', String(e.message).slice(0, 200)); }
} catch (e) {
  console.log('TOOL STATE:', String(e.message).slice(0, 300));
} finally {
  await client.close();
}
