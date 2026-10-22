import { readFileSync } from 'node:fs';
import { queryGame } from '../../mcp/bridge-client.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const j = JSON.parse(readFileSync('plans/peiqi-hexagon-town-lattice.json', 'utf8'));
const plan = j.plan ?? j;

async function tryRoad(label, args) {
  const rid = ('scan-' + label + '-' + Date.now()).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 90);
  let op;
  try { const q = await queryGame('preview_road', { request_id: rid, response_detail: 'summary', ...args }); op = q.data; }
  catch (e) { return 'THROW:' + e.code; }
  for (let i = 0; i < 80; i++) {
    const r = await queryGame('get_road_operation', { operation_id: op.operation_id });
    const d = r.data ?? {};
    if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) {
      if (d.state === 'preview_ready') { await queryGame('cancel_road_preview', { operation_id: op.operation_id }); return 'OK'; }
      return 'FAIL:' + JSON.stringify(d.errors ?? d.error ?? d.state);
    }
    await sleep(90);
  }
  return 'TIMEOUT';
}

// 已建成的道路：收集其几何，避免与既有边冲突
const builtRoadIds = new Set();
for (const b of (plan.roads ?? [])) builtRoadIds.add(b.id);

// 扫描：沿 z 带，测试纵向 24m 短段
const cols = [...new Set((plan.roads ?? []).filter(r => r.id.startsWith('lattice-v')).map(r => r.points[0].x))].sort((a, b) => a - b);
console.log('lattice x columns:', cols.join(','));
const zTest = Number(process.argv[2] ?? -1192);
const half = Number(process.argv[3] ?? 12);
for (const x of cols) {
  const r = await tryRoad('x' + x, { road_prefab: 'Small Road', start: { x, z: zTest - half }, end: { x, z: zTest + half } });
  console.log('x=' + String(x).padStart(6), 'z=' + zTest, r);
}
