import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { queryGame } from './bridge-client.mjs';
import { renderCityPlan } from './planning-renderer.mjs';
import { renderCityPlanInteractive } from './planning-interactive.mjs';
import { proposeGridPlan } from './planning-proposer.mjs';
import { bindGridProposal } from './planning-binder.mjs';
import { readPurchasedSurfaceWater } from './planning-water.mjs';
import { readPurchasedTerrain } from './planning-terrain.mjs';

const outputPath = process.argv[2];
const svgOutputPath = process.argv[3]?.startsWith('--') ? null : process.argv[3];
const includeGridProposal = process.argv.includes('--propose-grid');
const planArgumentIndex = process.argv.indexOf('--plan');
const importedPlanPath = planArgumentIndex >= 0 ? process.argv[planArgumentIndex + 1] : null;
if (!outputPath) {
  throw new Error('Usage: node render-live-plan.mjs <output.html> [output.svg] [--plan plan.json] [--propose-grid]');
}
if (planArgumentIndex >= 0 && !importedPlanPath) throw new Error('--plan requires a JSON file path.');

async function query(tool, args = {}) {
  const response = await queryGame(tool, args);
  if (!response?.ok) {
    throw new Error(`${tool} failed: ${response?.error?.code ?? 'UNKNOWN'} ${response?.error?.message ?? ''}`);
  }
  return response.data;
}

async function queryPaged(tool, baseArgs) {
  const items = [];
  let offset = 0;
  let snapshotId;

  for (;;) {
    const data = await query(tool, {
      ...baseArgs,
      offset,
      limit: 100,
      ...(snapshotId ? { snapshot_id: snapshotId } : {}),
    });
    items.push(...(data.items ?? []));
    snapshotId = data.snapshot_id ?? snapshotId;
    if (data.next_offset == null) break;
    offset = data.next_offset;
  }

  return items;
}

function vec(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.z)) return null;
  return { x: value.x, y: Number.isFinite(value.y) ? value.y : 0, z: value.z };
}

function roadWidth(item) {
  const name = `${item.name ?? ''} ${item.prefab ?? ''}`.toLowerCase();
  if (name.includes('highway') || name.includes('高速')) return 16;
  if (name.includes('large') || name.includes('大型')) return 20;
  if (name.includes('medium') || name.includes('中型')) return 13;
  if (name.includes('alley') || name.includes('小巷')) return 5;
  return 8;
}

function buildingKind(item) {
  const values = [...(item.categories ?? []), item.service, item.name, item.prefab]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (values.includes('residential') || values.includes('住宅')) return 'residential';
  if (values.includes('commercial') || values.includes('商业')) return 'commercial';
  if (values.includes('industrial') || values.includes('工业')) return 'industrial';
  if (values.includes('office') || values.includes('办公')) return 'office';
  if (values.includes('power') || values.includes('electricity')) return 'power';
  if (values.includes('water') || values.includes('sewage')) return 'water';
  if (values.includes('school') || values.includes('education')) return 'education';
  if (values.includes('hospital') || values.includes('health')) return 'healthcare';
  if (values.includes('transport')) return 'transport';
  return 'building';
}

function quantile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function deriveBounds(points) {
  const xs = points.map((point) => point.x).sort((a, b) => a - b);
  const zs = points.map((point) => point.z).sort((a, b) => a - b);
  let minX = quantile(xs, 0.01);
  let maxX = quantile(xs, 0.99);
  let minZ = quantile(zs, 0.01);
  let maxZ = quantile(zs, 0.99);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const spanX = Math.max(maxX - minX, 600);
  const spanZ = Math.max(maxZ - minZ, 600);
  minX = centerX - spanX * 0.56;
  maxX = centerX + spanX * 0.56;
  minZ = centerZ - spanZ * 0.56;
  maxZ = centerZ + spanZ * 0.56;
  return { min_x: minX, max_x: maxX, min_z: minZ, max_z: maxZ };
}

function boundsIntersect(left, right) {
  return left.min_x <= right.max_x && left.max_x >= right.min_x && left.min_z <= right.max_z && left.max_z >= right.min_z;
}

