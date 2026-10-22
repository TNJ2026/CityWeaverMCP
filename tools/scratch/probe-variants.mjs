import { queryGame } from '../../mcp/bridge-client.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tryRoad(label, args, tool = 'preview_road', extra = {}) {
  const rid = ('probe-' + label + '-' + Date.now()).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 90);
  let op;
  try {
    const q = await queryGame(tool, { request_id: rid, response_detail: 'summary', ...args, ...extra });
    op = q.data;
  } catch (e) { console.log(label.padEnd(10), 'THROW', e.code, e.message); return; }
  for (let i = 0; i < 60; i++) {
    const r = await queryGame('get_road_operation', { operation_id: op.operation_id });
    const d = r.data ?? {};
    if (d.state && !['queued', 'executing', 'pending'].includes(d.state)) {
      console.log(label.padEnd(10), d.state.padEnd(18), 'can_commit=' + d.can_commit, 'cost=' + d.cost,
        'errors=' + JSON.stringify(d.errors ?? d.error ?? null).slice(0, 120),
        'warn=' + JSON.stringify(d.warnings ?? []).slice(0, 120));
      if (d.state === 'preview_ready') await queryGame('cancel_road_preview', { operation_id: op.operation_id });
      return;
    }
    await sleep(100);
  }
  console.log(label.padEnd(10), 'TIMEOUT');
}

const S = { road_prefab: 'Small Road' };
const M = { road_prefab: 'Medium Road' };

await tryRoad('A-base', { ...S, start: { x: 160, z: -1248 }, end: { x: 160, z: -1136 } });
await tryRoad('B-inset8', { ...S, start: { x: 160, z: -1240 }, end: { x: 160, z: -1144 } });
await tryRoad('C-off8', { ...S, start: { x: 168, z: -1248 }, end: { x: 168, z: -1136 } });
await tryRoad('D-mid', { ...S, points: [{ x: 160, z: -1248 }, { x: 160, z: -1192 }, { x: 160, z: -1136 }] }, 'preview_road_route');
await tryRoad('E-med', { ...M, start: { x: 160, z: -1248 }, end: { x: 160, z: -1136 } });
await tryRoad('F-split', { ...S, start: { x: 160, z: -1248 }, end: { x: 160, z: -1176 } });
await tryRoad('G-short', { ...S, start: { x: 160, z: -1240 }, end: { x: 160, z: -1200 } });
