import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  assertScriptResolved,
  describePlanWithStamp,
  loadTargets,
  matchesPlannedBuilding,
  parseArgs,
  runMain,
  selectTargets,
} from '../lib/plan-targets.mjs';

// 只读阶段验收：回读规划范围内的设施与城市摘要。
// 目标清单与读取范围都来自权威清单 + 规划文件，脚本内不写死 prefab 或 bounds。
//
// 用法：node tools/scratch/verify-public-services-phase.mjs [--plan master]

await runMain(async () => {
  const args = parseArgs();
  const loaded = await loadTargets({
    planKey: typeof args.plan === 'string' ? args.plan : null,
    planPath: typeof args['plan-file'] === 'string' ? args['plan-file'] : null,
  });

  assertScriptResolved(loaded, 'verify');
  const targets = selectTargets(loaded, 'verify');

  if (!loaded.bounds) throw new Error('规划文件里没有 bounds，无法确定验收范围。');

  const [status, summary, buildings] = await Promise.all([
    queryGame('get_game_status', {}),
    queryGame('get_city_summary', {}),
    queryGame('get_planning_map_snapshot', {
      bounds: loaded.bounds,
      include_roads: false,
      include_buildings: true,
      include_tracks: false,
      include_utilities: false,
      max_features_per_layer: 5000,
    }),
  ]);

  const allBuildings = buildings.data?.buildings ?? [];
  const matches = targets.map(target => {
    const candidates = allBuildings.filter(item => item.prefab === target.prefab).map(item => ({
      item,
      position_error_m: Math.hypot(
        Number(item.position?.x) - Number(target.position?.x),
        Number(item.position?.z) - Number(target.position?.z),
      ),
    })).sort((a, b) => a.position_error_m - b.position_error_m);
    const nearest = candidates[0] ?? null;
    return {
      plan_id: target.plan_id,
      prefab: target.prefab,
      planned_position: target.position,
      found: Boolean(nearest && matchesPlannedBuilding(target, nearest.item)),
      nearest_position_error_m: nearest?.position_error_m ?? null,
      building: nearest?.item ?? null,
    };
  });

  process.stdout.write(`${JSON.stringify({
    plan: await describePlanWithStamp(loaded),
    status: status.data,
    summary: summary.data,
    expected_prefabs: targets.map(target => target.prefab),
    missing_prefabs: matches.filter(item => !item.found).map(item => item.prefab),
    expected_targets: matches.map(({ building, ...target }) => target),
    missing_targets: matches.filter(item => !item.found).map(({ building, ...target }) => target),
    public_services: matches.filter(item => item.found).map(item => item.building),
  }, null, 2)}\n`);
});