function itemBounds(points) {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}

function purchasedBounds(tiles) {
  return {
    min_x: Math.min(...tiles.map((tile) => tile.bounds.min_x)),
    max_x: Math.max(...tiles.map((tile) => tile.bounds.max_x)),
    min_z: Math.min(...tiles.map((tile) => tile.bounds.min_z)),
    max_z: Math.max(...tiles.map((tile) => tile.bounds.max_z)),
  };
}

const status = await query('get_game_status');
const importedPlanDocument = importedPlanPath ? JSON.parse(await readFile(importedPlanPath, 'utf8')) : null;
const [roadEntities, buildingEntities, trackData, utilityData, tileData, roadCatalog, zoneCatalog, cityConfiguration] = await Promise.all([
  queryPaged('query_entities', {
    category: 'roads',
    all_components: ['Game.Net.Edge', 'Game.Net.Curve'],
    include_components: ['Game.Net.Curve', 'Game.Net.Elevation'],
  }),
  queryPaged('query_buildings', { building_type: 'all' }),
  query('list_transport_tracks', { track_type: '' }),
  query('list_utility_networks', { network_type: 'all' }),
  query('list_map_tiles', { state: 'all', offset: 0, limit: 529 }),
  query('list_road_prefabs', { search: '', offset: 0, limit: 100 }),
  query('list_zone_types', { search: '', unlocked_only: true }),
  query('get_city_configuration'),
]);

const mapTiles = tileData.items ?? [];
const purchasedTiles = mapTiles.filter(tile => tile.owned === true);
if (purchasedTiles.length === 0) throw new Error('The live city returned no purchased map tiles.');

const roads = roadEntities.flatMap((item) => {
  const bezier = item.components?.['Game.Net.Curve']?.fields?.m_Bezier;
  const curve = bezier && ['a', 'b', 'c', 'd'].every((key) => vec(bezier[key]))
    ? Object.fromEntries(['a', 'b', 'c', 'd'].map((key) => [key, vec(bezier[key])]))
    : null;
  if (!curve) return [];
  return [{
    id: item.entity_id,
    curve,
    width_m: roadWidth(item),
    elevation_class: 'surface',
    status: 'existing',
  }];
});

const buildings = buildingEntities.flatMap((item) => {
  const position = vec(item.position);
  if (!position) return [];
  return [{
    id: item.entity_id,
    name: item.name,
    prefab_name: item.prefab_name,
    position,
    kind: buildingKind(item),
    status: 'existing',
  }];
});

const tracks = (trackData.items ?? []).flatMap((item) => {
  const start = vec(item.start);
  const end = vec(item.end);
  if (!start || !end) return [];
  const type = String(item.track_type ?? item.type ?? 'rail').toLowerCase();
  return [{
    id: item.entity_id,
    points: [start, end],
    track_type: type,
    elevation_class: type.includes('subway') ? 'underground' : 'surface',
    status: 'existing',
  }];
});

const utilities = (utilityData.items ?? []).flatMap((item) => {
  const start = vec(item.start);
  const end = vec(item.end);
  if (!start || !end) return [];
  const elevation = typeof item.elevation_m === 'object'
    ? Math.min(Number(item.elevation_m?.start), Number(item.elevation_m?.end))
    : Number(item.elevation_m ?? (start.y + end.y) / 2);
  return [{
    id: item.entity_id,
    prefab: item.prefab,
    points: [start, end],
    network_type: String(item.network_type ?? item.type ?? 'utility').toLowerCase(),
    elevation_class: elevation < -2 ? 'underground' : 'surface',
    status: 'existing',
  }];
});

const visibleRoads = roads;
const visibleBuildings = buildings;
const visibleTracks = tracks;
const visibleUtilities = utilities;

