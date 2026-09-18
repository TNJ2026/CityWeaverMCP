import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridConstructionWorkflow } from '../grid-construction-workflow.mjs';

const roadOperationId = 'a'.repeat(32);
const zoningOperationId = 'b'.repeat(32);
const edgeIds = ['c'.repeat(32) + ':10:1', 'd'.repeat(32) + ':11:1'];
const envelope = data => ({ meta: { session_id: 'session-1' }, data });

test('commits a prepared road preview, waits for permanent edges and returns the zoning stage', async () => {
  const calls = [];
  let roadReads = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: false, selected_speed: 2 });
    if (tool === 'set_simulation_speed') return envelope({ paused: input.speed === 'paused' });
    if (tool === 'get_road_operation') {
      roadReads++;
      return envelope(roadReads === 1
        ? { operation_id: roadOperationId, state: 'preview_ready', cost: 120 }
        : { operation_id: roadOperationId, state: 'completed', cost: 120, created_road_ids: edgeIds });
    }
    if (tool === 'build_road') return envelope({ operation_id: roadOperationId, state: 'commit_queued' });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createGridConstructionWorkflow(queryGame).advance({
    stage: 'commit_roads', request_id: 'grid-roads-commit-001', expected_session_id: 'session-1',
    operation_id: roadOperationId, max_cost: 150, zone_type: 'NA Residential Low',
    road_side: 'both', depth_cells: 6, overwrite: true, include_occupied: false, operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.success, true);
  assert.equal(result.permanent_changes, true);
  assert.deepEqual(result.created_road_ids, edgeIds);
  assert.equal(result.next_action.arguments.stage, 'preview_zoning');
  assert.deepEqual(result.next_action.arguments.edge_ids, edgeIds);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.input.speed), ['paused', 'fast']);
  assert.equal(calls.filter(call => call.tool === 'build_road').length, 1);
});

test('validates permanent road zoning and creates a separate zoning preview without applying it', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: true, selected_speed: 0 });
    if (tool === 'list_zone_types') return envelope({ items: [{ name: 'NA Residential Low', locked: false }] });
    if (tool === 'get_city_configuration') return envelope({ theme: 'North American' });
    if (tool === 'inspect_road_zoning') return envelope({ roads: input.edge_ids.map(edge_id => ({ edge_id, orderly_geometry: true })) });
    if (tool === 'preview_zoning') return envelope({ operation_id: zoningOperationId, state: 'preview_ready', changed_cell_count: 48 });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createGridConstructionWorkflow(queryGame).advance({
    stage: 'preview_zoning', request_id: 'grid-zone-preview-001', expected_session_id: 'session-1',
    edge_ids: edgeIds, zone_type: 'NA Residential Low', road_side: 'both', depth_cells: 6,
    overwrite: true, include_occupied: false, operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'preview_ready');
  assert.equal(result.success, true);
  assert.equal(result.permanent_changes, false);
  assert.equal(result.phases[0].changed_cell_count, 48);
  assert.equal(result.next_action.arguments.stage, 'apply_zoning');
  assert.deepEqual(result.cancel_action, { tool: 'cancel_zoning_preview', arguments: { operation_id: zoningOperationId } });
  assert.equal(calls.some(call => call.tool === 'apply_zoning'), false);
});

test('applies a preview-ready zoning operation and recovers completed retries', async () => {
  const calls = [];
  let completed = false;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: true, selected_speed: 0 });
    if (tool === 'get_zoning_operation') return envelope(completed
      ? { operation_id: zoningOperationId, state: 'completed', changed_cell_count: 48 }
      : { operation_id: zoningOperationId, state: 'preview_ready', changed_cell_count: 48 });
    if (tool === 'apply_zoning') { completed = true; return envelope({ operation_id: zoningOperationId, state: 'applying' }); }
    throw new Error(`Unexpected tool ${tool}`);
  };
  const workflow = createGridConstructionWorkflow(queryGame);
  const args = { stage: 'apply_zoning', request_id: 'grid-zone-apply-001', expected_session_id: 'session-1', operation_id: zoningOperationId, operation_timeout_ms: 1000 };
  const result = await workflow.advance(args);
  assert.equal(result.state, 'completed');
  assert.equal(result.permanent_changes, true);
  assert.equal(result.changed_cell_count, 48);
  const repeated = await workflow.advance(args);
  assert.equal(repeated.recovered_existing_result, true);
  assert.equal(calls.filter(call => call.tool === 'apply_zoning').length, 1);
});

test('stops on outcome_unknown and leaves the city paused for recovery', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: false, selected_speed: 1 });
    if (tool === 'set_simulation_speed') return envelope({ paused: input.speed === 'paused' });
    if (tool === 'get_road_operation') return envelope({ operation_id: roadOperationId, state: 'outcome_unknown', cost: 120 });
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createGridConstructionWorkflow(queryGame).advance({
    stage: 'commit_roads', request_id: 'grid-road-unknown-001', operation_id: roadOperationId,
    max_cost: 150, operation_timeout_ms: 1000,
  });
  assert.equal(result.success, false);
  assert.equal(result.recovery_required, true);
  assert.equal(result.simulation.kept_paused_for_recovery, true);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.input.speed), ['paused']);
  assert.equal(calls.some(call => call.tool === 'build_road' || call.tool === 'preview_zoning'), false);
});

test('resumes an in-progress road commit without submitting it again', async () => {
  const calls = [];
  let reads = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: true, selected_speed: 0 });
    if (tool === 'get_road_operation') {
      reads++;
      return envelope(reads === 1
        ? { operation_id: roadOperationId, state: 'applying', cost: 120 }
        : { operation_id: roadOperationId, state: 'completed', cost: 120, created_road_ids: edgeIds });
    }
    throw new Error(`Unexpected tool ${tool}`);
  };
  const result = await createGridConstructionWorkflow(queryGame).advance({
    stage: 'commit_roads', request_id: 'grid-road-resume-001', operation_id: roadOperationId,
    max_cost: 150, operation_timeout_ms: 1000,
  });
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.created_road_ids, edgeIds);
  assert.equal(calls.some(call => call.tool === 'build_road'), false);
});
