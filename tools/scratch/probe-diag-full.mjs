import { queryGame } from '../../mcp/bridge-client.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = 'diag-full-' + Date.now();
const q = await queryGame('preview_road', { request_id: rid, response_detail: 'full', road_prefab: 'Small Road', start: { x: 160, z: -1248 }, end: { x: 160, z: -1200 } });
const opId = q.data.operation_id;
let d;
for (let i = 0; i < 80; i++) {
  const r = await queryGame('get_road_operation', { operation_id: opId });
  d = r.data;
  if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) break;
  await sleep(90);
}
console.log('state', d.state);
for (const k of Object.keys(d)) {
  if (['segments', 'direct_changes'].includes(k)) continue;
  const v = d[k];
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
  console.log(k.padEnd(34), JSON.stringify(v).slice(0, 300));
}
console.log('--- segments ---');
console.log(JSON.stringify(d.segments, null, 1).slice(0, 1500));
