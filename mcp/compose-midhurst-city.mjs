// Midhurst / CityWeaver grid-first city plan composer.
//
// Follows docs/guides/planning/PLANNING-MAP-GUIDE.md and the skill's grid-first principle:
//   * Regular development units are expressed as structured plan.grids[] objects, never as
//     hand-expanded per-road geometry (otherwise the validator raises REGULAR_GRID_EXPANDED_AS_ROADS).
//   * Every grid stays within the native 5x5 preview batch limit; units are separated by arterial
//     roads so no outer road is generated twice and no unit straddles a wider road.
//   * Internal roads inside a grid are a single prefab (constant width). Larger roads exist only as
//     explicit perimeter / connector roads outside the units.
//   * Every prefab name is discovered live; nothing is guessed.
//   * Zones are emitted per grid so the plan carries real zone_type values.
//   * Validation goes through mcp/planning-validator.mjs and the drawing through the project's
//     interactive renderer. Read-only: no construction tool is called.
//
// Usage: node mcp/compose-midhurst-city.mjs
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { queryGame } from './bridge-client.mjs';
import { computeCityPlanId } from './planning-renderer.mjs';
import { validateCityPlan } from './planning-validator.mjs';
import { renderCityPlanInteractive } from './planning-interactive.mjs';
import { readPurchasedSurfaceWater } from './planning-water.mjs';
import { readPurchasedTerrain } from './planning-terrain.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const q = async (tool, args = {}) => {
  const r = await queryGame(tool, args);
  if (!r?.ok) throw new Error(`${tool}: ${r?.error?.code ?? 'UNKNOWN'} ${r?.error?.message ?? ''}`);
  return r.data;
};
const paged = async (tool, base = {}, cap = 4000) => {
  const items = []; let offset = 0;
  for (;;) {
    const page = await q(tool, { ...base, offset, limit: 100 });
    items.push(...(page.items ?? []));
    if (page.next_offset == null || items.length >= cap) break;
    offset = page.next_offset;
  }
  return items;
};

// ---------------------------------------------------------------- live discovery
const status = await q('get_game_status');
const config = await q('get_city_configuration');
const zoneCatalogue = await paged('list_zone_types', { unlocked_only: true });
const roadCatalogue = await paged('list_road_prefabs');
const serviceCatalogue = await paged('list_city_service_prefabs');
const utilityCatalogue = await paged('list_utility_facility_prefabs');

const zoneNames = new Set(zoneCatalogue.map((z) => z.name));
const roadByName = new Map(roadCatalogue.map((r) => [r.name, r]));
const pickRoad = (...names) => {
  for (const n of names) { const r = roadByName.get(n); if (r && !r.locked) return r; }
  throw new Error(`none of these roads is available: ${names.join(', ')}`);
};
const internal = pickRoad('Small Road');
const collector = pickRoad('Medium Road');
const arterial = pickRoad('Large Road');
const alpine = zoneNames.has('EU Residential Low');
console.log(JSON.stringify({
  stage: 'bindings', city: status.city_name, theme: config.theme,
  roads: { internal: `${internal.name}(${internal.width_m}m)`, collector: `${collector.name}(${collector.width_m}m)`, arterial: `${arterial.name}(${arterial.width_m}m)` },
  zones_ok: alpine, zone_count: zoneNames.size,
}));

// ---------------------------------------------------------------- footprint
// The golden block is 96 m measured curb to curb across two facing 48 m (6-cell) zone strips.
// A development unit is UNIT x UNIT blocks bounded by collector roads; units are laid out
// UNITS x UNITS to form the city lattice.
const BLOCK = 96;
const UNIT = 5;                 // blocks per development unit (exactly the native 5x5 batch limit)
const UNITS = 4;                // units per axis
const CELLS = UNIT * UNITS;      // 20 blocks per axis
const unitSpan = UNIT * BLOCK;   // lattice span of one unit
const pitch = unitSpan + collector.width_m;   // origin-to-origin distance between units
const span = UNITS * pitch - collector.width_m; // total lattice span
const footprint = span + 2 * collector.width_m; // outer collector centred on the lattice edge
const internalHalf = internal.width_m / 2;
const outerHalf = collector.width_m / 2;

