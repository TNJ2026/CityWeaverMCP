import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-parallel-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let connected = false, cleanupSerial = 0;
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
const currentTestEdges = async () => {
  const roads = await call('query_entities', { category: 'roads', limit: 100, include_components: ['Game.Net.Curve'] });
  return roads.items.filter(item => {
    const curve = item.components?.['Game.Net.Curve']; if (!curve?.present) return false;
    const { a, d } = curve.fields.m_Bezier;
    return [a, d].every(point => point.x >= 4650 && point.x <= 6000 && point.z >= 2800 && point.z <= 3300);
  }).map(item => item.entity_id);
};
const cleanup = async () => {
  if (!connected) return;
  const run = cleanupSerial++;
  for (let pass = 0; pass < 4; pass++) {
    const edges = await currentTestEdges(); if (!edges.length) return;
    await apply('preview_road_batch_demolition', { request_id: `parallel-clean-${suffix}-${run}-${pass}`, edge_ids: edges });
  }
};
const edge = async id => (await call('get_entity_components', { entity_id: id, components: ['Game.Net.Edge', 'Game.Net.Curve'] })).components;
const point = (curve, t) => {
  const u = 1 - t, b = curve.m_Bezier;
  return { x: u ** 3 * b.a.x + 3 * u ** 2 * t * b.b.x + 3 * u * t ** 2 * b.c.x + t ** 3 * b.d.x,
    z: u ** 3 * b.a.z + 3 * u ** 2 * t * b.b.z + 3 * u * t ** 2 * b.c.z + t ** 3 * b.d.z };
};
const near = (actual, expected, tolerance = 0.05) => assert(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  connected = true; assert.equal((await call('get_game_status')).paused, true); await cleanup();

  const first = await apply('preview_road', { request_id: `parallel-source-a-${suffix}`, road_prefab: 'Small Road', start: { x: 4800, z: 3000 }, end: { x: 4960, z: 3000 } });
  const firstId = first.created_road_ids[0], firstEdge = await edge(firstId), joint = firstEdge['Game.Net.Edge'].fields.m_End;
  const second = await apply('preview_road', { request_id: `parallel-source-b-${suffix}`, road_prefab: 'Gravel Road',
    start: { x: 4960, z: 3000, node_id: joint }, end: { x: 4960, z: 3160 } });
  const secondId = second.created_road_ids[0];

  const tooClose = await client.callTool({ name: 'preview_road_parallel', arguments: {
    request_id: `parallel-too-close-${suffix}`, edge_ids: [firstId, secondId], side: 'left', offset_m: 8
  } });
  assert.equal(tooClose.isError, true); assert(JSON.stringify(tooClose.content).includes('PARALLEL_OFFSET_TOO_SMALL'));

  const parallel = await apply('preview_road_parallel', { request_id: `parallel-route-${suffix}`, edge_ids: [firstId, secondId],
    side: 'left', offset_m: 32, connect_ends: true });
  assert.equal(parallel.parallel_side, 'left'); assert.equal(parallel.parallel_offset_m, 32);
  assert.equal(parallel.parallel_closed, false); assert.equal(parallel.parallel_connect_ends, true); assert.equal(parallel.parallel_inherited_prefabs, true);
  assert.equal(parallel.segment_count, 4); assert.equal(parallel.created_road_ids.length, 4);
  assert.deepEqual(parallel.segments.map(segment => segment.role), ['parallel', 'parallel', 'parallel_start_connection', 'parallel_end_connection']);
  assert.deepEqual(parallel.segments.slice(0, 2).map(segment => segment.road_prefab), ['Small Road', 'Gravel Road']);
  assert.deepEqual(parallel.segments.slice(0, 2).map(segment => segment.source_edge_id), [firstId, secondId]);
  near(parallel.segments[0].start.z, 3032); near(parallel.segments[0].end.x, 4928);
  near(parallel.segments[0].end.z, 3032); near(parallel.segments[1].start.x, 4928);
  near(parallel.segments[1].end.x, 4928); near(parallel.segments[1].end.z, 3160);
  assert(parallel.segments[2].end_target_id && parallel.segments[3].end_target_id);

  const curvedSource = await apply('preview_road', { request_id: `parallel-curve-source-${suffix}`, road_prefab: 'Small Road',
    start: { x: 5200, z: 3000 }, end: { x: 5360, z: 3000 }, curve: { mode: 'cubic', control_1: { x: 5240, z: 3080 }, control_2: { x: 5320, z: 3080 } } });
  const curvedSourceId = curvedSource.created_road_ids[0];
  const curvedParallel = await apply('preview_road_parallel', { request_id: `parallel-curve-${suffix}`, edge_ids: [curvedSourceId],
    side: 'right', offset_m: 32, road_prefab: 'Small Road' });
  assert.equal(curvedParallel.created_road_ids.length, 1); assert.equal(curvedParallel.segments[0].role, 'parallel');
  const sourceCurve = (await edge(curvedSourceId))['Game.Net.Curve'].fields;
  const resultCurve = (await edge(curvedParallel.created_road_ids[0]))['Game.Net.Curve'].fields;
  const distances = [];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const p = point(sourceCurve, t), q = point(resultCurve, t), before = point(sourceCurve, Math.max(0, t - 0.01)), after = point(sourceCurve, Math.min(1, t + 0.01));
    const dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz), cross = (after.x - before.x) * dz - (after.z - before.z) * dx;
    assert(cross < 0, JSON.stringify({ t, p, q, cross })); assert(length >= 24 && length <= 40, JSON.stringify({ t, length })); distances.push(length);
  }

  const ring = await apply('preview_road_ring', { request_id: `parallel-ring-source-${suffix}`, road_prefab: 'Small Road',
    center: { x: 5700, z: 3000 }, radius_m: 40, direction: 'counterclockwise' });
  const ringRows = [];
  for (const id of ring.created_road_ids) ringRows.push({ id, edge: (await edge(id))['Game.Net.Edge'].fields });
  const orderedRing = [{ id: ringRows[0].id, start: ringRows[0].edge.m_Start, end: ringRows[0].edge.m_End }], unusedRing = ringRows.slice(1);
  while (unusedRing.length) {
    const end = orderedRing.at(-1).end;
    const index = unusedRing.findIndex(row => row.edge.m_Start === end || row.edge.m_End === end);
    assert(index >= 0, JSON.stringify(ringRows)); const row = unusedRing.splice(index, 1)[0];
    orderedRing.push({ id: row.id, start: end, end: row.edge.m_Start === end ? row.edge.m_End : row.edge.m_Start });
  }
  const ringParallel = await apply('preview_road_parallel', { request_id: `parallel-ring-${suffix}`, edge_ids: orderedRing.map(row => row.id),
    side: 'right', offset_m: 24, road_prefab: 'Small Road' });
  assert.equal(ringParallel.parallel_closed, true); assert.equal(ringParallel.parallel_connect_ends, false);
  assert.equal(ringParallel.segment_count, 4); assert.equal(ringParallel.created_road_ids.length, 4);
  assert(ringParallel.segments.every(segment => segment.role === 'parallel'));
  const ringRadii = ringParallel.segments.map(segment => Math.hypot(segment.start.x - 5700, segment.start.z - 3000));
  assert(ringRadii.every(radius => radius >= 62 && radius <= 66), JSON.stringify(ringRadii));
  await cleanup();
  console.log(JSON.stringify({ passed: true, ordered_mixed_route_segments: 2, offset_m: 32, end_connections: 2,
    l_join: { x: 4928, z: 3032 }, curved_samples_m: distances, too_small_offset_rejected: true, remaining_test_edges: (await currentTestEdges()).length,
    closed_ring_segments: ringParallel.segment_count, closed_ring_radii_m: ringRadii,
    route_cost: parallel.cost, curved_cost: curvedParallel.cost, ring_cost: ringParallel.cost }, null, 2));
} finally {
  try { await cleanup(); } finally { if (connected) await client.close(); }
}
