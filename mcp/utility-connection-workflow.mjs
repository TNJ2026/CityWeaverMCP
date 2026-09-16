import { randomBytes } from 'node:crypto';
import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const FAILURE_STATES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const id = prefix => `${prefix}-${randomBytes(8).toString('hex')}`;
const childRequestId = (base, suffix) => `${base.slice(0, Math.max(8, 99 - suffix.length))}-${suffix}`;
const compact = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

const connectionForFacility = (facility, requested) => {
  if (requested !== 'auto') return requested;
  if (facility.kind === 'transformer' || facility.kind === 'power_plant' || facility.kind === 'battery') return 'high_voltage';
  if (facility.kind === 'sewage') return 'sewage';
  if (facility.kind === 'water_pump' || facility.kind === 'water_tower') return 'fresh_water';
  return 'auto';
};
const connectionMatchesPrefab = (connection, prefab) => {
  const type = String(prefab?.network_type || '').toLowerCase();
  if (connection === 'high_voltage' || connection === 'low_voltage') return type === 'electricity';
  if (connection === 'fresh_water') return type === 'water' || type === 'water_sewage';
  if (connection === 'sewage') return type === 'sewage' || type === 'water_sewage';
  if (connection === 'stormwater') return type === 'stormwater' || type === 'water_sewage';
  return true;
};
const point = p => ({ x: p.x, z: p.z });

