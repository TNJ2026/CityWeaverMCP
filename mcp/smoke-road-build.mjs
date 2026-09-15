// Performs a real, charged road placement. Run only for an authorized route file.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const route = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const max_cost = Number(process.argv[3]);
assert(Number.isInteger(max_cost) && max_cost >= 0, 'Pass an explicit authorized maximum cost');
const client = new Client({ name: 'cities2-road-build-test', version: '0.8.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, false, JSON.stringify(r.structuredContent)); return r.structuredContent.data;
  };
  const wait = async (operation_id, state) => {
    for (let i = 0; i < 100; i++) {
      const op = await call('get_road_operation', { operation_id });
      if (op.state === state) return op;
      assert(!['failed', 'outcome_unknown', 'expired', 'cancelled'].includes(op.state), JSON.stringify(op));
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`State timeout: poll ${operation_id}; do not replay with new IDs.`);
  };
  assert.equal((await call('get_game_status')).paused, true);
  const before = await call('get_city_summary');
  const beforeCount = await call('count_entities', { category: 'roads', all_components: ['Game.Net.Edge'] });
  const preview = await call('preview_road', route);
  console.log(JSON.stringify({ operation_id: preview.operation_id, request_id: route.request_id }));
  const ready = await wait(preview.operation_id, 'preview_ready');
  assert(ready.cost <= max_cost);
  const commit = { operation_id: ready.operation_id, request_id: route.request_id + '-commit', max_cost };
  await call('build_road', commit);
  const completed = await wait(ready.operation_id, 'completed');
  assert(completed.created_road_ids.length > 0);
  const firstAfter = await call('get_city_summary');
  const replay = await call('build_road', commit);
  assert.equal(replay.state, 'completed');
  assert.deepEqual(replay.created_road_ids, completed.created_road_ids);
  const after = await call('get_city_summary');
  assert.equal(after.money, firstAfter.money, 'Replay must not charge a second time');
  if (!before.unlimited_money) assert.equal(before.money - after.money, ready.cost);
  const afterCount = await call('count_entities', { category: 'roads', all_components: ['Game.Net.Edge'] });
  assert.equal(afterCount.count - beforeCount.count, completed.created_road_ids.length);
  const roads = [];
  for (const entity_id of completed.created_road_ids) {
    const data = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge', 'Game.Net.Curve', 'Game.Prefabs.PrefabRef'] });
    assert(data.components['Game.Net.Edge'].present);
    const edge = data.components['Game.Net.Edge'].fields;
    for (const node_id of [edge.m_Start, edge.m_End]) {
      const node = await call('get_entity_components', { entity_id: node_id, components: ['Game.Net.Node', 'Game.Net.ConnectedEdge'], buffer_limit: 100 });
      assert(node.components['Game.Net.Node'].present);
      assert(node.components['Game.Net.ConnectedEdge'].items.some(item => item.m_Edge === entity_id), 'Node must reference its road');
    }
    roads.push(data);
  }
  console.log(JSON.stringify({ passed: true, completed, money_before: before.money, money_after: after.money, cost: ready.cost,
    roads_before: beforeCount.count, roads_after: afterCount.count, roads }, null, 2));
} finally { await client.close(); }
