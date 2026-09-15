import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 69);
  const mutations = ['set_simulation_speed', 'preview_road', 'preview_road_route', 'preview_road_ring', 'preview_road_autoroute', 'preview_road_grid', 'preview_road_parallel', 'preview_road_interchange', 'preview_road_reverse', 'preview_road_batch_reverse', 'preview_road_upgrade', 'preview_road_demolition', 'preview_road_batch_upgrade', 'preview_road_batch_demolition', 'preview_road_elevation', 'preview_road_zoning', 'preview_road_features', 'preview_road_parking', 'preview_intersection_control', 'preview_intersection_roundabout', 'preview_intersection_rules', 'preview_road_policies', 'preview_road_undo', 'build_road', 'cancel_road_preview', 'preview_terrain', 'apply_terrain', 'cancel_terrain_preview'];
  assert(tools.filter(t => !mutations.includes(t.name)).every(t => t.annotations.readOnlyHint));
  assert(tools.filter(t => mutations.includes(t.name)).every(t => t.annotations.readOnlyHint === false));
  assert.equal(tools.find(t => t.name === 'build_road').annotations.readOnlyHint, false);
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    const value = response.structuredContent || JSON.parse(response.content[0].text);
    assert.equal(response.isError, false, JSON.stringify(value));
    return value;
  };
  const status = await call('get_game_status');
  console.log(JSON.stringify({ status }, null, 2));
  assert.equal(status.data.connected, true, 'Updated game mod must be running.');
  const capabilities = await call('get_query_capabilities');
  assert.equal(capabilities.data.max_page_size, 100);
  if (process.argv.includes('--menu')) {
    assert.equal(status.data.city_loaded, false);
    const response = await client.callTool({ name: 'get_city_summary', arguments: {} });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.error.code, 'CITY_NOT_READY');
    console.log('PASS: MCP initialization, tools, status, capabilities and main-menu rejection.');
  } else {
    assert.equal(status.data.city_loaded, true, 'Load a city before running the live smoke test.');
    const summary = await call('get_city_summary');
    const page = await call('query_buildings', { building_type: 'residential', limit: 10 });
    assert.equal(page.meta.session_id, status.meta.session_id);
    assert(page.data.items.length <= 10);
    if (page.data.items.length) {
      const details = await call('get_entity_details', { entity_id: page.data.items[0].entity_id });
      assert(details.data.component_types.includes('Game.Buildings.Building'));
      assert(details.data.component_types.includes('Game.Buildings.ResidentialProperty'));
    }
    if (page.data.next_offset !== null) {
      const next = await call('query_buildings', { building_type: 'residential', limit: 10, offset: page.data.next_offset, snapshot_id: page.data.snapshot_id });
      assert.equal(next.data.total, page.data.total);
      assert(next.data.items.every(item => !page.data.items.some(old => old.entity_id === item.entity_id)));
    }
    const stale = await client.callTool({ name: 'get_entity_details', arguments: { entity_id: '00000000000000000000000000000000:1:1' } });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.error.code, 'STALE_ENTITY');
    const invalid = await client.callTool({ name: 'query_buildings', arguments: { limit: 101 } });
    assert.equal(invalid.isError, true);
    console.log(JSON.stringify({ summary, residential_buildings: page }, null, 2));
    console.log('PASS: live MCP queries, entity details, pagination, stale-ID rejection and argument validation.');
  }
} finally { await client.close(); }




