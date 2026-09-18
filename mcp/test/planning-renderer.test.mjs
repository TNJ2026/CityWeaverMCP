import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCityPlan } from '../planning-renderer.mjs';
import { renderCityPlanInteractive } from '../planning-interactive.mjs';
import { validateCityPlan } from '../planning-validator.mjs';
import { proposeGridPlan } from '../planning-proposer.mjs';
import { bindGridProposal } from '../planning-binder.mjs';
import { readPurchasedSurfaceWater, vectorizeSurfaceWater } from '../planning-water.mjs';
import { readPurchasedTerrain, terrainCells } from '../planning-terrain.mjs';
import { augmentGridProposal } from '../planning-multilayer.mjs';

test('renders a 2x3 grid with surface and underground infrastructure', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 400, max_z: 400 };
  const result = renderCityPlan({
    session_id: 'fixture-session', bounds, truncated: false,
    roads: [{ id: 'existing-road', width_m: 12, elevation_class: 'surface', curve: { a: { x: 0, z: 20 }, b: { x: 100, z: 20 }, c: { x: 200, z: 20 }, d: { x: 400, z: 20 } } }],
    buildings: [{ id: 'existing-building', kind: 'service', position: { x: 40, z: 60 }, rotation_degrees: 15, size_m: { x: 20, z: 30 } }],
    tracks: [], utilities: []
  }, {
    grids: [{ origin: { x: 80, z: 80 }, columns: 2, rows: 3, block_width_m: 64, block_height_m: 64, road_prefab: 'Fixture Road', zone_type: 'Fixture Residential', zone_kind: 'residential' }],
    buildings: [{ prefab: 'Fixture School', kind: 'service', position: { x: 120, z: 120 }, rotation_degrees: 0, size_m: { x: 32, z: 40 } }],
    utilities: [{ network_type: 'water', level: 'underground', points: [{ x: 80, z: 90 }, { x: 208, z: 90 }] }],
    tracks: [{ track_type: 'subway', level: 'underground', points: [{ x: 90, z: 60 }, { x: 90, z: 300 }] }]
  }, { bounds, width: 1200, height: 800, view: 'surface_and_underground', title: 'Fixture <Plan>' });

  assert.match(result.plan_id, /^cplan-[a-f0-9]{16}$/);
  assert.equal(result.counts.roads, 7);
  assert.equal(result.counts.zones, 6);
  assert.match(result.svg, /^<svg/);
  assert.match(result.svg, /id="surface"/);
  assert.match(result.svg, /id="underground"/);
  assert.match(result.svg, /Fixture &lt;Plan&gt;/);
  assert.match(result.svg, /#2563eb/);
  assert.match(result.svg, /#a855f7/);
  assert.match(result.svg, /#fb7185/);
  assert.match(result.svg, />Fixture School<\/text>/);
  assert.match(result.svg, /公共设施/);
  assert.equal(result.snapshot_session_id, 'fixture-session');
});

test('rejects invalid render bounds', () => {
  assert.throws(() => renderCityPlan({}, {}, { bounds: { min_x: 1, min_z: 0, max_x: 1, max_z: 10 } }), /bounds/i);
});

test('combined view overlays underground infrastructure as dashed lines', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 100, max_z: 100 };
  const result = renderCityPlan({
    bounds,
    purchased_tiles: [{ tile_id: 'owned-1', bounds: { min_x: 0, min_z: 0, max_x: 50, max_z: 100 } }],
    roads: [
      { id: 'surface', elevation_class: 'surface', points: [{ x: 0, z: 20 }, { x: 100, z: 20 }] },
      { id: 'tunnel', elevation_class: 'tunnel', points: [{ x: 0, z: 40 }, { x: 100, z: 40 }] },
    ],
    buildings: [], tracks: [], utilities: [],
  }, {}, { bounds, view: 'combined' });

  assert.match(result.svg, /id="combined"/);
  assert.match(result.svg, /clip-owned-combined/);
  assert.doesNotMatch(result.svg, /id="underground" clip-path/);
  assert.match(result.svg, /stroke-dasharray="5 4"/);
});

