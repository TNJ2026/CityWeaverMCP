import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-road-parallel-expanded-test', version: '0.8.0' });
const suffix = Date.now().toString(36);
let connected = false, cleanupSerial = 0;
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent.data;
};
const expectError = async (name, args, code) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, JSON.stringify(result));
  assert(JSON.stringify(result.content).includes(code), JSON.stringify(result.content));
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
const components = async (id, names) => (await call('get_entity_components', { entity_id: id, components: names })).components;
const currentTestEdges = async () => {
  const roads = await call('query_entities', { category: 'roads', limit: 100, include_components: ['Game.Net.Curve'] });
  return roads.items.filter(item => {
    const curve = item.components?.['Game.Net.Curve']; if (!curve?.present) return false;
    const { a, d } = curve.fields.m_Bezier;
    return [a, d].every(point => point.x >= 5450 && point.x <= 6700 && point.z >= 2400 && point.z <= 3950);
  }).map(item => item.entity_id);
};
const cleanup = async () => {
  if (!connected) return;
  const run = cleanupSerial++;
  for (let pass = 0; pass < 5; pass++) {
    const edges = await currentTestEdges(); if (!edges.length) return;
    await apply('preview_road_batch_demolition', { request_id: `parallel-expanded-clean-${suffix}-${run}-${pass}`, edge_ids: edges });
  }
};
const createRoad = async (label, prefab, start, end, curve) => apply('preview_road', {
  request_id: `${label}-${suffix}`, road_prefab: prefab, start, end, ...(curve ? { curve } : {})
});
const prefabNames = async ids => {
  const roads = await call('query_entities', { category: 'roads', limit: 100 }); const wanted = new Set(ids);
  return roads.items.filter(item => wanted.has(item.entity_id)).map(item => item.prefab_name).sort();
};

