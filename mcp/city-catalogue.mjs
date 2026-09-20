// Read the exact live catalogue names needed to author grids and roads, plus confirm the
// snapshot/terrain plumbing the composer will reuse. Read-only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryGame } from './bridge-client.mjs';
import { readPurchasedSurfaceWater } from './planning-water.mjs';
import { readPurchasedTerrain } from './planning-terrain.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const q = async (tool, args = {}) => {
  const r = await queryGame(tool, args);
  if (!r?.ok) throw new Error(`${tool}: ${r?.error?.code} ${r?.error?.message}`);
  return r.data;
};

const paged = async (tool, base = {}, cap = 3000) => {
  const items = []; let offset = 0;
  for (;;) {
    const page = await q(tool, { ...base, offset, limit: 100 });
    items.push(...(page.items ?? []));
    if (page.next_offset == null || items.length >= cap) break;
    offset = page.next_offset;
  }
  return items;
};

const zones = await paged('list_zone_types', { unlocked_only: true });
const roads = await paged('list_road_prefabs');
const services = await paged('list_city_service_prefabs');
const utils = await paged('list_utility_facility_prefabs');

const pick = (list, names) => names.map((n) => list.find((x) => x.name === n)).filter(Boolean);
const report = {
  zoneCandidates: pick(zones, ['EU Residential Low', 'EU Residential Medium', 'EU Residential Medium Row', 'EU Residential High',
    'EU Residential Mixed', 'EU Commercial Low', 'EU Commercial High', 'Office Low', 'Office High', 'Industrial Manufacturing']).map((z) => z.name),
  allZoneNames: zones.map((z) => z.name).sort(),
  roadCandidates: pick(roads, ['Alley', 'Small Road', 'Medium Road', 'Large Road', 'Gravel Road', 'Small Road - Double Sided Parking',
    'Medium Road - Trees', 'Large Road - Trees']).map((r) => ({ name: r.name, width_m: r.width_m, zoning: r.zoning_enabled, highway: r.uses_highway_rules, locked: r.locked })),
  serviceCount: services.length,
  utilityCount: utils.length,
};

// ---- owned extent + terrain/water to choose the flattest buildable core
const tiles = await paged('list_map_tiles', { state: 'all' }, 600);
const purchased = tiles.filter((t) => t.owned).map((t) => ({ tile_id: t.tile_id, owned: true, bounds: t.bounds, center: t.center }));
const bounds = {
  min_x: Math.min(...purchased.map((t) => t.bounds.min_x)), max_x: Math.max(...purchased.map((t) => t.bounds.max_x)),
  min_z: Math.min(...purchased.map((t) => t.bounds.min_z)), max_z: Math.max(...purchased.map((t) => t.bounds.max_z)),
};
const snapshot = await q('get_planning_map_snapshot', { bounds, include_roads: true, include_buildings: true, include_tracks: true, include_utilities: true, max_features_per_layer: 5000 });
snapshot.bounds = bounds; snapshot.map_tiles = tiles; snapshot.purchased_tiles = purchased;
const water = await readPurchasedSurfaceWater(q, purchased, { bounds, cell_size_m: 32 });
const terrain = await readPurchasedTerrain(q, purchased, { bounds, cell_size_m: 32 });
snapshot.waters = water.waters; snapshot.terrain = terrain.terrain;

report.ownedBounds = bounds;
report.existing = { roads: snapshot.roads?.length ?? 0, buildings: snapshot.buildings?.length ?? 0, tracks: snapshot.tracks?.length ?? 0, utilities: snapshot.utilities?.length ?? 0 };
report.water = { polygons: water.waters?.length ?? 0, metadata: water.metadata };
report.terrain = { cells: terrain.terrain?.cells?.length ?? 0, metadata: terrain.metadata,
  height_range: terrain.terrain?.cells?.length
    ? [Math.min(...terrain.terrain.cells.map((c) => c.height_m)), Math.max(...terrain.terrain.cells.map((c) => c.height_m))]
    : null };

console.log(JSON.stringify(report, null, 2));
