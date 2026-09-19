import { BridgeError } from './bridge-client.mjs';
import { computeCityPlanId } from './planning-renderer.mjs';
import { planBuildingWorkflow as livePlanBuildingWorkflow, cancelBuildingPlan as liveCancelBuildingPlan } from './building-workflow.mjs';

const NON_BUILDABLE_STATUSES = new Set(['built', 'completed', 'skipped']);
const compact = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const childRequestId = (base, index) => `${base.slice(0, 91)}-bind-${index + 1}`.slice(0, 100);

function rotationSource(candidate) {
  const kind = String(candidate?.snap_target_kind ?? '').toLowerCase();
  if (kind.includes('shoreline')) return 'shoreline_normal';
  if (kind.includes('road') || kind.includes('network') || candidate?.snap_target_id) return 'network_snap';
  if (candidate?.road_edge_id) return 'road_tangent';
  return 'native_snap';
}

function previewAnnotation(preview) {
  return {
    operation_id: preview.operation_id ?? null,
    state: preview.state,
    cost: Number(preview.cost ?? 0),
    warnings: (preview.warnings ?? []).map(String),
    errors: (preview.errors ?? []).map(String),
    error: preview.error ? String(preview.error) : null,
    expires_at_utc: preview.expires_at_utc ?? null,
  };
}

