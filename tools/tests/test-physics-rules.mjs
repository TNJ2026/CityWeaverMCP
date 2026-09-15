import {
  CELL_SIZE,
  OPTIMAL_BLOCK_WIDTH_M,
  snapToCell,
  snapPoint,
  calculateGrade,
  validateRoadSegment,
  subdivideRoute,
  calculateGridFootprint,
  checkAABBOverlap,
  evaluateWindRelationship,
  calculateSafeIndustrialLocation,
  validateDistrictConfig
} from '../lib/physics-rules.mjs';
import fs from 'node:fs';
import path from 'node:path';

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

console.log('=== Running CityWeaver Physics Rules & Math Engine Tests ===\n');

// 1. Grid Snapping
console.log('[Test Suite 1: Discrete Grid Snapping]');
assert(snapToCell(0) === 0, '0 snaps to 0');
assert(snapToCell(4.1) === 8, '4.1 snaps to 8');
assert(snapToCell(3.9) === 0, '3.9 snaps to 0');
assert(snapToCell(93) === 96, '93 snaps to 96');
assert(snapToCell(-1138.4) === -1136, '-1138.4 snaps to -1136');

const pt = snapPoint({ x: -1603.2, y: 512.234, z: 541.1 });
assert(pt.x === -1600 && pt.z === 544 && pt.y === 512.23, '3D point coordinates snap accurately');

// 2. Slope and Road Segment Validation
console.log('\n[Test Suite 2: Slope & Road Physics]');
const pFlat1 = { x: 0, y: 500, z: 0 };
const pFlat2 = { x: 100, y: 500, z: 0 };
const vFlat = validateRoadSegment(pFlat1, pFlat2, 'Small Road');
assert(vFlat.valid === true && vFlat.grade === 0, 'Flat 100m segment is valid with 0% grade');

const pSteep1 = { x: 0, y: 500, z: 0 };
const pSteep2 = { x: 100, y: 525, z: 0 }; // 25m rise over 100m = 25% grade
const vSteep = validateRoadSegment(pSteep1, pSteep2, 'Small Road');
assert(vSteep.valid === false && vSteep.grade === 25, '25% slope is correctly rejected (>15% limit)');

const pShort1 = { x: 0, y: 500, z: 0 };
const pShort2 = { x: 5, y: 500, z: 0 }; // 5m length (< 8m)
const vShort = validateRoadSegment(pShort1, pShort2, 'Small Road');
assert(vShort.valid === false && vShort.reason.includes('ROAD_TOO_SHORT'), '5m road rejected as too short (<8m)');

// 3. Route Subdivision
console.log('\n[Test Suite 3: Route Subdivision]');
const longRoute = [
  { x: 0, y: 500, z: 0 },
  { x: 450, y: 500, z: 0 } // 450m long segment
];
const divided = subdivideRoute(longRoute, 200);
assert(divided.length === 4, '450m route correctly subdivided into 3 segments (4 points <= 200m each)');
assert(divided[1].x === 152 || divided[1].x === 150 || divided[1].x === 152, 'Interpolated intermediate nodes exist');

// 4. Footprint and AABB Collision
console.log('\n[Test Suite 4: Grid Footprint & AABB Collision]');
const fp1 = calculateGridFootprint({ x: 0, z: 0 }, 3, 2, 96, 96);
assert(fp1.width === 288 && fp1.height === 192, '3x2 footprint dimensions calculated accurately (288m x 192m)');
assert(fp1.total_blocks === 6 && fp1.total_area_m2 === 55296, 'Total blocks and area calculated accurately');

const fp2 = calculateGridFootprint({ x: 200, z: 100 }, 2, 2, 96, 96); // overlaps with fp1
const fp3 = calculateGridFootprint({ x: 500, z: 500 }, 2, 2, 96, 96); // disjoint
assert(checkAABBOverlap(fp1, fp2) === true, 'Overlapping footprints detected');
assert(checkAABBOverlap(fp1, fp3) === false, 'Disjoint footprints clear of collision');

// 5. Environmental Wind & Fluid Mechanics
console.log('\n[Test Suite 5: Wind & Fluid Pollution Dynamics]');
const cityCenter = { x: 0, z: 0 };
const windVector = { x: 0.2, z: 0.35 }; // Blowing North-East

const candidateDownwind = { x: 200, z: 350 }; // In the path of wind
const candidateUpwind = { x: -200, z: -350 }; // In reverse direction

const resDown = evaluateWindRelationship(cityCenter, candidateDownwind, windVector);
assert(resDown.is_downwind === true, 'North-East candidate is downwind (D . W > 0)');
assert(resDown.in_danger_cone === true, 'Candidate directly in line with wind is in danger cone');

const resUp = evaluateWindRelationship(cityCenter, candidateUpwind, windVector);
assert(resUp.is_downwind === false, 'South-West candidate is upwind (safe from city air emissions)');
assert(resUp.in_danger_cone === false, 'Upwind candidate outside danger cone');

// Safe industrial siting calculation
const safeInd = calculateSafeIndustrialLocation(cityCenter, windVector, 600, { width: 288, height: 192 });
assert(safeInd.origin.x > 0 && safeInd.origin.z > 0, 'Safe industrial location computed strictly in positive quadrant');
assert(safeInd.origin.x % 8 === 0 && safeInd.origin.z % 8 === 0, 'Industrial origin coordinates aligned to 8m lattice');

// 6. District Configuration Pre-Flight Validator
console.log('\n[Test Suite 6: District Config Validator]');
const goodConfig = {
  origin: { x: -1600, z: 544 },
  columns: 3,
  rows: 2,
  block_width_m: 96,
  block_height_m: 160
};
const valGood = validateDistrictConfig(goodConfig);
assert(valGood.valid === true && valGood.warnings.length === 0, 'Valid 96m config passes with 0 warnings');

const badConfig = {
  origin: { x: -1600, z: 544 },
  columns: 3,
  rows: 2,
  block_width_m: 95, // Not multiple of 8
  block_height_m: 160
};
const valBad = validateDistrictConfig(badConfig);
assert(valBad.valid === false && valBad.errors[0].includes('multiple of 8m'), 'Non-8m block width correctly caught');

// 7. Archetypes Presets Loading
console.log('\n[Test Suite 7: Archetypes Preset File Integrity]');
const presetPath = path.resolve('tools/presets/district-archetypes.json');
assert(fs.existsSync(presetPath), 'Archetypes preset file exists');
const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
assert(Object.keys(presetData.archetypes).length >= 4, 'At least 4 archetypes defined');
assert(presetData.archetypes.residential_suburban_3x2.block_width_m === 96, 'Suburban archetype uses 96m golden standard');

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) process.exit(1);
