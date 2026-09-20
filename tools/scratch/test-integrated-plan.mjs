import { buildCircularTownPlan } from './generate-meridian-circular-town.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const baseResult = buildCircularTownPlan();
const basePlan = baseResult.plan;

// Remove old placeholder sub-streets
const subStreetIds = new Set([
  'ind-sub-1', 'ind-sub-2',
  'com-sub-1', 'com-sub-2',
  'res-sw-sub-1', 'res-sw-sub-2',
  'res-nw-sub-1', 'res-nw-sub-2'
]);

const cleanedRoads = basePlan.roads.filter(r => !subStreetIds.has(r.id));

// 5 Grid Districts:
const grids = [
  {
    id: 'grid-industrial-ne',
    name: '东北先进制造工业网格',
    origin: { x: 384, z: 1024 },
    columns: 2,
    rows: 3,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'Industrial Manufacturing',
    zone_kind: 'industrial',
    construction_order: 28,
    construction_status: 'planned'
  },
  {
    id: 'grid-res-medium-nw',
    name: '西北都会中密生活网格',
    origin: { x: -576, z: 1024 },
    columns: 2,
    rows: 3,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'EU Residential Medium',
    zone_kind: 'residential',
    construction_order: 28,
    construction_status: 'planned'
  },
  {
    id: 'grid-res-low-sw',
    name: '西南生态低密花园网格',
    origin: { x: -576, z: 736 },
    columns: 2,
    rows: 3,
    block_width_m: 96,
    block_height_m: 96,
    road_prefab: 'Small Road',
    road_width_m: 16,
    zone_type: 'EU Residential Low',
    zone_kind: 'residential',
    construction_order: 28,
    construction_status: 'planned'
  },
  {
    id: 'grid-commercial-se',
    name: '东南现代商业金融网格',
    origin: { x: 384, z: 832 },
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
  {
    id: 'grid-office-se',
    name: '东南科技总部研发网格',
    origin: { x: 384, z: 736 },
    columns: 2,
    rows: 1,
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

// Adjust building positions to eliminate all collisions
const updatedBuildings = basePlan.buildings.map(b => {
  const item = { ...b };
  if (item.id === 'bld-substation-ne') {
    item.position = { x: 624, z: 1068 };
  } else if (item.id === 'bld-water-pump-ne') {
    item.position = { x: 624, z: 1160 };
  } else if (item.id === 'bld-water-tower-ne') {
    item.position = { x: 432, z: 1264 };
    item.rotation_degrees = 0;
  } else if (item.id === 'bld-bus-terminal-se') {
    item.position = { x: 650, z: 914 };
  } else if (item.id === 'bld-post-office-se') {
    item.position = { x: 640, z: 800 };
    item.rotation_degrees = 270;
  } else if (item.id === 'bld-parking-hall-se') {
    item.position = { x: 640, z: 700 };
    item.rotation_degrees = 270;
  } else if (item.id === 'bld-park-maintenance-se') {
    item.position = { x: 492, z: 650 };
  } else if (item.id === 'bld-elem-school-sw') {
    item.position = { x: -432, z: 880 };
  } else if (item.id === 'bld-clinic-sw') {
    item.position = { x: -432, z: 784 };
  } else if (item.id === 'bld-fire-house-sw') {
    item.position = { x: -432, z: 976 };
  } else if (item.id === 'bld-elem-school-nw') {
    item.position = { x: -640, z: 1220 };
  } else if (item.id === 'bld-police-station-nw') {
    item.position = { x: -432, z: 1072 };
  }
  return item;
});

// Update utility points to match relocated utilities
const updatedUtilities = basePlan.utilities.map(u => {
  const item = { ...u };
  if (item.id === 'util-water-trunk-1') {
    item.points = [{ x: 624, z: 1160 }, { x: 320, z: 1024 }, { x: 0, z: 1024 }];
  } else if (item.id === 'util-power-line-1') {
    item.points = [{ x: 624, z: 1068 }, { x: 320, z: 1024 }, { x: 0, z: 1024 }];
  }
  return item;
});

const testPlan = {
  ...basePlan,
  roads: cleanedRoads,
  grids,
  buildings: updatedBuildings,
  utilities: updatedUtilities
};

const res = validateCityPlan({ bounds: baseResult.bounds }, testPlan, baseResult.bounds);
console.log(`Validation: valid=${res.valid}, errors=${res.error_count}, warnings=${res.warning_count}`);
if (res.issues.length) {
  for (const issue of res.issues) {
    console.log(`[${issue.severity}] ${issue.code} on ${issue.object_id}: ${issue.message} ${JSON.stringify(issue.related_object_ids ?? [])}`);
  }
} else {
  console.log('>>> PERFECT: 0 ERRORS, 0 WARNINGS! <<<');
}
