import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-batch-test', version: '0.8.0' });
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
    const preview = await call(tool, args);
    const ready = await wait(preview.operation_id, 'preview_ready');
    await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
    return wait(ready.operation_id, 'completed');
  };

  assert.equal((await call('get_game_status')).paused, true);
  const created = await apply('preview_road_route', {
    request_id: `batch-create-${suffix}`,
    road_prefab: 'Small Road',
    points: [{ x: 1850, z: 2500 }, { x: 1930, z: 2500 }, { x: 2010, z: 2500 }]
  });
  assert.equal(created.created_road_ids.length, 2, JSON.stringify(created));
  const edgeIds = created.created_road_ids;

  const upgraded = await apply('preview_road_batch_upgrade', {
    request_id: `batch-upgrade-${suffix}`, edge_ids: edgeIds, road_prefab: 'Alley Oneway'
  });
  assert(upgraded.created_road_ids.length > 0);
  const upgradedIds = upgraded.created_road_ids;
  for (const entity_id of upgradedIds) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Prefabs.PrefabRef', 'Game.Net.Edge', 'Game.Net.Curve'] });
    assert.equal(row.components['Game.Prefabs.PrefabRef'].present, true);
  }

  const disabled = await apply('preview_road_zoning', {
    request_id: `zoning-off-${suffix}`, edge_ids: upgradedIds, left_enabled: false, right_enabled: false
  });
  assert(disabled.created_road_ids.length > 0);
  const zonedIds = disabled.created_road_ids;
  const enabled = await apply('preview_road_zoning', {
    request_id: `zoning-on-${suffix}`, edge_ids: zonedIds, left_enabled: true, right_enabled: true
  });
  assert(enabled.created_road_ids.length > 0);
  const restoredIds = enabled.created_road_ids;

  const demolished = await apply('preview_road_batch_demolition', {
    request_id: `batch-demolish-${suffix}`, edge_ids: restoredIds
  });
  assert.equal(demolished.created_road_ids.length, 0);
  for (const entity_id of restoredIds) {
    const result = await client.callTool({ name: 'get_entity_components', arguments: { entity_id } });
    assert.equal(result.isError, true, `Demolished edge still exists: ${entity_id}`);
  }
  console.log(JSON.stringify({ passed: true, edge_ids: edgeIds, create_cost: created.cost, upgrade_cost: upgraded.cost,
    zoning_disable_cost: disabled.cost, zoning_enable_cost: enabled.cost, demolition_cost: demolished.cost }, null, 2));
} finally {
  await client.close();
}