export function createCityPlanBuildingBinder({
  planBuildingWorkflow = livePlanBuildingWorkflow,
  cancelBuildingPlan = liveCancelBuildingPlan,
} = {}) {
  const requests = new Map();

  return async function bindCityPlanBuildings(args) {
    const fingerprint = JSON.stringify(args);
    const prior = requests.get(args.request_id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new BridgeError('IDEMPOTENCY_CONFLICT', 'request_id was already used with different city-plan building binding arguments.');
      return structuredClone(prior.result);
    }

    const sourcePlanId = computeCityPlanId(args.bounds, args.plan);
    const plan = structuredClone(args.plan);
    const requestedIds = new Set(args.building_ids ?? []);
    const selected = requestedIds.size
      ? (plan.buildings ?? []).filter(building => requestedIds.has(building.id))
      : (plan.buildings ?? []).filter(building => !NON_BUILDABLE_STATUSES.has(building.construction_status));
    const foundIds = new Set(selected.map(building => building.id));
    const missingIds = [...requestedIds].filter(id => !foundIds.has(id));
    if (missingIds.length) throw new BridgeError('PLAN_BUILDING_NOT_FOUND', `The requested plan building IDs were not found: ${missingIds.join(', ')}.`);

    const results = [];
    for (const [index, building] of selected.entries()) {
      if (!building.prefab) {
        building.placement_status = 'conceptual';
        building.rotation_source = building.rotation_degrees == null ? 'unresolved' : (building.rotation_source ?? 'manual');
        results.push({ building_id: building.id, state: 'unresolved', error: 'PLAN_BUILDING_PREFAB_REQUIRED: bind an exact live prefab before resolving position and rotation.' });
        if (!args.continue_on_error) break;
        continue;
      }

      let preview;
      let previewCancelled = false;
      try {
        preview = await planBuildingWorkflow(compact({
          request_id: childRequestId(args.request_id, index),
          building_prefab: building.prefab,
          near: { x: Number(building.position.x), z: Number(building.position.z) },
          category: building.category ?? 'auto',
          search_radius_m: building.search_radius_m ?? args.search_radius_m,
          road_side: building.road_side ?? args.road_side,
          candidate_count: building.candidate_count ?? args.candidate_count,
          max_preview_attempts: building.max_preview_attempts ?? args.max_preview_attempts,
          mode: building.placement_mode ?? 'auto',
          minimum_water_depth_m: building.minimum_water_depth_m ?? 1,
          consider_service_coverage: false,
          reserve_upgrade_prefabs: building.reserve_upgrade_prefabs ?? [],
          impact_radius_m: args.search_radius_m,
          allow_approximate_collisions: false,
          operation_timeout_ms: args.operation_timeout_ms,
        }));
        const candidate = preview.candidate;
        if (!candidate || !Number.isFinite(candidate.rotation_degrees)) {
          throw new BridgeError('PLAN_BUILDING_ROTATION_UNRESOLVED', `Planner returned no authoritative rotation for ${building.id}.`);
        }

        building.position = {
          x: Number(candidate.position.x),
          ...(candidate.position.y === undefined ? {} : { y: Number(candidate.position.y) }),
          z: Number(candidate.position.z),
        };
        building.rotation_degrees = Number(candidate.rotation_degrees);
        building.rotation_source = rotationSource(candidate);
        building.placement_status = 'native_preview_verified';
        building.planning_status = 'bound';
        building.category = preview.category ?? building.category ?? 'auto';
        const prefabSize = preview.prefab?.size_m;
        if (Number.isFinite(Number(prefabSize?.x)) && Number.isFinite(Number(prefabSize?.z))) {
          building.size_m = { x: Number(prefabSize.x), z: Number(prefabSize.z) };
        }
        building.road_side = candidate.road_side ?? building.road_side;
        if (candidate.road_edge_id) building.road_edge_id = candidate.road_edge_id;
        else delete building.road_edge_id;
        if (candidate.snap_target_id) building.snap_target_id = candidate.snap_target_id;
        else delete building.snap_target_id;
        building.placement_binding = {
          session_id: preview.session_id ?? null,
          building_plan_id: preview.plan_id,
          operation_id: preview.operation_id,
          preview_state: preview.state,
          preview_cancelled: false,
          candidate_index: preview.selected_candidate_index ?? 0,
          road_prefab: candidate.road_prefab ?? candidate.network_prefab ?? null,
        };
        building.native_preview = previewAnnotation(preview);

        try {
          const cancellation = await cancelBuildingPlan({ plan_id: preview.plan_id });
          previewCancelled = cancellation?.state === 'cancelled';
        } catch (error) {
          building.placement_binding.cancel_error = error instanceof Error ? error.message : String(error);
        }
        building.placement_binding.preview_cancelled = previewCancelled;
        if (!previewCancelled) {
          throw new BridgeError('PLAN_BUILDING_PREVIEW_CANCEL_FAILED', `The verified temporary preview for ${building.id} could not be cancelled; stop before planning another building.`);
        }
        building.native_preview.state = 'verified_then_cancelled';
        results.push({
          building_id: building.id, state: 'bound', category: building.category,
          position: building.position, rotation_degrees: building.rotation_degrees,
          rotation_source: building.rotation_source, road_edge_id: building.road_edge_id ?? null,
          snap_target_id: building.snap_target_id ?? null, native_preview_verified: true,
          preview_cancelled: previewCancelled,
        });
      } catch (error) {
        if (preview && !previewCancelled) {
          try {
            const cancellation = await cancelBuildingPlan({ plan_id: preview.plan_id });
            previewCancelled = cancellation?.state === 'cancelled';
          } catch {}
        }
        if (building.placement_binding) building.placement_binding.preview_cancelled = previewCancelled;
        building.placement_status = 'failed';
        building.planning_status = 'preview_failed';
        building.rotation_source ??= building.rotation_degrees == null ? 'unresolved' : 'manual';
        const message = error instanceof BridgeError ? `${error.code}: ${error.message}` : (error instanceof Error ? error.message : String(error));
        results.push({ building_id: building.id, state: 'failed', error: message,
          ...(preview ? { preview_created: true, preview_cancelled: previewCancelled } : {}),
          recovery_required: Boolean(preview && !previewCancelled),
        });
        if ((preview && !previewCancelled) || !args.continue_on_error) break;
      }
    }

    const boundCount = results.filter(result => result.state === 'bound').length;
    const failedCount = results.filter(result => result.state === 'failed').length;
    const unresolvedCount = results.filter(result => result.state === 'unresolved').length;
    const result = {
      workflow: 'bind_city_plan_buildings',
      state: failedCount ? (boundCount ? 'partial' : 'failed') : (unresolvedCount ? (boundCount ? 'partial' : 'unresolved') : 'completed'),
      source_plan_id: sourcePlanId,
      plan_id: computeCityPlanId(args.bounds, plan),
      permanent_changes: false,
      native_previews_cancelled_after_verification: results.filter(item => item.native_preview_verified || item.preview_created).every(item => item.preview_cancelled),
      recovery_required: results.some(item => item.recovery_required),
      selected_count: selected.length,
      bound_count: boundCount,
      unresolved_count: unresolvedCount,
      failed_count: failedCount,
      results,
      plan,
      notes: 'Exact candidates were validated through native building previews. Temporary previews were cancelled; construction must create a fresh native preview from the returned plan.',
    };
    requests.set(args.request_id, { fingerprint, result: structuredClone(result) });
    return result;
  };
}

export const bindCityPlanBuildings = createCityPlanBuildingBinder();
