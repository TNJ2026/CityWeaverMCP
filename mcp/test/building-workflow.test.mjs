import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingWorkflow } from '../building-workflow.mjs';

const sessionId = 'a'.repeat(32);
const edgeId = `${sessionId}:10:1`;

function response(data) { return { ok: true, meta: { session_id: sessionId }, data }; }

function planningArgs(overrides = {}) {
  return {
    request_id: 'workflow-test-001', building_prefab: 'FixtureBuilding', near: { x: 100, z: 200 }, category: 'auto',
    search_radius_m: 500, road_side: 'either', candidate_count: 8, max_preview_attempts: 8,
    operation_timeout_ms: 2000, mode: 'auto', minimum_water_depth_m: 1,
    consider_service_coverage: true, impact_radius_m: 500, allow_approximate_collisions: false,
    reserve_upgrade_prefabs: [],
    ...overrides
  };
}

test('building workflow falls back after native rejection and commits only during execute', async () => {
  const calls = [];
  let paused = false;
  let applied = false;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 4 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 4 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'FixtureBuilding', placement_flags: 'RoadSide, OnGround', construction_cost: 12000 }] });
    if (tool.startsWith('list_') && tool.endsWith('_facility_prefabs') || tool === 'list_city_service_prefabs') return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [
      { position: { x: 110, y: 5, z: 210 }, rotation_degrees: 0, road_edge_id: edgeId, approximate_collision: false },
      { position: { x: 120, y: 5, z: 220 }, rotation_degrees: 90, road_edge_id: edgeId, approximate_collision: false }
    ] });
    if (tool === 'preview_building_placement') return response({ operation_id: args.position.x === 110 ? '1'.repeat(32) : '2'.repeat(32), state: 'queued' });
    if (tool === 'get_building_operation' && args.operation_id === '1'.repeat(32)) return response({ operation_id: args.operation_id, state: 'failed', errors: ['Fixture collision'] });
    if (tool === 'get_building_operation' && !applied) return response({ operation_id: args.operation_id, state: 'preview_ready', cost: 12000, warnings: [], expires_at_utc: '2099-01-01T00:00:00Z' });
    if (tool === 'apply_building_operation') { applied = true; return response({ operation_id: args.operation_id, state: 'commit_queued' }); }
    if (tool === 'get_building_operation' && applied) return response({ operation_id: args.operation_id, state: 'completed', cost: 12000, result_entity_ids: [`${sessionId}:20:1`] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs());
  assert.equal(plan.state, 'preview_ready');
  assert.equal(plan.selected_candidate_index, 1);
  assert.equal(plan.attempts[0].state, 'failed');
  assert.equal(calls.some(call => call.tool === 'apply_building_operation'), false, 'planning must not commit');
  const previewCalls = calls.filter(call => call.tool === 'preview_building_placement');
  assert.deepEqual(previewCalls[0].args.position, { x: 110, z: 210 }, 'ordinary preview strips planner-only y');
  assert.deepEqual(calls.find(call => call.tool === 'plan_building_site').args.reserve_upgrade_prefabs, []);
  assert.equal(paused, false, 'planning restores the original speed');

  const done = await workflow.executePlan({ request_id: 'workflow-build-001', plan_id: plan.plan_id, max_cost: 12000, resume_speed: 'original' });
  assert.equal(done.state, 'completed');
  assert.equal(done.result_entity_ids.length, 1);
  assert.equal(done.readback.active, true);
  assert.equal(paused, false, 'execution restores the original speed');
  assert.equal(calls.filter(call => call.tool === 'apply_building_operation').length, 1);

  const retried = await workflow.executePlan({ request_id: 'workflow-build-001', plan_id: plan.plan_id, max_cost: 12000, resume_speed: 'original' });
  assert.equal(retried.state, 'completed');
  assert.equal(calls.filter(call => call.tool === 'apply_building_operation').length, 1, 'identical execution retry is idempotent');
});

