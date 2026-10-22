// 把所有规划建筑绑定到实际道路边：调用 bind_city_plan_buildings 的本地实现，
// 产出带 road_edge_id / 精确位置 / 旋转的新规划文件。此步不建任何永久建筑。
//
//   node tools/scratch/bind-hexagon-town-buildings.mjs [--dry-run]
//     [--from plans/xxx.json] [--out plans/yyy.json] [--ids bld-001,bld-002]
//     [--radius 220] [--candidates 8] [--attempts 8] [--side either]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bindCityPlanBuildings } from '../../mcp/city-plan-building-binder.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const arg = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : undefined; };
const srcPath = resolve(arg('from') ?? 'plans/peiqi-hexagon-town-lattice.json');
const outPath = resolve(arg('out') ?? 'plans/peiqi-hexagon-town-bound.json');
const doc = JSON.parse(readFileSync(srcPath, 'utf8'));
const { bounds, plan } = doc;

const only = (arg('ids') ?? '').split(',').filter(Boolean);
const dryRun = process.argv.includes('--dry-run');
const radius = Number(arg('radius') ?? 220);
const candidateCount = Number(arg('candidates') ?? 8);
const attempts = Number(arg('attempts') ?? 8);
const side = arg('side') ?? 'either';

const statusEnvelope = await queryGame('get_game_status', {});
const status = statusEnvelope.data ?? {};
console.log('from', srcPath);
console.log('city', status.city_name, '| paused', status.paused, '| session', statusEnvelope.meta?.session_id);

const sourcePlanId = computeCityPlanId(bounds, plan);
console.log('source plan_id', sourcePlanId, '| declared', doc.plan_id, '| 一致:', sourcePlanId === doc.plan_id);

const buildings = plan.buildings ?? [];
if (only.length) {
  const missing = only.filter(id => !buildings.some(b => b.id === id));
  if (missing.length) { console.log('选择的 id 不存在:', missing.join(', ')); process.exit(1); }
}

if (dryRun) {
  const target = only.length ? buildings.filter(b => only.includes(b.id)) : buildings;
  console.log('目标建筑数', target.length);
  console.log('已有 road_edge_id:', target.filter(b => b.road_edge_id).length);
  console.log('placement_status:', JSON.stringify(target.reduce((a, b) => (a[b.placement_status ?? 'null'] = (a[b.placement_status ?? 'null'] ?? 0) + 1, a), {})));
  process.exit(0);
}

const requestId = 'peiqi-hexagon-bind-' + Date.now();
console.log('binding request_id', requestId, '| radius', radius, '| candidates', candidateCount, '| attempts', attempts, '| side', side);

const result = await bindCityPlanBuildings({
  request_id: requestId, bounds, plan, building_ids: only,
  search_radius_m: radius, road_side: side, candidate_count: candidateCount,
  max_preview_attempts: attempts, operation_timeout_ms: 20000, continue_on_error: true,
});

console.log('state', result.state, '| selected', result.selected_count, '| bound', result.bound_count,
  '| unresolved', result.unresolved_count, '| failed', result.failed_count,
  '| 全部预览已取消:', result.native_previews_cancelled_after_verification,
  '| recovery_required', result.recovery_required);
for (const r of result.results) {
  if (r.state !== 'bound') console.log('  ! ' + r.building_id + ' ' + r.state + ' ' + (r.error ?? ''));
  else console.log('  ✓ ' + r.building_id + ' @(' + r.position.x.toFixed(1) + ',' + r.position.z.toFixed(1) + ') rot=' + r.rotation_degrees + ' edge=' + (r.road_edge_id ?? 'none'));
}

const priorBinding = doc.binding ?? {};
const out = {
  ...doc,
  plan_id: result.plan_id,
  plan: result.plan,
  binding: {
    ...priorBinding,
    source_plan_id: result.source_plan_id,
    bound_plan_id: result.plan_id,
    bound_at_utc: new Date().toISOString(),
    last_request_id: requestId,
    last_batch_ids: only.length ? only : buildings.map(b => b.id),
    summary: { selected: result.selected_count, bound: result.bound_count, unresolved: result.unresolved_count, failed: result.failed_count },
    last_results: result.results,
    history: [...(priorBinding.history ?? []), { at_utc: new Date().toISOString(), request_id: requestId, ids: only.length ? only : null, summary: { selected: result.selected_count, bound: result.bound_count, unresolved: result.unresolved_count, failed: result.failed_count } }],
  },
};
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('written', outPath);
console.log('new plan_id', result.plan_id);

const stillFailed = (result.plan.buildings ?? []).filter(b => b.placement_status === 'failed').map(b => b.id);
console.log('累计仍失败:', stillFailed.length, stillFailed.join(', '));