const snapshot = {
  session_id: status.session_id,
  city_name: status.city_name,
  bounds: purchasedBounds(mapTiles),
  map_tiles: mapTiles.map((tile) => ({ tile_id: tile.tile_id, bounds: tile.bounds, owned: tile.owned === true, starting_tile: tile.starting_tile === true, purchasable: tile.purchasable_by_adjacency === true })),
  purchased_tiles: purchasedTiles.map((tile) => ({ tile_id: tile.tile_id, bounds: tile.bounds })),
  roads: visibleRoads,
  buildings: visibleBuildings,
  tracks: visibleTracks,
  utilities: visibleUtilities,
};

const surfaceWater = await readPurchasedSurfaceWater(query, snapshot.map_tiles, {
  bounds: snapshot.bounds,
  cell_size_m: importedPlanDocument?.water_cell_size_m ?? 24,
  water_threshold_m: 0.03,
});
snapshot.waters = surfaceWater.waters;
snapshot.water_metadata = surfaceWater.metadata;
const terrain = await readPurchasedTerrain(query, snapshot.map_tiles, {
  bounds: snapshot.bounds,
  cell_size_m: importedPlanDocument?.terrain_cell_size_m ?? 64,
});
snapshot.terrain = terrain.terrain;
snapshot.terrain_metadata = terrain.metadata;

const proposalBounds = purchasedBounds(purchasedTiles);
const proposalSnapshot = { ...snapshot, bounds: proposalBounds };
const proposal = !importedPlanDocument && includeGridProposal ? bindGridProposal(proposeGridPlan(proposalSnapshot, {
  district_kind: 'residential', columns: 2, rows: 3, block_width_m: 96, block_height_m: 96,
  road_width_m: 8, building_clearance_m: 12,
}), {
  road_prefabs: roadCatalog.items ?? [],
  zone_types: zoneCatalog.items ?? [],
}, { district_kind: 'residential', density: 'low', theme_preference: 'auto', city_theme: cityConfiguration.theme }) : null;
const plan = importedPlanDocument?.plan ?? importedPlanDocument ?? proposal?.plan ?? {};
const planningBounds = importedPlanDocument?.bounds ?? proposalBounds;

const renderOptions = {
  bounds: snapshot.bounds,
  planning_bounds: planningBounds,
  width: importedPlanDocument?.render?.width ?? 1800,
  height: importedPlanDocument?.render?.height ?? 1100,
  title: importedPlanDocument?.render?.title ?? (proposal
    ? `${status.city_name ?? '当前城市'}｜北美低密住宅 2×3 网格（只读草案，尚未预览）`
    : `${status.city_name ?? '当前城市'}｜现状基础设施规划图`),
  view: importedPlanDocument?.render?.view ?? 'combined',
  include_existing: true,
  legend: true,
};
const rendered = renderCityPlan(snapshot, plan, renderOptions);
const webpage = renderCityPlanInteractive(snapshot, plan, renderOptions);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, webpage.html, 'utf8');
if (svgOutputPath) {
  await mkdir(path.dirname(svgOutputPath), { recursive: true });
  await writeFile(svgOutputPath, rendered.svg, 'utf8');
}

console.log(JSON.stringify({
  output_path: path.resolve(outputPath),
  svg_output_path: svgOutputPath ? path.resolve(svgOutputPath) : null,
  city_name: status.city_name,
  city_theme: cityConfiguration.theme,
  imported_plan_path: importedPlanPath ? path.resolve(importedPlanPath) : null,
  counts: {
    purchased_tiles: purchasedTiles.length,
    map_tiles: mapTiles.length,
    roads: visibleRoads.length,
    buildings: visibleBuildings.length,
    tracks: visibleTracks.length,
    utilities: visibleUtilities.length,
    water_bodies: snapshot.waters.length,
    terrain_cells: snapshot.terrain?.cells?.length ?? 0,
  },
  bounds: snapshot.bounds,
  plan_id: rendered.plan_id,
  validation: rendered.validation,
  proposal: proposal ? {
    proposal_id: proposal.proposal_id,
    placement: proposal.placement,
    evaluated_candidates: proposal.evaluated_candidates,
    bindings_ready: proposal.bindings_ready,
    bindings: proposal.bindings,
    missing_bindings: proposal.missing_bindings,
    preview_draft: proposal.preview_draft,
  } : null,
}, null, 2));