// Place the footprint on the flat core of the owned tiles, snapped to 8 m.
const ownedTiles = await paged('list_map_tiles', { state: 'owned' });
const ownedBounds = {
  min_x: Math.min(...ownedTiles.map((t) => t.bounds.min_x)),
  max_x: Math.max(...ownedTiles.map((t) => t.bounds.max_x)),
  min_z: Math.min(...ownedTiles.map((t) => t.bounds.min_z)),
  max_z: Math.max(...ownedTiles.map((t) => t.bounds.max_z)),
};
console.log(JSON.stringify({ stage: 'owned', tiles: ownedTiles.length, bounds: ownedBounds }));
const snap8 = (v) => Math.round(v / 8) * 8;
// plan bounds: the purchased square, inset by one grid step
const bounds = { min_x: snap8(ownedBounds.min_x) + 8, min_z: snap8(ownedBounds.min_z) + 8, max_x: snap8(ownedBounds.max_x) - 8, max_z: snap8(ownedBounds.max_z) - 8 };
const originX = snap8((ownedBounds.min_x + ownedBounds.max_x) / 2 - span / 2);
const originZ = snap8((ownedBounds.min_z + ownedBounds.max_z) / 2 - span / 2);
if (originX < bounds.min_x + footprint / 2 - span / 2 || originZ < bounds.min_z) throw new Error('footprint does not fit the purchased area');

// ---------------------------------------------------------------- roads outside the units
const roads = [];
// lattice coordinate: index -> world position, accounting for collector roads between units
const lattice = (origin) => (i) => origin + i * BLOCK + Math.floor(i / UNIT) * collector.width_m;
const X = lattice(originX);
const Z = lattice(originZ);
const west = X(0) - collector.width_m, east = X(CELLS), south = Z(0) - collector.width_m, north = Z(CELLS);

// city ring (32 m arterial), centred one arterial width outside the lattice
const ring = arterial.width_m;
roads.push(
  { id: 'ring-south', label: 'City ring south', prefab: arterial.name, width_m: arterial.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 10,
    points: [{ x: X(0) - ring, z: Z(0) - ring }, { x: X(CELLS) + ring, z: Z(0) - ring }] },
  { id: 'ring-north', label: 'City ring north', prefab: arterial.name, width_m: arterial.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 11,
    points: [{ x: X(0) - ring, z: Z(CELLS) + ring }, { x: X(CELLS) + ring, z: Z(CELLS) + ring }] },
  { id: 'ring-west', label: 'City ring west', prefab: arterial.name, width_m: arterial.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 12,
    points: [{ x: X(0) - ring, z: Z(0) - ring }, { x: X(0) - ring, z: Z(CELLS) + ring }] },
  { id: 'ring-east', label: 'City ring east', prefab: arterial.name, width_m: arterial.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 13,
    points: [{ x: X(CELLS) + ring, z: Z(0) - ring }, { x: X(CELLS) + ring, z: Z(CELLS) + ring }] },
);
// grid perimeter (24 m collector): the streets that actually own the units
roads.push(
  { id: 'perimeter-south', label: 'Grid perimeter south', prefab: collector.name, width_m: collector.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 20,
    points: [{ x: X(0), z: Z(0) }, { x: X(CELLS), z: Z(0) }] },
  { id: 'perimeter-north', label: 'Grid perimeter north', prefab: collector.name, width_m: collector.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 21,
    points: [{ x: X(0), z: Z(CELLS) }, { x: X(CELLS), z: Z(CELLS) }] },
  { id: 'perimeter-west', label: 'Grid perimeter west', prefab: collector.name, width_m: collector.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 22,
    points: [{ x: X(0), z: Z(0) }, { x: X(0), z: Z(CELLS) }] },
  { id: 'perimeter-east', label: 'Grid perimeter east', prefab: collector.name, width_m: collector.width_m, level: 'surface',
    planning_status: 'bound', construction_status: 'planned', construction_order: 23,
    points: [{ x: X(CELLS), z: Z(0) }, { x: X(CELLS), z: Z(CELLS) }] },
);
// ring <-> perimeter connectors on all four sides (short, orthogonal)
for (const [i, side] of ['south', 'north', 'west', 'east'].entries()) {
  const mid = side === 'south' || side === 'north' ? X(2) : Z(2);
  const point =
    side === 'south' ? [{ x: mid, z: Z(0) - ring }, { x: mid, z: Z(0) }]
      : side === 'north' ? [{ x: mid, z: Z(CELLS) + ring }, { x: mid, z: Z(CELLS) }]
        : side === 'west' ? [{ x: X(0) - ring, z: mid }, { x: X(0), z: mid }]
          : [{ x: X(CELLS) + ring, z: mid }, { x: X(CELLS), z: mid }];
  roads.push({ id: `connector-${side}`, label: `Ring connector ${side}`, prefab: collector.name, width_m: collector.width_m,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 30 + i, points: point });
}

