import { queryGame } from '../../mcp/bridge-client.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mode = process.argv[2]; // 'preview-demo' | 'commit-demo' | 'test'
const ids = (process.argv[3] ?? '').split(',').filter(Boolean);

if (mode === 'preview-demo') {
  const rid = 'demo-dup-' + Date.now();
  const q = await queryGame('preview_road_batch_demolition', { request_id: rid, edge_ids: ids, response_detail: 'full' });
  const opId = q.data.operation_id;
  let d;
  for (let i = 0; i < 100; i++) {
    const r = await queryGame('get_road_operation', { operation_id: opId });
    d = r.data;
    if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) break;
    await sleep(90);
  }
  console.log('PREVIEW', d.state, 'can_commit=' + d.can_commit, 'cost=' + d.cost, 'errors=' + JSON.stringify(d.errors), 'warn=' + JSON.stringify(d.warnings ?? []));
  console.log('operation_id=' + opId, 'request_id=' + rid);
} else if (mode === 'commit-demo') {
  const opId = process.argv[3];
  const rid = process.argv[4];
  const maxCost = Number(process.argv[5] ?? 0);
  try {
    const r = await queryGame('build_road', { operation_id: opId, request_id: rid, max_cost: maxCost });
    console.log('apply queued', JSON.stringify(r.data).slice(0, 200));
  } catch (e) { console.log('apply ERR', e.code, e.message); process.exit(1); }
  let d;
  for (let i = 0; i < 150; i++) {
    const r = await queryGame('get_road_operation', { operation_id: opId });
    d = r.data;
    if (['completed', 'failed'].includes(d.state)) break;
    await sleep(120);
  }
  console.log('RESULT', d.state, 'errors=' + JSON.stringify(d.errors ?? d.error ?? []));
} else if (mode === 'test') {
  const rid = 'post-test-' + Date.now();
  const q = await queryGame('preview_road', { request_id: rid, response_detail: 'summary', road_prefab: 'Small Road', start: { x: 160, z: -1248 }, end: { x: 160, z: -1136 } });
  const opId = q.data.operation_id;
  let d;
  for (let i = 0; i < 100; i++) {
    const r = await queryGame('get_road_operation', { operation_id: opId });
    d = r.data;
    if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) break;
    await sleep(90);
  }
  console.log('TEST v-037 state=' + d.state, 'cost=' + d.cost, 'errors=' + JSON.stringify(d.errors ?? d.error ?? []));
  if (d.state === 'preview_ready') { await queryGame('cancel_road_preview', { operation_id: opId }); console.log('(preview cancelled)'); }
}
