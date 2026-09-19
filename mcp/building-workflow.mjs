import { randomBytes } from 'node:crypto';
import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';

const FAILURE_STATES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const CATEGORY_CONFIG = {
  building: {
    list: 'list_building_prefabs', plan: 'plan_building_site', specialPlan: 'plan_special_building_site',
    preview: 'preview_building_placement', specialPreview: 'preview_special_building_placement',
    get: 'get_building_operation', apply: 'apply_building_operation', cancel: 'cancel_building_preview', read: 'get_building_state'
  },
  city_service: {
    list: 'list_city_service_prefabs', plan: 'plan_city_service_site', preview: 'preview_city_service_placement',
    get: 'get_city_service_operation', apply: 'apply_city_service_operation', cancel: 'cancel_city_service_preview', read: 'get_city_service_facility'
  },
  transport_facility: {
    list: 'list_transport_facility_prefabs', plan: 'plan_transport_facility_site', preview: 'preview_transport_facility_placement',
    get: 'get_transport_facility_operation', apply: 'apply_transport_facility_operation', cancel: 'cancel_transport_facility_preview', read: 'get_transport_facility'
  },
  utility_facility: {
    list: 'list_utility_facility_prefabs', plan: 'plan_utility_facility_site', preview: 'preview_utility_facility_placement',
    get: 'get_utility_facility_operation', apply: 'apply_utility_facility_operation', cancel: 'cancel_utility_facility_preview', read: 'get_utility_facility'
  }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const compact = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const id = prefix => `${prefix}-${randomBytes(8).toString('hex')}`;
const childRequestId = (base, suffix) => `${base.slice(0, Math.max(8, 99 - suffix.length))}-${suffix}`;
const speedOf = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';
const exactItem = (response, wanted) => response?.data?.items?.find(item => item.name?.toLowerCase() === wanted.toLowerCase());
const specialPlacement = prefab => /Shoreline|Floating|RoadEdge|RoadNode/i.test(prefab?.placement_flags || '') ||
  ['shoreline', 'floating', 'road_edge', 'road_node'].includes(prefab?.placement_mode);

export function createBuildingWorkflow(queryGame = liveQueryGame) {
  const plans = new Map();
  const planRequests = new Map();
  const executionRequests = new Map();
  const prefabCache = new Map();
  let constructionTail = Promise.resolve();

  const exclusive = async fn => {
    const previous = constructionTail;
    let release;
    constructionTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  async function waitOperation(config, operationId, target, timeoutMs, expectedSessionId) {
    const started = Date.now();
    let delay = 50;
    let last;
    while (Date.now() - started < timeoutMs) {
      const envelope = await queryGame(config.get, { operation_id: operationId });
      const actualSessionId = envelope.meta?.session_id || envelope.data?.session_id;
      if (expectedSessionId && actualSessionId && actualSessionId !== expectedSessionId) throw new BridgeError('CITY_SESSION_CHANGED', 'The loaded city session changed while waiting for the building operation.');
      last = envelope.data;
      if (last?.state === target) return last;
      if (FAILURE_STATES.has(last?.state)) return last;
      await sleep(delay);
      delay = Math.min(400, Math.round(delay * 1.7));
    }
    throw new BridgeError('WORKFLOW_TIMEOUT', `Operation ${operationId} timed out waiting for ${target}; last state was ${last?.state || 'unknown'}.`);
  }

  async function discover(prefabName, requestedCategory, sessionId) {
    const cacheKey = `${sessionId}:${requestedCategory}:${prefabName.toLowerCase()}`;
    if (prefabCache.has(cacheKey)) return prefabCache.get(cacheKey);
    const categories = requestedCategory === 'auto' ? Object.keys(CATEGORY_CONFIG) : [requestedCategory];
    const found = await Promise.all(categories.map(async category => {
      const config = CATEGORY_CONFIG[category];
      const args = category === 'building'
        ? { search: prefabName, kind: 'building', unlocked_only: true, offset: 0, limit: 100 }
        : { search: prefabName, kind: 'all', unlocked_only: true, offset: 0, limit: 100 };
      const response = await queryGame(config.list, args);
      return { category, prefab: exactItem(response, prefabName) };
    }));
    const specialized = found.filter(x => x.category !== 'building' && x.prefab);
    if (specialized.length > 1) throw new BridgeError('AMBIGUOUS_BUILDING_CATEGORY', `Prefab ${prefabName} appears in multiple specialized categories; set category explicitly.`);
    const match = specialized[0] || found.find(x => x.prefab);
    if (!match) throw new BridgeError('BUILDING_PREFAB_NOT_FOUND', `No unlocked exact prefab named ${prefabName} was found.`);
    prefabCache.set(cacheKey, match);
    return match;
  }

  async function analyze(category, prefab, candidate, radius, enabled = true) {
    if (category === 'city_service' && !enabled) return null;
    const position = { x: candidate.position.x, z: candidate.position.z };
    try {
      if (category === 'transport_facility') return (await queryGame('analyze_transport_catchment', { position, radius_m: radius })).data;
      if (category === 'building' && prefab.placement?.unique) return (await queryGame('analyze_attraction_impact', { position, radius_m: radius })).data;
      if (category !== 'city_service') return null;
      if (prefab.kind === 'education') return (await queryGame('analyze_education_demand', { position, radius_m: radius })).data;
      if (prefab.kind === 'park') return (await queryGame('analyze_attraction_impact', { position, radius_m: radius })).data;
      return (await queryGame('analyze_service_coverage', { position, kind: prefab.kind || 'all', radius_m: radius, facility_limit: 16 })).data;
    } catch (error) {
      return { unavailable: true, error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message };
    }
  }

  async function createPlan(args, lockHeld = false) {
    const fingerprint = JSON.stringify(args);
    const existingId = planRequests.get(args.request_id);
    if (existingId) {
      const existing = plans.get(existingId);
      if (existing?.fingerprint !== fingerprint) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different planning arguments.');
      const statusEnvelope = await queryGame('get_game_status', {});
      if (statusEnvelope.meta?.session_id !== existing?.public.session_id) throw new BridgeError('STALE_BUILDING_PLAN', 'The loaded city session changed. Use a new request_id to re-plan the building.');
      return existing.public;
    }
    if (plans.size >= 256) throw new BridgeError('BUILDING_PLAN_LIMIT_REACHED', 'This MCP session already holds 256 building plans. Restart the MCP server to clear the workflow journal.');

    const statusEnvelope = await queryGame('get_game_status', {});
    const status = statusEnvelope.data || {};
    if (!status.city_loaded) throw new BridgeError('CITY_NOT_READY', 'No playable city is loaded.');
    const sessionId = statusEnvelope.meta?.session_id;
    const beforeSpeed = speedOf(status);
    const discovered = await discover(args.building_prefab, args.category, sessionId);
    const config = CATEGORY_CONFIG[discovered.category];
    const useSpecial = discovered.category === 'building' && specialPlacement(discovered.prefab);
    const planTool = useSpecial ? config.specialPlan : config.plan;
    const planArgs = compact({
      building_prefab: args.building_prefab, near: args.near, mode: useSpecial ? args.mode : discovered.category === 'building' ? undefined : args.mode,
      search_radius_m: args.search_radius_m, road_side: useSpecial ? undefined : args.road_side,
      candidate_count: args.candidate_count, minimum_water_depth_m: useSpecial || discovered.category !== 'building' ? args.minimum_water_depth_m : undefined,
      reserve_upgrade_prefabs: useSpecial ? undefined : args.reserve_upgrade_prefabs,
      consider_service_coverage: discovered.category === 'city_service' ? args.consider_service_coverage : undefined,
      coverage_radius_m: discovered.category === 'city_service' ? args.impact_radius_m : undefined
    });
    const candidates = (await queryGame(planTool, planArgs)).data?.candidates || [];
    const usable = args.allow_approximate_collisions ? candidates : candidates.filter(candidate => !candidate.approximate_collision);
    if (!usable.length) throw new BridgeError('NO_BUILDING_SITE', 'The planner found no collision-free candidate. Expand the search area or choose another location.');

    const previewCandidate = async () => {
      let pausedByWorkflow = false;
      const attempts = [];
      try {
        if (!status.paused) {
          await queryGame('set_simulation_speed', { speed: 'paused' });
          pausedByWorkflow = true;
        }
        for (let index = 0; index < Math.min(usable.length, args.max_preview_attempts); index++) {
          const candidate = usable[index];
          const previewRequestId = childRequestId(args.request_id, String(index + 1));
          const previewTool = useSpecial ? config.specialPreview : config.preview;
          const previewArgs = compact({
            request_id: previewRequestId, building_prefab: args.building_prefab,
            position: discovered.category === 'building' && !useSpecial
              ? { x: candidate.position.x, z: candidate.position.z }
              : candidate.position,
            rotation_degrees: candidate.rotation_degrees ?? 0,
            road_edge_id: useSpecial ? undefined : candidate.road_edge_id,
            snap_target_id: candidate.snap_target_id || (useSpecial ? candidate.road_edge_id || candidate.road_node_id : undefined)
          });
          let operation;
          try {
            const queued = await queryGame(previewTool, previewArgs);
            operation = queued.data?.state === 'preview_ready' ? queued.data
              : await waitOperation(config, queued.data.operation_id, 'preview_ready', args.operation_timeout_ms, sessionId);
          } catch (error) {
            attempts.push({ candidate_index: index, state: 'error', error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message });
            continue;
          }
          if (operation.state !== 'preview_ready') {
            attempts.push({ candidate_index: index, state: operation.state, errors: operation.errors || [], error: operation.error || null });
            continue;
          }
          const planId = id('bplan');
          const impact = await analyze(discovered.category, discovered.prefab, candidate, args.impact_radius_m, args.consider_service_coverage);
          const publicPlan = {
            plan_id: planId, state: 'preview_ready', session_id: sessionId, city: status.city_name,
            category: discovered.category, building_prefab: args.building_prefab, prefab: discovered.prefab,
            selected_candidate_index: index, candidate, impact, cost: operation.cost || 0,
            warnings: operation.warnings || [], operation_id: operation.operation_id,
            expires_at_utc: operation.expires_at_utc, attempts, built: false
          };
          plans.set(planId, { public: publicPlan, fingerprint, config, previewRequestId, operationTimeoutMs: args.operation_timeout_ms, executionRequestId: null });
          planRequests.set(args.request_id, planId);
          return publicPlan;
        }
        throw new BridgeError('NO_PREVIEWABLE_BUILDING_SITE', `All ${Math.min(usable.length, args.max_preview_attempts)} candidate previews were rejected by the game.`);
      } finally {
        if (pausedByWorkflow) await queryGame('set_simulation_speed', { speed: beforeSpeed });
      }
    };
    return lockHeld ? previewCandidate() : exclusive(previewCandidate);
  }

  async function commitStoredPlan(stored, maxCost, executionRequestId) {
    const plan = stored.public;
    const readBack = async operation => {
      plan.state = operation.state;
      plan.built = operation.state === 'completed';
      plan.cost = operation.cost ?? plan.cost;
      plan.result_entity_ids = operation.result_entity_ids || [];
      plan.errors = operation.errors || [];
      plan.error = operation.error || null;
      if (plan.built && plan.result_entity_ids.length) {
        const entityId = plan.result_entity_ids[0];
        const readArgs = plan.category === 'building' ? { building_id: entityId } : { facility_id: entityId };
        try { plan.readback = (await queryGame(stored.config.read, readArgs)).data; } catch { plan.readback = null; }
        const expectedRoadEdgeId = plan.candidate?.road_edge_id ?? null;
        if (expectedRoadEdgeId) {
          const actualRoadEdgeId = plan.readback?.road_edge_id ?? null;
          plan.road_binding = { expected_road_edge_id: expectedRoadEdgeId, actual_road_edge_id: actualRoadEdgeId, verified: actualRoadEdgeId === expectedRoadEdgeId };
          if (!plan.road_binding.verified) {
            plan.state = 'completed_readback_incomplete';
            plan.built = false;
            plan.recovery_required = true;
            plan.error = 'Permanent building road binding does not match the preview candidate.';
          }
        }
      }
      return plan;
    };
    if (plan.state === 'completed') return plan;
    if (plan.state !== 'preview_ready') throw new BridgeError('BUILDING_PLAN_NOT_EXECUTABLE', `Plan is ${plan.state}.`);
    if (stored.executionRequestId && stored.executionRequestId !== executionRequestId) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'This plan is already associated with another execution request_id.');
    const current = (await queryGame(stored.config.get, { operation_id: plan.operation_id })).data;
    if (current.state === 'completed') return readBack(current);
    if (current.state !== 'preview_ready') {
      plan.state = current.state;
      plan.errors = current.errors || [];
      plan.error = current.error || null;
      throw new BridgeError('BUILDING_PLAN_NOT_EXECUTABLE', `Native preview is ${current.state}. Re-plan before executing.`);
    }
    plan.cost = current.cost ?? plan.cost;
    if (plan.cost > maxCost) throw new BridgeError('COST_LIMIT_EXCEEDED', `Plan cost ${plan.cost} exceeds max_cost ${maxCost}.`);
    stored.executionRequestId = executionRequestId;
    const applied = await queryGame(stored.config.apply, { operation_id: plan.operation_id, request_id: stored.previewRequestId, max_cost: maxCost });
    const done = applied.data?.state === 'completed' ? applied.data
      : await waitOperation(stored.config, plan.operation_id, 'completed', stored.operationTimeoutMs, stored.public.session_id);
    return readBack(done);
  }

  async function executePlan(args, lockHeld = false) {
    const stored = plans.get(args.plan_id);
    if (!stored) throw new BridgeError('BUILDING_PLAN_NOT_FOUND', 'plan_id is unknown or the MCP process was restarted. Re-plan the building.');
    const fingerprint = JSON.stringify(args);
    const prior = executionRequests.get(args.request_id);
    if (prior && prior.fingerprint !== fingerprint) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different execution arguments.');
    const commitPlan = async () => {
      const statusEnvelope = await queryGame('get_game_status', {});
      if (statusEnvelope.meta?.session_id !== stored.public.session_id) throw new BridgeError('STALE_BUILDING_PLAN', 'The loaded city session changed. Re-plan the building.');
      if (prior?.result) return prior.result;
      const beforeSpeed = speedOf(statusEnvelope.data);
      let pausedByWorkflow = false;
      try {
        if (!statusEnvelope.data.paused) { await queryGame('set_simulation_speed', { speed: 'paused' }); pausedByWorkflow = true; }
        const result = await commitStoredPlan(stored, args.max_cost, args.request_id);
        executionRequests.set(args.request_id, { fingerprint, result });
        return result;
      } finally {
        const resume = args.resume_speed === 'original' ? beforeSpeed : args.resume_speed;
        if (pausedByWorkflow || args.resume_speed !== 'original') await queryGame('set_simulation_speed', { speed: resume });
      }
    };
    return lockHeld ? commitPlan() : exclusive(commitPlan);
  }

  async function cancelPlan(args) {
    const stored = plans.get(args.plan_id);
    if (!stored) throw new BridgeError('BUILDING_PLAN_NOT_FOUND', 'plan_id is unknown or the MCP process was restarted.');
    if (stored.public.state === 'completed') throw new BridgeError('BUILDING_PLAN_NOT_CANCELLABLE', 'A completed building plan cannot be cancelled.');
    if (stored.public.state === 'cancelled') return stored.public;
    await queryGame(stored.config.cancel, { operation_id: stored.public.operation_id });
    stored.public.state = 'cancelled';
    return stored.public;
  }

  async function deployPlans(args) {
    const fingerprint = JSON.stringify(args);
    const prior = executionRequests.get(args.request_id);
    if (prior && prior.fingerprint !== fingerprint) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different deployment arguments.');
    if (prior?.result) return prior.result;
    return exclusive(async () => {
      const statusEnvelope = await queryGame('get_game_status', {});
      const beforeSpeed = speedOf(statusEnvelope.data);
      if (!statusEnvelope.data?.city_loaded) throw new BridgeError('CITY_NOT_READY', 'No playable city is loaded.');
      let pausedByWorkflow = false;
      const results = [];
      let totalCost = 0;
      try {
        if (!statusEnvelope.data.paused) {
          await queryGame('set_simulation_speed', { speed: 'paused' });
          pausedByWorkflow = true;
        }
        for (let index = 0; index < args.buildings.length; index++) {
          const item = args.buildings[index];
          let plan;
          try {
            plan = await createPlan({
              ...item,
              request_id: childRequestId(args.request_id, `plan-${index + 1}`),
              category: item.category || 'auto',
              search_radius_m: item.search_radius_m ?? args.search_radius_m,
              road_side: item.road_side || args.road_side,
              candidate_count: item.candidate_count ?? args.candidate_count,
              max_preview_attempts: item.max_preview_attempts ?? args.max_preview_attempts,
              operation_timeout_ms: args.operation_timeout_ms,
              mode: item.mode || 'auto',
              minimum_water_depth_m: item.minimum_water_depth_m ?? 1,
              consider_service_coverage: item.consider_service_coverage ?? true,
              impact_radius_m: item.impact_radius_m ?? args.impact_radius_m,
              allow_approximate_collisions: item.allow_approximate_collisions ?? false
            }, true);
            if (totalCost + plan.cost > args.max_total_cost) {
              await cancelPlan({ plan_id: plan.plan_id });
              throw new BridgeError('COST_LIMIT_EXCEEDED', `Adding ${item.building_prefab} would exceed max_total_cost ${args.max_total_cost}.`);
            }
            const built = await executePlan({
              plan_id: plan.plan_id,
              request_id: childRequestId(args.request_id, `build-${index + 1}`),
              max_cost: Math.min(item.max_cost ?? args.max_cost_per_building, args.max_total_cost - totalCost),
              resume_speed: 'original'
            }, true);
            totalCost += built.cost || 0;
            results.push(built);
            if (built.recovery_required || built.state === 'outcome_unknown' ||
                (built.state !== 'completed' && !args.continue_on_error)) break;
          } catch (error) {
            if (plan?.state === 'preview_ready') {
              try { await cancelPlan({ plan_id: plan.plan_id }); } catch {}
            }
            results.push({
              plan_id: plan?.plan_id || null, building_prefab: item.building_prefab, state: 'failed',
              error: error instanceof BridgeError ? `${error.code}: ${error.message}` : error.message
            });
            if (!args.continue_on_error) break;
          }
        }
        const result = {
          state: results.length === args.buildings.length && results.every(x => x.state === 'completed') ? 'completed' : 'partial',
          planned_count: args.buildings.length, completed_count: results.filter(x => x.state === 'completed').length,
          total_cost: totalCost, results
        };
        executionRequests.set(args.request_id, { fingerprint, result });
        return result;
      } finally {
        if (pausedByWorkflow) await queryGame('set_simulation_speed', { speed: beforeSpeed });
      }
    });
  }

  return { createPlan, executePlan, cancelPlan, deployPlans, _plans: plans };
}

const liveWorkflow = createBuildingWorkflow();
export const planBuildingWorkflow = args => liveWorkflow.createPlan(args);
export const executeBuildingPlan = args => liveWorkflow.executePlan(args);
export const cancelBuildingPlan = args => liveWorkflow.cancelPlan(args);
export const deployBuildingPlans = args => liveWorkflow.deployPlans(args);
