import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCityPlanRoads, createCityPlanConstructionWorkflow, subdividePlannedRoad } from '../city-plan-construction-workflow.mjs';
import { computeCityPlanId } from '../planning-renderer.mjs';

const operationId = 'a'.repeat(32);
const edgeIds = ['b'.repeat(32) + ':12:3', 'c'.repeat(32) + ':13:3'];
const bounds = { min_x: -1000, min_z: -1000, max_x: 1000, max_z: 1000 };
const plan = {
  grids: [], buildings: [], zones: [], tracks: [], utilities: [],
  roads: [
    { id: 'spine', prefab: 'Medium Road', level: 'surface', width_m: 24, construction_order: 1, points: [{ x: -600, z: 0 }, { x: 0, z: 0 }] },
    { id: 'branch', prefab: 'Small Road', level: 'surface', width_m: 16, construction_order: 2, depends_on: ['spine'], points: [{ x: 0, z: 0 }, { x: 0, z: 160 }] },
  ],
};
const planId = computeCityPlanId(bounds, plan);
const envelope = data => ({ meta: { session_id: 'session-1' }, data });

test('compiles the rendered plan identity, dependencies and native-safe subdivisions', () => {
  const points = subdividePlannedRoad([{ x: 0, z: 0 }, { x: 600, z: 0 }]);
  assert.equal(points.length, 4);
  assert.ok(points.slice(1).every((point, index) => Math.abs(point.x - points[index].x) <= 240));
  const compiled = compileCityPlanRoads(bounds, plan, planId);
  assert.equal(compiled.plan_id, planId);
  assert.deepEqual(compiled.roads.map(item => item.road_id), ['spine', 'branch']);
  assert.equal(compiled.roads[0].native_tool, 'preview_road_route');
  assert.equal(compiled.roads[1].native_tool, 'preview_road');
  assert.equal(compiled.batches.length, 2);
  assert.equal(compiled.virtual_sandbox.state, 'valid');
});

test('keeps exact native-limit routes below 256 metres for live snapping tolerance', () => {
  const points = subdividePlannedRoad([{ x: 0, z: 0 }, { x: 256, z: 0 }]);
  assert.deepEqual(points, [{ x: 0, z: 0 }, { x: 128, z: 0 }, { x: 256, z: 0 }]);
  assert.ok(points.slice(1).every((point, index) => Math.hypot(point.x - points[index].x, point.z - points[index].z) < 256));
});

test('preserves permanent road attachment anchors at planned route endpoints', () => {
  const edgeId = '0123456789abcdef0123456789abcdef:123:1';
  const anchoredPlan = {
    grids: [], buildings: [], zones: [], tracks: [], utilities: [],
    roads: [{
      id: 'anchored-connector', prefab: 'Medium Road', width_m: 24,
      points: [{ x: -600, z: 0, edge_id: edgeId }, { x: -360, z: 0 }],
    }],
  };
  const compiled = compileCityPlanRoads(bounds, anchoredPlan, computeCityPlanId(bounds, anchoredPlan));
  assert.equal(compiled.batches[0].native_args.start.edge_id, edgeId);
});

test('keeps a planned grid as one native atomic batch instead of expanding it into many previews', () => {
  const gridPlan = { roads: [], buildings: [], zones: [], tracks: [], utilities: [], grids: [{ id: 'homes', origin: { x: -800, z: -800 }, columns: 2, rows: 3, block_width_m: 96, block_height_m: 96, road_prefab: 'Small Road' }] };
  const compiled = compileCityPlanRoads(bounds, gridPlan, computeCityPlanId(bounds, gridPlan));
  assert.equal(compiled.roads.length, 7);
  assert.equal(compiled.batches.length, 1);
  assert.equal(compiled.batches[0].native_tool, 'preview_road_grid');
  assert.equal(compiled.batches[0].object_ids.length, 7);
});

test('splits a very long virtual route only at the native 16-point batch limit', () => {
  const longBounds = { min_x: -3000, min_z: -100, max_x: 3000, max_z: 100 };
  const longPlan = { grids: [], buildings: [], zones: [], tracks: [], utilities: [], roads: [{ id: 'long', prefab: 'Medium Road', width_m: 24, points: [{ x: -2000, z: 0 }, { x: 2000, z: 0 }] }] };
  const compiled = compileCityPlanRoads(longBounds, longPlan, computeCityPlanId(longBounds, longPlan));
  assert.equal(compiled.batches.length, 2);
  assert.ok(compiled.batches.every(batch => (batch.native_args.points ?? [batch.native_args.start, batch.native_args.end]).length <= 16));
  assert.deepEqual(compiled.batches[0].geometry_points.at(-1), compiled.batches[1].geometry_points[0]);
});