test('interactive plan exposes accessible layer filters and selectable objects', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 100, max_z: 100 };
  const result = renderCityPlanInteractive({ bounds, roads: [], buildings: [], tracks: [], utilities: [] }, {
    roads: [{ id: 'planned-road-1', label: '规划支路', level: 'surface', points: [{ x: 10, z: 10 }, { x: 90, z: 10 }] }],
    buildings: [], zones: [], tracks: [], utilities: [], grids: [],
  }, { bounds, view: 'combined', title: '交互规划' });

  assert.equal(result.mime_type, 'text/html');
  assert.doesNotMatch(result.html, /<!doctype|<html|<body/i);
  assert.match(result.html, /data-filter="layer"/);
  assert.match(result.html, /data-layer="roads"/);
  assert.match(result.html, /aria-live="polite"/);
  assert.match(result.html, /规划支路/);
  assert.match(result.html, /几何校验未发现问题/);
});

test('renders native road-preview state, cost, warnings and snapped origin', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 400, max_z: 400 };
  const nativePreview = {
    operation_id: 'a'.repeat(32), state: 'preview_ready', cost: 4321,
    warnings: ['near existing road'], errors: [], snapped_origin: { x: 80, z: 80 },
  };
  const plan = { grids: [{ origin: { x: 80, z: 80 }, columns: 2, rows: 3, block_width_m: 64, block_height_m: 64, zone_kind: 'residential', native_preview: nativePreview }] };
  const rendered = renderCityPlan({ bounds, roads: [], buildings: [], tracks: [], utilities: [] }, plan, { bounds, view: 'combined' });
  const interactive = renderCityPlanInteractive({ bounds, roads: [], buildings: [], tracks: [], utilities: [] }, plan, { bounds, view: 'combined' });

  assert.equal(rendered.native_preview_summary.state, 'preview_ready');
  assert.equal(rendered.native_preview_summary.cost, 4321);
  assert.match(rendered.svg, /data-native-state="preview_ready"/);
  assert.match(rendered.svg, /native-preview-marker/);
  assert.match(rendered.svg, /原生道路预检：preview_ready/);
  assert.match(interactive.html, /费用 4,321/);
  assert.match(interactive.html, /吸附原点 \(80, 80\)/);
  assert.match(interactive.html, /dataset\.nativeWarnings/);
});

test('planning validation reports purchased-area violations and building overlaps', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 200, max_z: 200 };
  const snapshot = { bounds, purchased_tiles: [{ bounds: { min_x: 0, min_z: 0, max_x: 100, max_z: 100 } }] };
  const validation = validateCityPlan(snapshot, {
    roads: [{ id: 'outside-road', points: [{ x: 20, z: 20 }, { x: 120, z: 20 }] }],
    buildings: [
      { id: 'building-a', position: { x: 50, z: 50 }, size_m: { x: 30, z: 30 } },
      { id: 'building-b', position: { x: 55, z: 50 }, size_m: { x: 30, z: 30 } },
    ],
  }, bounds);

  assert.equal(validation.valid, false);
  assert.equal(validation.error_count, 1);
  assert.equal(validation.warning_count, 2);
  assert(validation.issues.some(issue => issue.object_id === 'outside-road' && issue.code === 'OUTSIDE_PURCHASED_AREA'));
  assert(validation.issues.some(issue => issue.object_id === 'building-a' && issue.code === 'PLANNED_BUILDING_OVERLAP'));
});

