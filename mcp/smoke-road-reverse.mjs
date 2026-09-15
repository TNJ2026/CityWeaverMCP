import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-reverse-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let cleanupIds = [];
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent.data;
};
const wait = async (id, state) => {
  for (let i = 0; i < 240; i++) {
    const op = await call('get_road_operation', { operation_id: id });
    if (op.state === state) return op;
    assert(!['failed', 'outcome_unknown', 'expired', 'cancelled'].includes(op.state), JSON.stringify(op));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${state}`);
};
const apply = async (tool, args) => {
  const preview = await call(tool, args);
  const ready = await wait(preview.operation_id, 'preview_ready');
  await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
  return wait(ready.operation_id, 'completed');
};
const edge = async id => (await call('get_entity_components', { entity_id: id, components: ['Game.Net.Edge', 'Game.Net.Curve', 'Game.Prefabs.PrefabRef'] })).components;
const cleanup = async () => {
  if (!cleanupIds.length) return;
  const valid = [];
  for (const id of [...new Set(cleanupIds)]) {
    const result = await client.callTool({ name: 'get_entity_components', arguments: { entity_id: id, components: ['Game.Net.Edge'] } });
    if (!result.isError) valid.push(id);
  }
  if (valid.length) await apply('preview_road_batch_demolition', { request_id: `reverse-clean-${suffix}`, edge_ids: valid });
  cleanupIds = [];
};

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  assert.equal((await call('get_game_status')).paused, true);
  const prefabs = await call('list_road_prefabs', { search: 'Alley Oneway', limit: 10 });
  const oneWay = prefabs.items.find(item => item.name === 'Alley Oneway');
  assert(oneWay && oneWay.one_way === true, JSON.stringify(prefabs));

  const created = await apply('preview_road', { request_id: `reverse-create-${suffix}`, road_prefab: 'Alley Oneway', start: { x: 3300, z: 3100 }, end: { x: 3380, z: 3100 } });
  assert.equal(created.created_road_ids.length, 1);
  cleanupIds = [...created.created_road_ids];
  const originalId = created.created_road_ids[0];
  const before = await edge(originalId);
  const beforeEdge = before['Game.Net.Edge'].fields;

  const reversed = await apply('preview_road_reverse', { request_id: `reverse-apply-${suffix}`, edge_id: originalId });
  assert.equal(reversed.created_road_ids.length, 1, JSON.stringify(reversed));
  cleanupIds = [...new Set([...cleanupIds, ...reversed.created_road_ids])];
  const reversedId = reversed.created_road_ids[0];
  const after = await edge(reversedId);
  const afterEdge = after['Game.Net.Edge'].fields;
  assert.equal(afterEdge.m_Start, beforeEdge.m_End);
  assert.equal(afterEdge.m_End, beforeEdge.m_Start);

  const second = await apply('preview_road', { request_id: `reverse-second-${suffix}`, road_prefab: 'Alley Oneway', start: { x: 3380, z: 3150 }, end: { x: 3300, z: 3150 } });
  assert.equal(second.created_road_ids.length, 1);
  cleanupIds.push(...second.created_road_ids);
  const batchIds = [reversedId, second.created_road_ids[0]];
  const batchBefore = await Promise.all(batchIds.map(edge));
  const batch = await apply('preview_road_batch_reverse', { request_id: `reverse-batch-${suffix}`, edge_ids: batchIds });
  assert.equal(batch.created_road_ids.length, 2, JSON.stringify(batch));
  cleanupIds.push(...batch.created_road_ids);
  for (let i = 0; i < 2; i++) {
    const oldEdge = batchBefore[i]['Game.Net.Edge'].fields;
    const newEdge = (await edge(batch.created_road_ids[i]))['Game.Net.Edge'].fields;
    assert.equal(newEdge.m_Start, oldEdge.m_End);
    assert.equal(newEdge.m_End, oldEdge.m_Start);
  }

  const twoWay = await apply('preview_road', { request_id: `reverse-twoway-${suffix}`, road_prefab: 'Small Road', start: { x: 3300, z: 3200 }, end: { x: 3380, z: 3200 } });
  cleanupIds.push(...twoWay.created_road_ids);
  const rejected = await client.callTool({ name: 'preview_road_reverse', arguments: { request_id: `reverse-reject-${suffix}`, edge_id: twoWay.created_road_ids[0] } });
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error.code, 'ROAD_NOT_ONEWAY');
  const batchRejected = await client.callTool({ name: 'preview_road_batch_reverse', arguments: {
    request_id: `reverse-batch-reject-${suffix}`, edge_ids: [batch.created_road_ids[0], twoWay.created_road_ids[0]]
  } });
  assert.equal(batchRejected.isError, true);
  assert.equal(batchRejected.structuredContent.error.code, 'ROAD_NOT_ONEWAY');

  await cleanup();
  console.log(JSON.stringify({ passed: true, prefab: oneWay.name, one_way: oneWay.one_way, speed_limit: oneWay.speed_limit,
    original_edge_id: originalId, reversed_edge_id: reversedId, start_before: beforeEdge.m_Start, end_before: beforeEdge.m_End,
    start_after: afterEdge.m_Start, end_after: afterEdge.m_End, reverse_cost: reversed.cost,
    batch_edges: batch.created_road_ids.length, batch_cost: batch.cost, two_way_rejection: 'ROAD_NOT_ONEWAY' }, null, 2));
} finally {
  try { await cleanup(); } finally { await client.close(); }
}
