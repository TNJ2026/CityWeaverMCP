import { surveySpace, formatSurveySummary } from '../survey-space.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('=== Running Spatial Survey Engine Live Tests ===\n');

async function runTests() {
  // Test 1: Survey Occupied Area (Residential District)
  console.log('[Test 1: Survey Occupied Footprint (-1600, 544)]');
  const occRes = await surveySpace({
    origin: { x: -1600, z: 544 },
    width_m: 288,
    height_m: 320,
    clearance_m: 0
  });

  assert(occRes.ownership.fully_owned === true, 'Occupied footprint is 100% owned');
  assert(occRes.collisions.building_count > 0, `Detected existing buildings (${occRes.collisions.building_count})`);
  assert(occRes.terrain.min_height > 500, `Live terrain height sampled (>500m, was ${occRes.terrain.min_height}m)`);
  assert(occRes.environment.pollution.air === 0, 'Clean air in residential zone (air == 0)');
  assert(occRes.suitability.verdict === 'BLOCKED', 'Verdict is BLOCKED due to existing buildings');

  // Test 2: Survey Clear Greenfield (-2000, 544)
  console.log('\n[Test 2: Survey Clear Greenfield (-2000, 544)]');
  const clearRes = await surveySpace({
    origin: { x: -2000, z: 544 },
    width_m: 288,
    height_m: 192,
    clearance_m: 16
  });

  assert(clearRes.ownership.fully_owned === true, 'Greenfield is 100% owned');
  assert(clearRes.collisions.building_count === 0, 'Greenfield has 0 building collisions');
  assert(clearRes.terrain.max_grade_percent < 5.0, `Terrain is flat (grade ${clearRes.terrain.max_grade_percent}% < 5%)`);
  assert(clearRes.suitability.residential >= 90, `Residential suitability is high (${clearRes.suitability.residential}/100)`);
  assert(clearRes.suitability.verdict === 'PASS', 'Verdict is PASS (Ready for development)');

  // Test 3: Formatting Test
  console.log('\n[Test 3: Format Survey Output]');
  const summaryStr = formatSurveySummary(clearRes);
  assert(summaryStr.includes('[SPATIAL SURVEY]'), 'Summary includes header');
  assert(summaryStr.includes('READY FOR DEVELOPMENT'), 'Summary shows verdict');
  assert(summaryStr.split('\n').length <= 10, 'Summary is compact (<= 10 lines)');

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