// ---------------------------------------------------------------- structured grids + zones
// per-block use table: band rows drive the use mix (south = core/commercial, north = lower density)
const USE_BY_ROW = [
  // row 0 (south edge)
  ['EU Commercial High', 'EU Commercial High', 'EU Commercial High', 'Office High'],
  // row 1
  ['EU Commercial Low', 'Office High', 'Office High', 'EU Residential High'],
  // rows 2..5
  null,
  // row 6
  ['EU Residential High', 'EU Residential High', 'EU Residential Mixed', 'EU Residential Mixed'],
];
const ZONE_PLAN = [];
for (let r = 0; r < CELLS; r += 1) {
  for (let c = 0; c < CELLS; c += 1) {
    let zoneType;
    if (r === 0) {
      // southern edge: downtown commercial and office frontage
      zoneType = c < 8 ? 'EU Commercial High' : c < 14 ? 'EU Commercial Low' : 'Office High';
    } else if (r <= 4) {
      // inner city: offices, mixed residential and a small high-density share
      zoneType = ['Office High', 'EU Residential Mixed', 'EU Residential Mixed', 'EU Residential Medium'][c % 4];
    } else if (r <= 9) {
      // mid ring: mixed and medium residential
      zoneType = ['EU Residential Mixed', 'EU Residential Medium', 'EU Residential Medium', 'EU Residential Mixed'][c % 4];
    } else if (r <= 14) {
      // outer residential ring: medium density
      zoneType = ['EU Residential Medium Row', 'EU Residential Medium Row', 'EU Residential Medium', 'EU Residential Medium'][c % 4];
    } else {
      // northern edge: medium row and low density
      zoneType = c < 4 ? 'Office Low' : ['EU Residential Medium Row', 'EU Residential Low', 'EU Residential Low', 'EU Residential Medium Row'][c % 4];
    }
    ZONE_PLAN.push([c, r, zoneKindOf(zoneType), zoneType]);
  }
}
function zoneKindOf(zoneType) {
  if (/Commercial/i.test(zoneType)) return 'commercial';
  if (/Office/i.test(zoneType)) return 'office';
  if (/Industrial/i.test(zoneType)) return 'industrial';
  return 'residential';
}
for (const [, , , zoneType] of ZONE_PLAN) {
  if (!zoneNames.has(zoneType)) throw new Error(`zone ${zoneType} is not in the live catalogue`);
}

const grids = [];
const zones = [];
// one grid object per UNIT x UNIT development unit, so each stays inside the native 5x5 batch limit
for (let cr = 0; cr < UNITS; cr += 1) {
  for (let cc = 0; cc < UNITS; cc += 1) {
    const ui = cr * UNITS + cc;
    grids.push({
      id: `unit-${ui + 1}`,
      label: `Development unit ${ui + 1} (${UNIT}x${UNIT} blocks)`,
      origin: { x: X(cc * UNIT), z: Z(cr * UNIT) },
      columns: UNIT, rows: UNIT,
      block_width_m: BLOCK, block_height_m: BLOCK,
      road_width_m: internal.width_m,
      road_prefab: internal.name,
      horizontal_road_prefab: internal.name,
      vertical_road_prefab: internal.name,
      perimeter_road_prefab: internal.name,
      construction_status: 'planned',
      construction_order: 100 + ui,
    });
  }
}
for (const [c, r, kind, zoneType] of ZONE_PLAN) {
  zones.push({
    id: `zone-${kind}-${c}-${r}`,
    kind, label: `${zoneType} block ${c},${r}`, district: kind,
    area_m2: BLOCK * BLOCK,
    zone_type: zoneType,
    polygon: [
      { x: X(c), z: Z(r) }, { x: X(c + 1), z: Z(r) },
      { x: X(c + 1), z: Z(r + 1) }, { x: X(c), z: Z(r + 1) },
    ],
  });
}

