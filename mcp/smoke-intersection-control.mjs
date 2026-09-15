import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-intersection-control-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent.data;
  };
  const wait = async (operationId, desired) => {
    for (let i = 0; i < 160; i++) {
      const op = await call('get_road_operation', { operation_id: operationId });
      if (op.state === desired) return op;
      assert(!['failed', 'outcome_unknown', 'expired', 'cancelled'].includes(op.state), JSON.stringify(op));
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${desired}: ${operationId}`);
  };
  const apply = async (tool, args) => {
    const preview = await call(tool, args); const ready = await wait(preview.operation_id, 'preview_ready');
    await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
    return wait(ready.operation_id, 'completed');
  };

  assert.equal((await call('get_game_status')).paused, true);
  const horizontal = await apply('preview_road_route', { request_id: `ix-base-${suffix}`, road_prefab: 'Small Road',
    points: [{ x: 1850, z: 2500 }, { x: 1930, z: 2500 }, { x: 2010, z: 2500 }] });
  assert.equal(horizontal.created_road_ids.length, 2);
  const edgeNodes = [];
  for (const entity_id of horizontal.created_road_ids) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    const edge = row.components['Game.Net.Edge'].fields; edgeNodes.push([edge.m_Start, edge.m_End]);
  }
  const middleNode = edgeNodes[0].find(id => edgeNodes[1].includes(id));
  assert(middleNode, 'The two route segments must share a node');
  const branch = await apply('preview_road', { request_id: `ix-branch-${suffix}`, road_prefab: 'Small Road',
    start: { x: 1930, z: 2500, node_id: middleNode }, end: { x: 1930, z: 2580 } });
  assert(branch.created_road_ids.length > 0);

  const costs = {};
  for (const [index, mode] of ['traffic_lights', 'all_way_stop', 'uncontrolled', 'traffic_lights', 'automatic'].entries()) {
    const changed = await apply('preview_intersection_control', { request_id: `ix-${index}-${mode}-${suffix}`, node_ids: [middleNode], mode });
    costs[mode] = changed.cost;
  }
  const restricted = await apply('preview_intersection_rules', { request_id: `ix-rules-off-${suffix}`, edge_id: horizontal.created_road_ids[0], node_id: middleNode,
    left_turn: 'forbid', right_turn: 'forbid', straight: 'forbid', crosswalk_enabled: false });
  const restored = await apply('preview_intersection_rules', { request_id: `ix-rules-on-${suffix}`, edge_id: restricted.created_road_ids[0], node_id: middleNode,
    left_turn: 'allow', right_turn: 'allow', straight: 'allow', crosswalk_enabled: true });
  const node = await call('get_entity_components', { entity_id: middleNode, components: ['Game.Net.ConnectedEdge'], buffer_limit: 20 });
  const cleanupEdges = node.components['Game.Net.ConnectedEdge'].items.map(item => item.m_Edge);
  await apply('preview_road_batch_demolition', { request_id: `ix-clean-${suffix}`, edge_ids: cleanupEdges });
  console.log(JSON.stringify({ passed: true, node_id: middleNode, costs, rules_disable_cost: restricted.cost, rules_restore_cost: restored.cost }, null, 2));
} finally {
  await client.close();
}
