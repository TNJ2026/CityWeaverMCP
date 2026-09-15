import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-ring-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent.data;
  };
  const wait = async (id, state) => {
    for (let i = 0; i < 180; i++) {
      const op = await call('get_road_operation', { operation_id: id });
      if (op.state === state) return op;
      assert(!['failed', 'outcome_unknown', 'expired', 'cancelled'].includes(op.state), JSON.stringify(op));
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${state}`);
  };
  const apply = async (tool, args) => {
    const preview = await call(tool, args); const ready = await wait(preview.operation_id, 'preview_ready');
    await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
    return wait(ready.operation_id, 'completed');
  };

  assert.equal((await call('get_game_status')).paused, true);
  const ring = await apply('preview_road_ring', { request_id: `ring-${suffix}`, road_prefab: 'Small Road Oneway - 1 lane',
    center: { x: 2300, z: 2500 }, radius_m: 30, direction: 'counterclockwise' });
  assert.equal(ring.curve_mode, 'ring');
  assert.equal(ring.segment_count, 4);
  assert.equal(ring.created_road_ids.length, 4);

  const edges = [];
  for (const entity_id of ring.created_road_ids) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    edges.push(row.components['Game.Net.Edge'].fields);
  }
  const counts = new Map();
  for (const edge of edges) for (const node of [edge.m_Start, edge.m_End]) counts.set(node, (counts.get(node) ?? 0) + 1);
  assert.equal(counts.size, 4, `Expected four shared ring nodes: ${JSON.stringify(edges)}`);
  assert([...counts.values()].every(count => count === 2), `Every ring node must have degree two: ${JSON.stringify([...counts])}`);

  const byStart = new Map(edges.map(edge => [edge.m_Start, edge]));
  let edge = edges[0]; const orderedNodes = [];
  for (let i = 0; i < 4; i++) { orderedNodes.push(edge.m_Start); edge = byStart.get(edge.m_End); assert(edge); }
  assert.equal(edge.m_Start, orderedNodes[0], 'Directed edges must close into one cycle');
  const positions = [];
  for (const entity_id of orderedNodes) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Node'] });
    positions.push(row.components['Game.Net.Node'].fields.m_Position);
  }
  let twiceArea = 0;
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i], b = positions[(i + 1) % positions.length]; twiceArea += a.x * b.z - b.x * a.z;
  }
  assert(twiceArea > 0, `Expected counterclockwise directed cycle, signed area=${twiceArea / 2}`);
  await apply('preview_road_batch_demolition', { request_id: `ring-clean-${suffix}`, edge_ids: ring.created_road_ids });
  console.log(JSON.stringify({ passed: true, edge_count: edges.length, node_count: counts.size, signed_area_m2: twiceArea / 2, cost: ring.cost }, null, 2));
} finally {
  await client.close();
}