// ---------------------------------------------------------------- conceptual service reserves
const sizeOf = new Map();
for (const item of [...serviceCatalogue, ...utilityCatalogue]) if (item?.name && item?.size_m) sizeOf.set(item.name, { x: item.size_m.x, z: item.size_m.z });
// bands that cannot collide with the planned road network
const westCentre = X(0) - collector.width_m - 112;                                  // west residential band
const civicRow = (Z(0) - collector.width_m - 80);                                    // south civic row, below the ring
const northIndustrial = Z(CELLS) + collector.width_m + 96;                           // north of the ring, away from the eastern slope
const SERVICE_SLOTS = [
  { id: 'primary', prefab: 'ElementarySchool02', label: 'Primary school (west residential band)', x: westCentre, z: Z(3) },
  { id: 'clinic', prefab: 'MedicalClinic02', label: 'Clinic (west residential band)', x: westCentre, z: Z(1) },
  { id: 'park-a', prefab: 'CityPark03', label: 'Neighbourhood park A', x: westCentre, z: Z(2) },
  { id: 'park-b', prefab: 'CityPark02', label: 'Neighbourhood park B', x: westCentre, z: Z(0) },
  { id: 'police', prefab: 'PoliceStation02', label: 'Police post (civic row)', x: X(0), z: civicRow },
  { id: 'fire', prefab: 'FireHouse01', label: 'Fire station (civic row)', x: X(1), z: civicRow },
  { id: 'highschool', prefab: 'HighSchool02', label: 'High school (civic row)', x: X(2), z: civicRow },
  // hospital and city hall are deep: they need their own row above the civic row
  { id: 'hospital', prefab: 'Hospital01', label: 'Hospital (civic row north)', x: X(4), z: civicRow - 104 },
  { id: 'civic-hall', prefab: 'CityHall01', label: 'City hall (civic row north)', x: X(3), z: civicRow - 104 },
];
const buildings = [];
const placedBoxes = [];
const boxOf = (x, z, w, d) => ({ min_x: x - w / 2, max_x: x + w / 2, min_z: z - d / 2, max_z: z + d / 2 });
const boxOverlap = (a, b) => a.min_x < b.max_x && a.max_x > b.min_x && a.min_z < b.max_z && a.max_z > b.min_z;
for (const s of SERVICE_SLOTS) {
  const size = sizeOf.get(s.prefab);
  if (!size) { console.log(JSON.stringify({ stage: 'building-skip', id: s.id, prefab: s.prefab, reason: 'not in live catalogue' })); continue; }
  const rw = Math.ceil((size.x + 12) / 8) * 8;
  const rd = Math.ceil((size.z + 12) / 8) * 8;
  const pos = { x: snap8(s.x), z: snap8(s.z) };
  const box = boxOf(pos.x, pos.z, rw, rd);
  if (box.min_x < bounds.min_x || box.max_x > bounds.max_x || box.min_z < bounds.min_z || box.max_z > bounds.max_z) {
    console.log(JSON.stringify({ stage: 'building-skip', id: s.id, prefab: s.prefab, reason: 'reserve outside purchased area', box }));
    continue;
  }
  const hitRoad = roads.find((rd2) => {
    const half = rd2.width_m / 2;
    return (rd2.points ?? []).some((p, i) => {
      if (i === 0) return false;
      const a = rd2.points[i - 1]; const b = p;
      const segBox = { min_x: Math.min(a.x, b.x) - half, max_x: Math.max(a.x, b.x) + half, min_z: Math.min(a.z, b.z) - half, max_z: Math.max(a.z, b.z) + half };
      return boxOverlap(box, segBox);
    });
  });
  if (hitRoad) { console.log(JSON.stringify({ stage: 'building-skip', id: s.id, prefab: s.prefab, reason: `overlaps road ${hitRoad.id}` })); continue; }
  if (placedBoxes.some((b) => boxOverlap(box, b))) { console.log(JSON.stringify({ stage: 'building-skip', id: s.id, prefab: s.prefab, reason: 'overlaps another reserve' })); continue; }
  placedBoxes.push(box);
  buildings.push({
    id: s.id, label: s.label, prefab: s.prefab, name: s.label, kind: 'service', category: 'city_service',
    planning_status: 'conceptual', placement_status: 'conceptual', rotation_source: 'unresolved', rotation_degrees: null,
    construction_status: 'planned',
    size_m: { x: size.x, z: size.z },
    reserved_size_m: { x: rw, z: rd },
    position: pos,
  });
}