try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  connected = true; assert.equal((await call('get_game_status')).paused, true); await cleanup();

  const a = await createRoad('expanded-reverse-a', 'Small Road', { x: 5700, z: 2700 }, { x: 5860, z: 2700 });
  const aId = a.created_road_ids[0], aEdge = (await components(aId, ['Game.Net.Edge']))['Game.Net.Edge'].fields;
  const b = await createRoad('expanded-reverse-b', 'Gravel Road', { x: 5860, z: 2700, node_id: aEdge.m_End }, { x: 5860, z: 2860 });
  const bId = b.created_road_ids[0];
  const reversed = await apply('preview_road_parallel', { request_id: `expanded-reversed-${suffix}`, edge_ids: [bId, aId],
    side: 'right', offset_m: 32, road_prefab: 'Medium Road' });
  assert.equal(reversed.parallel_inherited_prefabs, false); assert.equal(reversed.created_road_ids.length, 2);
  assert.deepEqual(reversed.segments.map(segment => segment.road_prefab), ['Medium Road', 'Medium Road']);
  assert.deepEqual(await prefabNames(reversed.created_road_ids), ['Medium Road', 'Medium Road']);
  assert(Math.abs(reversed.segments[0].start.x - 5828) < 0.05 && Math.abs(reversed.segments[0].start.z - 2860) < 0.05);
  assert(Math.abs(reversed.segments[0].end.x - 5828) < 0.05 && Math.abs(reversed.segments[0].end.z - 2732) < 0.05);
  assert(Math.abs(reversed.segments[1].end.x - 5700) < 0.05 && Math.abs(reversed.segments[1].end.z - 2732) < 0.05);

  const exactSource = await createRoad('expanded-exact-source', 'Small Road', { x: 6100, z: 2700 }, { x: 6260, z: 2700 });
  const exact = await apply('preview_road_parallel', { request_id: `expanded-exact-${suffix}`, edge_ids: exactSource.created_road_ids,
    side: 'left', offset_m: 17, connect_ends: true });
  assert.equal(exact.parallel_offset_m, 17); assert.equal(exact.created_road_ids.length, 3);
  assert.deepEqual(exact.segments.map(segment => segment.role), ['parallel', 'parallel_start_connection', 'parallel_end_connection']);

  const maximum = await apply('preview_road_parallel', { request_id: `expanded-maximum-${suffix}`, edge_ids: exactSource.created_road_ids,
    side: 'right', offset_m: 128, road_prefab: 'Small Road' });
  assert.equal(maximum.parallel_offset_m, 128); assert.equal(maximum.created_road_ids.length, 1);

  const elevatedSource = await createRoad('expanded-elevated-source', 'Small Road', { x: 5700, z: 3200, elevation_m: 12 }, { x: 5860, z: 3200, elevation_m: 12 });
  const elevated = await apply('preview_road_parallel', { request_id: `expanded-elevated-${suffix}`, edge_ids: elevatedSource.created_road_ids,
    side: 'right', offset_m: 32, road_prefab: 'Medium Road' });
  assert.equal(elevated.segments[0].elevation_mode, 'elevated');
  const elevatedEcs = (await components(elevated.created_road_ids[0], ['Game.Net.Elevation']))['Game.Net.Elevation'];
  assert.equal(elevatedEcs.present, true); assert(Math.abs(elevatedEcs.fields.m_Elevation.x - 12) < 0.1 && Math.abs(elevatedEcs.fields.m_Elevation.y - 12) < 0.1);

  const tunnelSource = await createRoad('expanded-tunnel-source', 'Small Road', { x: 6100, z: 3200, elevation_m: -16 }, { x: 6260, z: 3200, elevation_m: -16 });
  const tunnel = await apply('preview_road_parallel', { request_id: `expanded-tunnel-${suffix}`, edge_ids: tunnelSource.created_road_ids,
    side: 'left', offset_m: 24 });
  assert.equal(tunnel.segments[0].elevation_mode, 'tunnel');
  const tunnelEcs = (await components(tunnel.created_road_ids[0], ['Game.Net.Elevation']))['Game.Net.Elevation'];
  assert.equal(tunnelEcs.present, true); assert(Math.abs(tunnelEcs.fields.m_Elevation.x + 16) < 0.1 && Math.abs(tunnelEcs.fields.m_Elevation.y + 16) < 0.1);

  const angledSource = await apply('preview_road_route', { request_id: `expanded-angled-source-${suffix}`, road_prefab: 'Small Road', points: [
    { x: 5600, z: 3600 }, { x: 5720, z: 3600 }, { x: 5800, z: 3680 }, { x: 5920, z: 3680 }
  ] });
  const angled = await apply('preview_road_parallel', { request_id: `expanded-angled-${suffix}`, edge_ids: angledSource.created_road_ids,
    side: 'left', offset_m: 24 });
  assert.equal(angled.segment_count, 3); assert.equal(angled.created_road_ids.length, 3);
  for (let i = 0; i + 1 < angled.segments.length; i++) {
    const end = angled.segments[i].end, start = angled.segments[i + 1].start;
    assert(Math.hypot(end.x - start.x, end.z - start.z) < 0.05, JSON.stringify({ i, end, start }));
  }

  const alley = await createRoad('expanded-alley-source', 'Alley Oneway', { x: 6450, z: 2700 }, { x: 6570, z: 2700 });
  await expectError('preview_road_parallel', { request_id: `expanded-short-connect-${suffix}`, edge_ids: alley.created_road_ids,
    side: 'left', offset_m: 12, connect_ends: true }, 'PARALLEL_CONNECTION_TOO_SHORT');
  await expectError('preview_road_parallel', { request_id: `expanded-duplicate-${suffix}`, edge_ids: [aId, aId], side: 'left', offset_m: 32 }, 'DUPLICATE_ROAD_EDGE');
  await expectError('preview_road_parallel', { request_id: `expanded-disconnected-${suffix}`, edge_ids: [aId, exactSource.created_road_ids[0]], side: 'left', offset_m: 32 }, 'PARALLEL_ROUTE_DISCONNECTED');
  await expectError('preview_road_parallel', { request_id: `expanded-unknown-${suffix}`, edge_ids: [aId], side: 'left', offset_m: 32,
    road_prefab: 'No Such Road' }, 'UNKNOWN_ROAD_PREFAB');

  const ring = await apply('preview_road_ring', { request_id: `expanded-ring-source-${suffix}`, road_prefab: 'Small Road', center: { x: 6450, z: 3650 }, radius_m: 40, direction: 'counterclockwise' });
  await expectError('preview_road_parallel', { request_id: `expanded-closed-connect-${suffix}`, edge_ids: ring.created_road_ids,
    side: 'right', offset_m: 24, connect_ends: true }, 'INVALID_ARGUMENT');

  await cleanup();
  console.log(JSON.stringify({ passed: true, permanent_cases: ['reversed_order_forced_prefab', 'minimum_offset_with_end_connections', 'maximum_offset',
    'elevated', 'tunnel', 'three_segment_angled_route'], rejected_cases: ['short_end_connections', 'duplicate_edges', 'disconnected_route',
    'unknown_prefab', 'closed_route_end_connections'], reversed_cost: reversed.cost, exact_offset_cost: exact.cost, maximum_offset_cost: maximum.cost,
    elevated_cost: elevated.cost, tunnel_cost: tunnel.cost, angled_cost: angled.cost, remaining_test_edges: (await currentTestEdges()).length }, null, 2));
} finally {
  try { await cleanup(); } finally { if (connected) await client.close(); }
}