test('rejects construction when the approved rendered plan hash differs', () => {
  assert.throws(() => compileCityPlanRoads(bounds, plan, 'cplan-0000000000000000'), error => error.code === 'PLAN_APPROVAL_MISMATCH');
});

test('prepares a deterministic manifest without creating a native preview', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: input.search, locked: false }] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).inspect({ bounds, plan, approved_plan_id: planId });
  assert.equal(result.state, 'approved_ready_for_native_preview');
  assert.equal(result.road_count, 2);
  assert.equal(result.native_batch_count, 2);
  assert.equal(result.permanent_changes, false);
  assert.equal(result.next_action.arguments.plan, plan);
  assert.equal(calls.some(call => call.tool.startsWith('preview_')), false);
});

test('native preview derives its exact geometry and prefab from the approved plan', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: false, selected_speed: 2 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Medium Road', locked: false }] });
    if (tool === 'set_simulation_speed') return envelope({ paused: input.speed === 'paused' });
    if (tool === 'preview_road_route') return envelope({ operation_id: operationId, state: 'preview_ready', cost: 500, warnings: [], errors: [] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({
    action: 'preview_road', bounds, plan, approved_plan_id: planId, road_id: 'spine', request_id: 'plan_spine_preview', expected_session_id: 'session-1', operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'preview_ready');
  const preview = calls.find(call => call.tool === 'preview_road_route');
  assert.equal(preview.input.road_prefab, 'Medium Road');
  assert.deepEqual(preview.input.points, compileCityPlanRoads(bounds, plan, planId).roads[0].native_points);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.input.speed), ['paused']);
  assert.equal(result.next_action.arguments.operation_id, operationId);
});

