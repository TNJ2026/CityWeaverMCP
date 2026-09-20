// 五边形城市｜只读勘察 2：精确 prefab 目录（服务/公用设施/道路）+ 已购区地形/水域摘要。
// 不修改城市。用法：node pentagon-survey2.mjs > pentagon-survey2.json
import { queryGame } from './bridge-client.mjs';

const call = async (tool, args = {}) => {
  try { return (await queryGame(tool, args))?.data ?? null; } catch (e) { return { __error: e.code ?? 'ERROR', message: e.message }; }
};
const paged = async (tool, base = {}, cap = 2000) => {
  const items = []; let offset = 0;
  for (let i = 0; i < 40; i += 1) {
    const page = await call(tool, { ...base, offset, limit: 100 });
    if (!page || page.__error) return page ?? { items: [] };
    items.push(...(page.items ?? []));
    if (page.next_offset == null || !(page.items ?? []).length || items.length >= cap) break;
    offset = page.next_offset;
  }
  return { total: items.length, items };
};

const out = {};
out.roads = await paged('list_road_prefabs');
out.zones = await call('list_zone_types');
out.buildings = await paged('list_building_prefabs');
out.services = await paged('list_city_service_prefabs');
out.utilityFacilities = await paged('list_utility_facility_prefabs');
out.utilityNetworks = await paged('list_utility_network_prefabs');

// 已购范围（取 16 格并集）
const owned = await paged('list_map_tiles', { state: 'owned' });
out.ownedBounds = owned.items?.length ? {
  min_x: Math.min(...owned.items.map(t => t.bounds.min_x)), max_x: Math.max(...owned.items.map(t => t.bounds.max_x)),
  min_z: Math.min(...owned.items.map(t => t.bounds.min_z)), max_z: Math.max(...owned.items.map(t => t.bounds.max_z)),
} : null;
out.ownedTileCount = owned.items?.length ?? 0;

// 地形采样（在正方形内 9x9 网格）
if (out.ownedBounds) {
  const b = out.ownedBounds; const pts = [];
  for (let i = 0; i < 9; i += 1) for (let j = 0; j < 9; j += 1) {
    pts.push({ x: b.min_x + (i + 0.5) * (b.max_x - b.min_x) / 9, y: 0, z: b.min_z + (j + 0.5) * (b.max_z - b.min_z) / 9 });
  }
  out.terrain = await call('sample_terrain', { points: pts });
}

console.log(JSON.stringify(out));