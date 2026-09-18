import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  assertScriptResolved,
  describePlanWithStamp,
  loadTargets,
  parseArgs,
  runMain,
  selectTargets,
} from '../lib/plan-targets.mjs';

// 只读刷新规划建筑附近的实时道路候选，用于确认规划坐标在当道路拓扑下仍然可接入。
// 目标与坐标来自权威清单 + 规划文件；脚本内不写死 prefab 或位置。
//
// 用法：node tools/scratch/refresh-public-service-road-bindings.mjs [--plan master]

await runMain(async () => {
  const args = parseArgs();
  const loaded = await loadTargets({
    planKey: typeof args.plan === 'string' ? args.plan : null,
    planPath: typeof args['plan-file'] === 'string' ? args['plan-file'] : null,
  });

  assertScriptResolved(loaded, 'refresh');
  const targets = selectTargets(loaded, 'refresh');

  const results = [];

  for (const target of targets) {
    const transport = target.domain === 'transport_facility';
    const response = await queryGame(
      transport ? 'plan_transport_facility_site' : 'plan_city_service_site',
      {
        building_prefab: target.prefab,
        near: { x: target.position.x, z: target.position.z },
        mode: 'auto',
        search_radius_m: 96,
        road_side: 'either',
        candidate_count: 12,
        reserve_upgrade_prefabs: [],
        ...(transport ? {} : { consider_service_coverage: false }),
      },
    );
    const candidates = (response.data?.candidates ?? []).map(candidate => ({
      position: candidate.position,
      rotation_degrees: candidate.rotation_degrees,
      road_edge_id: candidate.road_edge_id,
      road_prefab: candidate.road_prefab,
      approximate_collision: candidate.approximate_collision,
      transform_error: Math.hypot(
        candidate.position.x - target.position.x,
        candidate.position.z - target.position.z,
      ) + Math.abs(
        (((candidate.rotation_degrees - Number(target.rotation_degrees ?? 0)) + 540) % 360) - 180,
      ),
    })).sort((a, b) => a.transform_error - b.transform_error);

    results.push({
      prefab: target.prefab,
      script_id: target.script_id,
      planned: target.position,
      candidates: candidates.slice(0, 4),
    });
  }

  process.stdout.write(`${JSON.stringify({
    plan: await describePlanWithStamp(loaded),
    results,
  }, null, 2)}\n`);
});
