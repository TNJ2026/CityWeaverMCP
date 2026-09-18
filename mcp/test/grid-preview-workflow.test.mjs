import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridPreviewWorkflow } from '../grid-preview-workflow.mjs';

const operationId = 'a'.repeat(32);
const args = {
  request_id: 'grid-native-preview-001',
  origin: { x: -936, z: -280 },
  columns: 2,
  rows: 3,
  block_width_m: 96,
  block_height_m: 96,
  road_prefab: 'Alley',
  auto_connect: true,
  connection_sides: ['north', 'east', 'south', 'west'],
  connection_search_radius_m: 96,
  minimum_connections: 1,
  maximum_connections: 2,
  zone_type: 'NA Residential Low',
  depth_cells: 6,
  overwrite: true,
  survey_mode: 'full',
  check_conflicts: true,
  clearance_m: 16,
  operation_timeout_ms: 1000,
};

function envelope(data) {
  return { meta: { session_id: 'session-1' }, data };
}

test('creates only a native road preview, preserves zoning intent and restores speed', async () => {
  const calls = [];
  let operationReads = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: false, selected_speed: 2 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Alley', locked: false }] });
    if (tool === 'list_zone_types') return envelope({ items: [{ name: 'NA Residential Low', locked: false }] });
    if (tool === 'get_city_configuration') return envelope({ theme: 'North American' });
    if (tool === 'set_simulation_speed') return envelope({ paused: input.speed === 'paused' });
    if (tool === 'preview_road_grid') return envelope({ state: 'generating_preview', operation_id: operationId });
    if (tool === 'get_road_operation') {
      operationReads++;
      return envelope(operationReads === 1
        ? { state: 'generating_preview', operation_id: operationId }
        : { state: 'preview_ready', operation_id: operationId, cost: 1234, warnings: ['fixture warning'], expires_at_utc: '2026-09-17T01:00:00Z' });
    }
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createGridPreviewWorkflow(queryGame);
  const result = await workflow.prepare(args);
  assert.equal(result.state, 'preview_ready');
  assert.equal(result.road_preview.cost, 1234);
  assert.equal(result.zoning_intent.state, 'blocked_until_roads_built');
  assert.equal(result.construction_ready, false);
  assert.equal(result.permanent_changes, false);
  assert.equal(result.annotated_plan.grids[0].native_preview.state, 'preview_ready');
  assert.equal(result.annotated_plan.grids[0].native_preview.cost, 1234);
  assert.equal(result.annotated_plan.grids[0].zone_type, 'NA Residential Low');
  assert.deepEqual(result.cancel_action, { tool: 'cancel_road_preview', arguments: { operation_id: operationId } });
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.input.speed), ['paused', 'fast']);
  assert.equal(calls.some(call => call.tool === 'build_road'), false);
  assert.equal(calls.some(call => call.tool === 'preview_zoning'), false);
  assert.equal(calls.some(call => call.tool.startsWith('apply_')), false);

  const repeated = await workflow.prepare({ ...args, render: { format: 'interactive_html' } });
  assert.deepEqual(repeated, result);
  assert.equal(calls.filter(call => call.tool === 'preview_road_grid').length, 1, 'idempotent retry must not create another native preview');
});

test('returns a terminal native preview failure without applying anything', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: true, selected_speed: 0 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Alley', locked: false }] });
    if (tool === 'list_zone_types') return envelope({ items: [{ name: 'NA Residential Low', locked: false }] });
    if (tool === 'get_city_configuration') return envelope({ theme: 'North American' });
    if (tool === 'preview_road_grid') return envelope({ state: 'failed', operation_id: operationId, errors: ['collision'] });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const result = await createGridPreviewWorkflow(queryGame).prepare({ ...args, request_id: 'grid-native-preview-002' });
  assert.equal(result.state, 'failed');
  assert.deepEqual(result.road_preview.errors, ['collision']);
  assert.equal(result.cancel_action, null);
  assert.equal(calls.some(call => call.tool === 'build_road' || call.tool === 'preview_zoning'), false);
});

test('rejects a zone style that conflicts with the current city theme before preview', async () => {
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'get_game_status') return envelope({ city_loaded: true, city_name: '辛南', paused: true, selected_speed: 0 });
    if (tool === 'list_road_prefabs') return envelope({ items: [{ name: 'Alley', locked: false }] });
    if (tool === 'list_zone_types') return envelope({ items: [{ name: input.search, locked: false }] });
    if (tool === 'get_city_configuration') return envelope({ theme: 'North American' });
    throw new Error(`Unexpected tool ${tool}`);
  };

  await assert.rejects(
    createGridPreviewWorkflow(queryGame).prepare({ ...args, request_id: 'grid-native-preview-003', zone_type: 'EU Residential Low' }),
    error => error.code === 'ZONE_THEME_MISMATCH'
  );
  assert.equal(calls.some(call => call.tool === 'preview_road_grid'), false);
});
