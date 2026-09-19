import test from 'node:test';
import assert from 'node:assert/strict';
import { createCityWorkflows } from '../city-workflows.mjs';

const session = 'b'.repeat(32);
const entity = n => `${session}:${n}:1`;
const response = data => ({ ok: true, meta: { session_id: session }, data });

test('service cluster is idempotent and assigns completed facilities', async () => {
  const calls = [];
  let builds = 0;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'set_service_districts') return response({ service_id: entity(1), district_ids: [entity(2)] });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createCityWorkflows(query, {
    deployBuildingPlans: async args => {
      builds++;
      assert.equal(args.buildings[0].category, 'city_service');
      return { state: 'completed', planned_count: 1, completed_count: 1, total_cost: 100, results: [{ state: 'completed', result_entity_ids: [entity(1)] }] };
    }
  });
  const args = { request_id: 'service-cluster-001', anchor: { x: 0, z: 0 }, services: [{ building_prefab: 'School' }], district_ids: [entity(2)], resume_speed: 'original' };
  const first = await workflow.deployServiceCluster(args);
  const second = await workflow.deployServiceCluster(args);
  assert.equal(first.state, 'completed');
  assert.deepEqual(second, first);
  assert.equal(builds, 1);
  assert.equal(calls.filter(x => x.tool === 'set_service_districts').length, 1);
});

test('industrial campus stops after a failed district phase', async () => {
  const calls = [];
  const query = async (tool, args) => { calls.push({ tool, args }); if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 }); throw new Error(`unexpected ${tool}`); };
  let buildings = 0;
  const workflow = createCityWorkflows(query, {
    deployDistrict: async () => ({ success: false, error: 'blocked' }),
    deployBuildingPlans: async () => { buildings++; return {}; }
  });
  const result = await workflow.deployIndustrialCampus({ request_id: 'industrial-campus-001', anchor: { x: 0, z: 0 }, district: {}, buildings: [], areas: [], resume_speed: 'original' });
  assert.equal(result.state, 'partial');
  assert.equal(result.phases[0].state, 'failed');
  assert.equal(buildings, 0);
});

test('industrial campus selects an owner-compatible area prefab and returns its id', async () => {
  const calls = [];
  let districtArgs;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'list_building_areas') return response({ available_area_prefabs: [{ name: 'Industrial Storage Area' }] });
    if (tool === 'preview_building_area') return response({ operation_id: '3'.repeat(32), state: 'preview_ready', cost: 25 });
    if (tool === 'apply_building_area_operation') return response({ operation_id: '3'.repeat(32), state: 'completed', result_area_id: entity(9), cost: 25 });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createCityWorkflows(query, {
    deployDistrict: async args => { districtArgs = args; return { success: true, total_cost: 10 }; },
    deployBuildingPlans: async () => ({ state: 'completed', total_cost: 50, results: [{ state: 'completed', result_entity_ids: [entity(8)] }] })
  });
  const result = await workflow.deployIndustrialCampus({
    request_id: 'industrial-campus-002', anchor: { x: 0, z: 0 }, district: {},
    buildings: [{ building_prefab: 'Factory', near: { x: 0, z: 0 } }],
    areas: [{ building_index: 0, boundary: [{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 16 }] }], resume_speed: 'original'
  });
  assert.equal(result.state, 'completed');
  assert.equal(districtArgs.approval_mode, 'automatic');
  assert.equal(districtArgs.request_id, 'industrial-campus-002-district');
  assert.equal(result.phases.at(-1).result[0].result_area_id, entity(9));
  assert.equal(calls.find(x => x.tool === 'preview_building_area').args.area_prefab, 'Industrial Storage Area');
});

test('transit corridor does not create lines when track preview fails', async () => {
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'preview_transport_track') return response({ operation_id: '1'.repeat(32), state: 'failed', errors: ['invalid track'] });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createCityWorkflows(query);
  const result = await workflow.deployTransitCorridor({
    request_id: 'transit-corridor-001', tracks: [{ track_prefab: 'Subway Track', points: [{ x: 0, z: 0 }, { x: 32, z: 0 }] }],
    lines: [{ line_prefab: 'Subway Line', stop_ids: [entity(3), entity(4)] }], resume_speed: 'original'
  });
  assert.equal(result.state, 'partial');
  assert.equal(calls.some(x => x.tool === 'preview_transport_line'), false);
});

test('transit corridor preserves outcome_unknown and does not retry with a new request', async () => {
  const requests = [];
  const query = async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'preview_transport_track') { requests.push(args.request_id); return response({ operation_id: '2'.repeat(32), state: 'outcome_unknown' }); }
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createCityWorkflows(query);
  const args = { request_id: 'transit-corridor-002', tracks: [{ track_prefab: 'Subway Track', points: [{ x: 0, z: 0 }, { x: 32, z: 0 }] }], resume_speed: 'original' };
  const result = await workflow.deployTransitCorridor(args);
  assert.equal(result.phases[0].result[0].state, 'outcome_unknown');
  assert.deepEqual(requests, ['transit-corridor-002-track-1']);
});
