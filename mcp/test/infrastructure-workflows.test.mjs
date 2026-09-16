import test from 'node:test';
import assert from 'node:assert/strict';
import { createInfrastructureWorkflows } from '../infrastructure-workflows.mjs';

const session = 'c'.repeat(32);
const entity = n => `${session}:${n}:1`;
const response = data => ({ ok: true, meta: { session_id: session }, data });

test('utility backbone connects facilities and builds segments in order', async () => {
  const calls = []; const connected = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'preview_utility_network') return response({ operation_id: '1'.repeat(32), state: 'preview_ready', cost: 12 });
    if (tool === 'apply_utility_operation') return response({ operation_id: '1'.repeat(32), state: 'completed', cost: 12, result_edge_ids: [entity(8)] });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createInfrastructureWorkflows(query, {
    connectUtilityFacility: async args => { connected.push(args); return { state: 'completed', cost: 5, facility_id: args.facility_id }; }
  });
  const result = await workflow.buildUtilityBackbone({
    request_id: 'utility-backbone-001', connections: [{ facility_id: entity(1), connection: 'high_voltage' }],
    segments: [{ points: [{ x: 0, z: 0 }, { x: 32, z: 0 }] }], utility_prefab: 'Power Line',
    max_cost_per_connection: 100, max_cost_per_segment: 100, resume_speed: 'original'
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.total_cost, 17);
  assert.equal(connected[0].request_id, 'utility-backbone-001-connection-1');
  assert.deepEqual(result.phases.map(item => item.phase), ['connection', 'segment']);
  assert.deepEqual(calls.filter(item => item.tool === 'apply_utility_operation').map(item => item.args.request_id), ['utility-backbone-001-segment-1']);
});

test('utility backbone stops after outcome_unknown without trying later phases', async () => {
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createInfrastructureWorkflows(query, {
    connectUtilityFacility: async () => { const error = new Error('unknown'); error.code = 'OUTCOME_UNKNOWN'; error.operation_id = '2'.repeat(32); throw error; }
  });
  const result = await workflow.buildUtilityBackbone({ request_id: 'utility-backbone-002', connections: [{ facility_id: entity(1) }], segments: [{ utility_prefab: 'Sewage Pipe', points: [{ x: 0, z: 0 }, { x: 32, z: 0 }] }], resume_speed: 'original' });
  assert.equal(result.state, 'partial');
  assert.equal(result.phases[0].state, 'outcome_unknown');
  assert.equal(result.phases.length, 1);
  assert.equal(calls.some(item => item.tool === 'preview_utility_network'), false);
});

test('congested corridor analyzes bottlenecks and applies upgrade idempotently', async () => {
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'analyze_road_traffic') return response({ items: [{ edge_id: entity(3), priority_score: 1000, recommended_action: 'upgrade_or_parallel_relief' }] });
    if (tool === 'preview_road_batch_upgrade') return response({ operation_id: '3'.repeat(32), state: 'preview_ready', cost: 50 });
    if (tool === 'build_road') return response({ operation_id: '3'.repeat(32), state: 'completed', cost: 50, created_road_ids: [entity(9)] });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createInfrastructureWorkflows(query);
  const args = { request_id: 'corridor-repair-001', strategy: 'upgrade', road_prefab: 'Large Road', resume_speed: 'original' };
  const first = await workflow.repairCongestedCorridor(args);
  const second = await workflow.repairCongestedCorridor(args);
  assert.equal(first.state, 'completed');
  assert.deepEqual(second, first);
  assert.equal(calls.filter(item => item.tool === 'analyze_road_traffic').length, 1);
  assert.deepEqual(calls.find(item => item.tool === 'preview_road_batch_upgrade').args.edge_ids, [entity(3)]);
});

test('congested corridor preserves failed preview and does not apply', async () => {
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Test', paused: true, selected_speed: 0 });
    if (tool === 'analyze_road_traffic') return response({ items: [{ edge_id: entity(4), priority_score: 1000, recommended_action: 'upgrade_or_parallel_relief' }] });
    if (tool === 'preview_road_parallel') return response({ operation_id: '4'.repeat(32), state: 'outcome_unknown' });
    throw new Error(`unexpected ${tool}`);
  };
  const workflow = createInfrastructureWorkflows(query);
  const result = await workflow.repairCongestedCorridor({ request_id: 'corridor-repair-002', strategy: 'parallel', road_prefab: 'Large Road', resume_speed: 'original' });
  assert.equal(result.state, 'partial');
  assert.equal(result.phases[0].state, 'outcome_unknown');
  assert.equal(calls.some(item => item.tool === 'build_road'), false);
});