test('auto discovery prefers city-service workflow and supports cancellation', async () => {
  const calls = [];
  let paused = false;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 2 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 2 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'FixturePark', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'FixturePark', kind: 'park', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'list_transport_facility_prefabs' || tool === 'list_utility_facility_prefabs') return response({ items: [] });
    if (tool === 'plan_city_service_site') return response({ coverage_model: 'euclidean_radius_proxy', candidates: [{ position: { x: 50, y: 5, z: 60 }, road_edge_id: edgeId, rotation_degrees: -90, approximate_collision: false }] });
    if (tool === 'preview_city_service_placement') return response({ operation_id: '3'.repeat(32), state: 'preview_ready', cost: 5000, warnings: [], expires_at_utc: '2099-01-01T00:00:00Z' });
    if (tool === 'analyze_attraction_impact') return response({ nearby_buildings: 25, nearby_parks: 0 });
    if (tool === 'cancel_city_service_preview') return response({ operation_id: args.operation_id, state: 'cancelled' });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-park-001', building_prefab: 'FixturePark' }));
  assert.equal(plan.category, 'city_service');
  assert.equal(plan.impact.nearby_buildings, 25);
  assert.equal(paused, false);
  const cancelled = await workflow.cancelPlan({ plan_id: plan.plan_id });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(calls.filter(call => call.tool === 'cancel_city_service_preview').length, 1);
});

test('building workflow skips optional service impact analysis when disabled', async () => {
  const query = async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused: true, selected_speed: 0 });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'FixtureSchool', kind: 'education', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'plan_city_service_site') return response({ candidates: [{ position: { x: 50, y: 5, z: 60 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_city_service_placement') return response({ operation_id: '7'.repeat(32), state: 'preview_ready', cost: 5000 });
    if (tool.startsWith('analyze_')) throw new Error('impact analysis should be disabled');
    throw new Error(`Unexpected tool ${tool}`);
  };
  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-no-impact-001', building_prefab: 'FixtureSchool', category: 'city_service', consider_service_coverage: false }));
  assert.equal(plan.state, 'preview_ready');
  assert.equal(plan.impact, null);
});

test('execution recovers an already completed native operation and reads it back', async () => {
  const entityId = `${sessionId}:30:1`;
  let paused = false;
  let operationState = 'preview_ready';
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 1 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 1 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'RecoveredBuilding', placement_flags: 'RoadSide, OnGround', placement: { unique: true } }] });
    if (tool.startsWith('list_')) return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [{ position: { x: 20, y: 5, z: 30 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_building_placement') return response({ operation_id: '4'.repeat(32), state: 'preview_ready', cost: 7000 });
    if (tool === 'analyze_attraction_impact') return response({ nearby_buildings: 12, nearby_transport_stops: 1 });
    if (tool === 'get_building_operation') return response({ operation_id: args.operation_id, state: operationState, cost: 7000, result_entity_ids: operationState === 'completed' ? [entityId] : [] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-recovery-plan', building_prefab: 'RecoveredBuilding' }));
  assert.equal(plan.impact.nearby_buildings, 12);
  operationState = 'completed';
  const recovered = await workflow.executePlan({ request_id: 'workflow-recovery-run', plan_id: plan.plan_id, max_cost: 7000, resume_speed: 'original' });
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.readback.building_id, entityId);
  assert.equal(calls.some(call => call.tool === 'apply_building_operation'), false);
  assert.equal(paused, false);
});

test('batch deployment pauses once and restores speed once', async () => {
  const calls = [];
  let paused = false;
  let operationNumber = 0;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 4 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 4 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'BatchBuilding', placement_flags: 'RoadSide, OnGround' }] });
    if (tool.startsWith('list_')) return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [{ position: { x: 100 + operationNumber, y: 5, z: 200 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_building_placement') {
      operationNumber++;
      return response({ operation_id: String(operationNumber).padStart(32, '0'), state: 'preview_ready', cost: 1000 });
    }
    if (tool === 'get_building_operation') return response({ operation_id: args.operation_id, state: 'preview_ready', cost: 1000 });
    if (tool === 'apply_building_operation') return response({ operation_id: args.operation_id, state: 'completed', cost: 1000, result_entity_ids: [`${sessionId}:${40 + operationNumber}:1`] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const result = await workflow.deployPlans({
    request_id: 'workflow-batch-001', buildings: [
      planningArgs({ building_prefab: 'BatchBuilding', near: { x: 100, z: 200 } }),
      planningArgs({ building_prefab: 'BatchBuilding', near: { x: 200, z: 200 } })
    ], operation_timeout_ms: 2000, max_cost_per_building: 1000, max_total_cost: 2000, continue_on_error: false
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.completed_count, 2);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.args.speed), ['paused', 'fastest']);
  assert.equal(paused, false);
});
