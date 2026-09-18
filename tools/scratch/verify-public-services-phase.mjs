import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  assertScriptResolved,
  describePlanWithStamp,
  loadTargets,
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
  const prefabs = selectTargets(loaded, 'verify').map(target => target.prefab);

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

  const items = (buildings.data?.buildings ?? []).filter(item => prefabs.includes(item.prefab));
  const foundPrefabs = new Set(items.map(item => item.prefab));

  process.stdout.write(`${JSON.stringify({
    plan: await describePlanWithStamp(loaded),
    status: status.data,
    summary: summary.data,
    expected_prefabs: prefabs,
    missing_prefabs: prefabs.filter(prefab => !foundPrefabs.has(prefab)),
    public_services: items,
  }, null, 2)}\n`);
});
