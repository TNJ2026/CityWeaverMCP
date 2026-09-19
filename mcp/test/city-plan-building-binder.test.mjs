import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityPlanBuildingBinder } from '../city-plan-building-binder.mjs';

const bounds = { min_x: -512, min_z: -512, max_x: 512, max_z: 512 };
const roadEdgeId = `${'a'.repeat(32)}:10:1`;
const baseArgs = {
  request_id: 'bind-city-buildings-001', bounds, building_ids: [], search_radius_m: 256,
  road_side: 'either', candidate_count: 8, max_preview_attempts: 8, operation_timeout_ms: 20000, continue_on_error: true,
};

test('binds exact position, rotation and road edge then cancels the temporary native preview', async () => {
  let plans = 0, cancellations = 0;
  const bind = createCityPlanBuildingBinder({
    planBuildingWorkflow: async args => {
      plans++;
      assert.equal(args.building_prefab, 'Fixture School');
      assert.deepEqual(args.near, { x: 100, z: 100 });
      return {
        plan_id: `bplan-${'1'.repeat(16)}`, operation_id: '2'.repeat(32), state: 'preview_ready', session_id: 'session-1',
        category: 'city_service', selected_candidate_index: 1, cost: 5000, warnings: [], errors: [],
        candidate: { position: { x: 112, y: 5, z: 96 }, rotation_degrees: 90, road_edge_id: roadEdgeId, road_side: 'left', road_prefab: 'Small Road' },
      };
    },
    cancelBuildingPlan: async ({ plan_id }) => { cancellations++; return { plan_id, state: 'cancelled' }; },
  });
  const plan = {
    grids: [], roads: [], zones: [], tracks: [], utilities: [],
    buildings: [{ id: 'school', prefab: 'Fixture School', category: 'city_service', kind: 'service', planning_status: 'conceptual', placement_status: 'conceptual', position: { x: 100, z: 100 }, rotation_degrees: null, rotation_source: 'unresolved', size_m: { x: 48, z: 40 } }],
  };
  const first = await bind({ ...baseArgs, plan });
  const second = await bind({ ...baseArgs, plan });
  const building = first.plan.buildings[0];
  assert.equal(first.state, 'completed');
  assert.equal(building.rotation_degrees, 90);
  assert.equal(building.rotation_source, 'road_tangent');
  assert.equal(building.road_edge_id, roadEdgeId);
  assert.equal(building.placement_status, 'native_preview_verified');
  assert.equal(building.placement_binding.preview_cancelled, true);
  assert.equal(building.native_preview.state, 'verified_then_cancelled');
  assert.equal(plans, 1);
  assert.equal(cancellations, 1);
  assert.deepEqual(second, first);
});

test('keeps prefab-free reservations conceptual instead of inventing an angle', async () => {
  const bind = createCityPlanBuildingBinder({
    planBuildingWorkflow: async () => assert.fail('conceptual reservation must not invoke live planning'),
    cancelBuildingPlan: async () => assert.fail('no preview exists to cancel'),
  });
  const plan = {
    grids: [], roads: [], zones: [], tracks: [], utilities: [],
    buildings: [{ id: 'clinic-reservation', kind: 'service', planning_status: 'conceptual', placement_status: 'conceptual', position: { x: 0, z: 0 }, rotation_degrees: null, rotation_source: 'unresolved', size_m: { x: 32, z: 24 } }],
  };
  const result = await bind({ ...baseArgs, request_id: 'bind-city-buildings-002', plan });
  assert.equal(result.state, 'unresolved');
  assert.equal(result.unresolved_count, 1);
  assert.equal(result.plan.buildings[0].rotation_degrees, null);
  assert.equal(result.plan.buildings[0].rotation_source, 'unresolved');
});

test('stops when a verified temporary preview cannot be cancelled', async () => {
  let previews = 0;
  const bind = createCityPlanBuildingBinder({
    planBuildingWorkflow: async () => (previews++, {
      plan_id: `bplan-${'3'.repeat(16)}`, operation_id: '4'.repeat(32), state: 'preview_ready', session_id: 'session-1',
      category: 'city_service', selected_candidate_index: 0, cost: 5000, warnings: [], errors: [],
      candidate: { position: { x: 112, y: 5, z: 96 }, rotation_degrees: 90, road_edge_id: roadEdgeId },
    }),
    cancelBuildingPlan: async () => ({ state: 'preview_ready' }),
  });
  const plan = {
    grids: [], roads: [], zones: [], tracks: [], utilities: [],
    buildings: ['school', 'second-school'].map(id => ({ id, prefab: 'Fixture School', kind: 'service', position: { x: 100, z: 100 }, rotation_degrees: null, size_m: { x: 48, z: 40 } })),
  };
  const result = await bind({ ...baseArgs, request_id: 'bind-city-buildings-003', plan });
  assert.equal(result.state, 'failed');
  assert.equal(result.failed_count, 1);
  assert.equal(result.plan.buildings[0].placement_status, 'failed');
  assert.match(result.results[0].error, /PREVIEW_CANCEL_FAILED/);
  assert.equal(previews, 1);
  assert.equal(result.native_previews_cancelled_after_verification, false);
  assert.equal(result.recovery_required, true);
});

test('rejects null candidate rotation and reports failed cleanup honestly', async () => {
  let previews = 0;
  const bind = createCityPlanBuildingBinder({
    planBuildingWorkflow: async () => ({ plan_id: `plan-${++previews}`, state: 'preview_ready',
      candidate: { position: { x: 0, z: 0 }, rotation_degrees: null } }),
    cancelBuildingPlan: async () => { throw new Error('bridge unavailable'); },
  });
  const result = await bind({ ...baseArgs, plan: { buildings: ['a', 'b'].map(id => ({ id, prefab: 'School', position: { x: 0, z: 0 } })) } });
  assert.equal(previews, 1);
  assert.match(result.results[0].error, /ROTATION_UNRESOLVED/);
  assert.equal(result.native_previews_cancelled_after_verification, false);
  assert.equal(result.recovery_required, true);
});

test('records successful compensating cancellation before continuing', async () => {
  let previews = 0, cancellations = 0;
  const bind = createCityPlanBuildingBinder({
    planBuildingWorkflow: async () => ({ plan_id: `plan-${++previews}`, state: 'preview_ready',
      candidate: { position: { x: 0, z: 0 }, rotation_degrees: 0 } }),
    cancelBuildingPlan: async () => {
      if (++cancellations === 1) throw new Error('temporary connection failure');
      return { state: 'cancelled' };
    },
  });
  const result = await bind({ ...baseArgs, plan: { buildings: ['a', 'b'].map(id => ({ id, prefab: 'School', position: { x: 0, z: 0 } })) } });
  assert.equal(previews, 2);
  assert.equal(result.failed_count, 1);
  assert.equal(result.bound_count, 1);
  assert.equal(result.plan.buildings[0].placement_binding.preview_cancelled, true);
  assert.equal(result.native_previews_cancelled_after_verification, true);
  assert.equal(result.recovery_required, false);
});