test('grid proposer selects a purchased, low-conflict site near the road network', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 640, max_z: 640 };
  const snapshot = {
    bounds,
    purchased_tiles: [{ bounds }],
    roads: [{ curve: { a: { x: 0, z: 40 }, b: { x: 200, z: 40 }, c: { x: 400, z: 40 }, d: { x: 640, z: 40 } } }],
    buildings: [{ position: { x: 320, z: 320 }, size_m: { x: 160, z: 160 } }],
  };
  const proposal = proposeGridPlan(snapshot, { district_kind: 'residential', columns: 2, rows: 3, block_width_m: 64, block_height_m: 64 });
  const grid = proposal.plan.grids[0];
  const validation = validateCityPlan(snapshot, proposal.plan, bounds);

  assert.equal(grid.columns, 2);
  assert.equal(grid.rows, 3);
  assert.equal(grid.zone_kind, 'residential');
  assert.equal(proposal.placement.building_conflicts, 0);
  assert.equal(proposal.placement.surface_water_conflicts, 0);
  assert.equal(proposal.construction_ready, false);
  assert.deepEqual(proposal.missing_bindings.sort(), ['road_prefab', 'zone_type']);
  assert.equal(validation.valid, true);
});

test('grid proposer avoids sampled surface water when a dry candidate exists', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 400, max_z: 400 };
  const snapshot = {
    bounds, purchased_tiles: [{ bounds }], roads: [], buildings: [],
    waters: [{ polygons: [[{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 400 }, { x: 0, z: 400 }]] }],
  };
  const proposal = proposeGridPlan(snapshot, { columns: 2, rows: 2, block_width_m: 64, block_height_m: 64, search_step_m: 32 });
  assert.equal(proposal.placement.surface_water_conflicts, 0);
  assert(proposal.plan.grids[0].origin.x >= 200);
});

test('multilayer planner adds access, service, utility and transit concepts without construction bindings', () => {
  const proposal = {
    proposal_id: 'grid-2x3',
    placement: {
      connection_point: { x: 64, z: 64 }, nearest_road_point: { x: 32, z: 64 }, nearest_road_distance_m: 32,
    },
    plan: {
      grids: [{ origin: { x: 64, z: 64 }, columns: 2, rows: 3, block_width_m: 96, block_height_m: 96, road_width_m: 8, road_prefab: 'Alley', zone_kind: 'residential', zone_type: 'NA Residential Low' }],
      roads: [], buildings: [], zones: [], tracks: [], utilities: [],
    },
    construction_ready: false,
  };
  const result = augmentGridProposal(proposal, { district_kind: 'residential', infrastructure_profile: 'complete' });

  assert.equal(result.proposal_type, 'multilayer_city_plan');
  assert.equal(result.plan.roads.length, 1);
  assert.equal(result.plan.buildings.length, 2);
  assert.equal(result.plan.utilities.length, 2);
  assert.equal(result.plan.tracks.length, 1);
  assert.equal(result.plan.tracks[0].track_type, 'subway');
  assert(result.plan.buildings.every(item => item.planning_status === 'conceptual' && !item.prefab));
  assert(result.plan.utilities.some(item => item.network_type === 'water_sewage' && item.level === 'underground'));
  assert.equal(result.construction_ready, false);
});

const bindingCatalogs = {
  road_prefabs: [
    { name: 'Alley', width_m: 8, locked: false, zoning_enabled: true, bridge_prefab: false, structure_type: 'standard', one_way: false, includes_parking: false, uses_highway_rules: false },
    { name: 'Gravel Road', width_m: 8, locked: false, zoning_enabled: true, bridge_prefab: false, structure_type: 'standard', one_way: false, includes_parking: false, uses_highway_rules: false },
  ],
  zone_types: [
    { name: 'EU Residential Low', area_type: 'Residential', office: false, max_height: 20, locked: false },
    { name: 'NA Residential Low', area_type: 'Residential', office: false, max_height: 20, locked: false },
  ],
};

function conceptualGridProposal() {
  return {
    proposal_id: 'fixture-grid',
    plan: { grids: [{ origin: { x: 64, z: 64 }, columns: 2, rows: 3, block_width_m: 96, block_height_m: 96, road_width_m: 8, zone_kind: 'residential' }] },
    placement: { building_conflicts: 0, nearest_road_distance_m: 40 },
    construction_ready: false,
  };
}

