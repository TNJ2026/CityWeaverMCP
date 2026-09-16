import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';
import { connectUtilityFacility as liveConnectUtilityFacility } from './utility-connection-workflow.mjs';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const childRequestId = (base, suffix) => `${base.slice(0, Math.max(8, 99 - suffix.length))}-${suffix}`;
const sessionIdOf = response => response?.meta?.session_id || response?.data?.session_id || null;
const citySpeed = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';

function workflowError(code, message, details = {}) {
  const error = new BridgeError(code, message);
  Object.assign(error, details);
  return error;
}

export function createInfrastructureWorkflows(queryGame = liveQueryGame, dependencies = {}) {
  const connectUtilityFacility = dependencies.connectUtilityFacility || liveConnectUtilityFacility;
  const requests = new Map();
  let constructionTail = Promise.resolve();
  const exclusive = async fn => {
    const previous = constructionTail;
    let release;
    constructionTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  async function waitOperation(tool, operationId, timeoutMs) {
    if (!operationId) throw workflowError('MISSING_OPERATION_ID', `Native ${tool} response did not include operation_id.`);
    const started = Date.now(); let delay = 100; let last;
    while (Date.now() - started < timeoutMs) {
      last = (await queryGame(tool, { operation_id: operationId })).data;
      if (TERMINAL_FAILURES.has(last?.state) || last?.state === 'preview_ready' || last?.state === 'completed') return last;
      await sleep(delay); delay = Math.min(800, Math.round(delay * 1.5));
    }
    throw workflowError('WORKFLOW_TIMEOUT', `Operation ${operationId} timed out.`, { operation_id: operationId, last_state: last?.state });
  }

  async function withPausedCity(fn, resumeSpeed = 'original') {
    const envelope = await queryGame('get_game_status', {});
    const status = envelope.data || {};
    if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
    const beforeSpeed = citySpeed(status); let pausedByWorkflow = false;
    try {
      if (!status.paused) { await queryGame('set_simulation_speed', { speed: 'paused' }); pausedByWorkflow = true; }
      return await fn({ status, sessionId: sessionIdOf(envelope) });
    } finally {
      const speed = resumeSpeed === 'original' ? beforeSpeed : resumeSpeed;
      if (pausedByWorkflow || resumeSpeed !== 'original') await queryGame('set_simulation_speed', { speed });
    }
  }

  function checkIdempotency(requestId, fingerprint) {
    const prior = requests.get(requestId);
    if (prior && prior.fingerprint !== fingerprint) throw workflowError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different workflow arguments.');
    return prior?.result || null;
  }

  async function buildUtilityBackbone(args) {
    const fingerprint = JSON.stringify(args); const prior = checkIdempotency(args.request_id, fingerprint); if (prior) return prior;
    return exclusive(async () => {
      const result = await withPausedCity(async ({ status, sessionId }) => {
        const phases = []; let totalCost = 0; let stopped = false;
        for (const [index, item] of (args.connections || []).entries()) {
          if (stopped) break;
          const requestId = childRequestId(args.request_id, `connection-${index + 1}`);
          try {
            const connected = await connectUtilityFacility({ ...item, request_id: requestId,
              operation_timeout_ms: item.operation_timeout_ms ?? args.operation_timeout_ms,
              max_cost: item.max_cost ?? args.max_cost_per_connection,
              search_radius_m: item.search_radius_m ?? args.search_radius_m,
              max_preview_attempts: item.max_preview_attempts ?? args.max_preview_attempts,
              routing: item.routing ?? args.routing });
            phases.push({ phase: 'connection', index, state: connected.state, result: connected, request_id: requestId });
            totalCost += connected.cost || 0;
            if (connected.state !== 'completed') stopped = true;
          } catch (error) {
            const state = error?.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed';
            phases.push({ phase: 'connection', index, state, request_id: requestId, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message, operation_id: error.operation_id });
            stopped = state === 'outcome_unknown' || !args.continue_on_error;
          }
        }
        if (!stopped) {
          for (const [index, item] of (args.segments || []).entries()) {
            const requestId = childRequestId(args.request_id, `segment-${index + 1}`);
            let operation;
            try {
              const preview = await queryGame('preview_utility_network', { request_id: requestId, utility_prefab: item.utility_prefab || args.utility_prefab, points: item.points });
              operation = preview.data?.state && (preview.data.state === 'preview_ready' || TERMINAL_FAILURES.has(preview.data.state))
                ? preview.data : await waitOperation('get_utility_operation', preview.data?.operation_id, args.operation_timeout_ms);
            } catch (error) {
              phases.push({ phase: 'segment', index, state: error?.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed', request_id: requestId, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message });
              stopped = true; break;
            }
            if (operation.state !== 'preview_ready') {
              phases.push({ phase: 'segment', index, state: operation.state, request_id: requestId, operation_id: operation.operation_id, errors: operation.errors || [] });
              stopped = true; break;
            }
            const cost = operation.cost || 0;
            if (totalCost + cost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER) || cost > (item.max_cost ?? args.max_cost_per_segment)) {
              phases.push({ phase: 'segment', index, state: 'failed', reason: 'COST_LIMIT_EXCEEDED', request_id: requestId, operation_id: operation.operation_id, cost });
              stopped = true; break;
            }
            try {
              const applied = await queryGame('apply_utility_operation', { operation_id: operation.operation_id, request_id: requestId, max_cost: item.max_cost ?? args.max_cost_per_segment });
              const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation('get_utility_operation', operation.operation_id, args.operation_timeout_ms);
              phases.push({ phase: 'segment', index, state: completed.state, request_id: requestId, operation_id: operation.operation_id, result_edge_ids: completed.result_edge_ids || [], cost: completed.cost || cost, errors: completed.errors || [] });
              totalCost += completed.cost || cost;
              if (completed.state !== 'completed') { stopped = true; break; }
            } catch (error) {
              phases.push({ phase: 'segment', index, state: error?.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed', request_id: requestId, operation_id: operation.operation_id, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message });
              stopped = true; break;
            }
          }
        }
        const failed = phases.some(item => ['failed', 'outcome_unknown', 'cancelled', 'expired'].includes(item.state));
        return { state: failed ? 'partial' : stopped ? 'partial' : 'completed', workflow: 'build_utility_backbone', city: status.city_name, session_id: sessionId, total_cost: totalCost, phases };
      }, args.resume_speed);
      requests.set(args.request_id, { fingerprint, result }); return result;
    });
  }

  async function repairCongestedCorridor(args) {
    const fingerprint = JSON.stringify(args); const prior = checkIdempotency(args.request_id, fingerprint); if (prior) return prior;
    return exclusive(async () => {
      const result = await withPausedCity(async ({ status, sessionId }) => {
        const analysis = await queryGame('analyze_road_traffic', { edge_ids: args.edge_ids, limit: args.limit });
        const items = analysis.data?.items || []; const phases = []; let totalCost = 0;
        for (const [index, item] of items.entries()) {
          const strategy = args.strategy === 'auto' ? (item.recommended_action === 'upgrade_or_parallel_relief' ? 'upgrade' : 'parallel') : args.strategy;
          const requestId = childRequestId(args.request_id, `action-${index + 1}`);
          let operation;
          try {
            let preview;
            if (strategy === 'upgrade') preview = await queryGame('preview_road_batch_upgrade', { request_id: requestId, edge_ids: [item.edge_id], road_prefab: args.road_prefab });
            else if (strategy === 'parallel') preview = await queryGame('preview_road_parallel', { request_id: requestId, edge_ids: [item.edge_id], side: args.side, offset_m: args.offset_m, max_offset_m: args.max_offset_m, road_prefab: args.road_prefab, avoid_obstacles: args.avoid_obstacles });
            else if (strategy === 'reroute') preview = await queryGame('preview_road_autoroute', { request_id: requestId, road_prefab: args.road_prefab, start: args.start, end: args.end, strategy: 'balanced', grid_size_m: args.grid_size_m, max_detour_m: args.max_detour_m, zoning_alignment: args.zoning_alignment });
            else throw workflowError('INVALID_WORKFLOW_INPUT', `Unsupported repair strategy ${strategy}.`);
            operation = preview.data?.state && (preview.data.state === 'preview_ready' || TERMINAL_FAILURES.has(preview.data.state))
              ? preview.data : await waitOperation('get_road_operation', preview.data?.operation_id, args.operation_timeout_ms);
          } catch (error) {
            phases.push({ phase: 'repair', index, edge_id: item.edge_id, strategy, state: error?.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed', request_id: requestId, operation_id: error.operation_id, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message });
            break;
          }
          if (operation.state !== 'preview_ready') { phases.push({ phase: 'repair', index, edge_id: item.edge_id, strategy, state: operation.state, request_id: requestId, operation_id: operation.operation_id, errors: operation.errors || [] }); break; }
          const cost = operation.cost || 0;
          if (cost > (args.max_cost_per_action ?? Number.MAX_SAFE_INTEGER) || totalCost + cost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER)) { phases.push({ phase: 'repair', index, edge_id: item.edge_id, strategy, state: 'failed', reason: 'COST_LIMIT_EXCEEDED', request_id: requestId, operation_id: operation.operation_id, cost }); break; }
          try {
            const applied = await queryGame('build_road', { operation_id: operation.operation_id, request_id: requestId, max_cost: args.max_cost_per_action });
            const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation('get_road_operation', operation.operation_id, args.operation_timeout_ms);
            phases.push({ phase: 'repair', index, edge_id: item.edge_id, strategy, state: completed.state, request_id: requestId, operation_id: operation.operation_id, created_road_ids: completed.created_road_ids || [], cost: completed.cost || cost, errors: completed.errors || [] });
            totalCost += completed.cost || cost;
            if (completed.state !== 'completed') break;
          } catch (error) {
            phases.push({ phase: 'repair', index, edge_id: item.edge_id, strategy, state: error?.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed', request_id: requestId, operation_id: operation.operation_id, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message }); break;
          }
        }
        const failed = phases.some(item => ['failed', 'outcome_unknown', 'cancelled', 'expired'].includes(item.state));
        return { state: failed || phases.length < items.length ? 'partial' : 'completed', workflow: 'repair_congested_corridor', city: status.city_name, session_id: sessionId, analyzed_count: items.length, total_cost: totalCost, phases };
      }, args.resume_speed);
      requests.set(args.request_id, { fingerprint, result }); return result;
    });
  }

  return { buildUtilityBackbone, repairCongestedCorridor, _requests: requests };
}

const liveWorkflows = createInfrastructureWorkflows();
export const buildUtilityBackbone = args => liveWorkflows.buildUtilityBackbone(args);
export const repairCongestedCorridor = args => liveWorkflows.repairCongestedCorridor(args);