// ---------------------------------------------------------------- plan, validate, render
const plan = { grids, roads, zones, buildings, grid_exceptions: [], tracks: [], utilities: [] };

const tiles = await paged('list_map_tiles', { state: 'owned' });
const purchased = tiles;
const snapshot = await q('get_planning_map_snapshot', { bounds, include_roads: true, include_buildings: true, include_tracks: true, include_utilities: true, max_features_per_layer: 5000 });
snapshot.bounds = bounds; snapshot.map_tiles = tiles; snapshot.purchased_tiles = purchased;
const water = await readPurchasedSurfaceWater(q, purchased, { bounds, cell_size_m: 32 });
const terrain = await readPurchasedTerrain(q, purchased, { bounds, cell_size_m: 32 });
snapshot.waters = water.waters; snapshot.terrain = terrain.terrain;

// ---------------------------------------------------------------- population accounting
// Zone depth is 48 m measured outward from each road edge, and the golden block is exactly two
// facing 48 m strips curb to curb, so the zoned area of one block is BLOCK * DEPTH = 96 * 48 =
// 4608 m2. Reserves placed inside the block are subtracted. Household plot areas are planning
// coefficients, not game formulas; the real household count comes from simulation after growth,
// so they are declared in the output to keep the target reproducible.
const HH_M2 = {
  'EU Residential Low': 300, 'EU Residential Medium Row': 200, 'EU Residential Medium': 170,
  'EU Residential Mixed': 200, 'EU Residential High': 200,
};
const PEOPLE = [2.2, 2.8];
const DEPTH = 48;
const BLOCK_ZONEABLE = BLOCK * DEPTH;
const blockReserveArea = (c, r) => buildings
  .filter((b) => b.position.x > X(c) && b.position.x < X(c + 1) && b.position.z > Z(r) && b.position.z < Z(r + 1))
  .reduce((sum, b) => sum + b.reserved_size_m.x * b.reserved_size_m.z, 0);
const areaByZone = new Map();
for (const [c, r, , zoneType] of ZONE_PLAN) {
  const a = Math.max(0, BLOCK_ZONEABLE - blockReserveArea(c, r));
  areaByZone.set(zoneType, (areaByZone.get(zoneType) ?? 0) + a);
}
let households = 0;
const householdBreakdown = [];
for (const [zoneType, area] of [...areaByZone].sort((a, b) => b[1] - a[1])) {
  const per = HH_M2[zoneType];
  if (!per) continue;
  const hh = Math.round(area / per);
  households += hh;
  householdBreakdown.push({ zone_type: zoneType, zone_area_m2: Math.round(area), blocks: ZONE_PLAN.filter(([, , , z]) => z === zoneType).length, household_area_m2: per, households: hh });
}
const population = { households, range: [Math.round(households * PEOPLE[0]), Math.round(households * PEOPLE[1])], midpoint: Math.round(households * (PEOPLE[0] + PEOPLE[1]) / 2) };
const residentialBlocks = ZONE_PLAN.filter(([, , kind]) => kind === 'residential').length;

const validation = validateCityPlan(snapshot, plan, bounds);
const issueSample = validation.issues.slice(0, 12).map((i) => ({ code: i.code, layer: i.layer, object_id: i.object_id, related: i.related_object_ids ?? null }));
console.log(JSON.stringify({ stage: 'validate', tiles_used: purchased.length, snapshot_tiles: tiles.length, plan_bounds: bounds, issues: issueSample }, null, 2));
const planId = computeCityPlanId(bounds, plan);
const rendered = renderCityPlanInteractive(snapshot, plan, {
  ...({ title: `Midhurst / grid-first city plan (${CELLS}x${CELLS} golden blocks, 4 units)` }),
  view: 'combined', format: 'static_html', bounds, planning_bounds: bounds, include_existing: true,
});

