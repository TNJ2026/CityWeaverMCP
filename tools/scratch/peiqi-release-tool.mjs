// 尝试通过推进/暂停模拟来释放被占用的道路工具，然后重试一次极小预览。
//   node tools/scratch/peiqi-release-tool.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'peiqi-release-tool', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 220)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  const attempt = async (label) => {
    try {
      const started = await call('preview_road', { request_id: `peiqi_toolfree_${Date.now()}`, road_prefab: 'Small Road', start: { x: -520, z: -700 }, end: { x: -488, z: -700 } });
      const id = started.operation_id;
      for (let i = 0; i < 60; i++) {
        const q = await call('get_road_operation', { operation_id: id });
        if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(q.state)) { await call('cancel_road_preview', { operation_id: id }); return `${label}: FREE (state=${q.state}, cancelled)`; }
        await sleep(250);
      }
      return `${label}: started but never settled`;
    } catch (e) { return `${label}: BUSY (${String(e.message).slice(0, 120)})`; }
  };

  console.log(await attempt('before'));
  await call('set_simulation_speed', { speed: 'normal' });
  await sleep(4000);
  await call('set_simulation_speed', { speed: 'paused' });
  await sleep(1500);
  console.log(await attempt('after-normal-cycle'));
  await call('set_simulation_speed', { speed: 'fast' });
  await sleep(6000);
  await call('set_simulation_speed', { speed: 'paused' });
  await sleep(1500);
  console.log(await attempt('after-fast-cycle'));
} finally {
  await client.close();
}