test('grid binder selects Alley but leaves an ambiguous residential theme unresolved', () => {
  const result = bindGridProposal(conceptualGridProposal(), bindingCatalogs, {
    district_kind: 'residential', density: 'low', theme_preference: 'auto',
  });

  assert.equal(result.bindings.road.name, 'Alley');
  assert.equal(result.bindings.zone.status, 'ambiguous');
  assert.deepEqual(result.bindings.zone.candidates, ['EU Residential Low', 'NA Residential Low']);
  assert.equal(result.bindings_ready, false);
  assert.deepEqual(result.missing_bindings, ['zone_type']);
  assert.equal(result.preview_draft, null);
});

test('grid binder uses the live city theme before treating EU and NA zones as ambiguous', () => {
  const result = bindGridProposal(conceptualGridProposal(), bindingCatalogs, {
    district_kind: 'residential', density: 'low', theme_preference: 'auto', city_theme: 'North American',
  });

  assert.equal(result.bindings.zone.status, 'bound');
  assert.equal(result.bindings.zone.source, 'city_theme');
  assert.equal(result.bindings.zone.name, 'NA Residential Low');
  assert.equal(result.bindings_ready, true);
  assert.equal(result.preview_draft.zone_type, 'NA Residential Low');
});

test('grid binder emits a schema-compatible preview draft after an exact theme choice', () => {
  const result = bindGridProposal(conceptualGridProposal(), bindingCatalogs, {
    district_kind: 'residential', density: 'low', theme_preference: 'eu',
  });

  assert.equal(result.bindings.road.name, 'Alley');
  assert.equal(result.bindings.zone.name, 'EU Residential Low');
  assert.equal(result.bindings_ready, true);
  assert.equal(result.preview_draft.road_prefab, 'Alley');
  assert.equal(result.preview_draft.zone_type, 'EU Residential Low');
  assert.equal('road_width_m' in result.preview_draft, false);
  assert.equal(result.construction_ready, false);
});

test('surface-water cells become selectable morphology groups', () => {
  const waters = vectorizeSurfaceWater([
    { grid_x: 0, grid_z: 0, x: 5, z: 5, water_depth_m: 1 },
    { grid_x: 1, grid_z: 0, x: 15, z: 5, water_depth_m: 2 },
    { grid_x: 2, grid_z: 0, x: 25, z: 5, water_depth_m: 1.5 },
    { grid_x: 3, grid_z: 0, x: 35, z: 5, water_depth_m: 1 },
    { grid_x: 4, grid_z: 0, x: 45, z: 5, water_depth_m: .5 },
    { grid_x: 5, grid_z: 0, x: 55, z: 5, water_depth_m: .5 },
    { grid_x: 6, grid_z: 0, x: 65, z: 5, water_depth_m: .5 },
    { grid_x: 7, grid_z: 0, x: 75, z: 5, water_depth_m: .5 },
  ], 10);
  assert.equal(waters.length, 1);
  assert.equal(waters[0].kind, 'linear_water');
  assert(waters[0].area_m2 > 700 && waters[0].area_m2 < 900);
  assert.equal(waters[0].polygons.length, 1);
  assert.equal(waters[0].geometry_method, 'marching_squares_depth_interpolation');
  assert(waters[0].shoreline_vertices >= 10);
});

test('surface-water shoreline interpolates native depths and preserves dry islands', () => {
  const cells = [];
  for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) cells.push({
    grid_x: x, grid_z: z, x: x * 10 + 5, z: z * 10 + 5,
    water_depth_m: x === 2 && z === 2 ? 0 : (x === 0 ? 0.06 : 0.12),
  });
  const waters = vectorizeSurfaceWater(cells, 10, { water_threshold_m: 0.03 });
  assert.equal(waters.length, 1);
  assert.equal(waters[0].holes.length, 1);
  assert(waters[0].polygons[0].some(point => Math.abs(point.x % 10) > 0.01));
  assert(waters[0].shoreline_length_m > 0);
});

