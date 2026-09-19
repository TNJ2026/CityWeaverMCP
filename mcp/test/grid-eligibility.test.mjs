import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzePlanGridUsage, buildGridExceptions, classifyNativeGrid, compactEligibleRoadGrids } from '../grid-eligibility.mjs';

const road = (id, prefab, width_m, points, district = 'homes') => ({ id, prefab, width_m, points, district });

function regularRoads() {
  return [
    road('v0', 'Small Road', 16, [{ x: 0, z: 0 }, { x: 0, z: 192 }]),
    road('v1', 'Small Road', 16, [{ x: 96, z: 0 }, { x: 96, z: 192 }]),
    road('v2', 'Small Road', 16, [{ x: 192, z: 0 }, { x: 192, z: 192 }]),
    road('h0', 'Small Road', 16, [{ x: 0, z: 0 }, { x: 192, z: 0 }]),
    road('h1', 'Small Road', 16, [{ x: 0, z: 96 }, { x: 192, z: 96 }]),
    road('h2', 'Small Road', 16, [{ x: 0, z: 192 }, { x: 192, z: 192 }]),
  ];
}

test('recognizes a lossless native grid candidate', () => {
  const result = classifyNativeGrid(regularRoads(), { scopeId: 'homes' });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.suggested_grid.origin, { x: 0, z: 0 });
  assert.equal(result.suggested_grid.columns, 2);
  assert.equal(result.suggested_grid.rows, 2);
  assert.equal(result.suggested_grid.block_width_m, 96);
  assert.equal(result.suggested_grid.block_height_m, 96);
});

test('preserves roads with levels, explicit elevations or permanent attachment anchors', () => {
  for (const [mutate, reason] of [
    [road => { road.level = 'elevated'; }, 'NON_SURFACE_ROAD'],
    [road => { road.level = 'tunnel'; }, 'NON_SURFACE_ROAD'],
    [road => { road.points[0].y = 0; }, 'EXPLICIT_ROAD_ELEVATION'],
    [road => { road.points[0].y = 20; }, 'EXPLICIT_ROAD_ELEVATION'],
    [road => { road.points[0].node_id = 'existing-node'; }, 'EXPLICIT_ROAD_ANCHOR'],
    [road => { road.points[0].edge_id = 'existing-edge'; }, 'EXPLICIT_ROAD_ANCHOR'],
  ]) {
    const roads = regularRoads();
    mutate(roads[0]);
    const classification = classifyNativeGrid(roads);
    assert.equal(classification.eligible, false);
    assert(classification.reason_codes.includes(reason));
    const result = compactEligibleRoadGrids({ roads });
    assert.deepEqual(result.plan.roads, roads);
    assert.equal(result.plan.grids.length, 0);
    assert.equal(result.converted.length, 0);
    assert(!analyzePlanGridUsage({ roads }).issues.some(issue => issue.code === 'REGULAR_GRID_EXPANDED_AS_ROADS'));
  }
});

test('requires eligible explicit lattices to use plan.grids', () => {
  const result = analyzePlanGridUsage({ roads: regularRoads(), grids: [] });
  assert.equal(result.issues[0].code, 'REGULAR_GRID_EXPANDED_AS_ROADS');
  assert.equal(result.issues[0].severity, 'error');
});

test('compacts an eligible explicit lattice into plan.grids without changing unrelated roads', () => {
  const connector = road('connector', 'Medium Road', 24, [{ x: 192, z: 192 }, { x: 320, z: 192 }], 'connector');
  const result = compactEligibleRoadGrids({ roads: [...regularRoads(), connector], grids: [] });
  assert.equal(result.converted.length, 1);
  assert.equal(result.plan.grids.length, 1);
  assert.equal(result.plan.grids[0].district, 'homes');
  assert.deepEqual(result.plan.roads.map(item => item.id), ['connector']);
});

test('records why an irregular lattice cannot use one native grid batch', () => {
  const roads = regularRoads();
  roads.find(item => item.id === 'v1').points = [{ x: 96, z: 0 }, { x: 96, z: 96 }];
  const result = classifyNativeGrid(roads, { scopeId: 'homes' });
  assert.equal(result.eligible, false);
  assert(result.reason_codes.includes('PARTIAL_OR_EXTENDED_VERTICAL_LINE'));
  const exceptions = buildGridExceptions({ roads });
  assert.equal(exceptions[0].scope_id, 'homes');
  assert(exceptions[0].reason_codes.includes('PARTIAL_OR_EXTENDED_VERTICAL_LINE'));
  assert.equal(analyzePlanGridUsage({ roads, grid_exceptions: exceptions }).issues.length, 0);
});

test('rejects mixed internal widths even when coordinates form a rectangle', () => {
  const roads = regularRoads();
  roads.find(item => item.id === 'h1').width_m = 24;
  roads.find(item => item.id === 'h1').prefab = 'Medium Road';
  const result = classifyNativeGrid(roads, { scopeId: 'homes' });
  assert(result.reason_codes.includes('INTERNAL_ROAD_WIDTH_MISMATCH'));
});
