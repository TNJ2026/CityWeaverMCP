import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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

test('game-view capture is returned as MCP image content without duplicate base64 metadata', async t => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const response = {
    ok: true,
    meta: { session_id: 'capture-fixture' },
    data: { mime_type: 'image/png', width: 640, height: 360, byte_length: png.length, capture_scope: 'game_window_only', base64: png.toString('base64') }
  };
  const { endpointPath } = await fixture(t, (socket, request) => {
    assert.equal(request.tool, 'capture_game_view');
    assert.deepEqual(request.arguments, { include_ui: false, max_width: 640, max_height: 360 });
    socket.end(JSON.stringify(response) + '\n');
  });
  const client = new Client({ name: 'capture-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server.mjs', import.meta.url))], env: { ...process.env, CSII_BRIDGE_FILE: endpointPath, CITYWEAVER_PLANNING_STORE: path.join(path.dirname(endpointPath), "planning-store") } });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'capture_game_view', arguments: { include_ui: false, max_width: 640, max_height: 360 } });
  assert.equal(result.isError, false);
  assert.deepEqual(result.content.find(item => item.type === 'image'), { type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
  assert.equal(result.structuredContent.data.base64, undefined);
  assert.equal(result.structuredContent.data.capture_scope, 'game_window_only');
});

