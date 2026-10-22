// 只读渲染「六边形城镇范围」的独立施工图。
// 复用 renderCityPlan / renderCityPlanInteractive，但把渲染 bounds 收窄到六边形外扩边距，
// 使底图只画城镇范围（而非整张 ~14km 已购地图），便于人工审图。
//
// 用法:
//   node tools/render-hexagon-town-sheet.mjs <plan.json> <out.html> [out.svg] [--pad 200]
//
// 仅查询游戏（只读），不执行任何建造。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { queryGame } from '../mcp/bridge-client.mjs';
import { renderCityPlan } from '../mcp/planning-renderer.mjs';
import { renderCityPlanInteractive } from '../mcp/planning-interactive.mjs';
import { readPurchasedSurfaceWater } from '../mcp/planning-water.mjs';
import { readPurchasedTerrain } from '../mcp/planning-terrain.mjs';

const planPath = process.argv[2];
const outputPath = process.argv[3];
const svgOutputPath = process.argv[4]?.startsWith('--') ? null : process.argv[4];
const padIndex = process.argv.indexOf('--pad');
const PAD = padIndex >= 0 ? Number(process.argv[padIndex + 1]) : 200;

if (!planPath || !outputPath) {
  throw new Error('Usage: node render-hexagon-town-sheet.mjs <plan.json> <out.html> [out.svg] [--pad 200]');
}

const planDocument = JSON.parse(await readFile(planPath, 'utf8'));

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
    const data = await query(tool, { ...baseArgs, offset, limit: 100, ...(snapshotId ? { snapshot_id: snapshotId } : {}) });
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
  const values = [...(item.categories ?? []), item.service, item.name, item.prefab].filter(Boolean).join(' ').toLowerCase();
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

function purchasedBounds(tiles) {
  return {
    min_x: Math.min(...tiles.map((tile) => tile.bounds.min_x)),
    max_x: Math.max(...tiles.map((tile) => tile.bounds.max_x)),
    min_z: Math.min(...tiles.map((tile) => tile.bounds.min_z)),
    max_z: Math.max(...tiles.map((tile) => tile.bounds.max_z)),
  };
}

const status = await query('get_game_status');
const [roadEntities, buildingEntities, tileData] = await Promise.all([
  queryPaged('query_entities', {
    category: 'roads',
    all_components: ['Game.Net.Edge', 'Game.Net.Curve'],
    include_components: ['Game.Net.Curve', 'Game.Net.Elevation'],
  }),
  queryPaged('query_buildings', { building_type: 'all' }),
  query('list_map_tiles', { state: 'all', offset: 0, limit: 529 }),
]);

const mapTiles = tileData.items ?? [];
const purchasedTiles = mapTiles.filter((tile) => tile.owned === true);
if (purchasedTiles.length === 0) throw new Error('The live city returned no purchased map tiles.');

const roads = roadEntities.flatMap((item) => {
  const bezier = item.components?.['Game.Net.Curve']?.fields?.m_Bezier;
  const curve = bezier && ['a', 'b', 'c', 'd'].every((key) => vec(bezier[key]))
    ? Object.fromEntries(['a', 'b', 'c', 'd'].map((key) => [key, vec(bezier[key])]))
    : null;
  if (!curve) return [];
  return [{ id: item.entity_id, curve, width_m: roadWidth(item), elevation_class: 'surface', status: 'existing' }];
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

const snapshot = {
  session_id: status.session_id,
  city_name: status.city_name,
  bounds: purchasedBounds(mapTiles),
  map_tiles: mapTiles.map((tile) => ({ tile_id: tile.tile_id, bounds: tile.bounds, owned: tile.owned === true, starting_tile: tile.starting_tile === true, purchasable: tile.purchasable_by_adjacency === true })),
  purchased_tiles: purchasedTiles.map((tile) => ({ tile_id: tile.tile_id, bounds: tile.bounds })),
  roads,
  buildings,
  tracks: [],
  utilities: [],
};

const surfaceWater = await readPurchasedSurfaceWater(query, snapshot.map_tiles, {
  bounds: snapshot.bounds,
  cell_size_m: planDocument.water_cell_size_m ?? 24,
  water_threshold_m: 0.03,
});
snapshot.waters = surfaceWater.waters;
snapshot.water_metadata = surfaceWater.metadata;
const terrain = await readPurchasedTerrain(query, snapshot.map_tiles, {
  bounds: snapshot.bounds,
  cell_size_m: planDocument.terrain_cell_size_m ?? 64,
});
snapshot.terrain = terrain.terrain;
snapshot.terrain_metadata = terrain.metadata;

// —— 收窄渲染范围到六边形外扩边距 ——
const hex = planDocument.geometry?.hexagon;
if (!hex?.vertices?.length) throw new Error('plan.geometry.hexagon.vertices is required to compute the sheet focus.');
const xs = hex.vertices.map((v) => v.x);
const zs = hex.vertices.map((v) => v.z);
const focusBounds = {
  min_x: Math.min(...xs) - PAD,
  max_x: Math.max(...xs) + PAD,
  min_z: Math.min(...zs) - PAD,
  max_z: Math.max(...zs) + PAD,
};
const spanX = focusBounds.max_x - focusBounds.min_x;
const spanZ = focusBounds.max_z - focusBounds.min_z;
const aspect = spanX / spanZ;
const height = 1500;
const width = Math.round(height * aspect);

const plan = planDocument.plan ?? planDocument;
const renderOptions = {
  bounds: focusBounds,
  planning_bounds: focusBounds,
  width,
  height,
  title: planDocument.render?.title ?? planDocument.name ?? '六边形城镇施工图',
  view: 'surface',
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
  focus_bounds: focusBounds,
  canvas: { width, height },
  plan_id: rendered.plan_id,
  validation: rendered.validation,
  counts: rendered.counts,
}, null, 2));
