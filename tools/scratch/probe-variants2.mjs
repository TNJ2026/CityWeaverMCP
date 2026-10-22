import { queryGame } from '../../mcp/bridge-client.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tryRoad(label, args, tool = 'preview_road') {
  const rid = ('probe-' + label + '-' + Date.now()).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 90);
  let op;
  try { const q = await queryGame(tool, { request_id: rid, response_detail: 'summary', ...args }); op = q.data; }
  catch (e) { console.log(label.padEnd(14), 'THROW', e.code, e.message); return; }
  for (let i = 0; i < 60; i++) {
    const r = await queryGame('get_road_operation', { operation_id: op.operation_id });
    const d = r.data ?? {};
    if (d.state && !['queued', 'executing', 'pending'].includes(d.state)) {
      console.log(label.padEnd(14), d.state.padEnd(16), 'cost=' + d.cost, 'errors=' + JSON.stringify(d.errors ?? d.error ?? null).slice(0, 100));
      if (d.state === 'preview_ready') await queryGame('cancel_road_preview', { operation_id: op.operation_id });
      return;
    }
    await sleep(100);
  }
  console.log(label.padEnd(14), 'TIMEOUT');
}
const S = { road_prefab: 'Small Road' };
// 已知已建区域附近的新位置（远处，确认全局是否正常）
await tryRoad('far-e', { ...S, start: { x: 272, z: -1584 }, end: { x: 272, z: -1472 } });
await tryRoad('center', { ...S, start: { x: -400, z: -1248 }, end: { x: -400, z: -1136 } });
await tryRoad('west', { ...S, start: { x: -512, z: -1248 }, end: { x: -512, z: -1136 } });
await tryRoad('x160-north', { ...S, start: { x: 160, z: -800 }, end: { x: 160, z: -688 } });
await tryRoad('x160-south', { ...S, start: { x: 160, z: -1920 }, end: { x: 160, z: -1808 } });
