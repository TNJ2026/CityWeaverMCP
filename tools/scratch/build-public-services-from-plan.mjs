import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  advanceCityPlanConstruction,
  prepareCityPlanConstruction,
} from '../../mcp/city-plan-construction-workflow.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import {
  assertScriptResolved,
  describePlanWithStamp,
  formatFailure,
  loadTargets,
  matchesPlannedBuilding,
  parseArgs,
  runMain,
  selectTargets,
} from '../lib/plan-targets.mjs';

// 写入游戏：从规划文件抽取待建公共服务，走规划图分阶段施工流程，可能永久提交建筑。
// 只有用户明确授权当前存档施工后才能运行。
//
// 目标与坐标来自权威清单 + 规划文件。只有同 prefab 且位于目标坐标 2 米内的设施才跳过；
// 属于本方案、尚未建成、却在规划文件里找不到坐标的设施会在开始施工前显式报错，
// 不会再跑到中途崩在某一栋上。
//
// 用法：node tools/scratch/build-public-services-from-plan.mjs [--plan master]

// 施工过程中的进度累计，供中断时报告「已经建成什么」。
const completed = [];
let totalCost = 0;

function output(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

await runMain(async () => {
  const args = parseArgs();
  const loaded = await loadTargets({
    planKey: typeof args.plan === 'string' ? args.plan : null,
    planPath: typeof args['plan-file'] === 'string' ? args['plan-file'] : null,
  });

  const bounds = loaded.bounds;
  if (!bounds) throw new Error('规划文件里没有 bounds，无法施工。');

  const timeout = 30_000;

  output('plan', await describePlanWithStamp(loaded));

  const snapshot = await queryGame('get_planning_map_snapshot', {
    bounds,
    include_roads: false,
    include_buildings: true,
    include_tracks: false,
    include_utilities: false,
    max_features_per_layer: 5000,
  });
  const targets = selectTargets(loaded, 'construction');
  assertScriptResolved(loaded, 'construction');

  const existingBuildings = snapshot.data?.buildings ?? [];
  const isExistingTarget = target => existingBuildings.some(item => matchesPlannedBuilding(target, item));
  const skippedExistingTargets = targets.filter(isExistingTarget).map(target => ({
    prefab: target.prefab,
    plan_id: target.plan_id,
  }));
  const skippedExisting = skippedExistingTargets.map(target => target.prefab);

  const pendingTargets = targets.filter(target => !isExistingTarget(target));
  const buildings = pendingTargets.map((target, index) => ({
    ...target.building,
    id: target.script_id,
    category: target.domain,
    construction_order: index + 1,
    construction_status: 'planned',
  }));

  const plan = { roads: [], grids: [], zones: [], tracks: [], utilities: [], buildings };
  const approvedPlanId = computeCityPlanId(bounds, plan);

  async function cancelPreview(preview) {
    if (!preview.cancel_action) return;
    await queryGame(preview.cancel_action.tool, preview.cancel_action.arguments);
  }

  async function advanceWithToolRecovery(advanceArgs) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await advanceCityPlanConstruction(advanceArgs);
      } catch (error) {
        if (error?.code !== 'TOOL_BUSY' || attempt >= 2) throw error;
        output('tool_busy_recovery', { batch_id: advanceArgs.batch_id, attempt: attempt + 1 });
        await queryGame('set_simulation_speed', { speed: 'normal' });
        await new Promise(resolve => setTimeout(resolve, 450));
        await queryGame('set_simulation_speed', { speed: 'paused' });
      }
    }
  }

  try {
    const prepared = await prepareCityPlanConstruction({
      bounds,
      plan,
      approved_plan_id: approvedPlanId,
    });
    output('prepared', {
      city: prepared.city,
      session_id: prepared.session_id,
      plan_id: prepared.plan_id,
      construction_ready: prepared.construction_ready,
      batch_count: prepared.native_batch_count,
      skipped_existing: skippedExisting,
      skipped_existing_targets: skippedExistingTargets,
      order: prepared.execution_order.map(item => ({ batch_id: item.batch_id, prefab: item.building_prefab })),
    });
    if (!prepared.construction_ready) throw new Error('该公共服务阶段尚未满足施工条件。');

    for (const batch of prepared.execution_order) {
      const preview = await advanceWithToolRecovery({
        action: 'preview_batch',
        bounds,
        plan,
        approved_plan_id: approvedPlanId,
        expected_session_id: prepared.session_id,
        batch_id: batch.batch_id,
        request_id: `${approvedPlanId}-${batch.batch_id}-preview`,
        operation_timeout_ms: timeout,
      });
      output('preview', {
        batch_id: batch.batch_id,
        prefab: batch.building_prefab,
        state: preview.state,
        success: preview.success,
        operation_id: preview.native_preview?.operation_id,
        cost: preview.native_preview?.cost,
        warnings: preview.native_preview?.warnings,
        errors: preview.native_preview?.errors,
        error: preview.native_preview?.error,
      });
      if (!preview.success || preview.state !== 'preview_ready') {
        output('stopped', { reason: 'preview_not_ready', batch_id: batch.batch_id, completed, total_cost: totalCost });
        process.exitCode = 2;
        break;
      }
      if ((preview.native_preview?.errors ?? []).length || preview.native_preview?.error) {
        await cancelPreview(preview);
        output('stopped', { reason: 'preview_errors', batch_id: batch.batch_id, completed, total_cost: totalCost });
        process.exitCode = 3;
        break;
      }

      const commit = await advanceWithToolRecovery({
        ...preview.next_action.arguments,
        operation_timeout_ms: timeout,
      });
      output('commit', {
        batch_id: batch.batch_id,
        prefab: batch.building_prefab,
        state: commit.state,
        success: commit.success,
        operation_id: commit.native_operation?.operation_id,
        cost: commit.native_operation?.cost,
        errors: commit.native_operation?.errors,
        error: commit.native_operation?.error,
        result_entity_ids: commit.native_operation?.result_entity_ids,
        permanent_readback: commit.permanent_readback,
      });
      if (!commit.success || commit.state !== 'completed_verified') {
        output('stopped', { reason: 'commit_not_verified', batch_id: batch.batch_id, completed, total_cost: totalCost });
        process.exitCode = 4;
        break;
      }
      totalCost += Number(commit.native_operation?.cost ?? 0);
      completed.push({
        batch_id: batch.batch_id,
        prefab: batch.building_prefab,
        cost: Number(commit.native_operation?.cost ?? 0),
        building_ids: commit.permanent_readback?.building_ids ?? [],
      });
    }

    output('final', {
      plan_key: loaded.planKey,
      plan_id: approvedPlanId,
      completed_count: completed.length,
      requested_count: prepared.native_batch_count,
      total_cost: totalCost,
      completed,
      all_completed: completed.length === prepared.native_batch_count,
    });
  } catch (error) {
    output('fatal', {
      ...formatFailure(error),
      completed,
      total_cost: totalCost,
    });
    process.exitCode = 1;
  }
});