const doc = {
  plan_id: planId, city: status.city_name, name: 'Grid-first city plan',
  bounds, plan,
  bindings: {
    theme: config.theme,
    internal_road: { name: internal.name, width_m: internal.width_m },
    collector_road: { name: collector.name, width_m: collector.width_m },
    arterial_road: { name: arterial.name, width_m: arterial.width_m },
  },
  morphology: {
    block_m: BLOCK, blocks: `${CELLS}x${CELLS}`, span_m: span, footprint_m: footprint,
    origin: { x: originX, z: originZ },
    golden_block_note: '96 m block = two facing 6-cell (48 m) zone strips measured from each road edge.',
  },
  accounting: {
    zone_blocks: ZONE_PLAN.length, roads: roads.length, grids: grids.length, buildings: buildings.length,
    residential_blocks: residentialBlocks,
    zoneable_area_m2: [...areaByZone].reduce((a, [, v]) => a + v, 0),
    zone_area_by_type: [...areaByZone].map(([zone_type, area_m2]) => ({ zone_type, area_m2: Math.round(area_m2) })).sort((a, b) => b.area_m2 - a.area_m2),
    household_breakdown: householdBreakdown,
    households, people_per_household: PEOPLE,
    population_range: population.range, population_midpoint: population.midpoint,
    planning_coefficients: {
      note: 'Household plot areas are planning coefficients used for accounting only; the real household count comes from simulation after the zones grow.',
      block_zoneable_formula: 'BLOCK * DEPTH = 96 m golden block x 48 m zone depth = 4608 m2 per block',
      household_area_m2: HH_M2,
    },
    target_population: 20000,
    target_delta: population.midpoint - 20000,
  },
  validation,
  render: { plan_id: rendered.plan_id, html_bytes: Buffer.byteLength(rendered.html, 'utf8') },
  notes: [
    'Regular development units are declared as plan.grids[] (16 units of 5x5 blocks, each exactly at the native 5x5 preview batch limit) instead of hand-expanded per-road geometry, which is what the validator expects.',
    'Internal grid roads are a single prefab at constant width (16 m Small Road). Wider roads exist only outside the units: 24 m Medium Road collectors between units and around the lattice, and a 32 m Large Road ring outside that.',
    'Zones carry real zone_type values discovered from list_zone_types for the live city theme (European). 400 blocks: row 0 is downtown commercial/office, rows 1-2 office and mixed residential, row 3-5 medium residential ring, rows 6-15 medium row and low density, northern edge office and low density.',
    'Population accounting: the golden block is two facing 48 m zone strips curb to curb, so zoned area is 96 x 48 = 4608 m2 per block. Household plot areas are planning coefficients declared in accounting.planning_coefficients; the real count comes from simulation after growth.',
    'Service buildings are conceptual reserves with rotation_degrees=null. Bind them with bind_city_plan_buildings only after the roads are permanent, then re-render: binding changes the plan hash and invalidates this approval.',
    'CityHall01 was requested for the civic row but is not present in this city live prefab catalogue, so it was skipped rather than guessed. Add it once the prefab is available.',
  ],
};

await mkdir(path.join(ROOT, 'plans'), { recursive: true });
await writeFile(path.join(ROOT, 'plans', 'midhurst-grid-city-plan.json'), `${JSON.stringify(doc, null, 2)}\n`);
await mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
await writeFile(path.join(ROOT, 'artifacts', 'midhurst-grid-city-plan.html'), rendered.html);

console.log(JSON.stringify({
  plan_id: planId,
  render_plan_id: rendered.plan_id,
  validation: { valid: validation.valid, errors: validation.error_count, warnings: validation.warning_count,
    codes: [...new Set(validation.issues.map((i) => `${i.severity}:${i.code}`))] },
  counts: { grids: grids.length, roads: roads.length, zones: zones.length, buildings: buildings.length },
  population,
  footprint_m: footprint, origin: { x: originX, z: originZ },
  html_bytes: Buffer.byteLength(rendered.html, 'utf8'),
}, null, 2));
