// 二分诊断：逐段 preview_road → poll → cancel，找出被拒路段。
import { readFile } from 'node:fs/promises';
const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const transport = new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs'],
});
const client = new Client({ name: 'diag', version: '1.0.0' });
await client.connect(transport);
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content || []).map(c => c.text || '').join('\n');
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
const sleep = ms => new Promise(res => setTimeout(res, ms));

// 街道折线（与规划一致）：西一街北段 x=128, z -1440..-2240
const zs = [-1440, -1600, -1760, -1920, -2080, -2240];
for (let i = 0; i < zs.length - 1; i++) {
  const req = `diag-x128-s${i + 1}`;
  const made = await call('preview_road', {
    request_id: req, road_prefab: 'Small Road',
    start: { x: 128, z: zs[i] }, end: { x: 128, z: zs[i + 1] },
  });
  if (!made.ok) { console.log(`seg${i + 1}: 调用失败 ${made.error?.code || made.raw}`); continue; }
  const op = made.data;
  let st = op.state, detail = { cost: op.cost, err: op.error, targets: [op.start_target_kind, op.end_target_kind] };
  for (let k = 0; k < 10 && (st === 'queued' || st === 'running'); k++) {
    await sleep(300);
    const g = await call('get_road_operation', { operation_id: op.operation_id });
    st = g.data?.state; detail = { cost: g.data?.cost, err: g.data?.error, errors: g.data?.errors, targets: [g.data?.start_target_kind, g.data?.end_target_kind], edges: g.data?.segments?.length };
  }
  console.log(`seg${i + 1} (${zs[i]}→${zs[i + 1]}): ${st} ${JSON.stringify(detail)}`);
  if (st === 'preview_ready') await call('cancel_road_preview', { operation_id: op.operation_id });
}
await transport.close();
