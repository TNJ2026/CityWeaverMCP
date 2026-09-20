import { readFileSync } from 'node:fs';
import { queryGame } from '../../mcp/bridge-client.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { findCompletedPlannedBuildingIds } from '../lib/construction-safety.mjs';

function distanceToPolyline(point, points) {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    if (l2 === 0) { min = Math.min(min, Math.hypot(point.x - a.x, point.z - a.z)); continue; }
    let t = ((point.x - a.x) * (b.x - a.x) + (point.z - a.z) * (b.z - a.z)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) };
    min = Math.min(min, Math.hypot(point.x - proj.x, point.z - proj.z));
  }
  return min;
}

async function main() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const roads = planDoc.plan.roads;
  const roadById = new Map(roads.map(r => [r.id, r]));
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_buildings: true,
    include_roads: false,
    max_features_per_layer: 5000,
  });
  const liveBuildings = snap.data?.buildings ?? [];

  // Building mapping
  const syncedBuildings = [
    // 住宅区
    { id: 'bld-elementary-west', prefab: 'ElementarySchool02', label: '规划小学（西）', size: { x: 71.6, z: 47.6 }, roadside_of: 'res-w6', live_id: '5fda330cf2a149849a42f7b9b9a4a702:59284:7' },
    { id: 'bld-elementary-east', prefab: 'ElementarySchool02', label: '规划小学（东）', size: { x: 71.6, z: 47.6 }, roadside_of: 'res-w6', live_id: '5fda330cf2a149849a42f7b9b9a4a702:299698:33' },
    { id: 'bld-high-school', prefab: 'HighSchool02', label: '规划中学', size: { x: 95.6, z: 63.6 }, roadside_of: 'res-w7', live_id: '5fda330cf2a149849a42f7b9b9a4a702:301289:13' },
    { id: 'bld-park-central', prefab: 'CityPark08', label: '规划西丘公园', size: { x: 63.6, z: 63.6 }, roadside_of: 'res-w7', live_id: '5fda330cf2a149849a42f7b9b9a4a702:302353:3' },
    { id: 'bld-playground-west', prefab: 'Playground04', label: '儿童活动场（西）', size: { x: 31.6, z: 31.6 }, roadside_of: 'res-west-ring', live_id: '5fda330cf2a149849a42f7b9b9a4a702:302411:5' },
    { id: 'bld-playground-east', prefab: 'Playground02', label: '儿童活动场（东）', size: { x: 23.6, z: 31.6 }, roadside_of: 'res-w6', live_id: '5fda330cf2a149849a42f7b9b9a4a702:302911:5' },
    { id: 'bld-clinic', prefab: 'MedicalClinic02', label: '规划社区诊所', size: { x: 39.6, z: 39.6 }, roadside_of: 'res-w3', live_id: '5fda330cf2a149849a42f7b9b9a4a702:303168:3' },
    { id: 'bld-fire-station', prefab: 'FireHouse02', label: '规划消防站', size: { x: 23.6, z: 31.6 }, roadside_of: 'res-local-x2-south', live_id: '5fda330cf2a149849a42f7b9b9a4a702:303215:3' },
    { id: 'bld-police', prefab: 'PoliceStation02', label: '规划警察分局', size: { x: 39.6, z: 39.6 }, roadside_of: 'res-local-x2-south', live_id: '5fda330cf2a149849a42f7b9b9a4a702:303465:3' },
    { id: 'bld-crematorium', prefab: 'Crematorium01', label: '规划殡仪馆', size: { x: 63.6, z: 79.6 }, roadside_of: 'res-w-s2', live_id: '5fda330cf2a149849a42f7b9b9a4a702:303631:5' },
    { id: 'bld-pocket-park-1', prefab: 'PocketPark05', label: '口袋公园 1', size: { x: 15.6, z: 15.6 }, roadside_of: 'res-east-ring', live_id: '5fda330cf2a149849a42f7b9b9a4a702:303638:7' },
    { id: 'bld-pocket-park-2', prefab: 'PocketPark07', label: '口袋公园 2', size: { x: 31.6, z: 7.6 }, roadside_of: 'res-w5', live_id: '5fda330cf2a149849a42f7b9b9a4a702:304006:5' },
    { id: 'bld-water-tower-town', prefab: 'WaterTower01', label: '规划水塔（住宅）', size: { x: 31.6, z: 31.6 }, roadside_of: 'res-w7', live_id: '5fda330cf2a149849a42f7b9b9a4a702:304077:5' },

    // 商业区
    { id: 'bld-park-commercial', prefab: 'CityPark02', label: '规划商业主广场', size: { x: 47.6, z: 47.6 }, roadside_of: 'shop-back-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:422802:15' },
    { id: 'bld-park-commercial-north', prefab: 'CityPark02', label: '规划商业北广场', size: { x: 47.6, z: 47.6 }, roadside_of: 'shop-back-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:304123:7' },

    // 办公区
    { id: 'bld-park-office', prefab: 'CityPark02', label: '规划科技绿洲广场', size: { x: 47.6, z: 47.6 }, roadside_of: 'office-south-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:423376:11' },

    // 工业区
    { id: 'bld-coal-power-plant', prefab: 'SmallCoalPowerPlant01', label: '规划小型燃煤电厂', size: { x: 111.6, z: 127.6 }, roadside_of: 'yard-x4', live_id: '5fda330cf2a149849a42f7b9b9a4a702:304279:9' },
    { id: 'bld-wastewater-plant', prefab: 'WastewaterTreatmentPlant01', label: '规划污水处理厂', size: { x: 95.6, z: 79.6 }, roadside_of: 'yard-south-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:305231:3' },
    { id: 'bld-transformer', prefab: 'TransformerStation01', label: '规划变电站', size: { x: 47.6, z: 55.6 }, roadside_of: 'yard-main-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:306122:5' },
    { id: 'bld-landfill', prefab: 'Landfill01', label: '规划垃圾填埋场', size: { x: 135.6, z: 119.6 }, roadside_of: 'yard-south-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:306301:5' },
    { id: 'bld-water-tower-yard', prefab: 'WaterTower01', label: '规划水塔（厂区）', size: { x: 31.6, z: 31.6 }, roadside_of: 'yard-south-street', live_id: '5fda330cf2a149849a42f7b9b9a4a702:304083:9' },
    { id: 'bld-telecom-tower', prefab: 'TelecomTower01', label: '规划通信塔', size: { x: 55.6, z: 55.6 }, roadside_of: 'yard-x2', live_id: '5fda330cf2a149849a42f7b9b9a4a702:307411:5' },
    { id: 'bld-wind-turbine-north', prefab: 'WindTurbine01', label: '规划风力发电机（北）', size: { x: 119.6, z: 119.6 }, roadside_of: 'res-w7', live_id: '5fda330cf2a149849a42f7b9b9a4a702:308119:1' },
    { id: 'bld-wind-turbine-south', prefab: 'WindTurbine01', label: '规划风力发电机（南）', size: { x: 119.6, z: 119.6 }, roadside_of: 'res-w7', live_id: '5fda330cf2a149849a42f7b9b9a4a702:305262:7' },
  ];

  const liveById = new Map(liveBuildings.map(b => [b.id, b]));

  const planned = syncedBuildings.map(item => {
    const live = liveById.get(item.live_id);
    if (!live) throw new Error(`Live building not found: ${item.live_id}`);
    return {
      id: item.id,
      prefab: item.prefab,
      label: item.label,
      name: item.label,
      kind: item.id.includes('wind') || item.id.includes('power') || item.id.includes('water') ? 'utility' : 'service',
      roadside_of: item.roadside_of,
      planning_status: 'bound',
      construction_status: 'completed',
      construction_order: 80,
      position: { x: Math.round(live.position.x * 10) / 10, z: Math.round(live.position.z * 10) / 10 },
      rotation_degrees: 0,
      size_m: item.size,
    };
  });

  // Verify findCompletedPlannedBuildingIds
  const completedIds = findCompletedPlannedBuildingIds(planned, liveBuildings, 2);
  console.log(`Matched completed buildings: ${completedIds.length} / ${planned.length}`);

  // Verify validator
  const valResult = validateCityPlan({ utilities: [] }, { roads, buildings: planned, zones: [] }, planDoc.bounds);
  console.log(`Validator issues: ${valResult.issues.length}`);
  for (const iss of valResult.issues) {
    console.log(`  [${iss.severity}] ${iss.object_id}: ${iss.message}`);
  }

  // Check roadside
  const bad = [];
  for (const b of planned) {
    const road = roadById.get(b.roadside_of);
    if (!road) { bad.push(`${b.id}: no road`); continue; }
    const dist = distanceToPolyline(b.position, road.points);
    const allow = road.width_m / 2 + Math.hypot(b.size_m.x, b.size_m.z) / 2 + 6;
    if (dist > allow) bad.push(`${b.id}: dist ${dist.toFixed(1)} > allow ${allow.toFixed(1)}`);
  }
  console.log(`Roadside check failures: ${bad.length}`);
  if (bad.length) console.log(bad);
}

main().catch(console.error);
