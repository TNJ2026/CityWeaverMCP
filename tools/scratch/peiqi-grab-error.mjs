// 在失败预览存活窗口内抓取 Game.Tools.Error 实体，读出游戏拒绝的真实原因。
//   node tools/scratch/peiqi-grab-error.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'peiqi-grab-error', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 200)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  await call('set_simulation_speed', { speed: 'paused' });

  const schema = await call('get_component_schema', { component: 'Game.Tools.Error' });
  console.log('=== Game.Tools.Error schema ===');
  console.log(JSON.stringify(schema).slice(0, 1400));

  const grab = async () => {
    const found = await call('query_entities', {
      category: 'all', all_components: ['Game.Tools.Error'],
      include_components: ['Game.Tools.Error'], include_prefabs: true, limit: 20, buffer_limit: 8,
    });
    return found;
  };
  console.log('=== baseline errors ===', JSON.stringify(await grab()).slice(0, 400));

  const started = await call('preview_road', {
    request_id: `peiqigrab_${Date.now()}`, road_prefab: 'Large Road',
    start: { x: -1400, z: -480 }, end: { x: -1366.4, z: -583.2 },
  });
  const id = started.operation_id;
  const seen = [];
  for (let i = 0; i < 25; i++) {
    const [state, errors] = await Promise.all([
      call('get_road_operation', { operation_id: id }),
      grab(),
    ]);
    const count = errors.total ?? errors.count ?? errors.items?.length ?? 0;
    if (count > 0) seen.push({ tick: i, state: state.state, errors });
    if (['failed', 'preview_ready', 'cancelled', 'expired', 'outcome_unknown'].includes(state.state)) { seen.push({ tick: i, final_state: state.state }); break; }
  }
  console.log('=== captured ===');
  console.log(JSON.stringify(seen).slice(0, 3000));
  try { await call('cancel_road_preview', { operation_id: id }); } catch { /* ignore */ }
} finally {
  await client.close();
}