export function createUtilityConnectionWorkflow(queryGame = liveQueryGame) {
  const requests = new Map();
  const prefabCache = new Map();
  let writeTail = Promise.resolve();
  const exclusive = async fn => { const previous = writeTail; let release; writeTail = new Promise(resolve => { release = resolve; }); await previous; try { return await fn(); } finally { release(); } };

  async function waitOperation(operationId, targetState, timeoutMs) {
    const started = Date.now(); let delay = 50; let last;
    while (Date.now() - started < timeoutMs) {
      last = (await queryGame('get_utility_operation', { operation_id: operationId })).data;
      if (last?.state === targetState || FAILURE_STATES.has(last?.state)) return last;
      await sleep(delay); delay = Math.min(400, Math.round(delay * 1.7));
    }
    throw new BridgeError('WORKFLOW_TIMEOUT', `Utility operation ${operationId} timed out waiting for ${targetState}; last state was ${last?.state || 'unknown'}.`);
  }

  async function connect(args) {
    const fingerprint = JSON.stringify(args); const existing = requests.get(args.request_id);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different connection arguments.'); return existing.result; }
    const statusEnvelope = await queryGame('get_game_status', {}); const status = statusEnvelope.data || {};
    if (!status.city_loaded) throw new BridgeError('CITY_NOT_READY', 'No playable city is loaded.');
    const beforeSpeed = status.paused || status.selected_speed === 0 ? 'paused' : status.selected_speed === 4 ? 'fastest' : status.selected_speed === 2 ? 'fast' : 'normal';
    let pausedByWorkflow = false;
    return exclusive(async () => {
      try {
        if (!status.paused) { await queryGame('set_simulation_speed', { speed: 'paused' }); pausedByWorkflow = true; }
        const facilityResponse = await queryGame('list_utility_facilities', { kind: 'all' });
        const facility = facilityResponse.data?.items?.find(item => item.facility_id === args.facility_id);
        if (!facility) throw new BridgeError('UTILITY_FACILITY_NOT_FOUND', 'facility_id was not found in the current city session.');
        const connection = connectionForFacility(facility, args.connection);
        let ports = [];
        try { ports = (await queryGame('list_utility_connection_points', { facility_id: args.facility_id, connection })).data?.items || []; } catch (error) { if (!(error instanceof BridgeError) || error.code !== 'UNKNOWN_TOOL') throw error; }
        if (!ports.length) throw new BridgeError('UTILITY_CONNECTION_POINT_NOT_FOUND', 'The facility exposes no matching native connection port. Inspect installed upgrades and choose the correct connection kind.');
        let targets = [];
        try { targets = (await queryGame('find_compatible_utility_targets', compact({ facility_id: args.facility_id, connection, utility_prefab: args.utility_prefab, search_radius_m: args.search_radius_m, limit: args.max_preview_attempts * 4 }))).data?.items || []; } catch (error) { if (!(error instanceof BridgeError) || error.code !== 'UNKNOWN_TOOL') throw error; }
        const networks = targets.length ? [] : (await queryGame('list_utility_networks', { network_type: 'all' })).data?.items || [];
        // A target returned by the native compatibility query already carries an exact prefab.
        // Avoid a full prefab enumeration for the common existing-network path.
        let selectedPrefab = args.utility_prefab && targets.length ? { name: args.utility_prefab } : targets[0]?.utility_prefab ? { name: targets[0].utility_prefab } : null;
        if (!selectedPrefab) {
          const sessionId = statusEnvelope.meta?.session_id || statusEnvelope.data?.session_id || 'unknown';
          const cacheKey = `${sessionId}:utility-prefabs`;
          let prefabs = prefabCache.get(cacheKey);
          if (!prefabs) {
            const prefabsResponse = await queryGame('list_utility_network_prefabs', { network_type: 'all', include_markers: false, unlocked_only: true });
            prefabs = prefabsResponse.data?.items || [];
            prefabCache.set(cacheKey, prefabs);
          }
          selectedPrefab = args.utility_prefab ? prefabs.find(item => item.name?.toLowerCase() === args.utility_prefab.toLowerCase()) : prefabs.find(item => connectionMatchesPrefab(connection, item));
        }
        if (!selectedPrefab) throw new BridgeError('UTILITY_PREFAB_NOT_FOUND', 'No unlocked utility network prefab matches the requested connection.');
        if (!targets.length) {
          const origin = facility.position; const candidates = networks.map(network => {
            const end = Math.hypot(network.start.x - origin.x, network.start.z - origin.z) <= Math.hypot(network.end.x - origin.x, network.end.z - origin.z) ? network.start : network.end;
            return { target_node_id: Math.hypot(network.start.x - origin.x, network.start.z - origin.z) <= Math.hypot(network.end.x - origin.x, network.end.z - origin.z) ? network.start_node_id : network.end_node_id, target_position: end, utility_prefab: network.prefab, distance_m: Math.hypot(end.x - origin.x, end.z - origin.z) };
          }).filter(item => connectionMatchesPrefab(connection, networks.find(network => network.prefab === item.utility_prefab) || selectedPrefab)).sort((a, b) => a.distance_m - b.distance_m);
          targets = candidates.filter(item => item.distance_m <= args.search_radius_m).slice(0, args.max_preview_attempts * 4);
        }
        if (!targets.length) throw new BridgeError('UTILITY_TARGET_NOT_FOUND', 'No compatible utility network target was found within search_radius_m.');
        const attempts = [];
        for (let index = 0; index < Math.min(args.max_preview_attempts, targets.length); index++) {
          const target = targets[index];
          const port = target.facility_port || ports.find(item => item.node_id === target.facility_port_id) || ports[index % Math.max(1, ports.length)];
          const start = port?.position || facility.position; const end = target.target_position || target.position || target.end;
          const paths = args.routing === 'direct' ? [[start, end]] : args.routing === 'orthogonal' ? [[start, { x: end.x, z: start.z }, end]] : [[start, end], [start, { x: end.x, z: start.z }, end], [start, { x: start.x, z: end.z }, end]];
          for (const [pathIndex, path] of paths.entries()) {
            const points = path.map(point); if (port?.node_id) points[0] = { ...points[0], node_id: port.node_id }; if (target.target_node_id) points[points.length - 1] = { ...points[points.length - 1], node_id: target.target_node_id };
            const previewArgs = { request_id: childRequestId(args.request_id, `${index + 1}-${pathIndex + 1}`), utility_prefab: args.utility_prefab || selectedPrefab.name, points };
            let operation;
            try { const queued = await queryGame('preview_utility_network', previewArgs); operation = queued.data?.state === 'preview_ready' ? queued.data : await waitOperation(queued.data.operation_id, 'preview_ready', args.operation_timeout_ms); }
            catch (error) { attempts.push({ target_index: index, path: pathIndex, state: 'error', error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message }); continue; }
            if (operation?.state === 'outcome_unknown') {
              const failure = new BridgeError('OUTCOME_UNKNOWN', 'Native utility preview outcome is unknown; inspect the original operation before taking any further action.');
              failure.operation_id = operation.operation_id;
              failure.attempts = attempts;
              throw failure;
            }
            if (operation?.state !== 'preview_ready') { attempts.push({ target_index: index, path: pathIndex, state: operation?.state || 'failed', errors: operation?.errors || [], error: operation?.error || null }); continue; }
            const applied = await queryGame('apply_utility_operation', { operation_id: operation.operation_id, request_id: previewArgs.request_id, max_cost: args.max_cost });
            const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation(operation.operation_id, 'completed', args.operation_timeout_ms);
            if (completed?.state === 'outcome_unknown') {
              const failure = new BridgeError('OUTCOME_UNKNOWN', 'Native utility apply outcome is unknown; inspect the original operation before any further action.');
              failure.operation_id = operation.operation_id;
              failure.attempts = attempts;
              throw failure;
            }
            const resultEdgeIds = completed.created_utility_edge_ids?.length
              ? completed.created_utility_edge_ids
              : completed.result_edge_ids?.length
                ? completed.result_edge_ids
                : completed.created_road_ids || [];
            const result = { state: completed.state, facility_id: args.facility_id, connection, utility_prefab: previewArgs.utility_prefab, target, port: port || null, operation_id: operation.operation_id, attempts, cost: completed.cost || operation.cost || 0, result_edge_ids: resultEdgeIds };
            requests.set(args.request_id, { fingerprint, result }); return result;
          }
        }
        const failure = new BridgeError('UTILITY_CONNECTION_FAILED', `All ${attempts.length} native connection previews were rejected. Attempts: ${JSON.stringify(attempts)}`);
        failure.attempts = attempts;
        throw failure;
      } finally { if (pausedByWorkflow) await queryGame('set_simulation_speed', { speed: beforeSpeed }); }
    });
  }
  return { connect, _requests: requests };
}

const workflow = createUtilityConnectionWorkflow();
export const connectUtilityFacility = args => workflow.connect(args);
