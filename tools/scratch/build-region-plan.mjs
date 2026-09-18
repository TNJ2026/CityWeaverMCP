import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  advanceCityPlanConstruction,
  prepareCityPlanConstruction,
} from '../../mcp/city-plan-construction-workflow.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { formatFailure, parseArgs, runMain } from '../lib/plan-targets.mjs';
import {
  filterAlreadyBuiltBatches,
  findCompletedPlannedBuildingIds,
  mayContinueAfterPreviewFailure,
  samplePolyline,
} from '../lib/construction-safety.mjs';

// 写入游戏：把 plans/ 下的规划文件按「规划图分阶段施工」流程落到当前存档。
// 只有用户明确授权施工后才能运行。
//
// 规划文件本身就是施工几何的唯一来源：脚本不保存任何坐标、路网 ID 或会话 ID。
// 为此它做四道闸，全部在任何一次写入之前生效：
//   1. 规划文件声明的 `city` 必须等于当前城市的 `city_name`（否则 CITY_MISMATCH）；
//   2. `computeCityPlanId(bounds, plan)` 必须等于文件里的 `plan_id`
//      （几何被改过却沿用旧哈希时立刻中止，而不是让游戏原生预览报怪错）；
//   3. 本阶段覆盖范围内已有的永久对象超过 `--max-existing`（默认 0）时中止，
//      避免把已经建好的东西再建一遍；
//   4. 资金低于 `--min-money`（默认 2,000,000）时中止。
//
// 阶段（--stage）只决定「执行哪些批次」，不改变送进施工器的 plan：
// 哈希必须覆盖完整规划，剥离批次会让 approved_plan_id 对不上。
//   roads（默认） | buildings | utilities | all
// 批次顺序是道路 → 建筑 → 管网；脚本只遍历属于本阶段的批次。
//
// 默认遇到被游戏拒绝的批次就停机（`--continue-on-failure` 改为记录后继续）。
// 继续模式用于「先摸清到底哪些批次建不成」：被拒批次的几何、prefab 与错误码
// 全部落在 `final.blocked_batches` 里，未建成的道路不会留下任何永久实体。
//
// 用法：
//   node tools/scratch/build-region-plan.mjs
//   node tools/scratch/build-region-plan.mjs --stage all
//   node tools/scratch/build-region-plan.mjs --stage roads --continue-on-failure
//   node tools/scratch/build-region-plan.mjs --plan-file plans/egelin-region-plan.json --stage roads

const STAGE_TYPES = {
  roads: ['grid', 'route'],
  buildings: ['building'],
  utilities: ['utility'],
  all: ['grid', 'route', 'building', 'utility'],
};

// 与 city-plan-construction-workflow.mjs 的 requestIdFor 保持一致：
// 同一批次重试必须复用同一个 request_id，否则游戏会把它当成第二次预览。
const requestIdFor = (planId, batchId, suffix) =>
  `${planId.replace('cplan-', 'cp_')}_${String(batchId).replace(/[^A-Za-z0-9_-]+/g, '_')}_${suffix}`.slice(0, 100);

const completed = [];
let totalCost = 0;
let logPath = null;

function output(event, data = {}) {
  const line = `${JSON.stringify({ event, ...data })}\n`;
  process.stdout.write(line);
  if (logPath) appendFileSync(logPath, line);
}

