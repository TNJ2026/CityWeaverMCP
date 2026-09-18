import { queryGame } from '../../mcp/bridge-client.mjs';
import {
  PlanTargetError,
  assertScriptResolved,
  describePlanWithStamp,
  loadTargets,
  parseArgs,
  runMain,
  selectTargets,
} from '../lib/plan-targets.mjs';

// 只读探针：为当前规划方案里指定的每座设施，在运行时向原生规划器现场请求候选，
// 逐个试建原生临时预览，命中后立即取消，不留下永久实体。
//
// 候选（含 road_edge_id）一律运行时生成，清单里不保存坐标、路网 ID 或会话 ID，
// 因此没有「换存档后 ID 失效」这回事：本脚本永远跟随当前城市的路网拓扑。
// 取候选的参数在 tools/presets/weford-public-services.json 的 preview_candidate_policy 里调。
//
// 用法：node tools/scratch/preview-public-service-plan.mjs [--plan master]

const TERMINAL_STATES = ['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function plannerTool(domain) {
  return domain === 'transport_facility' ? 'plan_transport_facility_site' : 'plan_city_service_site';
}

function previewTools(domain) {
  return domain === 'transport_facility'
    ? {
        preview: 'preview_transport_facility_placement',
        get: 'get_transport_facility_operation',
        cancel: 'cancel_transport_facility_preview',
      }
    : {
        preview: 'preview_city_service_placement',
        get: 'get_city_service_operation',
        cancel: 'cancel_city_service_preview',
      };
}

async function waitFor(tool, operationId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await queryGame(tool, { operation_id: operationId });
    if (TERMINAL_STATES.includes(response.data?.state)) return response.data;
    await sleep(250);
  }
  throw new Error(`等待预览 ${operationId} 超时。`);
}

// 按规划坐标向原生规划器要候选，剔除近似碰撞项，并按「离规划点多远 + 朝向差多少」排序。
// 首次运行需要候选形态，因此这里只保留能直接喂给 preview 的三个字段。
async function requestCandidates(target, policy) {
  const transport = target.domain === 'transport_facility';
  const response = await queryGame(plannerTool(target.domain), {
    building_prefab: target.prefab,
    near: { x: target.position.x, z: target.position.z },
    mode: 'auto',
    search_radius_m: policy.search_radius_m,
    road_side: policy.road_side,
    candidate_count: policy.candidate_count,
    reserve_upgrade_prefabs: [],
    ...(transport ? {} : { consider_service_coverage: policy.consider_service_coverage }),
  });
  const planned = target.position;
  const plannedRotation = Number(target.rotation_degrees ?? 0);
  return (response.data?.candidates ?? [])
    .filter(candidate => !candidate.approximate_collision)
    .map(candidate => ({
      position: candidate.position,
      rotation_degrees: candidate.rotation_degrees,
      road_edge_id: candidate.road_edge_id,
      road_prefab: candidate.road_prefab,
      distance_from_request_m: candidate.distance_from_request_m,
      transform_error: Math.hypot(
        candidate.position.x - planned.x,
        candidate.position.z - planned.z,
      ) + Math.abs((((candidate.rotation_degrees - plannedRotation) + 540) % 360) - 180),
    }))
    .sort((a, b) => a.transform_error - b.transform_error);
}

await runMain(async () => {
  const args = parseArgs();
  const loaded = await loadTargets({
    planKey: typeof args.plan === 'string' ? args.plan : null,
    planPath: typeof args['plan-file'] === 'string' ? args['plan-file'] : null,
  });
  const policy = loaded.previewCandidatePolicy;
  const attemptLimit = Math.max(1, Number(policy.attempt_limit) || 1);

  assertScriptResolved(loaded, 'preview');
  const targets = selectTargets(loaded, 'preview');
  if (targets.length === 0) {
    throw new PlanTargetError(
      'NO_PREVIEW_TARGETS',
      `${loaded.planKey} 方案下没有任何目标声明参与 preview 脚本。`,
      { plan_key: loaded.planKey, available_plans: Object.keys(loaded.planCatalog) },
    );
  }

  const status = await queryGame('get_game_status', {});
  if (status.data?.connected !== true) {
    throw new PlanTargetError(
      'BRIDGE_NOT_FOUND',
      '游戏查询桥未运行，无法请求原生候选。',
      { hint: '先用 node mcp/query.mjs get_game_status 确认游戏已启动且模组已部署。' },
    );
  }

  // 原生预览在暂停的城市上更稳定，沿用既有流程的做法。
  await queryGame('set_simulation_speed', { speed: 'normal' });
  await sleep(400);
  await queryGame('set_simulation_speed', { speed: 'paused' });

  const results = [];
  let stopReason = null;

  for (const target of targets) {
    const tools = previewTools(target.domain);
    let candidates = [];
    let candidateError = null;
    try {
      candidates = await requestCandidates(target, policy);
    } catch (error) {
      candidateError = { code: error?.code ?? null, message: error?.message ?? String(error) };
    }

    const attempts = [];
    let selected = null;
    for (const [index, candidate] of candidates.slice(0, attemptLimit).entries()) {
      const queued = await queryGame(tools.preview, {
        request_id: `planpreview-${target.script_id}-${index + 1}`,
        building_prefab: target.prefab,
        position: candidate.position,
        rotation_degrees: candidate.rotation_degrees,
        road_edge_id: candidate.road_edge_id,
      });
      const operation = TERMINAL_STATES.includes(queued.data?.state)
        ? queued.data
        : await waitFor(tools.get, queued.data?.operation_id);
      attempts.push({
        candidate,
        operation_id: operation.operation_id,
        state: operation.state,
        cost: operation.cost,
        warnings: operation.warnings ?? [],
        errors: operation.errors ?? [],
        error: operation.error ?? null,
      });
      if (operation.state === 'preview_ready') {
        await queryGame(tools.cancel, { operation_id: operation.operation_id });
        selected = candidate;
        break;
      }
      if (operation.state === 'outcome_unknown') break;
    }

    results.push({
      prefab: target.prefab,
      script_id: target.script_id,
      domain: target.domain,
      construction_status: target.construction_status,
      planned: target.position,
      candidate_count: candidates.length,
      candidate_error: candidateError,
      preview_ready: selected !== null,
      selected,
      attempts,
    });

    if (attempts.at(-1)?.state === 'outcome_unknown') {
      stopReason = 'outcome_unknown';
      break;
    }
  }

  const attemptsTotal = results.reduce((sum, item) => sum + item.attempts.length, 0);
  // 命中的那次预览才带费用（取消后不扣款），用于对照规划预算。
  const selectedCostTotal = results.reduce((sum, item) => {
    const hit = item.attempts.find(attempt => attempt.state === 'preview_ready');
    return sum + Number(hit?.cost ?? 0);
  }, 0);

  process.stdout.write(`${JSON.stringify({
    plan: await describePlanWithStamp(loaded),
    policy,
    city: status.data?.city_name,
    session_id: status.meta?.session_id,
    summary: {
      targets: targets.length,
      preview_ready: results.filter(item => item.preview_ready).length,
      no_candidates: results.filter(item => item.attempts.length === 0).length,
      attempts: attemptsTotal,
      cost_of_selected: selectedCostTotal,
      stop_reason: stopReason,
    },
    results,
  }, null, 2)}\n`);
});
