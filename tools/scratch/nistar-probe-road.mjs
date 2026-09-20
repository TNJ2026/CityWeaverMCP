// 只读诊断：对任意路线做原生道路预览，返回状态与错误；可选 cancel 后退出。
// 用法：node tools/scratch/nistar-probe-road.mjs "<prefab>" "x,z x,z ..." [cancel]
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const prefab = process.argv[2];
const points = process.argv[3].trim().split(/\s+/).map((s) => {
  const [x, z] = s.split(',').map(Number);
  return { x, z };
});
const doCancel = process.argv[4] === 'cancel';

const client = new Client({ name: 'nistar-probe-road', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  const rid = `probe_${Date.now()}`;
  const r = await client.callTool({ name: 'preview_road_route', arguments: { request_id: rid, road_prefab: prefab, points } }, undefined, { timeout: 120000 });
  const d = r.structuredContent ?? {};
  console.log(JSON.stringify({ ok: d.ok, state: d.data?.state, cost: d.data?.cost, errors: d.data?.errors, error: d.error ?? d.data?.error, operation_id: d.data?.operation_id }));
  if (doCancel && d.data?.operation_id) {
    const c2 = await client.callTool({ name: 'cancel_road_preview', arguments: { operation_id: d.data.operation_id } });
    console.log('cancel:', c2.structuredContent?.ok ?? c2.isError);
  }
} finally {
  await client.close();
}