function fatal(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

await runMain(async () => {
  const args = parseArgs();
  const planFile = typeof args['plan-file'] === 'string' ? args['plan-file'] : 'plans/egelin-region-plan.json';
  const stage = typeof args.stage === 'string' ? args.stage : 'roads';
  const timeout = Number(args['operation-timeout-ms'] ?? 30_000);
  const maxExisting = Number(args['max-existing'] ?? 0);
  const minMoney = Number(args['min-money'] ?? 2_000_000);
  const continueOnFailure = args['continue-on-failure'] === true;

  if (!STAGE_TYPES[stage]) fatal('STAGE_UNKNOWN', `未知阶段 ${stage}；可用：${Object.keys(STAGE_TYPES).join(' / ')}`, { stage });
  const wantedTypes = new Set(STAGE_TYPES[stage]);

  const planPath = resolve(planFile);
  const document = JSON.parse(readFileSync(planPath, 'utf8'));
  const { bounds, plan, plan_id: declaredPlanId } = document;
  if (!bounds || !plan) fatal('PLAN_FILE_INCOMPLETE', `${planPath} 缺少 bounds 或 plan。`, { plan_file: planPath });

  const planId = computeCityPlanId(bounds, plan);
  if (declaredPlanId !== planId) {
    fatal('PLAN_HASH_STALE', `规划文件声明的 plan_id (${declaredPlanId}) 与 bounds+plan 复算结果 (${planId}) 不一致；几何被改过，必须先重新渲染并重新确认。`, { declared: declaredPlanId, recomputed: planId });
  }

  const status = (await queryGame('get_game_status', {})).data ?? {};
  if (!status.city_loaded) fatal('CITY_NOT_READY', '当前没有加载可玩的城市。', {});

  const declaredCity = document.city;
  if (declaredCity && args['allow-city-mismatch'] !== true && declaredCity !== status.city_name) {
    fatal('CITY_MISMATCH', `规划属于「${declaredCity}」，当前城市是「${status.city_name}」。`, { expected_city: declaredCity, actual_city: status.city_name });
  }

  const money = Number((await queryGame('get_city_economy', {})).data?.money ?? 0);
  if (money < minMoney) fatal('INSUFFICIENT_MONEY', `当前资金 ${money} 低于开工下限 ${minMoney}。`, { money, min_money: minMoney });

  const snapshotInBounds = layer => queryGame('get_planning_map_snapshot', {
    bounds,
    include_roads: layer === 'roads',
    include_buildings: layer === 'buildings',
    include_tracks: false,
    include_utilities: false,
    max_features_per_layer: 5000,
  }).then(envelope => envelope.data?.[layer] ?? []);

  // 只统计「规划自己会建的那种 prefab」。规划范围内原本就存在的东西
  // （本规划里是那截高速北向支线，三区大道要接它的端点）不算重复施工。
  //
  // 判定必须按「规划道路」而不是「道路边」：一条规划路会被游戏拆成 6~8 条边，
  // 直接数边会把 4 条已建规划路误读成 27 条和 6 条。用中点距离也不行——
  // 交叉点上的边中点会恰好落在另一条路的线上。这里用**覆盖率**：
  // 规划道路每 8 m 取一个采样点，至少 80% 的点落在永久道路 4 m 内才算已建成。
  const plannedRoadPrefabs = new Set((plan.roads ?? []).map(road => road.prefab));
  const permanentRoads = (await snapshotInBounds('roads')).filter(road => plannedRoadPrefabs.has(road.prefab));
  const permanentBuildings = await snapshotInBounds('buildings');
  const reentrantBuildingIds = findCompletedPlannedBuildingIds(plan.buildings, permanentBuildings);

  function sampleCurve(curve, step = 8) {
    const points = [];
    if (!curve) return points;
    const a = curve.a ?? curve;
    const d = curve.d ?? a;
    if (!curve.b || !curve.c) {
      const length = Math.hypot(d.x - a.x, d.z - a.z);
      const count = Math.max(1, Math.ceil(length / step));
      for (let index = 0; index <= count; index += 1) {
        const t = index / count;
        points.push({ x: a.x + (d.x - a.x) * t, z: a.z + (d.z - a.z) * t });
      }
      return points;
    }
    const length = Math.hypot(d.x - a.x, d.z - a.z);
    const count = Math.max(2, Math.ceil(length / step));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count, u = 1 - t;
      points.push({
        x: u * u * u * a.x + 3 * u * u * t * curve.b.x + 3 * u * t * t * curve.c.x + t * t * t * d.x,
        z: u * u * u * a.z + 3 * u * u * t * curve.b.z + 3 * u * t * t * curve.c.z + t * t * t * d.z,
      });
    }
    return points;
  }

  const permanentPoints = permanentRoads.flatMap(road => sampleCurve(road.curve, 8));
  const reentrantRoads = [];
  for (const planned of plan.roads ?? []) {
    const samples = samplePolyline(planned.points, 8);
    const covered = samples.filter(sample => permanentPoints.some(point => Math.hypot(point.x - sample.x, point.z - sample.z) <= 4)).length;
    if (covered / samples.length >= 0.8) reentrantRoads.push(planned.id);
  }

  const skipAlreadyBuilt = args['skip-already-built'] === true;
  if ((wantedTypes.has('grid') || wantedTypes.has('route')) && !skipAlreadyBuilt && reentrantRoads.length > maxExisting) {
    fatal('PLAN_BOUNDS_ALREADY_BUILT', `规划范围内已有 ${reentrantRoads.length} 条规划道路建成（上限 ${maxExisting}）：${reentrantRoads.join(', ')}。再跑一次会重复建路；确认要重跑请加 --max-existing ${reentrantRoads.length}。`, { existing_roads: reentrantRoads.length, existing_road_ids: reentrantRoads, max_existing: maxExisting });
  }
  if (wantedTypes.has('building') && !skipAlreadyBuilt && reentrantBuildingIds.length > maxExisting) {
    fatal('PLAN_BOUNDS_ALREADY_BUILT', `规划范围内已有 ${reentrantBuildingIds.length} 栋规划建筑建成（上限 ${maxExisting}）：${reentrantBuildingIds.join(', ')}。再跑一次会重复建造；确认要重跑请加 --max-existing ${reentrantBuildingIds.length}。`, { existing_buildings: reentrantBuildingIds.length, existing_building_ids: reentrantBuildingIds, max_existing: maxExisting });
  }

  mkdirSync(resolve('artifacts'), { recursive: true });
  logPath = resolve('artifacts', `region-plan-build-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

  output('start', {
    plan_file: planPath,
    plan_name: document.name ?? null,
    plan_id: planId,
    stage,
    stage_types: [...wantedTypes],
    continue_on_failure: continueOnFailure,
    city: status.city_name,
    paused: Boolean(status.paused),
    money,
    existing_roads_in_bounds: reentrantRoads.length,
    existing_buildings_in_bounds: reentrantBuildingIds.length,
    skip_already_built: skipAlreadyBuilt,
    log: logPath,
  });

  async function advanceWithRecovery(advanceArgs) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await advanceCityPlanConstruction(advanceArgs);
      } catch (error) {
        if (error?.code !== 'TOOL_BUSY' || attempt >= 2) throw error;
        output('tool_busy_recovery', { batch_id: advanceArgs.batch_id, attempt: attempt + 1 });
        await queryGame('set_simulation_speed', { speed: 'normal' });
        await new Promise(resolveTimer => setTimeout(resolveTimer, 450));
        await queryGame('set_simulation_speed', { speed: 'paused' });
      }
    }
  }

  const prepared = await prepareCityPlanConstruction({ bounds, plan, approved_plan_id: planId });
  const batches = prepared.execution_order ?? [];

  output('prepared', {
    plan_id: prepared.plan_id,
    state: prepared.state,
    construction_ready: prepared.construction_ready,
    road_count: prepared.road_count,
    native_batch_count: prepared.native_batch_count,
    sandbox_state: prepared.virtual_sandbox?.state,
    sandbox_errors: prepared.virtual_sandbox?.errors ?? [],
    batch_mix: [...batches.reduce((acc, batch) => acc.set(batch.batch_type, (acc.get(batch.batch_type) ?? 0) + 1), new Map())],
  });
  if (!prepared.construction_ready) {
    fatal('PLAN_NOT_CONSTRUCTION_READY', `施工前置检查未通过：${prepared.virtual_sandbox?.state ?? 'unknown'}。`, { errors: prepared.virtual_sandbox?.errors ?? [] });
  }

  const stageBatches = filterAlreadyBuiltBatches(
    batches.filter(batch => wantedTypes.has(batch.batch_type)),
    { skip: skipAlreadyBuilt, roadIds: reentrantRoads, buildingIds: reentrantBuildingIds },
  );
  output('stage_plan', {
    batch_count: stageBatches.length,
    skipped_already_built: skipAlreadyBuilt ? { roads: reentrantRoads, buildings: reentrantBuildingIds } : { roads: [], buildings: [] },
    orders: stageBatches.map(batch => ({ sequence: batch.sequence, batch_id: batch.batch_id, batch_type: batch.batch_type, label: batch.label, prefab: batch.prefab_names?.[0] ?? batch.building_prefab ?? batch.utility_prefab ?? null })),
  });
  if (!stageBatches.length) {
    if (!skipAlreadyBuilt) fatal('STAGE_EMPTY', `规划里没有属于阶段 ${stage} 的批次。`, {});
    output('stage_complete', { stage, reason: 'all_batches_already_built', permanent_changes: false });
    return;
  }

  // --dry-run：只走到这里。已经完成的都是只读检查（状态、哈希、快照、虚拟沙盒），
  // 没有创建任何预览，也没有碰模拟速度。
  if (args['dry-run'] === true) {
    output('dry_run', { plan_id: planId, stage, batch_count: stageBatches.length, permanent_changes: false });
    return;
  }

  // 批次参数由脚本按与施工器完全相同的公式重算（request_id 见 requestIdFor 的注释），
  // 这样被游戏拒绝的批次可以记录后继续下一批；预览返回的 next_action 只用来取
  // commit 需要的 operation_id 与 max_cost。
  const blocked = [];
  for (const batch of stageBatches) {
    const previewArguments = {
      action: 'preview_batch',
      bounds,
      plan,
      batch_id: batch.batch_id,
      approved_plan_id: planId,
      expected_session_id: prepared.session_id,
      request_id: requestIdFor(planId, batch.batch_id, 'preview'),
    };

    const preview = await advanceWithRecovery({ ...previewArguments, operation_timeout_ms: timeout });
    output('preview', {
      batch_id: preview.batch_id,
      batch_type: preview.batch_type,
      label: batch.label,
      sequence: preview.sequence,
      state: preview.state,
      success: preview.success,
      operation_id: preview.native_preview?.operation_id,
      cost: preview.native_preview?.cost,
      warnings: preview.native_preview?.warnings,
      errors: preview.native_preview?.errors,
      error: preview.native_preview?.error,
      anchor_rebindings: preview.anchor_rebindings,
    });

    if (!preview.success || preview.state !== 'preview_ready' || (preview.native_preview?.errors ?? []).length || preview.native_preview?.error) {
      // outcome_unknown 的原生状态不可再写；保留原 operation 供回查。
      if (preview.cancel_action && preview.state !== 'outcome_unknown') {
        await queryGame(preview.cancel_action.tool, preview.cancel_action.arguments);
      }
      blocked.push({
        batch_id: batch.batch_id,
        label: batch.label,
        prefab: batch.prefab_names?.[0] ?? null,
        points: batch.geometry_points?.map(point => ({ x: point.x, z: point.z })) ?? [],
        state: preview.state,
        errors: preview.native_preview?.errors ?? [],
        error: preview.native_preview?.error ?? null,
      });
      output('blocked', { batch_id: batch.batch_id, label: batch.label, state: preview.state, errors: preview.native_preview?.errors, error: preview.native_preview?.error });
      if (!mayContinueAfterPreviewFailure(preview.state, continueOnFailure)) {
        output('stopped', { reason: 'preview_not_ready', batch_id: batch.batch_id, completed, blocked, total_cost: totalCost });
        process.exitCode = 2;
        break;
      }
      continue;
    }

    const commit = await advanceWithRecovery({ ...preview.next_action.arguments, operation_timeout_ms: timeout });
    output('commit', {
      batch_id: commit.batch_id,
      batch_type: commit.batch_type,
      sequence: commit.sequence,
      state: commit.state,
      success: commit.success,
      cost: commit.native_operation?.cost,
      created_road_ids: commit.native_operation?.created_road_ids,
      building_ids: commit.permanent_readback?.building_ids,
      geometry_mismatches: commit.permanent_readback?.geometry_mismatches,
      errors: commit.native_operation?.errors,
      error: commit.native_operation?.error,
    });
    if (!commit.success || commit.state !== 'completed_verified') {
      blocked.push({ batch_id: batch.batch_id, label: batch.label, state: commit.state, errors: commit.native_operation?.errors ?? [], error: commit.native_operation?.error ?? null });
      output('stopped', { reason: 'commit_not_verified', batch_id: batch.batch_id, completed, blocked, total_cost: totalCost });
      process.exitCode = 4;
      break;
    }

    const cost = Number(commit.native_operation?.cost ?? 0);
    totalCost += cost;
    completed.push({
      batch_id: commit.batch_id,
      batch_type: commit.batch_type,
      cost,
      created_road_ids: commit.native_operation?.created_road_ids ?? [],
      building_ids: commit.permanent_readback?.building_ids ?? [],
    });
    output('progress', { done: completed.length, of: stageBatches.length, blocked: blocked.length, total_cost: totalCost });
  }

  output('final', {
    plan_id: planId,
    stage,
    completed_count: completed.length,
    blocked_count: blocked.length,
    blocked_batches: blocked,
    stage_batch_count: stageBatches.length,
    remaining_in_stage: stageBatches.length - completed.length - blocked.length,
    remaining_batch_count: batches.length - completed.length,
    total_cost: totalCost,
    money_before: money,
    money_after: Number((await queryGame('get_city_economy', {})).data?.money ?? 0),
    completed,
    paused: Boolean((await queryGame('get_game_status', {})).data?.paused),
    log: logPath,
  });
});
