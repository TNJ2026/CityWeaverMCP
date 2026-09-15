import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-zoning-inspection-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let createdEdges = [];
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
  const preview = await call(tool, args);
  const ready = await wait(preview.operation_id, 'preview_ready');
  await call('build_road', { operation_id: ready.operation_id, request_id: `${args.request_id}-commit`, max_cost: 10_000_000 });
  return wait(ready.operation_id, 'completed');
};
const cleanup = async () => {
  if (!createdEdges.length) return;
  await apply('preview_road_batch_demolition', { request_id: `zone-inspect-clean-${suffix}`, edge_ids: createdEdges });
  createdEdges = [];
};

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  assert.equal((await call('get_game_status')).paused, true);
  const route = await apply('preview_road_autoroute', {
    request_id: `zone-inspect-${suffix}`, road_prefab: 'Small Road',
    start: { x: 1850, z: 2700 }, end: { x: 2450, z: 2700 },
    strategy: 'balanced', grid_size_m: 32, max_detour_m: 128, zoning_alignment: true
  });
  createdEdges = route.created_road_ids;
  assert.equal(route.zoning_validation, 'verified');
  assert.equal(route.zoning_orderly, true);
  assert(route.zoning_block_count > 0);
  assert(route.zoning_cell_count > 0);
  let report;
  for (let i = 0; i < 40; i++) {
    report = await call('inspect_road_zoning', { edge_ids: createdEdges });
    if (report.zone_block_count > 0) break;
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  assert(report.zone_block_count > 0, JSON.stringify(report));
  assert(report.cell_count > 0, JSON.stringify(report));
  assert.equal(report.size_mismatch_blocks, 0, JSON.stringify(report));
  assert.equal(report.axis_aligned_blocks, report.zone_block_count, JSON.stringify(report));
  assert.equal(report.cell_lattice_consistent, true, JSON.stringify(report));
  assert.equal(report.orderly_geometry, true, JSON.stringify(report));
  await cleanup();
  console.log(JSON.stringify({
    passed: true,
    edges: report.edge_count,
    blocks: report.zone_block_count,
    cells: report.cell_count,
    clear_cells: report.clear_cells,
    frontage_clear_cells: report.frontage_clear_cells,
    blocked_cells: report.blocked_cells,
    shared_cells: report.shared_cells,
    occupied_cells: report.occupied_cells,
    redundant_cells: report.redundant_cells,
    lattice_phase_m: report.cell_lattice_phase_m,
    orderly_geometry: report.orderly_geometry
  }, null, 2));
} finally {
  try { await cleanup(); } finally { await client.close(); }
}
