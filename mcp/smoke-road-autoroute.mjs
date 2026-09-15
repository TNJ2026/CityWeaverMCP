import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-autoroute-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent)}`);
    return result.structuredContent.data;
  };
  const wait = async (id, state) => {
    for (let i = 0; i < 200; i++) {
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
  const route = await apply('preview_road_autoroute', { request_id: `auto-${suffix}`, road_prefab: 'Small Road',
    start: { x: 1850, z: 2700 }, end: { x: 2450, z: 2700 }, strategy: 'balanced', grid_size_m: 32, max_detour_m: 128, zoning_alignment: true });
  assert.equal(route.curve_mode, 'autoroute');
  assert.equal(route.planner_strategy, 'balanced');
  assert.equal(route.planner_grid_size_m, 32);
  assert.equal(route.zoning_alignment, true);
  assert.equal(route.zoning_validation, 'verified');
  assert.equal(route.zoning_orderly, true);
  assert(route.zoning_block_count > 0);
  assert(route.zoning_cell_count > 0);
  assert(route.segments.every(segment => {
    const axisAligned = Math.abs(segment.start.x - segment.end.x) < 0.01 || Math.abs(segment.start.z - segment.end.z) < 0.01;
    const gridAligned = [segment.start.x, segment.start.z, segment.end.x, segment.end.z].every(value =>
      Math.abs(value / route.planner_grid_size_m - Math.round(value / route.planner_grid_size_m)) < 0.01);
    return axisAligned && gridAligned;
  }), 'Every zoning-aligned segment must be cardinal and use planner grid points');
  assert(route.segment_count >= 3, `600m route should require at least three native segments: ${JSON.stringify(route)}`);
  assert(route.segments.every(segment => segment.length_m >= 16 && segment.length_m <= 248.1));
  assert(route.created_road_ids.length >= route.segment_count, 'The native pipeline may split planned segments into additional permanent edges');

  const nodeCounts = new Map();
  for (const entity_id of route.created_road_ids) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    const edge = row.components['Game.Net.Edge'].fields;
    for (const node of [edge.m_Start, edge.m_End]) nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
  }
  assert.equal([...nodeCounts.values()].filter(value => value === 1).length, 2, 'Route must have exactly two terminal nodes');
  assert([...nodeCounts.values()].filter(value => value === 2).length === route.created_road_ids.length - 1, 'Every intermediate node must connect two route edges');
  await apply('preview_road_batch_demolition', { request_id: `auto-clean-${suffix}`, edge_ids: route.created_road_ids });
  console.log(JSON.stringify({ passed: true, length_m: route.length_m, planned_segments: route.segment_count, permanent_edges: route.created_road_ids.length,
    planner_obstacles: route.planner_obstacle_count, zoning_blocks: route.zoning_block_count, zoning_cells: route.zoning_cell_count,
    frontage_clear_cells: route.zoning_frontage_clear_cells, cost: route.cost }, null, 2));
} finally {
  await client.close();
}
