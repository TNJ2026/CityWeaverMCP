import { queryGame } from './bridge-client.mjs';
import assert from 'node:assert/strict';

async function q(tool, args = {}) { return (await queryGame(tool, args)).data; }
const center = { x: -1400, z: 208 };
let created = [];
let waterSource = null;
try {
  const status = await q('get_game_status');
  assert.equal(status.bridge_version, '1.22.1');
  await q('set_simulation_speed', { speed: 'paused' });
  const trees = await q('list_landscape_prefabs', { kind: 'tree', limit: 100 });
  const plants = await q('list_landscape_prefabs', { kind: 'plant', limit: 100 });
  assert(trees.total > 0 && plants.total > 0);
  const tree = trees.items.find(x => !x.locked && x.name === 'AppleTree01') || trees.items.find(x => !x.locked);
  const plant = plants.items.find(x => !x.locked && x.name === 'FlowerBushCity01') || plants.items.find(x => !x.locked);
  const treeBaseline = (await q('list_landscape_objects', { x: center.x, z: center.z, radius_m: 80, search: tree.name, limit: 100 })).total;

  const placed = await q('place_landscape_objects', {
    prefab: tree.name,
    positions: [{ x: -1420, z: 190 }, { x: -1410, z: 190 }, { x: -1400, z: 190 }],
    rotation_degrees: 25,
    age: .5
  });
  created.push(...placed.object_ids);
  assert.equal(placed.created_count, 3);
  let first = await q('get_landscape_object', { object_id: created[0] });
  assert.equal(first.prefab, tree.name);
  assert.equal(first.tree_state, 'Adult');
  await q('move_landscape_object', { object_id: created[0], position: { x: -1418, z: 194 }, rotation_degrees: 70 });
  first = await q('get_landscape_object', { object_id: created[0] });
  assert.equal(first.position.x, -1418);
  await q('set_tree_state', { object_id: created[0], growth: 42, state: 'teen' });
  first = await q('get_landscape_object', { object_id: created[0] });
  assert.equal(first.growth, 42);
  assert.equal(first.tree_state, 'Teen');

  const pattern = await q('plant_landscape_pattern', {
    prefab: plant.name, center: { x: -1370, z: 225 }, radius_m: 18, count: 8,
    pattern: 'ring', minimum_spacing_m: 4, seed: 1515
  });
  created.push(...pattern.object_ids);
  assert.equal(pattern.created_count, 8);
  const analysis = await q('analyze_landscape_area', { kind: 'all', x: center.x, z: center.z, radius_m: 120 });
  assert(analysis.matched_count >= 11);

  const sourcesBefore = await q('list_water_sources');
  const water = await q('create_water_source', {
    position: { x: -1345, y: 507.2, z: 235 }, radius_m: 10, height_m: 507.2,
    constant_depth: false, multiplier: 0, polluted: 0
  });
  waterSource = water.water_source_id;
  let sources = await q('list_water_sources');
  assert(sources.items.some(x => x.water_source_id === waterSource));
  await q('update_water_source', { water_source_id: waterSource, radius_m: 12, polluted: .2 });
  sources = await q('list_water_sources');
  const changedSource = sources.items.find(x => x.water_source_id === waterSource);
  assert.equal(changedSource.radius_m, 12);
  assert(Math.abs(changedSource.polluted - .2) < .001);
  await q('delete_water_source', { water_source_id: waterSource });
  waterSource = null;
  assert.equal((await q('list_water_sources')).total, sourcesBefore.total);

  const pollutionPoint = { x: -1450, z: 170 };
  const pollutionBefore = (await q('sample_pollution', { points: [pollutionPoint] })).items[0];
  for (const type of ['air', 'ground', 'noise']) {
    const write = await q('set_pollution_area', { type, center: pollutionPoint, radius_m: 90, value: 1234 });
    assert(write.changed_cells > 0);
  }
  const pollutionChanged = (await q('sample_pollution', { points: [pollutionPoint] })).items[0];
  assert(pollutionChanged.air > 0 && pollutionChanged.ground > 0 && pollutionChanged.noise > 0);
  for (const type of ['air', 'ground', 'noise']) await q('set_pollution_area', { type, center: pollutionPoint, radius_m: 90, value: pollutionBefore[type] });

  await q('remove_landscape_objects', { object_ids: created });
  created = [];
  assert.equal((await q('list_landscape_objects', { x: center.x, z: center.z, radius_m: 80, search: tree.name, limit: 100 })).total, treeBaseline);
  await q('set_simulation_speed', { speed: 'normal' });
  console.log(JSON.stringify({ ok: true, report: {
    prefabs: { trees: trees.total, plants: plants.total },
    explicitPlacement: 3, patternPlacement: 8, move: true, treeState: true,
    landscapeAreaCount: analysis.matched_count,
    waterSourceRoundTrip: true,
    pollution: { before: pollutionBefore, changed: pollutionChanged, restored: true },
    cleanup: true
  } }, null, 2));
} finally {
  try { await q('set_simulation_speed', { speed: 'paused' }); } catch {}
  if (created.length) { try { await q('remove_landscape_objects', { object_ids: created }); } catch {} }
  if (waterSource) { try { await q('delete_water_source', { water_source_id: waterSource }); } catch {} }
  try { await q('set_simulation_speed', { speed: 'normal' }); } catch {}
}
