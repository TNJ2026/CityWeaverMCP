// Render a live interactive city-plan HTML for a stored structured plan.
// Read-only against the game: reads tiles, roads, buildings, tracks, utilities, water and terrain,
// then renders the plan overlay. Does not pause the city and creates no game entities.
//
// Usage: node mcp/render-live-interactive.mjs <plan.json> <output.html>   (paths relative to the project root)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryGame } from './bridge-client.mjs';
import { renderCityPlanInteractive } from './planning-interactive.mjs';
import { readPurchasedSurfaceWater } from './planning-water.mjs';
import { readPurchasedTerrain } from './planning-terrain.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const planPath = process.argv[2];
const outputPath = process.argv[3];
if (!planPath || !outputPath) throw new Error('Usage: node mcp/render-live-interactive.mjs <plan.json> <output.html>');

const doc = JSON.parse(await readFile(path.resolve(ROOT, planPath), 'utf8'));
const plan = doc.plan;
const renderOptions = { ...(doc.render ?? {}), format: 'static_html' };

const query = async (tool, args = {}) => {
  const response = await queryGame(tool, args);
  if (!response?.ok) throw new Error(`${tool} failed: ${response?.error?.code ?? 'UNKNOWN'} ${response?.error?.message ?? ''}`);
  return response.data;
};

// ---- full-map tile list -> display bounds
const tileData = await query('list_map_tiles', { state: 'all', offset: 0, limit: 529 });
const tiles = (tileData.items ?? []).map((tile) => ({
  tile_id: tile.tile_id, owned: tile.owned, native_locked: tile.native_locked, starting_tile: tile.starting_tile,
  center: tile.center, bounds: tile.bounds, surface_area_m2: tile.surface_area_m2,
  features: tile.features ?? [], neighbor_ids: tile.neighbor_ids ?? [], owned_neighbor_count: tile.owned_neighbor_count,
}));
const bounds = {
  min_x: Math.min(...tiles.map((t) => t.bounds.min_x)), max_x: Math.max(...tiles.map((t) => t.bounds.max_x)),
  min_z: Math.min(...tiles.map((t) => t.bounds.min_z)), max_z: Math.max(...tiles.map((t) => t.bounds.max_z)),
};

// ---- existing geometry
const snapshot = await query('get_planning_map_snapshot', {
  bounds, include_roads: true, include_buildings: true, include_tracks: true, include_utilities: true, max_features_per_layer: 2000,
});
snapshot.bounds = bounds;
snapshot.map_tiles = tiles;
snapshot.purchased_tiles = tiles.filter((t) => t.owned);

// ---- water + terrain (over the purchased tiles only)
const water = await readPurchasedSurfaceWater(query, snapshot.map_tiles, {
  bounds, cell_size_m: doc.water_cell_size_m ?? 32,
});
snapshot.waters = water.waters; snapshot.water_metadata = water.metadata;
const terrain = await readPurchasedTerrain(query, snapshot.map_tiles, {
  bounds, cell_size_m: doc.terrain_cell_size_m ?? 64,
});
snapshot.terrain = terrain.terrain; snapshot.terrain_metadata = terrain.metadata;

// ---- render
renderOptions.planning_bounds = doc.bounds;
renderOptions.bounds = bounds;
renderOptions.include_existing = true;
const rendered = renderCityPlanInteractive(snapshot, plan, renderOptions);

const out = path.resolve(ROOT, outputPath);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, rendered.html);
console.log(JSON.stringify({
  out,
  plan_id: rendered.plan_id,
  expected_plan_id: doc.plan_id,
  plan_id_matches: rendered.plan_id === doc.plan_id,
  html_bytes: Buffer.byteLength(rendered.html, 'utf8'),
  validation: rendered.validation
    ? { valid: rendered.validation.valid, errors: rendered.validation.error_count, warnings: rendered.validation.warning_count }
    : null,
  issue_codes: rendered.validation?.issues?.length
    ? [...new Set(rendered.validation.issues.map((i) => `${i.severity}:${i.code}`))]
    : [],
}, null, 2));
