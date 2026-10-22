// Preview (and optionally apply) a building-area boundary replacement via STDIO MCP,
// bypassing the host-side empty-schema validation bug on preview_building_area.
// Usage: node area-boundary.mjs <area_id> <x1,z1;x2,z2;...> [--apply] [--max-cost N]
import { spawn } from 'node:child_process';

const SERVER = 'D:/Develop/game/CityWeaverMCP/mcp/server.mjs';
const [, , areaId, boundaryArg, ...flags] = process.argv;
const doApply = flags.includes('--apply');
const mcIdx = flags.indexOf('--max-cost');
const maxCost = mcIdx >= 0 ? Number(flags[mcIdx + 1]) : 100000;

if (!areaId || !boundaryArg) {
  console.error('usage: node area-boundary.mjs <area_id> "x1,z1;x2,z2;..." [--apply] [--max-cost N]');
  process.exit(2);
}
const boundary = boundaryArg.split(';').map((p) => {
  const [x, z] = p.split(',').map(Number);
  return { x, z };
});

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
let nextId = 1;
child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const call = (method, params) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tool(name, args) {
  const r = await call('tools/call', { name, arguments: args });
  const t = r?.content?.[0]?.text;
  return t ? JSON.parse(t) : r;
}

async function main() {
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'area-boundary', version: '1.0.0' } });
  await call('notifications/initialized', {}).catch(() => {});

  const requestId = 'fishing-area-reroute-' + Date.now().toString(36);
  const pv = await tool('preview_building_area', {
    request_id: requestId,
    mode: 'boundary',
    area_id: areaId,
    boundary,
  });
  console.log('preview:', JSON.stringify(pv?.data ?? pv).slice(0, 800));
  const opId = pv?.data?.operation_id;
  if (!opId) throw new Error('no operation_id');

  let op;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    op = (await tool('get_building_area_operation', { operation_id: opId }))?.data;
    if (op && op.state !== 'pending' && op.state !== 'previewing') break;
  }
  console.log('state:', op?.state, 'cost:', op?.cost, 'errors:', JSON.stringify(op?.errors), 'warnings:', JSON.stringify(op?.warnings));
  console.log('surface_area_m2:', op?.surface_area_m2, 'resource:', JSON.stringify(op?.resource ?? op?.resource_amount ?? null));

  if (doApply && op?.state === 'preview_ready') {
    const ap = await tool('apply_building_area_operation', { operation_id: opId, request_id: requestId, max_cost: maxCost });
    console.log('apply:', JSON.stringify(ap?.data ?? ap).slice(0, 400));
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      op = (await tool('get_building_area_operation', { operation_id: opId }))?.data;
      if (op && (op.state === 'completed' || op.state === 'failed')) break;
    }
    console.log('final:', op?.state, 'result_area_id:', op?.result_area_id, 'errors:', JSON.stringify(op?.errors));
  }
  child.kill();
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); child.kill(); process.exit(1); });
