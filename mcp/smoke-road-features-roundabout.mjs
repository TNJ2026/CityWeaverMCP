import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-features-roundabout-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent.data;
  };
  const wait = async (operationId, desired) => {
    for (let i = 0; i < 180; i++) {
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
  const base = await apply('preview_road_route', { request_id: `adv-base-${suffix}`, road_prefab: 'Small Road',
    points: [{ x: 1850, z: 2500 }, { x: 1930, z: 2500 }, { x: 2010, z: 2500 }] });
  assert.equal(base.created_road_ids.length, 2);
  const edgeNodes = [];
  for (const entity_id of base.created_road_ids) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    const edge = row.components['Game.Net.Edge'].fields; edgeNodes.push([edge.m_Start, edge.m_End]);
  }
  const middleNode = edgeNodes[0].find(id => edgeNodes[1].includes(id));
  assert(middleNode);
  await apply('preview_road', { request_id: `adv-branch-${suffix}`, road_prefab: 'Small Road',
    start: { x: 1930, z: 2500, node_id: middleNode }, end: { x: 1930, z: 2580 } });

  const decorated = await apply('preview_road_features', { request_id: `adv-side-on-${suffix}`, edge_ids: [base.created_road_ids[0]],
    left_wide_sidewalk: true, right_wide_sidewalk: true, left_decoration: 'grass', right_decoration: 'trees' });
  const restored = await apply('preview_road_features', { request_id: `adv-side-off-${suffix}`, edge_ids: [decorated.created_road_ids[0]],
    left_wide_sidewalk: false, right_wide_sidewalk: false, left_decoration: 'none', right_decoration: 'none' });

  const roundaboutOn = await apply('preview_intersection_roundabout', { request_id: `adv-roundabout-on-${suffix}`, node_id: middleNode, enabled: true });
  const roundaboutEntity = await call('get_entity_components', { entity_id: middleNode, components: ['Game.Net.Roundabout'] });
  const radius = roundaboutEntity.components['Game.Net.Roundabout'].fields.m_Radius;
  assert(radius > 0, `Expected computed roundabout radius, got ${radius}`);
  const roundaboutOff = await apply('preview_intersection_roundabout', { request_id: `adv-roundabout-off-${suffix}`, node_id: middleNode, enabled: false });

  const node = await call('get_entity_components', { entity_id: middleNode, components: ['Game.Net.ConnectedEdge'], buffer_limit: 20 });
  const cleanupEdges = node.components['Game.Net.ConnectedEdge'].items.map(item => item.m_Edge);
  await apply('preview_road_batch_demolition', { request_id: `adv-clean-small-${suffix}`, edge_ids: cleanupEdges });

  const divided = await apply('preview_road', { request_id: `adv-divided-${suffix}`, road_prefab: 'Medium Road Divided',
    start: { x: 2100, z: 2500 }, end: { x: 2200, z: 2500 } });
  const medianOn = await apply('preview_road_features', { request_id: `adv-median-on-${suffix}`, edge_ids: divided.created_road_ids,
    wide_median: true, median_decoration: 'trees' });
  const medianOff = await apply('preview_road_features', { request_id: `adv-median-off-${suffix}`, edge_ids: medianOn.created_road_ids,
    wide_median: false, median_decoration: 'none' });
  await apply('preview_road_batch_demolition', { request_id: `adv-clean-divided-${suffix}`, edge_ids: medianOff.created_road_ids });

  console.log(JSON.stringify({ passed: true, roundabout_radius_m: radius,
    costs: { side_on: decorated.cost, side_off: restored.cost, roundabout_on: roundaboutOn.cost, roundabout_off: roundaboutOff.cost,
      median_on: medianOn.cost, median_off: medianOff.cost } }, null, 2));
} finally {
  await client.close();
}
