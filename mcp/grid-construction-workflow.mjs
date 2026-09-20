import { withPrefabCatalog } from './prefab-catalog-service.mjs';
import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const ROAD_COMMIT_IN_PROGRESS = new Set(['commit_queued', 'applying']);
const ZONING_APPLY_IN_PROGRESS = new Set(['commit_queued', 'applying']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const speedOf = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';
const sessionIdOf = envelope => envelope?.meta?.session_id || envelope?.data?.session_id || null;
const exactItem = (response, name) => response?.data?.items?.find(item => item.name === name) ?? null;
const messageText = value => typeof value === 'string' ? value : value?.message ?? value?.code ?? JSON.stringify(value);
const nextRequestId = (requestId, suffix) => `${requestId.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;

function workflowError(code, message, details = {}) {
  const error = new BridgeError(code, message);
  Object.assign(error, details);
  return error;
}

function cityThemeStyle(theme) {
  const value = String(theme ?? '').toLowerCase();
  if (value.includes('north american')) return 'NA';
  if (value.includes('european')) return 'EU';
  return null;
}

function zoneStyle(name) {
  const match = String(name ?? '').match(/^(NA|EU)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function operationSummary(operation) {
  return {
    operation_id: operation?.operation_id ?? null,
    state: operation?.state ?? 'unknown',
    cost: Number(operation?.cost ?? 0),
    warnings: (operation?.warnings ?? []).map(messageText),
    errors: (operation?.errors ?? []).map(messageText),
    error: operation?.error ? messageText(operation.error) : null,
  };
}

export function createGridConstructionWorkflow(queryGame = liveQueryGame) {
  queryGame = withPrefabCatalog(queryGame);
  let writeTail = Promise.resolve();

  const exclusive = async fn => {
    const previous = writeTail;
    let release;
    writeTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  const checkSession = (expectedSessionId, envelope) => {
    const actualSessionId = sessionIdOf(envelope);
    if (expectedSessionId && actualSessionId && expectedSessionId !== actualSessionId) {
      throw workflowError('CITY_SESSION_CHANGED', 'The loaded city session changed during staged grid construction.', {
        expected_session_id: expectedSessionId,
        actual_session_id: actualSessionId,
      });
    }
    return actualSessionId ?? expectedSessionId ?? null;
  };

  async function waitFor(tool, operationId, desiredState, timeoutMs, sessionId) {
    const started = Date.now();
    let delay = 50;
    let last = null;
    while (Date.now() - started < timeoutMs) {
      const envelope = await queryGame(tool, { operation_id: operationId });
      checkSession(sessionId, envelope);
      last = envelope.data;
      if (last?.state === desiredState || TERMINAL_FAILURES.has(last?.state)) return last;
      await sleep(delay);
      delay = Math.min(500, Math.round(delay * 1.7));
    }
    throw workflowError('WORKFLOW_TIMEOUT', `${tool} did not reach ${desiredState} before the bounded wait expired.`, {
      operation_id: operationId,
      last_state: last?.state,
    });
  }

  function validateStageArgs(args) {
    if (args.stage === 'commit_roads') {
      if (!args.operation_id) throw workflowError('INVALID_WORKFLOW_INPUT', 'operation_id from prepare_grid_native_preview is required for commit_roads.');
      if (args.max_cost == null) throw workflowError('INVALID_WORKFLOW_INPUT', 'max_cost is required to authorize the road commit.');
    } else if (args.stage === 'preview_zoning') {
      if (!args.edge_ids?.length) throw workflowError('INVALID_WORKFLOW_INPUT', 'Permanent edge_ids returned by the completed road stage are required for preview_zoning.');
      if (!args.zone_type) throw workflowError('INVALID_WORKFLOW_INPUT', 'An exact zone_type is required for preview_zoning.');
    } else if (args.stage === 'apply_zoning') {
      if (!args.operation_id) throw workflowError('INVALID_WORKFLOW_INPUT', 'The preview_ready zoning operation_id is required for apply_zoning.');
    }
  }

  async function advance(args) {
    validateStageArgs(args);
    return exclusive(async () => {
      const statusEnvelope = await queryGame('get_game_status', {});
      const status = statusEnvelope.data ?? {};
      if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
      const sessionId = checkSession(args.expected_session_id, statusEnvelope);
      const beforeSpeed = speedOf(status);
      let pausedByWorkflow = false;
      let keepPaused = false;
      try {
        if (!status.paused) {
          const paused = await queryGame('set_simulation_speed', { speed: 'paused' });
          checkSession(sessionId, paused);
          pausedByWorkflow = true;
        }
        let result;
        if (args.stage === 'commit_roads') result = await commitRoads(args, sessionId);
        else if (args.stage === 'preview_zoning') result = await previewZoning(args, sessionId);
        else result = await applyZoning(args, sessionId);
        keepPaused = result.state === 'outcome_unknown';
        return {
          workflow: 'advance_grid_construction',
          city: status.city_name,
          session_id: sessionId,
          ...result,
          simulation: {
            before_speed: beforeSpeed,
            kept_paused_for_recovery: keepPaused,
            restored_after_stage: pausedByWorkflow && !keepPaused,
          },
        };
      } catch (error) {
        if (error?.code === 'WORKFLOW_TIMEOUT') keepPaused = true;
        throw error;
      } finally {
        if (pausedByWorkflow && !keepPaused) await queryGame('set_simulation_speed', { speed: beforeSpeed });
      }
    });
  }

  async function commitRoads(args, sessionId) {
    const existingEnvelope = await queryGame('get_road_operation', { operation_id: args.operation_id });
    checkSession(sessionId, existingEnvelope);
    let operation = existingEnvelope.data ?? {};
    const recovered = operation.state === 'completed';
    if (!recovered) {
      if (ROAD_COMMIT_IN_PROGRESS.has(operation.state)) {
        operation = await waitFor('get_road_operation', args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
      } else if (operation.state !== 'preview_ready') {
        return {
          stage: 'commit_roads', state: operation.state ?? 'unknown', success: false,
          permanent_changes: operation.state === 'outcome_unknown' ? null : false, phases: [{ phase: 'roads', ...operationSummary(operation) }],
          recovery_required: operation.state === 'outcome_unknown', next_action: null,
        };
      } else {
        const quotedCost = Number(operation.cost ?? 0);
        if (quotedCost > args.max_cost) {
          throw workflowError('BUDGET_EXCEEDED', `Road preview cost ${quotedCost} exceeds authorized max_cost ${args.max_cost}.`, {
            operation_id: args.operation_id, preview_cost: quotedCost, max_cost: args.max_cost,
          });
        }
        const committed = await queryGame('build_road', {
          operation_id: args.operation_id,
          request_id: args.request_id,
          max_cost: args.max_cost,
        });
        checkSession(sessionId, committed);
        operation = committed.data?.state === 'completed' || TERMINAL_FAILURES.has(committed.data?.state)
          ? committed.data
          : await waitFor('get_road_operation', args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
      }
    }
    const createdRoadIds = operation.created_road_ids ?? [];
    const completed = operation.state === 'completed';
    const zoningArgs = completed && createdRoadIds.length && args.zone_type ? {
      stage: 'preview_zoning',
      request_id: nextRequestId(args.request_id, '_zprev'),
      expected_session_id: sessionId,
      edge_ids: createdRoadIds,
      zone_type: args.zone_type,
      road_side: args.road_side,
      depth_cells: args.depth_cells,
      overwrite: args.overwrite,
      include_occupied: args.include_occupied,
      operation_timeout_ms: args.operation_timeout_ms,
    } : null;
    return {
      stage: 'commit_roads', state: operation.state, success: completed,
      permanent_changes: completed, recovered_existing_result: recovered,
      phases: [{ phase: 'roads', ...operationSummary(operation), created_road_ids: createdRoadIds }],
      created_road_ids: createdRoadIds,
      recovery_required: operation.state === 'outcome_unknown',
      next_action: zoningArgs ? { tool: 'advance_grid_construction', arguments: zoningArgs } : null,
    };
  }

  async function previewZoning(args, sessionId) {
    let zone = null;
    let theme = null;
    if (!['none', 'clear'].includes(args.zone_type.toLowerCase())) {
      const [zoneEnvelope, configurationEnvelope] = await Promise.all([
        queryGame('list_zone_types', { search: args.zone_type, unlocked_only: false }),
        queryGame('get_city_configuration', {}),
      ]);
      checkSession(sessionId, zoneEnvelope);
      checkSession(sessionId, configurationEnvelope);
      zone = exactItem(zoneEnvelope, args.zone_type);
      if (!zone) throw workflowError('ZONE_TYPE_NOT_FOUND', `No exact live zone type named ${args.zone_type} was found.`);
      if (zone.locked) throw workflowError('ZONE_TYPE_LOCKED', `Zone type ${args.zone_type} is locked in the loaded city.`);
      theme = configurationEnvelope.data?.theme ?? null;
      const expectedStyle = cityThemeStyle(theme), actualStyle = zoneStyle(zone.name);
      if (expectedStyle && actualStyle && expectedStyle !== actualStyle) {
        throw workflowError('ZONE_THEME_MISMATCH', `Zone type ${zone.name} uses ${actualStyle} style, but the loaded city theme is ${theme}.`);
      }
    }
    const inspectionEnvelope = await queryGame('inspect_road_zoning', { edge_ids: args.edge_ids });
    checkSession(sessionId, inspectionEnvelope);
    const previewEnvelope = await queryGame('preview_zoning', {
      request_id: args.request_id,
      edge_ids: args.edge_ids,
      zone: zone?.name ?? 'none',
      road_side: args.road_side,
      depth_cells: args.depth_cells,
      overwrite: args.overwrite,
      include_occupied: args.include_occupied,
    });
    checkSession(sessionId, previewEnvelope);
    let operation = previewEnvelope.data ?? {};
    if (operation.state !== 'preview_ready' && !TERMINAL_FAILURES.has(operation.state)) {
      operation = await waitFor('get_zoning_operation', operation.operation_id, 'preview_ready', args.operation_timeout_ms, sessionId);
    }
    const ready = operation.state === 'preview_ready';
    return {
      stage: 'preview_zoning', state: operation.state, success: ready,
      permanent_changes: false, city_theme: theme,
      road_zoning_inspection: inspectionEnvelope.data,
      phases: [{ phase: 'zoning_preview', ...operationSummary(operation), changed_cell_count: operation.changed_cell_count ?? 0 }],
      recovery_required: operation.state === 'outcome_unknown',
      cancel_action: ready ? { tool: 'cancel_zoning_preview', arguments: { operation_id: operation.operation_id } } : null,
      next_action: ready ? {
        tool: 'advance_grid_construction',
        arguments: {
          stage: 'apply_zoning', request_id: nextRequestId(args.request_id, '_apply'),
          expected_session_id: sessionId, operation_id: operation.operation_id,
          operation_timeout_ms: args.operation_timeout_ms,
        },
      } : null,
    };
  }

  async function applyZoning(args, sessionId) {
    const existingEnvelope = await queryGame('get_zoning_operation', { operation_id: args.operation_id });
    checkSession(sessionId, existingEnvelope);
    let operation = existingEnvelope.data ?? {};
    const recovered = operation.state === 'completed';
    if (!recovered) {
      if (ZONING_APPLY_IN_PROGRESS.has(operation.state)) {
        operation = await waitFor('get_zoning_operation', args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
      } else if (operation.state !== 'preview_ready') {
        return {
          stage: 'apply_zoning', state: operation.state ?? 'unknown', success: false,
          permanent_changes: operation.state === 'outcome_unknown' ? null : false, phases: [{ phase: 'zoning_apply', ...operationSummary(operation) }],
          recovery_required: operation.state === 'outcome_unknown', next_action: null,
        };
      } else {
        const applied = await queryGame('apply_zoning', { operation_id: args.operation_id, request_id: args.request_id });
        checkSession(sessionId, applied);
        operation = applied.data?.state === 'completed' || TERMINAL_FAILURES.has(applied.data?.state)
          ? applied.data
          : await waitFor('get_zoning_operation', args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
      }
    }
    const completed = operation.state === 'completed';
    return {
      stage: 'apply_zoning', state: operation.state, success: completed,
      permanent_changes: completed, recovered_existing_result: recovered,
      phases: [{ phase: 'zoning_apply', ...operationSummary(operation), changed_cell_count: operation.changed_cell_count ?? 0 }],
      changed_cell_count: operation.changed_cell_count ?? 0,
      recovery_required: operation.state === 'outcome_unknown', next_action: null,
    };
  }

  return { advance };
}

const liveWorkflow = createGridConstructionWorkflow();
export const advanceGridConstruction = args => liveWorkflow.advance(args);
