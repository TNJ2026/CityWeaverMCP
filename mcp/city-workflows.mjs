import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';
import { deployDistrict as liveDeployDistrict } from '../tools/deploy-district.mjs';
import { deployBuildingPlans as liveDeployBuildingPlans } from './building-workflow.mjs';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const childRequestId = (base, suffix) => `${base.slice(0, Math.max(8, 99 - suffix.length))}-${suffix}`;
const citySpeed = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';
const sessionIdOf = response => response?.meta?.session_id || response?.data?.session_id || null;

function workflowError(code, message, details = {}) {
  const error = new BridgeError(code, message);
  Object.assign(error, details);
  return error;
}

export function createCityWorkflows(queryGame = liveQueryGame, dependencies = {}) {
  const deployDistrict = dependencies.deployDistrict || liveDeployDistrict;
  const deployBuildingPlans = dependencies.deployBuildingPlans || liveDeployBuildingPlans;
  const requests = new Map();
  let constructionTail = Promise.resolve();

  const exclusive = async fn => {
    const previous = constructionTail;
    let release;
    constructionTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  async function waitOperation(tool, operationId, target, timeoutMs) {
    const started = Date.now();
    let delay = 100;
    let last = null;
    while (Date.now() - started < timeoutMs) {
      last = (await queryGame(tool, { operation_id: operationId })).data;
      if (last?.state === target) return last;
      if (TERMINAL_FAILURES.has(last?.state)) return last;
      await sleep(delay);
      delay = Math.min(800, Math.round(delay * 1.5));
    }
    throw workflowError('WORKFLOW_TIMEOUT', `Operation ${operationId} timed out waiting for ${target}.`, { operation_id: operationId, last_state: last?.state });
  }

  function checkIdempotency(requestId, fingerprint) {
    const prior = requests.get(requestId);
    if (prior && prior.fingerprint !== fingerprint) throw workflowError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different workflow arguments.');
    if (prior?.result) return prior.result;
    return null;
  }

  async function withPausedCity(fn, resumeSpeed = 'original') {
    const statusEnvelope = await queryGame('get_game_status', {});
    const status = statusEnvelope.data || {};
    if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
    const beforeSpeed = citySpeed(status);
    let pausedByWorkflow = false;
    try {
      if (!status.paused) {
        await queryGame('set_simulation_speed', { speed: 'paused' });
        pausedByWorkflow = true;
      }
      return await fn({ status, sessionId: sessionIdOf(statusEnvelope), beforeSpeed });
    } finally {
      const speed = resumeSpeed === 'original' ? beforeSpeed : resumeSpeed;
      if (pausedByWorkflow || resumeSpeed !== 'original') await queryGame('set_simulation_speed', { speed });
    }
  }

  async function deployServiceCluster(args) {
    const fingerprint = JSON.stringify(args);
    const prior = checkIdempotency(args.request_id, fingerprint);
    if (prior) return prior;
    return exclusive(async () => {
      const result = await withPausedCity(async ({ status, sessionId }) => {
        const buildings = args.services.map((item, index) => compact({
          building_prefab: item.building_prefab,
          category: 'city_service',
          near: item.near || args.anchor,
          mode: item.mode || 'auto',
          search_radius_m: item.search_radius_m ?? args.search_radius_m,
          candidate_count: item.candidate_count ?? args.candidate_count,
          max_preview_attempts: item.max_preview_attempts ?? args.max_preview_attempts,
          consider_service_coverage: item.consider_service_coverage ?? true,
          impact_radius_m: item.impact_radius_m ?? args.impact_radius_m,
          reserve_upgrade_prefabs: item.reserve_upgrade_prefabs || [],
          request_id: childRequestId(args.request_id, `service-${index + 1}`)
        }));
        const deployed = await deployBuildingPlans({
          request_id: childRequestId(args.request_id, 'buildings'),
          buildings,
          operation_timeout_ms: args.operation_timeout_ms,
          max_cost_per_building: args.max_cost_per_building,
          max_total_cost: args.max_total_cost,
          continue_on_error: args.continue_on_error
        });
        const assignments = [];
        if (args.district_ids?.length) {
          for (const item of deployed.results || []) {
            const facilityId = item.result_entity_ids?.[0];
            if (!facilityId || item.state !== 'completed') continue;
            const assigned = await queryGame('set_service_districts', { service_id: facilityId, district_ids: args.district_ids });
            assignments.push({ service_id: facilityId, district_ids: args.district_ids, result: assigned.data });
          }
        }
        return {
          state: deployed.state,
          workflow: 'deploy_service_cluster',
          city: status.city_name,
          session_id: sessionId,
          anchor: args.anchor,
          planned_count: deployed.planned_count,
          completed_count: deployed.completed_count,
          total_cost: deployed.total_cost,
          assignments,
          results: deployed.results
        };
      }, args.resume_speed);
      requests.set(args.request_id, { fingerprint, result });
      return result;
    });
  }

  async function deployIndustrialCampus(args) {
    const fingerprint = JSON.stringify(args);
    const prior = checkIdempotency(args.request_id, fingerprint);
    if (prior) return prior;
    return exclusive(async () => {
      const result = await withPausedCity(async ({ status, sessionId }) => {
        let district;
        try {
          district = await deployDistrict({
            ...args.district,
            origin: args.district.origin || args.anchor,
            resume_speed: 'paused',
            growth_loop: undefined,
            request_id: childRequestId(args.request_id, 'district')
          });
        } catch (error) {
          district = { success: false, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message };
        }
        let totalCost = district.total_cost || 0;
        const phases = [{ phase: 'district', state: district.success ? 'completed' : 'failed', result: district }];
        if (!district.success) return { state: 'partial', workflow: 'deploy_industrial_campus', city: status.city_name, session_id: sessionId, phases };
        if (totalCost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER)) return { state: 'partial', workflow: 'deploy_industrial_campus', city: status.city_name, session_id: sessionId, phases, total_cost: totalCost, error: 'COST_LIMIT_EXCEEDED' };

        let buildings = null;
        if (args.buildings?.length) {
          buildings = await deployBuildingPlans({
            request_id: childRequestId(args.request_id, 'buildings'),
            buildings: args.buildings.map((item, index) => ({
              ...item,
              category: item.category || 'building',
              near: item.near || args.anchor,
              request_id: childRequestId(args.request_id, `campus-building-${index + 1}`)
            })),
            operation_timeout_ms: args.operation_timeout_ms,
            max_cost_per_building: args.max_cost_per_building,
            max_total_cost: Math.max(0, (args.max_total_cost ?? Number.MAX_SAFE_INTEGER) - totalCost),
            continue_on_error: args.continue_on_error
          });
          phases.push({ phase: 'buildings', state: buildings.state, result: buildings });
          totalCost += buildings.total_cost || 0;
          if (buildings.state === 'partial' && !args.continue_on_error) return { state: 'partial', workflow: 'deploy_industrial_campus', city: status.city_name, session_id: sessionId, phases };
        }

        const areas = [];
        for (const [index, item] of (args.areas || []).entries()) {
          const ownerId = item.building_id || buildings?.results?.[item.building_index ?? index]?.result_entity_ids?.[0];
          if (!ownerId) {
            areas.push({ phase: 'area', state: 'skipped', reason: 'BUILDING_OWNER_NOT_AVAILABLE', item });
            if (!args.continue_on_error) break;
            continue;
          }
          const available = (await queryGame('list_building_areas', { building_id: ownerId })).data;
          const areaPrefab = item.area_prefab || available?.available_area_prefabs?.[0]?.name || available?.available?.[0]?.name;
          if (!areaPrefab) {
            areas.push({ phase: 'area', state: 'failed', reason: 'AREA_PREFAB_NOT_FOUND', building_id: ownerId });
            if (!args.continue_on_error) break;
            continue;
          }
          const requestId = childRequestId(args.request_id, `area-${index + 1}`);
          const preview = await queryGame('preview_building_area', { request_id: requestId, mode: 'create', building_id: ownerId, area_prefab: areaPrefab, boundary: item.boundary });
          const operationId = preview.data?.operation_id;
          const operation = preview.data?.state && !['queued', 'previewing', 'commit_queued'].includes(preview.data.state)
            ? preview.data : await waitOperation('get_building_area_operation', operationId, 'preview_ready', args.operation_timeout_ms);
          if (operation.state !== 'preview_ready') {
            areas.push({ phase: 'area', state: operation.state, building_id: ownerId, area_prefab: areaPrefab, errors: operation.errors || [], operation_id: operationId });
            if (!args.continue_on_error) break;
            continue;
          }
          const areaCost = operation.cost || 0;
          if (totalCost + areaCost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER)) {
            areas.push({ phase: 'area', state: 'failed', reason: 'COST_LIMIT_EXCEEDED', building_id: ownerId, area_prefab: areaPrefab, operation_id: operationId, cost: areaCost });
            if (!args.continue_on_error) break;
            continue;
          }
          const applied = await queryGame('apply_building_area_operation', { operation_id: operationId, request_id: requestId, max_cost: item.max_cost ?? args.max_cost_per_area });
          const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation('get_building_area_operation', operationId, 'completed', args.operation_timeout_ms);
          areas.push({ phase: 'area', state: completed.state, building_id: ownerId, area_prefab: areaPrefab, operation_id: operationId, result_area_id: completed.result_area_id, cost: completed.cost || operation.cost || 0, errors: completed.errors || [] });
          totalCost += completed.cost || operation.cost || 0;
          if (completed.state !== 'completed' && !args.continue_on_error) break;
        }
        if (areas.length) phases.push({ phase: 'areas', state: areas.every(item => item.state === 'completed' || item.state === 'skipped') ? 'completed' : 'partial', result: areas });
        const failed = phases.some(phase => phase.state === 'failed' || phase.state === 'partial');
        return { state: failed ? 'partial' : 'completed', workflow: 'deploy_industrial_campus', city: status.city_name, session_id: sessionId, phases, total_cost: totalCost };
      }, args.resume_speed);
      requests.set(args.request_id, { fingerprint, result });
      return result;
    });
  }

  async function deployTransitCorridor(args) {
    const fingerprint = JSON.stringify(args);
    const prior = checkIdempotency(args.request_id, fingerprint);
    if (prior) return prior;
    return exclusive(async () => {
      const result = await withPausedCity(async ({ status, sessionId }) => {
        const phases = [];
        let totalCost = 0;
        let facilities = null;
        if (args.facilities?.length) {
          facilities = await deployBuildingPlans({
            request_id: childRequestId(args.request_id, 'facilities'),
            buildings: args.facilities.map((item, index) => ({ ...item, category: 'transport_facility', request_id: childRequestId(args.request_id, `facility-${index + 1}`) })),
            operation_timeout_ms: args.operation_timeout_ms,
            max_cost_per_building: args.max_cost_per_building,
            max_total_cost: args.max_total_cost,
            continue_on_error: false
          });
          phases.push({ phase: 'facilities', state: facilities.state, result: facilities });
          totalCost += facilities.total_cost || 0;
          if (facilities.state !== 'completed') return { state: 'partial', workflow: 'deploy_transit_corridor', city: status.city_name, session_id: sessionId, phases };
        }
        const tracks = [];
        for (const [index, track] of (args.tracks || []).entries()) {
          const requestId = childRequestId(args.request_id, `track-${index + 1}`);
          const preview = await queryGame('preview_transport_track', { request_id: requestId, track_prefab: track.track_prefab, points: track.points });
          const operationId = preview.data?.operation_id;
          const operation = preview.data?.state && !['queued', 'previewing', 'commit_queued'].includes(preview.data.state)
            ? preview.data : await waitOperation('get_transport_track_operation', operationId, 'preview_ready', args.operation_timeout_ms);
          if (operation.state !== 'preview_ready') { tracks.push({ state: operation.state, operation_id: operationId, errors: operation.errors || [] }); break; }
          const trackCost = operation.cost || 0;
          if (totalCost + trackCost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER)) {
            tracks.push({ state: 'failed', operation_id: operationId, errors: ['COST_LIMIT_EXCEEDED'], cost: trackCost });
            break;
          }
          const applied = await queryGame('apply_transport_track_operation', { operation_id: operationId, request_id: requestId, max_cost: Math.min(track.max_cost ?? args.max_cost_per_track, (args.max_total_cost ?? Number.MAX_SAFE_INTEGER) - totalCost) });
          const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation('get_transport_track_operation', operationId, 'completed', args.operation_timeout_ms);
          tracks.push({ state: completed.state, operation_id: operationId, created_track_ids: completed.created_track_ids || [], cost: completed.cost || operation.cost || 0, errors: completed.errors || [] });
          totalCost += completed.cost || operation.cost || 0;
          if (completed.state !== 'completed') break;
        }
        if (tracks.length) phases.push({ phase: 'tracks', state: tracks.every(item => item.state === 'completed') ? 'completed' : 'partial', result: tracks });
        if (tracks.some(item => item.state !== 'completed')) return { state: 'partial', workflow: 'deploy_transit_corridor', city: status.city_name, session_id: sessionId, phases };

        const lineResults = [];
        for (const [index, line] of (args.lines || []).entries()) {
          const requestId = childRequestId(args.request_id, `line-${index + 1}`);
          const preview = await queryGame('preview_transport_line', { request_id: requestId, line_prefab: line.line_prefab, stop_ids: line.stop_ids, name: line.name || '', color: line.color });
          const operationId = preview.data?.operation_id;
          const operation = preview.data?.state && !['queued', 'previewing', 'commit_queued'].includes(preview.data.state)
            ? preview.data : await waitOperation('get_transport_line_operation', operationId, 'preview_ready', args.operation_timeout_ms);
          if (operation.state !== 'preview_ready') { lineResults.push({ state: operation.state, operation_id: operationId, errors: operation.errors || [] }); break; }
          const lineCost = operation.cost || 0;
          if (totalCost + lineCost > (args.max_total_cost ?? Number.MAX_SAFE_INTEGER)) {
            lineResults.push({ state: 'failed', operation_id: operationId, errors: ['COST_LIMIT_EXCEEDED'], cost: lineCost });
            break;
          }
          const applied = await queryGame('apply_transport_line_operation', { operation_id: operationId, request_id: requestId });
          const completed = applied.data?.state === 'completed' ? applied.data : await waitOperation('get_transport_line_operation', operationId, 'completed', args.operation_timeout_ms);
          lineResults.push({ state: completed.state, operation_id: operationId, line_id: completed.result_line_id, cost: completed.cost || operation.cost || 0, errors: completed.errors || [] });
          totalCost += completed.cost || operation.cost || 0;
          if (completed.state !== 'completed') break;
        }
        if (lineResults.length) phases.push({ phase: 'lines', state: lineResults.every(item => item.state === 'completed') ? 'completed' : 'partial', result: lineResults });
        const failed = phases.some(phase => phase.state !== 'completed');
        return { state: failed ? 'partial' : 'completed', workflow: 'deploy_transit_corridor', city: status.city_name, session_id: sessionId, phases, total_cost: totalCost };
      }, args.resume_speed);
      requests.set(args.request_id, { fingerprint, result });
      return result;
    });
  }

  return { deployServiceCluster, deployIndustrialCampus, deployTransitCorridor, _requests: requests };
}

const liveWorkflows = createCityWorkflows();
export const deployServiceCluster = args => liveWorkflows.deployServiceCluster(args);
export const deployIndustrialCampus = args => liveWorkflows.deployIndustrialCampus(args);
export const deployTransitCorridor = args => liveWorkflows.deployTransitCorridor(args);