test('water rendering uses an even-odd path for shoreline islands', () => {
  const bounds = { min_x: 0, min_z: 0, max_x: 100, max_z: 100 };
  const result = renderCityPlan({
    bounds, roads: [], buildings: [], tracks: [], utilities: [],
    waters: [{ id: 'lake', kind: 'open_water', polygons: [[{ x: 10, z: 10 }, { x: 90, z: 10 }, { x: 90, z: 90 }, { x: 10, z: 90 }]], holes: [[{ x: 40, z: 40 }, { x: 60, z: 40 }, { x: 60, z: 60 }, { x: 40, z: 60 }]] }],
  }, {}, { bounds, view: 'surface' });
  assert.match(result.svg, /fill-rule="evenod[d]"/);
  assert.match(result.svg, /data-object-id="lake"/);
});

test('surface-water reader clips wet cells to purchased tiles', async () => {
  const cells = [
    { grid_x: 0, grid_z: 0, x: 5, z: 5, water: true, water_depth_m: 1 },
    { grid_x: 1, grid_z: 0, x: 15, z: 5, water: true, water_depth_m: 1 },
  ];
  const query = async (_tool, args) => ({
    resolution: { x: 2, z: 1 }, world_bounds: { min_x: 0, min_z: 0, max_x: 20, max_z: 10 },
    total_cells: 2, cell_size_m: 10,
    cells: args.limit === 1 ? [cells[0]] : cells.slice(args.offset, args.offset + args.limit),
  });
  const result = await readPurchasedSurfaceWater(query, [{ bounds: { min_x: 0, min_z: 0, max_x: 10, max_z: 10 } }], { cell_size_m: 10 });
  assert.equal(result.metadata.wet_cells, 1);
  assert.equal(result.waters.length, 1);
  assert.equal(result.waters[0].kind, 'small_water');
  assert.equal(result.metadata.geometry_method, 'marching_squares_depth_interpolation');
});

test('surface-water reader adaptively caps very large masks', async () => {
  const requestedSizes = [];
  const query = async (_tool, args) => {
    requestedSizes.push(args.cell_size_m);
    return args.cell_size_m === 2
      ? { resolution: { x: 2000, z: 1000 }, total_cells: 2000000, cell_size_m: 2, cells: [] }
      : { resolution: { x: 1000, z: 500 }, total_cells: 0, cell_size_m: args.cell_size_m, cells: [] };
  };
  const result = await readPurchasedSurfaceWater(query, [], { bounds: { min_x: 0, min_z: 0, max_x: 4000, max_z: 2000 }, cell_size_m: 2, max_sampled_cells: 750000 });
  assert.deepEqual(requestedSizes, [2, 4]);
  assert.equal(result.metadata.adaptive_resolution, true);
  assert.equal(result.metadata.cell_size_m, 4);
});

test('terrain sampling classifies slope from native heights', () => {
  const cells = terrainCells([
    { x: 0, z: 0, height_m: 0 }, { x: 10, z: 0, height_m: 3 },
    { x: 0, z: 10, height_m: 0 }, { x: 10, z: 10, height_m: 3 },
  ], 2, 2, 10, [{ bounds: { min_x: 0, min_z: 0, max_x: 10, max_z: 10 } }], { min_x: 0, min_z: 0, max_x: 10, max_z: 10 });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].kind, 'steep_terrain');
  assert(cells[0].slope_degrees > 12);
});

test('terrain reader pages native samples and returns purchased cells', async () => {
  const query = async (_tool, args) => ({ items: args.points.map(point => ({ ...point, height_m: point.x / 20 })) });
  const result = await readPurchasedTerrain(query, [{ bounds: { min_x: 0, min_z: 0, max_x: 64, max_z: 64 } }], { cell_size_m: 32 });
  assert.equal(result.metadata.sampled_points, 9);
  assert.equal(result.terrain.cells.length, 4);
});
