import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  assertScriptResolved,
  describePlanWithStamp,
  loadTargets,
  parseArgs,
  runMain,
  selectTargets,
} from '../lib/plan-targets.mjs';

// 只读重新选址：为当前规划方案中的每座设施请求原生候选点，不提交任何施工。
// 目标清单与坐标来自 tools/presets/weford-public-services.json + 规划文件，脚本内不写死。
//
// 用法：node tools/scratch/plan-public-service-relocation.mjs [--plan master]

await runMain(async () => {
  const args = parseArgs();
  const loaded = await loadTargets({
    planKey: typeof args.plan === 'string' ? args.plan : null,
    planPath: typeof args['plan-file'] === 'string' ? args['plan-file'] : null,
  });

  assertScriptResolved(loaded, 'relocation');
  const targets = selectTargets(loaded, 'relocation');
  if (targets.length === 0) throw new Error('relocation 在当前规划方案下没有任何目标。');

  const status = await queryGame('get_game_status', {});
  const results = [];

  for (const target of targets) {
    const planner = target.domain === 'transport_facility'
      ? 'plan_transport_facility_site'
      : 'plan_city_service_site';
    try {
      const response = await queryGame(planner, {
        building_prefab: target.prefab,
        near: { x: target.position.x, z: target.position.z },
        mode: 'auto',
        search_radius_m: 320,
        road_side: 'either',
        candidate_count: 16,
        reserve_upgrade_prefabs: [],
        ...(target.domain === 'city_service' ? { consider_service_coverage: false } : {}),
      });
      results.push({
        prefab: target.prefab,
        script_id: target.script_id,
        plan_id: target.plan_id,
        plan_label: target.plan_label,
        planned_position: target.position,
        ok: true,
        reserved_footprint_half_extents_m: response.data?.reserved_footprint_half_extents_m,
        candidates: (response.data?.candidates ?? [])
          .filter(candidate => !candidate.approximate_collision)
          .slice(0, 8)
          .map(candidate => ({
            index: candidate.index,
            position: candidate.position,
            rotation_degrees: candidate.rotation_degrees,
            road_edge_id: candidate.road_edge_id,
            road_prefab: candidate.road_prefab,
            road_side: candidate.road_side,
            distance_from_request_m: candidate.distance_from_request_m,
            site_terrain_relief_m: candidate.site_terrain_relief_m,
          })),
        rejected: response.data?.rejected,
      });
    } catch (error) {
      results.push({
        prefab: target.prefab,
        script_id: target.script_id,
        planned_position: target.position,
        ok: false,
        error: { code: error?.code ?? null, message: error?.message ?? String(error) },
      });
    }
  }

  process.stdout.write(`${JSON.stringify({
    plan: await describePlanWithStamp(loaded),
    status: status.data,
    results,
  }, null, 2)}\n`);
});