test('rebinds a stale planned edge anchor to the permanent road currently at the approved coordinate', async () => {
  const oldEdgeId = 'd'.repeat(32) + ':20:1';
  const newEdgeId = 'e'.repeat(32) + ':21:1';
  const anchoredPlan = {
    grids: [], buildings: [], zones: [], tracks: [], utilities: [],
    roads: [{ id: 'connector', prefab: 'Small Road', points: [{ x: -600, z: 0, edge_id: oldEdgeId }, { x: -520, z: 0 }] }],
  };
  const anchoredPlanId = computeCityPlanId(bounds, anchoredPlan);
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Small Road', locked: false }] });
    if (tool === 'get_planning_map_snapshot') return envelope({ roads: [{ id: newEdgeId, curve: { a: { x: -640, z: 0 }, b: { x: -620, z: 0 }, c: { x: -580, z: 0 }, d: { x: -560, z: 0 } } }] });
    if (tool === 'preview_road') return envelope({ operation_id: operationId, state: 'preview_ready', cost: 100, warnings: [], errors: [] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({
    action: 'preview_batch', bounds, plan: anchoredPlan, approved_plan_id: anchoredPlanId, batch_id: 'connector', request_id: 'connector_preview', expected_session_id: 'session-1', operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'preview_ready');
  assert.equal(calls.find(call => call.tool === 'preview_road').input.start.edge_id, newEdgeId);
  assert.deepEqual(result.anchor_rebindings, [{ x: -600, z: 0, previous_edge_id: oldEdgeId, previous_node_id: null, current_edge_id: newEdgeId, distance_m: 0 }]);
});

test('resolves a planned node anchor to the permanent road currently at the approved coordinate', async () => {
  const oldNodeId = 'f'.repeat(32) + ':30:1';
  const newEdgeId = '1'.repeat(32) + ':31:1';
  const anchoredPlan = {
    grids: [], buildings: [], zones: [], tracks: [], utilities: [],
    roads: [{ id: 'node-connector', prefab: 'Small Road', points: [{ x: -600, z: 0, node_id: oldNodeId }, { x: -520, z: 0 }] }],
  };
  const anchoredPlanId = computeCityPlanId(bounds, anchoredPlan);
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Small Road', locked: false }] });
    if (tool === 'get_planning_map_snapshot') return envelope({ roads: [{ id: newEdgeId, curve: { a: { x: -640, z: 0 }, b: { x: -620, z: 0 }, c: { x: -580, z: 0 }, d: { x: -560, z: 0 } } }] });
    if (tool === 'preview_road') return envelope({ operation_id: operationId, state: 'preview_ready', cost: 100, warnings: [], errors: [] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({
    action: 'preview_batch', bounds, plan: anchoredPlan, approved_plan_id: anchoredPlanId, batch_id: 'node-connector', request_id: 'node_connector_preview', expected_session_id: 'session-1', operation_timeout_ms: 1000,
  });
  const input = calls.find(call => call.tool === 'preview_road').input.start;
  assert.equal(input.node_id, undefined);
  assert.equal(input.edge_id, newEdgeId);
  assert.equal(result.anchor_rebindings[0].previous_node_id, oldNodeId);
});

test('commit waits for completion and verifies every permanent road id by readback', async () => {
  const calls = []; let reads = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'get_road_operation') {
      reads++;
      return envelope(reads === 1
        ? { operation_id: operationId, state: 'preview_ready', cost: 500 }
        : { operation_id: operationId, state: 'completed', cost: 500, created_road_ids: edgeIds });
    }
    if (tool === 'build_road') return envelope({ operation_id: operationId, state: 'commit_queued' });
    if (tool === 'get_planning_map_snapshot') return envelope({ roads: edgeIds.map(id => ({ id })), truncated: false });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({
    action: 'commit_road', bounds, plan, approved_plan_id: planId, road_id: 'spine', request_id: 'plan_spine_commit', expected_session_id: 'session-1', operation_id: operationId, max_cost: 500, operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'completed_verified');
  assert.equal(result.success, true);
  assert.deepEqual(result.permanent_readback.verified_road_ids, edgeIds);
  assert.equal(result.next_action.arguments.batch_id, 'branch');
  assert.equal(calls.filter(call => call.tool === 'build_road').length, 1);
});

test('outcome_unknown stops construction and keeps the city paused', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: false, selected_speed: 1 });
    if (tool === 'set_simulation_speed') return envelope({ paused: true });
    if (tool === 'get_road_operation') return envelope({ operation_id: operationId, state: 'outcome_unknown', cost: 500 });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({
    action: 'commit_road', bounds, plan, approved_plan_id: planId, road_id: 'spine', request_id: 'plan_spine_commit', expected_session_id: 'session-1', operation_id: operationId, max_cost: 500, operation_timeout_ms: 1000,
  });
  assert.equal(result.success, false);
  assert.equal(result.recovery_required, true);
  assert.equal(result.simulation.kept_paused_for_recovery, true);
  assert.equal(calls.some(call => call.tool === 'build_road'), false);
});

test('compiles roads, ploppable buildings and utility networks into one dependency order', () => {
  const mixedPlan = {
    grids: [], zones: [], tracks: [],
    roads: [{ id: 'access', prefab: 'Small Road', construction_order: 10, points: [{ x: 0, z: 0 }, { x: 80, z: 0 }] }],
    buildings: [{ id: 'school', prefab: 'ElementarySchool02', category: 'city_service', kind: 'service', position: { x: 32, z: 32 }, rotation_degrees: 90, size_m: { x: 64, z: 48 }, construction_order: 20, depends_on: ['access'] }],
    utilities: [{ id: 'water-main', prefab: 'Small Water Pipe', network_type: 'water', level: 'underground', points: [{ x: 0, z: 16 }, { x: 80, z: 16 }], construction_order: 30, depends_on: ['school'] }],
  };
  const compiled = compileCityPlanRoads(bounds, mixedPlan, computeCityPlanId(bounds, mixedPlan));
  assert.deepEqual(compiled.batches.map(batch => [batch.batch_id, batch.batch_type]), [['access', 'route'], ['school', 'building'], ['water-main', 'utility']]);
  assert.equal(compiled.virtual_sandbox.metrics.native_batch_count, 1);
});

test('building preview uses the approved exact position and specialized native domain', async () => {
  const buildingPlan = {
    grids: [], roads: [], zones: [], tracks: [], utilities: [],
    buildings: [{ id: 'clinic', prefab: 'MedicalClinic01', category: 'city_service', kind: 'service', position: { x: 128, z: 64 }, rotation_degrees: 90, size_m: { x: 48, z: 40 } }],
  };
  const id = computeCityPlanId(bounds, buildingPlan); const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'list_city_service_prefabs') return envelope({ items: [{ name: 'MedicalClinic01', locked: false }] });
    if (tool === 'preview_city_service_placement') return envelope({ operation_id: operationId, state: 'preview_ready', cost: 2500, warnings: [], errors: [] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({ action: 'preview_batch', bounds, plan: buildingPlan, approved_plan_id: id, batch_id: 'clinic', request_id: 'clinic-preview', expected_session_id: 'session-1', operation_timeout_ms: 1000 });
  assert.equal(result.state, 'preview_ready');
  const preview = calls.find(call => call.tool === 'preview_city_service_placement');
  assert.deepEqual(preview.input.position, { x: 128, z: 64 });
  assert.equal(preview.input.rotation_degrees, 90);
  assert.equal(result.cancel_action.tool, 'cancel_city_service_preview');
});

test('building commit verifies permanent id, position and rotation from a fresh planning snapshot', async () => {
  const buildingId = '7'.repeat(32) + ':70:1';
  const buildingPlan = {
    grids: [], roads: [], zones: [], tracks: [], utilities: [],
    buildings: [{ id: 'fire-house', prefab: 'FireHouse02', category: 'city_service', kind: 'service', position: { x: 256, z: 128 }, rotation_degrees: 90, size_m: { x: 40, z: 48 } }],
  };
  const id = computeCityPlanId(bounds, buildingPlan);
  const queryGame = async (tool) => {
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'get_city_service_operation') return envelope({ operation_id: operationId, state: 'preview_ready', cost: 1000 });
    if (tool === 'apply_city_service_operation') return envelope({ operation_id: operationId, state: 'completed', cost: 1000, result_entity_ids: [buildingId] });
    if (tool === 'get_planning_map_snapshot') return envelope({ buildings: [{ id: buildingId, position: { x: 256, z: 128 }, rotation_degrees: 90 }], truncated: false });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createCityPlanConstructionWorkflow(queryGame).advance({ action: 'commit_batch', bounds, plan: buildingPlan, approved_plan_id: id, batch_id: 'fire-house', request_id: 'fire-house-commit', expected_session_id: 'session-1', operation_id: operationId, max_cost: 1000, operation_timeout_ms: 1000 });
  assert.equal(result.state, 'completed_verified');
  assert.deepEqual(result.permanent_readback.verified_ids, [buildingId]);
  assert.deepEqual(result.permanent_readback.geometry_mismatches, []);
});

test('underground utility preview derives elevation and commit verifies permanent edges', async () => {
  const utilityPlan = {
    grids: [], roads: [], buildings: [], zones: [], tracks: [],
    utilities: [{ id: 'sewer', prefab: 'Small Sewage Pipe', network_type: 'sewage', level: 'underground', points: [{ x: 0, z: 0 }, { x: 160, z: 0 }] }],
  };
  const id = computeCityPlanId(bounds, utilityPlan); const utilityOperationId = '9'.repeat(32); const utilityEdgeId = '8'.repeat(32) + ':44:1';
  const previewCalls = [];
  const previewQuery = async (tool, input) => {
    previewCalls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'list_utility_network_prefabs') return envelope({ items: [{ name: 'Small Sewage Pipe', network_type: 'sewage', elevation_range_m: { min: -50, max: -10 } }] });
    if (tool === 'preview_utility_network') return envelope({ operation_id: utilityOperationId, state: 'preview_ready', cost: 300, warnings: [], errors: [] });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const previewResult = await createCityPlanConstructionWorkflow(previewQuery).advance({ action: 'preview_batch', bounds, plan: utilityPlan, approved_plan_id: id, batch_id: 'sewer', request_id: 'sewer-preview', expected_session_id: 'session-1', operation_timeout_ms: 1000 });
  assert.equal(previewResult.state, 'preview_ready');
  assert.deepEqual(previewCalls.find(call => call.tool === 'preview_utility_network').input.points.map(point => point.elevation_m), [-10, -10]);

  const commitQuery = async (tool, input) => {
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '韦福德', paused: true, selected_speed: 0 });
    if (tool === 'get_utility_operation') return envelope({ operation_id: utilityOperationId, state: 'preview_ready', cost: 300 });
    if (tool === 'apply_utility_operation') return envelope({ operation_id: utilityOperationId, state: 'completed', cost: 300, created_utility_edge_ids: [utilityEdgeId] });
    if (tool === 'get_utility_network') return envelope({ utility_edge_id: input.utility_edge_id, prefab: 'Small Sewage Pipe' });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const committed = await createCityPlanConstructionWorkflow(commitQuery).advance({ action: 'commit_batch', bounds, plan: utilityPlan, approved_plan_id: id, batch_id: 'sewer', request_id: 'sewer-commit', expected_session_id: 'session-1', operation_id: utilityOperationId, max_cost: 300, operation_timeout_ms: 1000 });
  assert.equal(committed.state, 'completed_verified');
  assert.deepEqual(committed.permanent_readback.verified_ids, [utilityEdgeId]);
});
