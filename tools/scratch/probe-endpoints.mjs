import { queryGame } from '../../mcp/bridge-client.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tryRoad(label, start, end, prefab = 'Small Road') {
  const rid = ('t-' + label + '-' + Date.now()).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 90);
  let op;
  try { const q = await queryGame('preview_road', { request_id: rid, response_detail: 'summary', road_prefab: prefab, start, end }); op = q.data; }
  catch (e) { console.log(label.padEnd(24), 'THROW', e.code); return; }
  for (let i = 0; i < 80; i++) {
    const r = await queryGame('get_road_operation', { operation_id: op.operation_id });
    const d = r.data ?? {};
    if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) {
      if (d.state === 'preview_ready') { await queryGame('cancel_road_preview', { operation_id: op.operation_id }); console.log(label.padEnd(24), 'OK  cost=' + d.cost); return; }
      console.log(label.padEnd(24), 'FAIL', JSON.stringify(d.errors ?? d.error)); return;
    }
    await sleep(90);
  }
  console.log(label.padEnd(24), 'TIMEOUT');
}
await tryRoad('n160-1248 -> -1200', { x: 160, z: -1248 }, { x: 160, z: -1200 });
await tryRoad('s160-1136 -> -1184', { x: 160, z: -1136 }, { x: 160, z: -1184 });
await tryRoad('full -1248 -> -1136', { x: 160, z: -1248 }, { x: 160, z: -1136 });
await tryRoad('x156 vertical', { x: 156, z: -1248 }, { x: 156, z: -1136 });
await tryRoad('x160 -1248 -> -1192', { x: 160, z: -1248 }, { x: 160, z: -1192 });
await tryRoad('x160 -1192 -> -1136', { x: 160, z: -1192 }, { x: 160, z: -1136 });
