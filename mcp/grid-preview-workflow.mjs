import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const speedOf = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';
const sessionIdOf = envelope => envelope?.meta?.session_id || envelope?.data?.session_id || null;
const exactItem = (response, name) => response?.data?.items?.find(item => item.name === name) ?? null;
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const messageText = value => typeof value === 'string' ? value : value?.message ?? value?.code ?? JSON.stringify(value);

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

function workflowError(code, message, details = {}) {
  const error = new BridgeError(code, message);
  Object.assign(error, details);
  return error;
}

export function createGridPreviewWorkflow(queryGame = liveQueryGame) {
  const requests = new Map();
  let previewTail = Promise.resolve();

  const exclusive = async fn => {
    const previous = previewTail;
    let release;
    previewTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  const checkSession = (expectedSessionId, envelope) => {
    const actualSessionId = sessionIdOf(envelope);
    if (expectedSessionId && actualSessionId && actualSessionId !== expectedSessionId) {
      throw workflowError('CITY_SESSION_CHANGED', 'The loaded city session changed while preparing the grid preview.');
    }
  };

  async function waitForPreview(operationId, timeoutMs, sessionId) {
    if (!operationId) throw workflowError('MISSING_OPERATION_ID', 'Native road preview did not return operation_id.');
    const started = Date.now();
    let delay = 50;
    let last;
    while (Date.now() - started < timeoutMs) {
      const envelope = await queryGame('get_road_operation', { operation_id: operationId });
      checkSession(sessionId, envelope);
      last = envelope.data;
      if (last?.state === 'preview_ready' || TERMINAL_FAILURES.has(last?.state)) return last;
      await sleep(delay);
      delay = Math.min(500, Math.round(delay * 1.7));
    }
    throw workflowError('WORKFLOW_TIMEOUT', `Road operation ${operationId} timed out before native preview completed.`, {
      operation_id: operationId,
      last_state: last?.state,
    });
  }

  async function prepare(args) {
    const fingerprintArgs = { ...args };
    delete fingerprintArgs.render;
    const fingerprint = JSON.stringify(fingerprintArgs);
    const prior = requests.get(args.request_id);
    if (prior && prior.fingerprint !== fingerprint) {
      throw workflowError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different grid-preview arguments.');
    }
    if (prior) return prior.result;

    return exclusive(async () => {
      const repeated = requests.get(args.request_id);
      if (repeated && repeated.fingerprint !== fingerprint) {
        throw workflowError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different grid-preview arguments.');
      }
      if (repeated) return repeated.result;

      const statusEnvelope = await queryGame('get_game_status', {});
      const status = statusEnvelope.data || {};
      if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
      const sessionId = sessionIdOf(statusEnvelope);
      const beforeSpeed = speedOf(status);
      const roadNames = [...new Set([
        args.road_prefab, args.horizontal_road_prefab, args.vertical_road_prefab,
        args.perimeter_road_prefab, args.connection_road_prefab,
      ].filter(Boolean))];

      const [roadResponses, zoneResponse, configurationEnvelope] = await Promise.all([
        Promise.all(roadNames.map(name => queryGame('list_road_prefabs', { search: name, offset: 0, limit: 100 }))),
        queryGame('list_zone_types', { search: args.zone_type, unlocked_only: false }),
        queryGame('get_city_configuration', {}),
      ]);
      for (const envelope of [...roadResponses, zoneResponse, configurationEnvelope]) checkSession(sessionId, envelope);

      const roadBindings = roadNames.map((name, index) => ({ name, prefab: exactItem(roadResponses[index], name) }));
      const missingRoad = roadBindings.find(binding => !binding.prefab);
      if (missingRoad) throw workflowError('ROAD_PREFAB_NOT_FOUND', `No exact live road prefab named ${missingRoad.name} was found.`);
      const lockedRoad = roadBindings.find(binding => binding.prefab.locked);
      if (lockedRoad) throw workflowError('ROAD_PREFAB_LOCKED', `Road prefab ${lockedRoad.name} is locked in the loaded city.`);

      const zone = exactItem(zoneResponse, args.zone_type);
      if (!zone) throw workflowError('ZONE_TYPE_NOT_FOUND', `No exact live zone type named ${args.zone_type} was found.`);
      if (zone.locked) throw workflowError('ZONE_TYPE_LOCKED', `Zone type ${args.zone_type} is locked in the loaded city.`);
      const theme = configurationEnvelope.data?.theme ?? null;
      const expectedStyle = cityThemeStyle(theme);
      const actualStyle = zoneStyle(zone.name);
      if (expectedStyle && actualStyle && expectedStyle !== actualStyle) {
        throw workflowError('ZONE_THEME_MISMATCH', `Zone type ${zone.name} uses ${actualStyle} style, but the loaded city theme is ${theme}.`);
      }

      let pausedByWorkflow = false;
      try {
        if (!status.paused) {
          await queryGame('set_simulation_speed', { speed: 'paused' });
          pausedByWorkflow = true;
        }
        const nativeArgs = compact({
          request_id: args.request_id,
          road_prefab: args.road_prefab,
          origin: args.origin,
          horizontal_road_prefab: args.horizontal_road_prefab,
          vertical_road_prefab: args.vertical_road_prefab,
          perimeter_road_prefab: args.perimeter_road_prefab,
          auto_connect: args.auto_connect,
          connection_sides: args.connection_sides,
          connection_search_radius_m: args.connection_search_radius_m,
          connection_road_prefab: args.connection_road_prefab,
          minimum_connections: args.minimum_connections,
          maximum_connections: args.maximum_connections,
          columns: args.columns,
          rows: args.rows,
          block_width_m: args.block_width_m,
          block_height_m: args.block_height_m,
        });
        const queued = await queryGame('preview_road_grid', nativeArgs);
        checkSession(sessionId, queued);
        const operation = queued.data?.state === 'preview_ready' || TERMINAL_FAILURES.has(queued.data?.state)
          ? queued.data
          : await waitForPreview(queued.data?.operation_id, args.operation_timeout_ms, sessionId);
        const previewAnnotation = {
          operation_id: operation.operation_id ?? queued.data?.operation_id,
          state: operation.state,
          cost: operation.cost ?? 0,
          warnings: (operation.warnings ?? []).map(messageText),
          errors: (operation.errors ?? []).map(messageText),
          error: operation.error ? messageText(operation.error) : null,
          expires_at_utc: operation.expires_at_utc ?? null,
          snapped_origin: operation.snapped_origin ? { x: operation.snapped_origin.x, z: operation.snapped_origin.z } : null,
        };
        const zoneKind = zone.office ? 'office' : String(zone.area_type ?? 'residential').toLowerCase();
        const result = {
          workflow: 'prepare_grid_native_preview',
          state: operation.state,
          city: status.city_name,
          session_id: sessionId,
          city_theme: theme,
          road_bindings: roadBindings.map(binding => ({ name: binding.name, locked: Boolean(binding.prefab.locked) })),
          road_preview: previewAnnotation,
          annotated_plan: {
            grids: [{
              origin: args.origin, columns: args.columns, rows: args.rows,
              block_width_m: args.block_width_m, block_height_m: args.block_height_m,
              road_prefab: args.road_prefab, horizontal_road_prefab: args.horizontal_road_prefab,
              vertical_road_prefab: args.vertical_road_prefab, zone_type: zone.name, zone_kind: zoneKind,
              native_preview: previewAnnotation,
            }],
            roads: [], buildings: [], zones: [], tracks: [], utilities: [],
          },
          zoning_intent: {
            state: 'blocked_until_roads_built',
            zone_type: zone.name,
            depth_cells: args.depth_cells,
            overwrite: args.overwrite,
            reason: 'Native zoning preview requires permanent road edge IDs, which do not exist until the road preview is explicitly committed.',
          },
          construction_ready: false,
          permanent_changes: false,
          cancel_action: operation.state === 'preview_ready'
            ? { tool: 'cancel_road_preview', arguments: { operation_id: previewAnnotation.operation_id } }
            : null,
        };
        requests.set(args.request_id, { fingerprint, result });
        return result;
      } finally {
        if (pausedByWorkflow) await queryGame('set_simulation_speed', { speed: beforeSpeed });
      }
    });
  }

  return { prepare, _requests: requests };
}

const liveWorkflow = createGridPreviewWorkflow();
export const prepareGridNativePreview = args => liveWorkflow.prepare(args);
