import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-grid-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let createdEdges = [];
let permanentEdgeCount = 0;
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
const cleanup = async () => {
  if (!createdEdges.length) return;
  await apply('preview_road_batch_demolition', { request_id: `grid-clean-${suffix}`, edge_ids: createdEdges });
  createdEdges = [];
};

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  assert.equal((await call('get_game_status')).paused, true);
  const grid = await apply('preview_road_grid', {
    request_id: `road-grid-${suffix}`, road_prefab: 'Small Road', origin: { x: 3002, z: 3003 },
    columns: 2, rows: 2, block_width_m: 96, block_height_m: 80
  });
  createdEdges = grid.created_road_ids;
  permanentEdgeCount = createdEdges.length;
  assert.equal(grid.curve_mode, 'grid');
  assert.equal(grid.grid_columns, 2);
  assert.equal(grid.grid_rows, 2);
  assert.equal(grid.grid_block_width_m, 96);
  assert.equal(grid.grid_block_height_m, 80);
  assert.equal(grid.grid_origin.x % 8, 0);
  assert.equal(grid.grid_origin.z % 8, 0);
  assert.equal(grid.segment_count, 12);
  assert.equal(grid.zoning_validation, 'verified');
  assert.equal(grid.zoning_orderly, true);
  assert(grid.zoning_block_count > 0 && grid.zoning_cell_count > 0);
  const nodeCounts = new Map();
  for (const entity_id of createdEdges) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    const edge = row.components['Game.Net.Edge'].fields;
    for (const node of [edge.m_Start, edge.m_End]) nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
  }
  const degrees = [...nodeCounts.values()].sort((a, b) => a - b);
  assert.deepEqual(degrees, [2, 2, 2, 2, 3, 3, 3, 3, 4]);
  const zoning = await call('inspect_road_zoning', { edge_ids: createdEdges });
  assert.equal(zoning.orderly_geometry, true);
  await cleanup();
  console.log(JSON.stringify({ passed: true, planned_segments: grid.segment_count, permanent_edges: permanentEdgeCount,
    nodes: nodeCounts.size, degrees, zoning_blocks: grid.zoning_block_count, zoning_cells: grid.zoning_cell_count,
    frontage_clear_cells: grid.zoning_frontage_clear_cells, cost: grid.cost }, null, 2));
} finally {
  try { await cleanup(); } finally { await client.close(); }
}
