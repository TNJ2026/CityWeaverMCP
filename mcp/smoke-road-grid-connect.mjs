import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-grid-connect-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let gridEdges = [], anchorEdges = [];
let connected = false;
let cleanupRun = 0;
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
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
  const preview = await call(tool, args), ready = await wait(preview.operation_id, 'preview_ready');
  await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
  return wait(ready.operation_id, 'completed');
};
const demolish = async (edges, label) => {
  if (!edges.length) return;
  await apply('preview_road_batch_demolition', { request_id: `${label}-${suffix}`, edge_ids: edges });
};
const cleanup = async () => {
  if (!connected) return;
  const run = cleanupRun++;
  gridEdges = []; anchorEdges = [];
  for (let pass = 0; pass < 3; pass++) {
    const roads = await call('query_entities', { category: 'roads', limit: 100, include_components: ['Game.Net.Curve'] });
    const edges = roads.items.filter(item => {
      const curve = item.components?.['Game.Net.Curve'];
      if (!curve?.present) return false;
      const { a, d } = curve.fields.m_Bezier;
      return [a, d].every(point => point.x >= 3900 && point.x <= 4600 && point.z >= 3150 && point.z <= 3800);
    }).map(item => item.entity_id);
    if (!edges.length) return;
    await demolish(edges, `connect-spatial-clean-${run}-${pass}`);
  }
};

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  connected = true;
  assert.equal((await call('get_game_status')).paused, true);
  await cleanup();
  const anchors = [
    [{ x: 4040, z: 3480 }, { x: 4120, z: 3480 }],
    [{ x: 4472, z: 3480 }, { x: 4552, z: 3480 }],
    [{ x: 4296, z: 3240 }, { x: 4296, z: 3320 }],
    [{ x: 4296, z: 3640 }, { x: 4296, z: 3720 }]
  ];
  for (let i = 0; i < anchors.length; i++) {
    const road = await apply('preview_road', { request_id: `connect-anchor-${i}-${suffix}`, road_prefab: 'Small Road', start: anchors[i][0], end: anchors[i][1] });
    anchorEdges.push(...road.created_road_ids);
  }
  assert.equal(anchorEdges.length, 4);

  const grid = await apply('preview_road_grid', {
    request_id: `road-grid-connect-${suffix}`, road_prefab: 'Small Road', horizontal_road_prefab: 'Alley Oneway',
    vertical_road_prefab: 'Gravel Road', perimeter_road_prefab: 'Medium Road', origin: { x: 4200, z: 3400 },
    columns: 2, rows: 2, block_width_m: 96, block_height_m: 80, auto_connect: true,
    connection_sides: ['north', 'east', 'south', 'west'], connection_search_radius_m: 96,
    connection_road_prefab: 'Small Road', minimum_connections: 4, maximum_connections: 4
  });
  gridEdges = grid.created_road_ids;
  assert.equal(grid.grid_connection_count, 4);
  assert.equal(grid.grid_connection_segment_count, 4);
  assert.deepEqual([...grid.grid_connected_sides].sort(), ['east', 'north', 'south', 'west']);
  assert.equal(grid.segment_count, 16);
  assert.equal(gridEdges.length, 16);
  assert.equal(grid.zoning_validation, 'verified');
  assert.equal(grid.zoning_orderly, true);
  const roles = grid.segments.reduce((counts, segment) => (counts[segment.role] = (counts[segment.role] ?? 0) + 1, counts), {});
  assert.deepEqual(roles, { grid: 12, connection: 4 });
  for (const segment of grid.segments.filter(segment => segment.role === 'connection')) {
    assert(segment.end_target_id, JSON.stringify(segment));
    assert.equal(segment.end_target_kind, 'road_node');
  }

  const roads = await call('query_entities', { category: 'roads', limit: 100 });
  const gridSet = new Set(gridEdges);
  const types = roads.items.filter(item => gridSet.has(item.entity_id)).reduce((counts, item) => (counts[item.prefab_name] = (counts[item.prefab_name] ?? 0) + 1, counts), {});
  assert.deepEqual(types, { 'Medium Road': 8, 'Alley Oneway': 2, 'Gravel Road': 2, 'Small Road': 4 });
  const current = await call('query_entities', { category: 'roads', limit: 100, include_components: ['Game.Net.Curve'] });
  const currentTestEdges = current.items.filter(item => {
    const curve = item.components?.['Game.Net.Curve']; if (!curve?.present) return false;
    const { a, d } = curve.fields.m_Bezier;
    return [a, d].every(point => point.x >= 3900 && point.x <= 4600 && point.z >= 3150 && point.z <= 3800);
  }).map(item => item.entity_id);
  assert.equal(currentTestEdges.length, 16, JSON.stringify(currentTestEdges));
  const nodeDegrees = new Map();
  for (const entity_id of currentTestEdges) {
    const row = await call('get_entity_components', { entity_id, components: ['Game.Net.Edge'] });
    const edge = row.components['Game.Net.Edge'].fields;
    for (const node of [edge.m_Start, edge.m_End]) nodeDegrees.set(node, (nodeDegrees.get(node) ?? 0) + 1);
  }
  const degrees = [...nodeDegrees.values()].sort((a, b) => a - b);
  assert.deepEqual(degrees, [1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4]);
  const zoning = await call('inspect_road_zoning', { edge_ids: gridEdges });
  assert(zoning.items.every(item => item.orderly_geometry), JSON.stringify(zoning));
  await cleanup();

  const noTarget = await client.callTool({ name: 'preview_road_grid', arguments: {
    request_id: `road-grid-no-target-${suffix}`, road_prefab: 'Small Road', origin: { x: 6000, z: 6000 }, columns: 1, rows: 1,
    block_width_m: 80, block_height_m: 80, auto_connect: true, connection_sides: ['north'], connection_search_radius_m: 32,
    minimum_connections: 1, maximum_connections: 1
  } });
  assert.equal(noTarget.isError, true);
  assert(JSON.stringify(noTarget.content).includes('NO_ROAD_CONNECTION'));
  console.log(JSON.stringify({ passed: true, grid_edges: 16, anchor_edges: 4, connections: grid.grid_connection_count,
    connected_sides: grid.grid_connected_sides, road_types: types, permanent_edges_after_native_coalescing: currentTestEdges.length, nodes: nodeDegrees.size, degrees,
    zoning_blocks: grid.zoning_block_count, zoning_cells: grid.zoning_cell_count,
    frontage_clear_cells: grid.zoning_frontage_clear_cells, cost: grid.cost, insufficient_target_rejected: true }, null, 2));
} finally {
  try { await cleanup(); } finally { if (connected) await client.close(); }
}
