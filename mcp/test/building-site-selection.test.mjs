import test from 'node:test';
import assert from 'node:assert/strict';
import { rankBuildingSites, siteProfile } from '../building-site-selection.mjs';

const candidates = [0, 100].map(x => ({ position: { x, z: 0 }, score: x }));
const rank = (impacts, overrides = {}) => rankBuildingSites(candidates, impacts, {
  category: 'city_service', prefab: { kind: 'fire' }, radius: 500, ...overrides,
});

test('marginal coverage prefers an underserved area over a crowded already covered area', () => {
  const rows = rank([
    { residential_buildings_in_range: 500, uncovered_residential_buildings: 0, uncovered_households: 0 },
    { residential_buildings_in_range: 20, uncovered_residential_buildings: 20, uncovered_households: 40 },
  ]);
  assert.equal(rows[0].candidate.position.x, 100);
  assert.equal(rows[0].selection.model, 'marginal_residential_coverage_proxy');
});

test('missing or unavailable metrics trigger consistent native fallback for every candidate', () => {
  for (const missing of [null, { unavailable: true }, { residential_buildings_in_range: 1000 }]) {
    const rows = rank([missing, { uncovered_residential_buildings: 9999 }]);
    assert.equal(rows[0].candidate.position.x, 0);
    assert.ok(rows.every(row => row.selection.fallback));
  }
});

test('education subtracts matching total capacity without counting enrolled demand twice', () => {
  const rows = rank([
    { matching_students_in_range: 100, schools: [{ education_level: 1, student_capacity: 100, available_capacity: 0 }] },
    { matching_students_in_range: 80, schools: [{ education_level: 2, student_capacity: 1000, available_capacity: 1000 }] },
  ], { prefab: { kind: 'education', education_level: 1, student_capacity: 50 } });
  assert.equal(rows[0].candidate.position.x, 100);
  assert.equal(rows[0].selection.benefit, Math.log1p(50));
});

test('garbage and sewage favor lower residential exposure', () => {
  for (const [category, kind] of [['city_service', 'garbage'], ['utility_facility', 'sewage']]) {
    const rows = rank([{ residential_buildings_in_range: 100 }, { residential_buildings_in_range: 0 }], { category, prefab: { kind } });
    assert.equal(rows[0].candidate.position.x, 100);
  }
});

test('cargo, depots and utilities without a demand model use engineering constraints', () => {
  assert.equal(siteProfile('transport_facility', { cargo: true }), 'engineering');
  assert.equal(siteProfile('transport_facility', { depot: true }), 'engineering');
  assert.equal(siteProfile('utility_facility', { kind: 'water_pump' }), 'engineering');
});

test('native opt-out and equal scores are deterministic', () => {
  assert.equal(rank([{ uncovered_residential_buildings: 0 }, { uncovered_residential_buildings: 1000 }], { strategy: 'native' })[0].source_index, 0);
  const rows = rankBuildingSites(candidates.map(c => ({ ...c, score: 0 })), [null, null], { category: 'building', prefab: {} });
  assert.deepEqual(rows.map(row => row.source_index), [0, 1]);
});
