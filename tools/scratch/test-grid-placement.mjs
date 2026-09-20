import { buildCircularTownPlan } from './generate-meridian-circular-town.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { buildGridExceptions } from '../../mcp/grid-eligibility.mjs';

const baseResult = buildCircularTownPlan();
const basePlan = baseResult.plan;

// Remove the placeholder sub-streets (ind-sub-1, com-sub-1, res-sw-sub-1, res-nw-sub-1, etc.)
const subStreetIds = new Set([
  'ind-sub-1', 'ind-sub-2',
  'com-sub-1', 'com-sub-2',
  'res-sw-sub-1', 'res-sw-sub-2',
  'res-nw-sub-1', 'res-nw-sub-2'
]);

const roadsWithoutSubStreets = basePlan.roads.filter(r => !subStreetIds.has(r.id));

// Define the 5 Grid Districts requested by user:
// 1. Residential Medium (NW quadrant)
// 2. Residential Low (SW quadrant)
// 3. Commercial High (SE quadrant)
// 4. Office High (SE quadrant)
// 5. Industrial Manufacturing (NE quadrant)

const candidateGrids = [
  // 1. NE Industrial: 2x2 grid
  {
    id: 'grid-industrial-ne',
    name: '东北先进制造网格街区',
    origin: { x: 384, z: 1120 },
    columns: 2,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'Industrial Manufacturing',
    zone_kind: 'industrial',
    construction_order: 28,
    construction_status: 'planned'
  },
  // 2. NW Residential Medium: 2x2 grid
  {
    id: 'grid-res-medium-nw',
    name: '西北都会中密住宅网格街区',
    origin: { x: -576, z: 1120 },
    columns: 2,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'EU Residential Medium',
    zone_kind: 'residential',
    construction_order: 28,
    construction_status: 'planned'
  },
  // 3. SW Residential Low: 2x2 grid
  {
    id: 'grid-res-low-sw',
    name: '西南生态低密独栋网格街区',
    origin: { x: -576, z: 736 },
    columns: 2,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'EU Residential Low',
    zone_kind: 'residential',
    construction_order: 28,
    construction_status: 'planned'
  },
  // 4. SE Commercial High: 2x2 grid
  {
    id: 'grid-commercial-se',
    name: '东南现代高密商业网格街区',
    origin: { x: 384, z: 736 },
    columns: 2,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'EU Commercial High',
    zone_kind: 'commercial',
    construction_order: 28,
    construction_status: 'planned'
  },
  // 5. SE Office High: 2x1 or 2x2 grid
  {
    id: 'grid-office-se',
    name: '东南总部科创办公网格街区',
    origin: { x: 576, z: 736 },
    columns: 1,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'Office High',
    zone_kind: 'office',
    construction_order: 28,
    construction_status: 'planned'
  }
];

const testPlan = {
  ...basePlan,
  roads: roadsWithoutSubStreets,
  grids: candidateGrids
};

const validation = validateCityPlan({ bounds: baseResult.bounds }, testPlan, baseResult.bounds);
console.log(`Validation result: valid=${validation.valid}, errors=${validation.error_count}, warnings=${validation.warning_count}`);
for (const issue of validation.issues) {
  console.log(`[${issue.severity.toUpperCase()}] ${issue.code} on ${issue.object_id}: ${issue.message} ${JSON.stringify(issue.related_object_ids ?? [])}`);
}
