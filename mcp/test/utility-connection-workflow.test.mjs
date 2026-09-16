import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeError } from '../bridge-client.mjs';
import { createUtilityConnectionWorkflow } from '../utility-connection-workflow.mjs';

const facilityId = 'a'.repeat(32) + ':10:1';
const port = { node_id: 'b'.repeat(32) + ':20:1', connection: 'high_voltage', position: { x: 0, z: 0 } };
const target = { target_node_id: 'c'.repeat(32) + ':30:1', target_position: { x: 64, z: 0 }, utility_prefab: 'Overhead Power Line', distance_m: 64 };
const args = { request_id: 'utility-connect-001', facility_id: facilityId, connection: 'auto', search_radius_m: 500, routing: 'direct', max_preview_attempts: 2, operation_timeout_ms: 1000, max_cost: 1000000 };

function baseResponses() {
  return {
    get_game_status: { connected: true, city_loaded: true, paused: false, selected_speed: 2 },
    list_utility_facilities: { items: [{ facility_id: facilityId, kind: 'transformer', position: { x: 0, z: 0 } }] },
    list_utility_connection_points: { items: [port] },
    find_compatible_utility_targets: { items: [target, { ...target, target_node_id: 'c'.repeat(32) + ':31:1', target_position: { x: 96, z: 0 }, distance_m: 96 }] },
    list_utility_network_prefabs: { items: [{ name: 'Overhead Power Line', network_type: 'electricity', connection_layers: 'PowerlineHigh' }] }
  };
}

test('discovers native port, retries rejected preview, commits and restores speed', async () => {
  const calls = [];
  const responses = baseResponses();
  let previews = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'set_simulation_speed') return { data: { paused: input.speed === 'paused' } };
    if (tool === 'preview_utility_network') {
      previews++;
      if (previews === 1) throw new BridgeError('NATIVE_REJECTED', 'collision');
      return { data: { state: 'preview_ready', operation_id: 'd'.repeat(32), cost: 120 } };
    }
    if (tool === 'apply_utility_operation') return { data: { state: 'applying', operation_id: input.operation_id } };
    if (tool === 'get_utility_operation') return { data: { state: 'completed', operation_id: input.operation_id, cost: 120, result_edge_ids: ['e'.repeat(32) + ':40:1'] } };
    return { data: responses[tool] };
  };
  const workflow = createUtilityConnectionWorkflow(queryGame);
  const result = await workflow.connect(args);
  assert.equal(result.state, 'completed');
  assert.equal(result.connection, 'high_voltage');
  assert.equal(result.port.node_id, port.node_id);
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.input.speed), ['paused', 'fast']);
  assert.equal(calls.filter(call => call.tool === 'preview_utility_network').length, 2);
  assert.equal(calls.filter(call => call.tool === 'list_utility_network_prefabs').length, 0, 'native targets provide the exact prefab without a full enumeration');
  const again = await workflow.connect(args);
  assert.deepEqual(again, result);
  assert.equal(calls.filter(call => call.tool === 'preview_utility_network').length, 2, 'idempotent retry does not resubmit native preview');
});

test('does not continue after an unknown native outcome', async () => {
  const responses = baseResponses();
  const calls = [];
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'set_simulation_speed') return { data: {} };
    if (tool === 'preview_utility_network') return { data: { state: 'preview_ready', operation_id: 'f'.repeat(32) } };
    if (tool === 'apply_utility_operation') return { data: { state: 'applying', operation_id: input.operation_id } };
    if (tool === 'get_utility_operation') return { data: { state: 'outcome_unknown', operation_id: input.operation_id } };
    return { data: responses[tool] };
  };
  const workflow = createUtilityConnectionWorkflow(queryGame);
  await assert.rejects(workflow.connect({ ...args, request_id: 'utility-unknown-001' }), error => error.code === 'OUTCOME_UNKNOWN');
  assert.equal(calls.filter(call => call.tool === 'preview_utility_network').length, 1);
  assert.equal(calls.filter(call => call.tool === 'apply_utility_operation').length, 1);
});

test('waits for an asynchronous preview to become ready before applying', async () => {
  const responses = baseResponses();
  const calls = [];
  let operationReads = 0;
  const queryGame = async (tool, input) => {
    calls.push({ tool, input });
    if (tool === 'set_simulation_speed') return { data: {} };
    if (tool === 'preview_utility_network') return { data: { state: 'generating_preview', operation_id: 'g'.repeat(32) } };
    if (tool === 'get_utility_operation') {
      operationReads++;
      return { data: operationReads === 1 ? { state: 'generating_preview', operation_id: 'g'.repeat(32) } : { state: 'preview_ready', operation_id: 'g'.repeat(32), cost: 88 } };
    }
    if (tool === 'apply_utility_operation') return { data: { state: 'completed', operation_id: input.operation_id, cost: 88 } };
    return { data: responses[tool] };
  };
  const workflow = createUtilityConnectionWorkflow(queryGame);
  const result = await workflow.connect({ ...args, request_id: 'utility-async-preview-001' });
  assert.equal(result.state, 'completed');
  assert.equal(calls.filter(call => call.tool === 'apply_utility_operation').length, 1);
});