test('real MCP handshake, tool schemas, query forwarding and validation', async t => {
  let calls = 0;
  const { endpointPath } = await fixture(t, (socket, request) => {
    calls++;
    if (request.tool === 'list_map_tiles') {
      socket.end(JSON.stringify({ ok: true, meta: { session_id: 'fixture' }, data: { total: 1, items: [{ tile_id: 'fixture-tile', owned: true, starting_tile: true, purchasable_by_adjacency: false, bounds: { min_x: 0, min_z: 0, max_x: 400, max_z: 400 } }] } }) + '\n');
      return;
    }
    socket.end(JSON.stringify({ ok: true, meta: { session_id: 'fixture' }, data: { tool: request.tool, args: request.arguments } }) + '\n');
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../server.mjs', import.meta.url))], env: { ...process.env, CSII_BRIDGE_FILE: endpointPath, CITYWEAVER_PLANNING_STORE: path.join(path.dirname(endpointPath), "planning-store") } });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 374);
  const cacheInfo = await client.callTool({ name: 'inspect_planning_cache', arguments: {} });
  assert.equal(cacheInfo.isError, false);
  assert.equal(cacheInfo.structuredContent.data.records.entries, 0);
  assert.equal(cacheInfo.structuredContent.data.render.pending, 0);
  assert(tools.some(tool => tool.name === 'get_camera_view'), 'camera viewport query tool is registered');
  assert(tools.some(tool => tool.name === 'capture_game_view'), 'game-window screenshot tool is registered');
  assert(tools.some(tool => tool.name === 'focus_camera'), 'smooth camera focus tool is registered');
  const focus = { target: { x: 120, z: -240 }, width_m: 400, depth_m: 300, duration_seconds: 1 };
  assert.deepEqual((await client.callTool({ name: 'focus_camera', arguments: focus })).structuredContent.data.args, focus);
  assert(tools.some(tool => tool.name === 'get_planning_map_snapshot'), 'planning geometry snapshot tool is registered');
  assert(tools.some(tool => tool.name === 'render_city_plan'), 'static city-plan webpage renderer is registered');
  assert(tools.some(tool => tool.name === 'bind_city_plan_buildings'), 'city-plan building angle and road binder is registered');
  assert(tools.some(tool => tool.name === 'propose_grid_plan'), 'read-only grid-plan proposer is registered');
  assert(tools.some(tool => tool.name === 'propose_city_plan'), 'read-only multilayer city-plan proposer is registered');
  const renderedPlan = await client.callTool({ name: 'render_city_plan', arguments: {
    bounds: { min_x: 0, min_z: 0, max_x: 400, max_z: 400 }, include_existing: false, include_water: false, include_terrain: false,
    plan: { grids: [{ origin: { x: 40, z: 40 }, columns: 2, rows: 3, zone_type: 'Fixture Residential', zone_kind: 'residential', native_preview: { operation_id: 'a'.repeat(32), state: 'preview_ready', cost: 50, warnings: [], errors: [], snapped_origin: { x: 40, z: 40 } } }] }
  } });
  assert.equal(renderedPlan.isError, false);
  assert(!renderedPlan.content.some(item => item.type === 'resource'));
  assert.match(renderedPlan.structuredContent.data.plan_ref, /^plan-[a-f0-9]{64}$/);
  assert.match(await readFile(renderedPlan.structuredContent.data.artifact_path, 'utf8'), /<html/);
  assert.match(renderedPlan.structuredContent.data.plan_id, /^cplan-[a-f0-9]{16}$/);
  assert.equal(renderedPlan.structuredContent.data.native_preview_summary.state, 'preview_ready');
  const interactivePlan = await client.callTool({ name: 'render_city_plan', arguments: {
    bounds: { min_x: 0, min_z: 0, max_x: 400, max_z: 400 }, include_existing: false, include_water: false, include_terrain: false,
    plan: { roads: [{ id: 'fixture-road', label: 'Fixture Road', points: [{ x: 20, z: 20 }, { x: 200, z: 20 }] }] },
    render: { format: 'interactive_html', view: 'combined' }
  } });
  assert.equal(interactivePlan.isError, false);
  assert(!interactivePlan.content.some(item => item.type === 'resource'));
  assert.match(interactivePlan.structuredContent.data.plan_ref, /^plan-[a-f0-9]{64}$/);
  assert.match(await readFile(interactivePlan.structuredContent.data.artifact_path, 'utf8'), /<html/);
  const rerender = await client.callTool({ name: 'render_city_plan', arguments: {
    plan_ref: interactivePlan.structuredContent.data.plan_ref, include_existing: false, include_water: false, include_terrain: false,
    render: { format: 'interactive_html', view: 'combined' }
  } });
  assert.equal(rerender.isError, false);
  assert.equal(rerender.structuredContent.data.plan_id, interactivePlan.structuredContent.data.plan_id);
  const snapshot = await client.callTool({ name: 'capture_planning_snapshot', arguments: { include_existing: false, include_water: false, include_terrain: false } });
  assert.equal(snapshot.isError, false);
  assert.match(snapshot.structuredContent.data.snapshot_ref, /^snapshot-[a-f0-9]{64}$/);
  const reused = await client.callTool({ name: 'render_city_plan', arguments: {
    plan_ref: interactivePlan.structuredContent.data.plan_ref, snapshot_ref: snapshot.structuredContent.data.snapshot_ref,
    include_existing: false, include_water: false, include_terrain: false
  } });
  assert.equal(reused.isError, false);
  const missingLayer = await client.callTool({ name: 'render_city_plan', arguments: {
    plan_ref: interactivePlan.structuredContent.data.plan_ref, snapshot_ref: snapshot.structuredContent.data.snapshot_ref
  } });
  assert.equal(missingLayer.structuredContent.error.code, 'SNAPSHOT_LAYER_MISSING');
  const record = await client.callTool({ name: 'read_planning_record', arguments: { ref: interactivePlan.structuredContent.data.plan_ref, fields: ['plan', 'roads', '0'] } });
  assert.equal(record.structuredContent.data.data.id, 'fixture-road');
  assert.equal(record.structuredContent.data.data.points.type, 'array');
  assert(tools.some(tool => tool.name === 'deploy_grid_district'), 'high-level grid deployment tool is registered');
  const gridDeployment = tools.find(tool => tool.name === 'deploy_grid_district');
  for (const name of ['analyze_education_demand', 'analyze_transport_catchment']) {
    const schema = tools.find(tool => tool.name === name).inputSchema;
    assert.equal(schema.properties.positions.maxItems, 32);
    assert.ok(schema.properties.position, 'single-position callers remain compatible');
  }
  assert(gridDeployment.inputSchema.required.includes('request_id'), 'grid deployment requires a stable workflow request id');
  assert.deepEqual(gridDeployment.inputSchema.properties.approval_mode.enum, ['staged', 'automatic']);
  assert.equal(gridDeployment.inputSchema.properties.approval_mode.default, 'staged');
  assert(gridDeployment.inputSchema.required.includes('road_prefab'), 'grid deployment requires a discovered exact road prefab');
  assert(tools.some(tool => tool.name === 'prepare_grid_native_preview'), 'road-only native grid preflight tool is registered');
  assert(tools.some(tool => tool.name === 'advance_grid_construction'), 'staged post-preview grid construction tool is registered');
  assert(tools.some(tool => tool.name === 'prepare_city_plan_construction'), 'approved rendered-plan compiler is registered');
  assert(tools.some(tool => tool.name === 'advance_city_plan_construction'), 'approved rendered-plan road executor is registered');
  for (const name of ['plan_building_workflow', 'execute_building_plan', 'cancel_building_plan', 'deploy_building_plans']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  for (const name of ['deploy_service_cluster', 'deploy_industrial_campus', 'deploy_transit_corridor']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  const industrialCampus = tools.find(tool => tool.name === 'deploy_industrial_campus');
  assert(industrialCampus.inputSchema.properties.district.required.includes('road_prefab'));
  assert(industrialCampus.inputSchema.properties.district.required.includes('zone_type'));
  for (const name of ['list_building_areas', 'preview_building_area', 'get_building_area_operation', 'apply_building_area_operation', 'cancel_building_area_preview']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  for (const name of ['connect_utility_facility', 'list_utility_connection_points', 'find_compatible_utility_targets']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  const householdProfile = tools.find(tool => tool.name === 'set_household_profile');
  assert.ok(householdProfile.inputSchema.properties.income_last_day, 'household income uses the current game field semantics');
  assert.ok(householdProfile.inputSchema.properties.salary_last_day, 'legacy salary input remains available as a compatibility alias');
  assert.equal(tools.find(tool => tool.name === 'plan_building_workflow').annotations.destructiveHint, false);
  const mutations = new Set(['set_simulation_speed', 'preview_disaster', 'apply_disaster_operation', 'cancel_disaster_preview', 'update_disaster', 'stop_disaster', 'clear_disaster_effects', 'set_city_name', 'set_city_money', 'set_city_configuration', 'set_city_policy', 'set_transport_line_schedule', 'set_transport_line_ticket_price', 'set_transport_line_vehicle_count', 'set_transport_line_number', 'set_transport_line_unbunching', 'set_transport_stop_name', 'set_transport_facility_name', 'set_transport_facility_active', 'set_transport_facility_policy', 'preview_transport_facility_upgrade', 'preview_transport_facility_upgrade_removal', 'request_transport_line_vehicle', 'cancel_transport_line_vehicle_requests', 'release_transport_line_vehicle', 'preview_map_tile_purchase', 'apply_map_tile_purchase', 'cancel_map_tile_purchase', 'unlock_all_map_tiles', 'place_landscape_objects', 'plant_landscape_pattern', 'move_landscape_object', 'set_tree_state', 'remove_landscape_objects', 'clear_landscape_area', 'create_water_source', 'update_water_source', 'delete_water_source', 'set_pollution_area', 'set_weather_override', 'set_wind', 'set_unlimited_demand', 'set_citizen_attributes', 'set_household_money', 'set_company_profitability', 'set_resource_amount', 'create_citizen', 'set_citizen_name', 'set_citizen_profile', 'set_citizen_household', 'set_citizen_workplace', 'set_citizen_school', 'set_citizen_location', 'set_citizen_health_problem', 'delete_citizen', 'create_household', 'set_household_name', 'set_household_profile', 'set_household_housing', 'set_household_need', 'delete_household', 'create_company', 'set_company_name', 'set_company_financials', 'set_company_workforce', 'set_company_property', 'set_company_trade_cost', 'delete_company', 'request_vehicle_reroute', 'set_vehicle_target', 'set_vehicle_behavior', 'remove_vehicle', 'request_traveler_reroute', 'set_traveler_target', 'set_traveler_speed', 'request_citizen_trip', 'cancel_citizen_trips', 'manage_traffic', 'set_experience_points', 'set_development_points', 'purchase_development_node', 'unlock_prefab', 'unlock_all_progression', 'preview_road', 'preview_road_route', 'preview_road_ring', 'preview_road_grid', 'preview_road_parallel', 'preview_road_interchange', 'preview_intersection_prefab', 'preview_road_autoroute', 'preview_road_reverse', 'preview_road_batch_reverse', 'preview_road_upgrade', 'preview_road_demolition', 'preview_road_batch_upgrade', 'preview_road_batch_demolition', 'preview_road_elevation', 'preview_road_zoning', 'preview_road_features', 'preview_road_parking', 'preview_intersection_control', 'preview_intersection_roundabout', 'preview_intersection_rules', 'preview_road_policies', 'preview_road_undo', 'build_road', 'cancel_road_preview', 'preview_terrain', 'apply_terrain', 'cancel_terrain_preview', 'preview_building_placement', 'preview_special_building_placement', 'preview_building_batch_placement', 'preview_building_move', 'preview_building_replacement', 'preview_building_upgrade', 'preview_building_rebuild', 'preview_building_demolition', 'preview_building_upgrade_removal', 'apply_building_operation', 'cancel_building_preview', 'set_building_name', 'set_building_active', 'set_building_policy', 'preview_zoning', 'apply_zoning', 'cancel_zoning_preview', 'preview_district_create', 'preview_district_boundary', 'preview_district_delete', 'apply_district_operation', 'cancel_district_preview', 'set_district_name', 'set_district_policy', 'set_service_districts', 'preview_transport_line', 'preview_transport_line_stops', 'preview_transport_line_delete', 'apply_transport_line_operation', 'cancel_transport_line_preview', 'set_transport_line_name', 'set_transport_line_active', 'set_transport_line_color', 'set_transport_line_policy', 'preview_transport_facility_placement', 'preview_transport_facility_move', 'preview_transport_facility_delete', 'apply_transport_facility_operation', 'cancel_transport_facility_preview', 'preview_transport_track', 'preview_transport_track_delete', 'apply_transport_track_operation', 'cancel_transport_track_preview', 'preview_utility_facility_placement', 'preview_utility_facility_move', 'preview_utility_facility_delete', 'apply_utility_facility_operation', 'cancel_utility_facility_preview', 'preview_utility_network', 'preview_utility_network_upgrade', 'preview_utility_network_delete', 'apply_utility_operation', 'cancel_utility_preview', 'preview_city_service_placement', 'preview_city_service_move', 'preview_city_service_upgrade', 'preview_city_service_upgrade_removal', 'preview_city_service_delete', 'apply_city_service_operation', 'cancel_city_service_preview', 'preview_tax_change', 'preview_service_budget', 'preview_service_fee', 'preview_loan_change', 'apply_economy_operation', 'cancel_economy_preview']);
  mutations.add('deploy_grid_district');
  mutations.add('prepare_grid_native_preview');
  mutations.add('advance_grid_construction');
  mutations.add('advance_city_plan_construction');
  mutations.add('bind_city_plan_buildings');
  for (const name of ['plan_building_workflow', 'execute_building_plan', 'cancel_building_plan', 'deploy_building_plans']) mutations.add(name);
  for (const name of ['deploy_service_cluster', 'deploy_industrial_campus', 'deploy_transit_corridor']) mutations.add(name);
  for (const name of ['build_utility_backbone', 'repair_congested_corridor']) mutations.add(name);
  for (const name of ['preview_building_area', 'apply_building_area_operation', 'cancel_building_area_preview']) mutations.add(name);
  mutations.add('connect_utility_facility');
  mutations.add('focus_camera');
  for (const name of ['preview_road_stop_placement', 'apply_road_stop_operation', 'cancel_road_stop_preview']) mutations.add(name);
  for (const name of ['list_road_stop_prefabs', 'plan_road_stop_site', 'preview_road_stop_placement', 'get_road_stop_operation', 'apply_road_stop_operation', 'cancel_road_stop_preview']) {
    assert(tools.some(tool => tool.name === name), `${name} is registered`);
  }
  const stopSchema = tools.find(tool => tool.name === 'preview_road_stop_placement').inputSchema;
  assert(stopSchema.required.includes('road_edge_id'));
  assert(stopSchema.required.includes('road_side'));
  assert.deepEqual(stopSchema.properties.road_side.enum, ['left', 'right']);
  assert.equal(stopSchema.properties.edge_parameter.minimum, .05);
  assert.equal(stopSchema.properties.edge_parameter.maximum, .95);
  assert.deepEqual(tools.find(tool => tool.name === 'list_road_stop_prefabs').inputSchema.properties.transport_type.enum, ['all', 'Bus', 'Tram']);
  for (const name of ['preview_waterway', 'preview_waterway_delete', 'apply_waterway_operation', 'cancel_waterway_preview']) mutations.add(name);
  assert(tools.every(tool => tool.annotations.readOnlyHint === !mutations.has(tool.name)));
  assert.equal(tools.find(tool => tool.name === 'build_road').annotations.destructiveHint, true);
  assert.equal(tools.find(tool => tool.name === 'get_road_operation').annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'apply_disaster_operation').annotations.destructiveHint, true);
  const beforeBadWorkflow = calls;
  for (const request of [
    { name: 'prepare_grid_native_preview', arguments: { request_id: 'grid-preview-invalid-001', origin: { x: 0, z: 0 }, columns: 2, rows: 3, block_width_m: 95, block_height_m: 96, road_prefab: 'Alley', zone_type: 'NA Residential Low' } },
    { name: 'advance_grid_construction', arguments: { stage: 'commit_roads', request_id: 'grid-advance-invalid-001', max_cost: 1000 } },
    { name: 'plan_building_workflow', arguments: { request_id: 'workflow-invalid-001', building_prefab: 'Fixture', near: { x: 99999, z: 0 } } },
    { name: 'plan_building_workflow', arguments: { request_id: 'workflow-invalid-002', building_prefab: 'Fixture', near: { x: 0, z: 0 }, search_radius_m: 3001 } },
    { name: 'execute_building_plan', arguments: { request_id: 'workflow-invalid-003', plan_id: 'unknown', max_cost: 1000 } },
    { name: 'deploy_building_plans', arguments: { request_id: 'workflow-invalid-004', buildings: [] } }
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.equal(calls, beforeBadWorkflow, 'Invalid high-level building workflow arguments must not reach the game.');
  const buildingId = 'a'.repeat(32) + ':10:1';
  const roadStop = { request_id: 'stop-preview-001', stop_prefab: 'Fixture Bus Shelter', road_edge_id: buildingId, edge_parameter: .6, road_side: 'right' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_stop_placement', arguments: roadStop })).structuredContent.data.args, roadStop);
  const beforeBadStops = calls;
  assert.equal((await client.callTool({ name: 'list_road_stop_prefabs', arguments: { transport_type: 'Train' } })).isError, true);
  for (const args of [{ ...roadStop, road_side: 'either' }, { ...roadStop, edge_parameter: 0 }, { ...roadStop, edge_parameter: 1 }, { ...roadStop, road_edge_id: 'stale' }]) {
    assert.equal((await client.callTool({ name: 'preview_road_stop_placement', arguments: args })).isError, true);
  }
  assert.equal(calls, beforeBadStops, 'Invalid road-stop requests must not reach the game');
  for (const transport_type of ['Bus', 'Tram']) {
    assert.deepEqual((await client.callTool({ name: 'list_road_stop_prefabs', arguments: { transport_type } })).structuredContent.data.args,
      { transport_type, search: '', unlocked_only: true });
  }
  const tramStop = { ...roadStop, request_id: 'tram-preview-001', stop_prefab: 'Fixture Tram Stop' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_stop_placement', arguments: tramStop })).structuredContent.data.args, tramStop);
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
  const bicycleFeatures = { request_id: 'fixture-bicycle-001', edge_ids: edgeIds, left_bicycle_lane: true, right_bicycle_lane: false, left_decoration: 'none' };
  assert.deepEqual((await client.callTool({ name: 'preview_road_features', arguments: bicycleFeatures })).structuredContent.data.args, bicycleFeatures);
  const bothBicycleSides = { request_id: 'fixture-bicycle-002', edge_ids: edgeIds, left_bicycle_lane: true, right_bicycle_lane: true };
  assert.deepEqual((await client.callTool({ name: 'preview_road_features', arguments: bothBicycleSides })).structuredContent.data.args, bothBicycleSides);
  const invalidBicycle = await client.callTool({ name: 'preview_road_features', arguments: { ...bothBicycleSides, left_bicycle_lane: 'true' } });
  assert.equal(invalidBicycle.isError, true);
  const intersection = { request_id: 'intersection-001', node_ids: edgeIds, mode: 'traffic_lights' };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_control', arguments: intersection })).structuredContent.data.args, intersection);
  const roundabout = { request_id: 'fixture-roundabout-001', node_id: 'a'.repeat(32) + ':4:1', enabled: true };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_roundabout', arguments: roundabout })).structuredContent.data.args, roundabout);
  const rules = { request_id: 'rules-test-001', edge_id: edgeIds[0], node_id: edgeIds[1], left_turn: 'forbid', crosswalk_enabled: false };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_rules', arguments: rules })).structuredContent.data.args, rules);
  const commit = { operation_id: 'a'.repeat(32), request_id: 'commit-test-001', max_cost: 5000 };
  const applied = await client.callTool({ name: 'build_road', arguments: commit });
  assert.deepEqual(applied.structuredContent.data.args, commit);
  const facilityId = 'c'.repeat(32) + ':10:1';
  const sideUpgrade = { request_id: 'school-upgrade-side-001', facility_id: facilityId, upgrade_prefab: 'Fixture School Wing', placement_side: 'right', placement_offset_m: 4 };
  assert.deepEqual((await client.callTool({ name: 'preview_city_service_upgrade', arguments: sideUpgrade })).structuredContent.data.args, { ...sideUpgrade, placement_mode: 'owner_side' });
  const defaultSideUpgrade = { request_id: 'school-upgrade-side-002', facility_id: facilityId, upgrade_prefab: 'Fixture Sport Park' };
  assert.deepEqual((await client.callTool({ name: 'preview_city_service_upgrade', arguments: defaultSideUpgrade })).structuredContent.data.args,
    { ...defaultSideUpgrade, placement_mode: 'owner_side', placement_side: 'back', placement_offset_m: 0 });
  const roadsideUpgrade = { request_id: 'school-upgrade-road-001', facility_id: facilityId, upgrade_prefab: 'Fixture Sport Park', placement_mode: 'road_side', position: { x: 120, z: 80 }, rotation_degrees: 90, road_edge_id: 'd'.repeat(32) + ':11:1' };
  assert.deepEqual((await client.callTool({ name: 'preview_city_service_upgrade', arguments: roadsideUpgrade })).structuredContent.data.args,
    { ...roadsideUpgrade, placement_side: 'back', placement_offset_m: 0 });
  const waterwayNames = ['list_waterway_prefabs', 'list_waterways', 'get_waterway', 'preview_waterway', 'preview_waterway_delete', 'get_waterway_operation', 'apply_waterway_operation', 'cancel_waterway_preview'];
  for (const name of waterwayNames) assert(tools.some(tool => tool.name === name), name);
  for (const name of ['preview_waterway', 'preview_waterway_delete', 'apply_waterway_operation', 'cancel_waterway_preview']) assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, false);
  const waterway = { request_id: 'waterway-test-001', waterway_prefab: 'Medium Seaway', points: [{ x: 0, z: 0, node_id: edgeIds[0] }, { x: 160, z: 0, edge_id: edgeIds[1] }] };
  assert.deepEqual((await client.callTool({ name: 'preview_waterway', arguments: waterway })).structuredContent.data.args, { ...waterway, minimum_water_depth_m: 2 });
  const beforeBadWater = calls;
  for (const invalid of [
    { ...waterway, points: [{ x: 0, z: 0, node_id: edgeIds[0], edge_id: edgeIds[1] }, { x: 160, z: 0 }] },
    { ...waterway, points: [{ x: 0, z: 0, elevation_m: -20 }, { x: 160, z: 0 }] },
    { ...waterway, minimum_water_depth_m: 0 },
    { ...waterway, points: [{ x: 0, z: 0 }] }
  ]) assert.equal((await client.callTool({ name: 'preview_waterway', arguments: invalid })).isError, true);
  assert.equal(calls, beforeBadWater, 'Invalid waterway requests must not reach game');
  const waterCommit = { request_id: 'waterway-commit-001', operation_id: 'a'.repeat(32), max_cost: 2000 };
  assert.deepEqual((await client.callTool({ name: 'apply_waterway_operation', arguments: waterCommit })).structuredContent.data.args, waterCommit);
  const curvedTrack = { request_id: 'curved-track-001', track_prefab: 'Double Train Track', points: [{ x: 0, z: 0 }, { x: 150, z: 150 }], curves: [{ mode: 'cubic', control_1: { x: 83, z: 0 }, control_2: { x: 150, z: 67 } }], min_radius_m: 140 };
  assert.deepEqual((await client.callTool({ name: 'preview_transport_track', arguments: curvedTrack })).structuredContent.data.args, curvedTrack);
  for (const invalid of [ { ...curvedTrack, min_radius_m: -1 }, { ...curvedTrack, curves: [{ mode: 'cubic', control_1: { x: 1, z: 1 } }] }, { ...curvedTrack, curves: [{ mode: 'circle' }] } ])
    assert.equal((await client.callTool({ name: 'preview_transport_track', arguments: invalid })).isError, true);
  const beforeBadRoad = calls;
  // Discover and place whole native assets independently of the four-ramp planner.
  const intersectionCatalog = await client.callTool({ name: 'list_intersection_prefabs', arguments: { search: 'Single', offset: 2, limit: 5 } });
  assert.deepEqual(intersectionCatalog.structuredContent.data.args, { search: 'Single', offset: 2, limit: 5 });
  const stamp = { request_id: 'intersection-stamp-001', intersection_prefab: 'Fixture Single Point', position: { x: 816, z: -980 }, rotation_degrees: 90 };
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_prefab', arguments: stamp })).structuredContent.data.args, stamp);
  const { rotation_degrees: omittedAngle, ...defaultStamp } = stamp;
  assert.deepEqual((await client.callTool({ name: 'preview_intersection_prefab', arguments: defaultStamp })).structuredContent.data.args, { ...defaultStamp, rotation_degrees: 0 });
  for (const invalid of [
    { ...stamp, position: { x: 7200, z: 0 } },
    { ...stamp, position: { x: 0, z: 0, y: 500 } },
    { ...stamp, rotation_degrees: 361 },
    { ...stamp, rotation_degrees: '90' },
    { ...stamp, intersection_prefab: '' },
    { ...stamp, request_id: 'short' }
  ]) assert.equal((await client.callTool({ name: 'preview_intersection_prefab', arguments: invalid })).isError, true);
  assert.equal(calls, beforeBadRoad + 3, 'Invalid stamp requests must not reach the game.');
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
  assert.equal((await client.callTool({ name: 'preview_city_service_upgrade', arguments: { ...sideUpgrade, request_id: 'school-upgrade-side-bad', placement_side: 'diagonal' } })).isError, true);
  assert.equal((await client.callTool({ name: 'preview_city_service_upgrade', arguments: { ...sideUpgrade, request_id: 'school-upgrade-offset-bad', placement_offset_m: 513 } })).isError, true);
  assert.equal(calls, beforeBadRoad + 3, 'Invalid road requests must not reach the game.');
});











