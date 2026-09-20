// 五边形城市｜只读勘察：城市配置、已购地图格、现有道路/建筑/水域/地形、可用 prefab 目录。
// 不修改城市。用法：node pentagon-survey.mjs > survey.json
import { queryGame } from './bridge-client.mjs';

const out = {};
const call = async (tool, args = {}) => {
  try {
    const r = await queryGame(tool, args);
    return r?.data ?? r;
  } catch (e) {
    return { __error: e.code ?? 'ERROR', message: e.message };
  }
};

out.status = await call('get_game_status');
out.config = await call('get_city_configuration');
out.overview = await call('get_map_overview');

// ---- 已购地图格（分页）
const owned = [];
let offset = 0;
for (let i = 0; i < 40; i += 1) {
  const page = await call('list_map_tiles', { state: 'owned', offset, limit: 100 });
  if (page.__error) { out.ownedError = page; break; }
  const items = page.items ?? [];
  owned.push(...items);
  if (page.next_offset === null || page.next_offset === undefined || items.length === 0) break;
  offset = page.next_offset;
}
out.ownedTiles = owned;

// ---- 已购范围包围盒
if (owned.length) {
  const xs0 = owned.map((t) => t.bounds.min_x); const xs1 = owned.map((t) => t.bounds.max_x);
  const zs0 = owned.map((t) => t.bounds.min_z); const zs1 = owned.map((t) => t.bounds.max_z);
  out.ownedBounds = { min_x: Math.min(...xs0), max_x: Math.max(...xs1), min_z: Math.min(...zs0), max_z: Math.max(...zs1) };
}

// ---- 现有建成物（只读，限量）
out.existingRoads = await call('get_planning_map_snapshot', { bounds: { min_x: -7168, min_z: -7168, max_x: 7168, max_z: 7168 }, max_features_per_layer: 2000 });
out.buildings = await call('query_buildings', { building_type: 'all', limit: 100 });

// ---- prefab 目录
for (const [key, tool, args] of [
  ['roadPrefabs', 'list_road_prefabs', { limit: 100 }],
  ['zoneTypes', 'list_zone_types', {}],
  ['servicePrefabs', 'list_city_service_prefabs', { kind: 'all', limit: 200 }],
  ['utilityFacilityPrefabs', 'list_utility_facility_prefabs', { type: 'all', limit: 100 }],
  ['utilityNetworkPrefabs', 'list_utility_network_prefabs', { limit: 100 }],
  ['buildingPrefabs', 'list_building_prefabs', { search: '', limit: 100 }],
]) {
  out[key] = await call(tool, args);
}

console.log(JSON.stringify(out));