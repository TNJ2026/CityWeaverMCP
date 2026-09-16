import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { queryGame } from '../bridge-client.mjs';

const token = Buffer.alloc(32, 7).toString('base64');
async function fixture(t, handler) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cities2-mcp-test-'));
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let text = '';
    socket.on('data', chunk => {
      text += chunk.toString();
      if (text.includes('\n')) handler(socket, JSON.parse(text.split('\n')[0]));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = { protocol_version: 1, host: '127.0.0.1', port: server.address().port, token };
  const endpointPath = path.join(directory, 'bridge.json');
  await writeFile(endpointPath, JSON.stringify(endpoint));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { endpointPath, endpoint, directory };
}

test('authenticated request and fragmented UTF-8 response', async t => {
  const response = { ok: true, meta: { session_id: 'test' }, data: { city_name: '测试城市' } };
  const { endpointPath } = await fixture(t, (socket, request) => {
    assert.equal(request.token, token);
    assert.equal(request.protocol_version, 1);
    assert.equal(request.tool, 'query_buildings');
    assert.deepEqual(request.arguments, { limit: 10 });
    const bytes = Buffer.from(JSON.stringify(response) + '\n');
    socket.write(bytes.subarray(0, bytes.length - 8));
    setTimeout(() => socket.end(bytes.subarray(bytes.length - 8)), 5);
  });
  assert.deepEqual(await queryGame('query_buildings', { limit: 10 }, { endpointPath }), response);
});

test('game error codes propagate without exposing credentials', async t => {
  const { endpointPath } = await fixture(t, socket => socket.end(JSON.stringify({ ok: false, error: { code: 'STALE_ENTITY', message: 'Reloaded city' } }) + '\n'));
  await assert.rejects(queryGame('get_entity_details', {}, { endpointPath }), error => error.code === 'STALE_ENTITY' && !error.message.includes(token));
});

test('reject non-loopback endpoint', async t => {
  const { endpointPath, endpoint } = await fixture(t, () => assert.fail('Must not connect'));
  await writeFile(endpointPath, JSON.stringify({ ...endpoint, host: 'example.com' }));
  await assert.rejects(queryGame('get_game_status', {}, { endpointPath }), { code: 'INVALID_ENDPOINT' });
});

test('missing bridge is explicit', async t => {
  const { directory } = await fixture(t, () => {});
  await assert.rejects(queryGame('get_game_status', {}, { endpointPath: path.join(directory, 'missing.json') }), { code: 'BRIDGE_NOT_FOUND' });
});

test('connection failure invalidates cached endpoint for immediate rediscovery', async t => {
  const response = { ok: true, meta: { session_id: 'restarted' }, data: { connected: true } };
  const { endpointPath, endpoint } = await fixture(t, socket => socket.end(JSON.stringify(response) + '\n'));
  const unavailable = net.createServer();
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  const unavailablePort = unavailable.address().port;
  await new Promise(resolve => unavailable.close(resolve));

  await writeFile(endpointPath, JSON.stringify({ ...endpoint, port: unavailablePort }));
  await assert.rejects(queryGame('get_game_status', {}, { endpointPath }), { code: 'GAME_UNAVAILABLE' });

  await writeFile(endpointPath, JSON.stringify(endpoint));
  assert.deepEqual(await queryGame('get_game_status', {}, { endpointPath }), response);
});

test('deadline aborts unresponsive game', async t => {
  const { endpointPath } = await fixture(t, () => {});
  await assert.rejects(queryGame('get_game_status', {}, { endpointPath, timeoutMs: 30 }), { code: 'GAME_TIMEOUT' });
});

test('reject malformed and truncated responses', async t => {
  const bad = await fixture(t, socket => socket.end('{broken}\n'));
  await assert.rejects(queryGame('get_game_status', {}, bad), { code: 'INVALID_RESPONSE' });
  const truncated = await fixture(t, socket => socket.end('{"ok":'));
  await assert.rejects(queryGame('get_game_status', {}, truncated), { code: 'INCOMPLETE_RESPONSE' });
});

test('request and response size limits', async t => {
  const { endpointPath } = await fixture(t, socket => socket.end(Buffer.alloc(2 * 1024 * 1024 + 1, 120)));
  await assert.rejects(queryGame('get_game_status', { extra: 'x'.repeat(8192) }, { endpointPath }), { code: 'REQUEST_TOO_LARGE' });
  await assert.rejects(queryGame('get_game_status', {}, { endpointPath }), { code: 'RESPONSE_TOO_LARGE' });
});

test('real MCP handshake, tool schemas, query forwarding and validation', async t => {
  let calls = 0;
  const { endpointPath } = await fixture(t, (socket, request) => {
    calls++;
    socket.end(JSON.stringify({ ok: true, meta: { session_id: 'fixture' }, data: { tool: request.tool, args: request.arguments } }) + '\n');
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server.mjs', import.meta.url))], env: { ...process.env, CSII_BRIDGE_FILE: endpointPath } });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 342);
  assert(tools.some(tool => tool.name === 'deploy_grid_district'), 'high-level grid deployment tool is registered');
  for (const name of ['plan_building_workflow', 'execute_building_plan', 'cancel_building_plan', 'deploy_building_plans']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  for (const name of ['deploy_service_cluster', 'deploy_industrial_campus', 'deploy_transit_corridor']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  for (const name of ['list_building_areas', 'preview_building_area', 'get_building_area_operation', 'apply_building_area_operation', 'cancel_building_area_preview']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  for (const name of ['connect_utility_facility', 'list_utility_connection_points', 'find_compatible_utility_targets']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  assert.equal(tools.find(tool => tool.name === 'plan_building_workflow').annotations.destructiveHint, false);
  const mutations = new Set(['set_simulation_speed', 'preview_disaster', 'apply_disaster_operation', 'cancel_disaster_preview', 'update_disaster', 'stop_disaster', 'clear_disaster_effects', 'set_city_name', 'set_city_money', 'set_city_configuration', 'set_city_policy', 'set_transport_line_schedule', 'set_transport_line_ticket_price', 'set_transport_line_vehicle_count', 'set_transport_line_number', 'set_transport_line_unbunching', 'set_transport_stop_name', 'set_transport_facility_name', 'set_transport_facility_active', 'set_transport_facility_policy', 'preview_transport_facility_upgrade', 'preview_transport_facility_upgrade_removal', 'request_transport_line_vehicle', 'cancel_transport_line_vehicle_requests', 'release_transport_line_vehicle', 'preview_map_tile_purchase', 'apply_map_tile_purchase', 'cancel_map_tile_purchase', 'unlock_all_map_tiles', 'place_landscape_objects', 'plant_landscape_pattern', 'move_landscape_object', 'set_tree_state', 'remove_landscape_objects', 'clear_landscape_area', 'create_water_source', 'update_water_source', 'delete_water_source', 'set_pollution_area', 'set_weather_override', 'set_wind', 'set_unlimited_demand', 'set_citizen_attributes', 'set_household_money', 'set_company_profitability', 'set_resource_amount', 'create_citizen', 'set_citizen_name', 'set_citizen_profile', 'set_citizen_household', 'set_citizen_workplace', 'set_citizen_school', 'set_citizen_location', 'set_citizen_health_problem', 'delete_citizen', 'create_household', 'set_household_name', 'set_household_profile', 'set_household_housing', 'set_household_need', 'delete_household', 'create_company', 'set_company_name', 'set_company_financials', 'set_company_workforce', 'set_company_property', 'set_company_trade_cost', 'delete_company', 'request_vehicle_reroute', 'set_vehicle_target', 'set_vehicle_behavior', 'remove_vehicle', 'request_traveler_reroute', 'set_traveler_target', 'set_traveler_speed', 'request_citizen_trip', 'cancel_citizen_trips', 'manage_traffic', 'set_experience_points', 'set_development_points', 'purchase_development_node', 'unlock_prefab', 'unlock_all_progression', 'preview_road', 'preview_road_route', 'preview_road_ring', 'preview_road_grid', 'preview_road_parallel', 'preview_road_interchange', 'preview_road_autoroute', 'preview_road_reverse', 'preview_road_batch_reverse', 'preview_road_upgrade', 'preview_road_demolition', 'preview_road_batch_upgrade', 'preview_road_batch_demolition', 'preview_road_elevation', 'preview_road_zoning', 'preview_road_features', 'preview_road_parking', 'preview_intersection_control', 'preview_intersection_roundabout', 'preview_intersection_rules', 'preview_road_policies', 'preview_road_undo', 'build_road', 'cancel_road_preview', 'preview_terrain', 'apply_terrain', 'cancel_terrain_preview', 'preview_building_placement', 'preview_special_building_placement', 'preview_building_batch_placement', 'preview_building_move', 'preview_building_replacement', 'preview_building_upgrade', 'preview_building_rebuild', 'preview_building_demolition', 'preview_building_upgrade_removal', 'apply_building_operation', 'cancel_building_preview', 'set_building_name', 'set_building_active', 'set_building_policy', 'preview_zoning', 'apply_zoning', 'cancel_zoning_preview', 'preview_district_create', 'preview_district_boundary', 'preview_district_delete', 'apply_district_operation', 'cancel_district_preview', 'set_district_name', 'set_district_policy', 'set_service_districts', 'preview_transport_line', 'preview_transport_line_stops', 'preview_transport_line_delete', 'apply_transport_line_operation', 'cancel_transport_line_preview', 'set_transport_line_name', 'set_transport_line_active', 'set_transport_line_color', 'set_transport_line_policy', 'preview_transport_facility_placement', 'preview_transport_facility_move', 'preview_transport_facility_delete', 'apply_transport_facility_operation', 'cancel_transport_facility_preview', 'preview_transport_track', 'preview_transport_track_delete', 'apply_transport_track_operation', 'cancel_transport_track_preview', 'preview_utility_facility_placement', 'preview_utility_facility_move', 'preview_utility_facility_delete', 'apply_utility_facility_operation', 'cancel_utility_facility_preview', 'preview_utility_network', 'preview_utility_network_upgrade', 'preview_utility_network_delete', 'apply_utility_operation', 'cancel_utility_preview', 'preview_city_service_placement', 'preview_city_service_move', 'preview_city_service_upgrade', 'preview_city_service_upgrade_removal', 'preview_city_service_delete', 'apply_city_service_operation', 'cancel_city_service_preview', 'preview_tax_change', 'preview_service_budget', 'preview_service_fee', 'preview_loan_change', 'apply_economy_operation', 'cancel_economy_preview']);
  mutations.add('deploy_grid_district');
  for (const name of ['plan_building_workflow', 'execute_building_plan', 'cancel_building_plan', 'deploy_building_plans']) mutations.add(name);
  for (const name of ['deploy_service_cluster', 'deploy_industrial_campus', 'deploy_transit_corridor']) mutations.add(name);
  for (const name of ['build_utility_backbone', 'repair_congested_corridor']) mutations.add(name);
  for (const name of ['preview_building_area', 'apply_building_area_operation', 'cancel_building_area_preview']) mutations.add(name);
  mutations.add('connect_utility_facility');
  assert(tools.every(tool => tool.annotations.readOnlyHint === !mutations.has(tool.name)));
  assert.equal(tools.find(tool => tool.name === 'build_road').annotations.destructiveHint, true);
  assert.equal(tools.find(tool => tool.name === 'get_road_operation').annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'apply_disaster_operation').annotations.destructiveHint, true);
  const beforeBadWorkflow = calls;
  for (const request of [
    { name: 'plan_building_workflow', arguments: { request_id: 'workflow-invalid-001', building_prefab: 'Fixture', near: { x: 99999, z: 0 } } },
    { name: 'plan_building_workflow', arguments: { request_id: 'workflow-invalid-002', building_prefab: 'Fixture', near: { x: 0, z: 0 }, search_radius_m: 3001 } },
    { name: 'execute_building_plan', arguments: { request_id: 'workflow-invalid-003', plan_id: 'unknown', max_cost: 1000 } },
    { name: 'deploy_building_plans', arguments: { request_id: 'workflow-invalid-004', buildings: [] } }
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, beforeBadWorkflow, 'Invalid high-level building workflow arguments must not reach the game.');
  const buildingId = 'a'.repeat(32) + ':10:1';
  const areaId = 'b'.repeat(32) + ':11:1';
  const areaBoundary = [{ x: 10, z: 10 }, { x: 50, z: 10 }, { x: 50, z: 50 }, { x: 10, z: 50 }];
  const areaCreate = { request_id: 'area-create-001', mode: 'create', building_id: buildingId, area_prefab: 'Fixture Storage Area', boundary: areaBoundary };
  assert.deepEqual((await client.callTool({ name: 'preview_building_area', arguments: areaCreate })).structuredContent.data.args, areaCreate);
  const areaBoundaryChange = { request_id: 'area-boundary-001', mode: 'boundary', area_id: areaId, boundary: areaBoundary };
  assert.deepEqual((await client.callTool({ name: 'preview_building_area', arguments: areaBoundaryChange })).structuredContent.data.args, areaBoundaryChange);
  const areaDelete = { request_id: 'area-delete-001', mode: 'delete', area_id: areaId };
  assert.deepEqual((await client.callTool({ name: 'preview_building_area', arguments: areaDelete })).structuredContent.data.args, areaDelete);
  const areaApply = { operation_id: 'c'.repeat(32), request_id: 'area-apply-001', max_cost: 10000 };
  assert.deepEqual((await client.callTool({ name: 'apply_building_area_operation', arguments: areaApply })).structuredContent.data.args, areaApply);
  const beforeBadArea = calls;
  for (const request of [
    { name: 'preview_building_area', arguments: { request_id: 'area-invalid-001', mode: 'create', building_id: buildingId, area_prefab: 'Fixture', boundary: areaBoundary.slice(0, 2) } },
    { name: 'preview_building_area', arguments: { request_id: 'area-invalid-002', mode: 'create', building_id: buildingId, boundary: areaBoundary } },
    { name: 'preview_building_area', arguments: { request_id: 'area-invalid-003', mode: 'boundary', area_id: areaId } },
    { name: 'preview_building_area', arguments: { request_id: 'area-invalid-004', mode: 'delete', area_id: areaId, boundary: areaBoundary } },
    { name: 'apply_building_area_operation', arguments: { ...areaApply, max_cost: -1 } }
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, beforeBadArea, 'Invalid building-area arguments must not reach the game.');
  const disaster = { request_id: 'disaster-test-001', prefab: 'Fixture Tornado', x: 100, z: 200, phenomenon_radius: 150, hotspot_radius: 50, initial_intensity: 0.5, warning_seconds: 10, duration_seconds: 60 };
  assert.deepEqual((await client.callTool({ name: 'preview_disaster', arguments: disaster })).structuredContent.data.args, disaster);
  const beforeBadDisaster = calls;
  assert.equal((await client.callTool({ name: 'preview_disaster', arguments: { ...disaster, request_id: 'disaster-bad-001', phenomenon_radius: 6000 } })).isError, true);
  assert.equal(calls, beforeBadDisaster, 'Invalid disaster arguments must not reach the game.');
  const result = await client.callTool({ name: 'query_buildings', arguments: { building_type: 'residential', limit: 10 } });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.data.args.limit, 10);
  assert.equal(result.structuredContent.data.args.offset, 0);
  const beforeInvalidQuery = calls;
  const invalid = await client.callTool({ name: 'query_buildings', arguments: { limit: 101 } });
  assert.equal(invalid.isError, true);
  assert.equal(calls, beforeInvalidQuery, 'Invalid arguments must not reach the game.');
  const discovery = await client.callTool({ name: 'list_component_types', arguments: { search: 'Citizen' } });
  assert.equal(discovery.structuredContent.data.args.search, 'Citizen');
  const entityQuery = await client.callTool({ name: 'query_entities', arguments: { category: 'citizens', include_components: ['Game.Citizens.Citizen'] } });
  assert.equal(entityQuery.structuredContent.data.args.category, 'citizens');
  const beforeInvalid = calls;
  for (const request of [
    { name: 'query_entities', arguments: { category: 'invented' } },
    { name: 'query_entities', arguments: { all_components: Array(9).fill('Game.Citizens.Citizen') } },
    { name: 'get_component_schema', arguments: { component: 'System.Reflection.Assembly' } },
    { name: 'get_entity_components', arguments: { entity_id: 'not-an-id' } },
    { name: 'get_city_data', arguments: { buffer_limit: 10000 } }
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, beforeInvalid, 'Invalid discovery/filter/buffer arguments must not reach the game.');
  const road = { request_id: 'route-test-001', road_prefab: 'Fixture Road', start: { x: 10, z: 20 }, end: { x: 100, z: 20 } };
  const preview = await client.callTool({ name: 'preview_road', arguments: road });
  assert.equal(preview.isError, false);
  assert.deepEqual(preview.structuredContent.data.args, road);
  const curvedRoad = { ...road, request_id: 'route-curve-001', start: { x: 10, z: 20, edge_id: 'a'.repeat(32) + ':1:1' }, curve: { mode: 'quadratic', control: { x: 55, z: 60 } } };
  const curvedPreview = await client.callTool({ name: 'preview_road', arguments: curvedRoad });
  assert.equal(curvedPreview.isError, false);
  assert.deepEqual(curvedPreview.structuredContent.data.args, curvedRoad);
  const route = { request_id: 'polyline-test-001', road_prefab: 'Fixture Road', points: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }] };
  const routePreview = await client.callTool({ name: 'preview_road_route', arguments: route });
  assert.equal(routePreview.isError, false);
  assert.deepEqual(routePreview.structuredContent.data.args, route);
  const ring = { request_id: 'route-ring-001', road_prefab: 'Fixture Road', center: { x: 100, z: 200 }, radius_m: 30, direction: 'clockwise' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_ring', arguments: ring })).structuredContent.data.args, ring);
  const grid = { request_id: 'route-grid-001', road_prefab: 'Fixture Road', horizontal_road_prefab: 'Fixture Horizontal', vertical_road_prefab: 'Fixture Vertical', perimeter_road_prefab: 'Fixture Perimeter', auto_connect: true, connection_sides: ['north', 'west'], connection_search_radius_m: 128, connection_road_prefab: 'Fixture Connector', minimum_connections: 1, maximum_connections: 2, origin: { x: 100, z: 200 }, columns: 2, rows: 2, block_width_m: 96, block_height_m: 80 };
  assert.deepEqual((await client.callTool({ name: 'preview_road_grid', arguments: grid })).structuredContent.data.args, grid);
  const parallel = { request_id: 'road-parallel-001', edge_ids: ['a'.repeat(32) + ':1:1', 'b'.repeat(32) + ':2:1'], side: 'left', offset_m: 32, road_prefab: 'Fixture Road', connect_ends: true, connection_road_prefab: 'Fixture Connector' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_parallel', arguments: parallel })).structuredContent.data.args,
    { ...parallel, avoid_obstacles: false, max_offset_m: 128, clearance_m: 4 });
  const autoroute = { request_id: 'route-auto-001', road_prefab: 'Fixture Road', start: { x: 0, z: 0 }, end: { x: 600, z: 100 }, strategy: 'gentle', grid_size_m: 32, max_detour_m: 128, zoning_alignment: true };
  assert.deepEqual((await client.callTool({ name: 'preview_road_autoroute', arguments: autoroute })).structuredContent.data.args, autoroute);
  const edgeIds = ['a'.repeat(32) + ':1:1', 'b'.repeat(32) + ':2:1'];
  const reverse = { request_id: 'road-reverse-001', edge_id: edgeIds[0] };
  assert.deepEqual((await client.callTool({ name: 'preview_road_reverse', arguments: reverse })).structuredContent.data.args, reverse);
  const batchReverse = { request_id: 'batch-reverse-001', edge_ids: edgeIds };
  assert.deepEqual((await client.callTool({ name: 'preview_road_batch_reverse', arguments: batchReverse })).structuredContent.data.args, batchReverse);
  const zoningInspection = await client.callTool({ name: 'inspect_road_zoning', arguments: { edge_ids: edgeIds } });
  assert.deepEqual(zoningInspection.structuredContent.data.args.edge_ids, edgeIds);
  const batchUpgrade = { request_id: 'batch-upgrade-001', edge_ids: edgeIds, road_prefab: 'Fixture Road' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_batch_upgrade', arguments: batchUpgrade })).structuredContent.data.args, batchUpgrade);
  const batchDemolition = { request_id: 'batch-demolish-001', edge_ids: edgeIds };
  assert.deepEqual((await client.callTool({ name: 'preview_road_batch_demolition', arguments: batchDemolition })).structuredContent.data.args, batchDemolition);
  const zoning = { request_id: 'road-zoning-001', edge_ids: edgeIds, left_enabled: false };
  assert.deepEqual((await client.callTool({ name: 'preview_road_zoning', arguments: zoning })).structuredContent.data.args, zoning);
  const features = { request_id: 'fixture-features-001', edge_ids: ['a'.repeat(32) + ':1:1'], left_decoration: 'trees', right_wide_sidewalk: true, median_decoration: 'grass' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_features', arguments: features })).structuredContent.data.args, features);
  const intersection = { request_id: 'intersection-001', node_ids: edgeIds, mode: 'traffic_lights' };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_control', arguments: intersection })).structuredContent.data.args, intersection);
  const roundabout = { request_id: 'fixture-roundabout-001', node_id: 'a'.repeat(32) + ':4:1', enabled: true };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_roundabout', arguments: roundabout })).structuredContent.data.args, roundabout);
  const rules = { request_id: 'rules-test-001', edge_id: edgeIds[0], node_id: edgeIds[1], left_turn: 'forbid', crosswalk_enabled: false };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_rules', arguments: rules })).structuredContent.data.args, rules);
  const commit = { operation_id: 'a'.repeat(32), request_id: 'commit-test-001', max_cost: 5000 };
  const applied = await client.callTool({ name: 'build_road', arguments: commit });
  assert.deepEqual(applied.structuredContent.data.args, commit);
  const beforeBadRoad = calls;
  for (const request of [
    { name: 'preview_road', arguments: { ...road, start: { x: 99999, z: 0 } } },
    { name: 'preview_road', arguments: { ...road, start: { x: 10, z: 20, y: 200 } } },
    { name: 'preview_road', arguments: { ...road, start: { x: 10, z: 20, node_id: 'invented' } } },
    { name: 'preview_road', arguments: { ...road, start: { x: 10, z: 20, node_id: 'a'.repeat(32) + ':1:1', edge_id: 'b'.repeat(32) + ':2:1' } } },
    { name: 'preview_road', arguments: { ...road, curve: { mode: 'quadratic' } } },
    { name: 'preview_road', arguments: { ...road, curve: { mode: 'cubic', control_1: { x: 50, z: 30 }, control_2: { x: 60, z: 30, y: 4 } } } },
    { name: 'preview_road_route', arguments: { request_id: 'bad-route-001', road_prefab: 'Fixture Road', points: [{ x: 0, z: 0 }] } },
    { name: 'preview_road_grid', arguments: { request_id: 'bad-grid-001', road_prefab: 'Fixture Road', origin: { x: 0, z: 0 }, columns: 2, rows: 2, block_width_m: 95, block_height_m: 80 } },
    { name: 'preview_road_batch_upgrade', arguments: { request_id: 'bad-batch-001', edge_ids: [], road_prefab: 'Fixture Road' } },
    { name: 'inspect_road_zoning', arguments: { edge_ids: [] } },
    { name: 'preview_road_batch_demolition', arguments: { request_id: 'bad-batch-002', edge_ids: Array(65).fill('a'.repeat(32) + ':1:1') } },
    { name: 'preview_road', arguments: { ...road, request_id: 'short' } },
    { name: 'build_road', arguments: { operation_id: commit.operation_id, request_id: commit.request_id } },
    { name: 'build_road', arguments: { ...commit, max_cost: -1 } },
    { name: 'get_road_operation', arguments: { operation_id: 'unknown' } }
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, beforeBadRoad, 'Invalid road requests must not reach the game.');
});











