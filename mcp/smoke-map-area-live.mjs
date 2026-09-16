import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'map-area-live', version: '1.13.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent.data;
};
const errorCode = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, `${name} should fail`);
  return JSON.parse(result.content[0].text).error.code;
};

const report = {};
try {
  const status = await call('get_game_status');
  assert.equal(status.bridge_version, '1.21.2');
  report.overview = await call('get_map_overview');
  const all = await call('list_map_tiles', { state: 'all', limit: 529 });
  const owned = await call('list_map_tiles', { state: 'owned', limit: 529 });
  const unowned = await call('list_map_tiles', { state: 'unowned', limit: 529 });
  const purchasable = await call('list_map_tiles', { state: 'purchasable', limit: 529 });
  assert.equal(all.total, owned.total + unowned.total);
  assert.equal(report.overview.map_tiles.total, all.total);
  assert.equal(report.overview.map_tiles.owned, owned.total);
  assert.equal(report.overview.map_tiles.unowned, unowned.total);
  report.filters = { all: all.total, owned: owned.total, unowned: unowned.total, purchasable: purchasable.total };

  const tile = all.items[Math.floor(all.items.length / 2)];
  report.tile = await call('get_map_tile', { tile_id: tile.tile_id });
  report.neighbors = await call('get_map_tile_neighbors', { tile_id: tile.tile_id });
  const located = await call('find_map_tile_at', { x: tile.center.x, z: tile.center.z });
  assert.equal(located.found, true); assert.equal(located.tile.tile_id, tile.tile_id);
  report.coordinate_lookup = { x: tile.center.x, z: tile.center.z, tile_id: located.tile.tile_id };
  report.features = await call('analyze_map_tile_features', { state: 'all', limit: 10 });
  report.buildable = {
    all: await call('analyze_buildable_area', { state: 'all' }),
    owned: await call('analyze_buildable_area', { state: 'owned' }),
    unowned: await call('analyze_buildable_area', { state: 'unowned' })
  };
  report.districts = await call('list_districts');
  report.zones = await call('list_zone_types', { unlocked_only: false });
  report.terrain = await call('sample_terrain', { points: [{ x: tile.center.x, z: tile.center.z }] });

  report.running_rejection = await errorCode('unlock_all_map_tiles', { confirm_irreversible: true });
  assert.equal(report.running_rejection, 'CITY_MUST_BE_PAUSED');
  await call('set_simulation_speed', { speed: 'paused' });
  if (owned.items.length) {
    report.owned_purchase_rejection = await errorCode('preview_map_tile_purchase', { request_id: `owned-reject-${Date.now()}`, tile_ids: [owned.items[0].tile_id] });
    assert.equal(report.owned_purchase_rejection, 'MAP_TILE_ALREADY_OWNED');
  }
  report.unlock_all = await call('unlock_all_map_tiles', { confirm_irreversible: true });
  const after = await call('get_map_overview');
  assert.equal(after.map_tiles.unowned, 0);
  assert.equal(report.unlock_all.owned_after, after.map_tiles.owned);
  await call('set_simulation_speed', { speed: 'normal' });
  report.final_status = await call('get_game_status');
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await call('set_simulation_speed', { speed: 'normal' }); } catch {}
  await client.close();
}
