// 复核：规划建筑到最近规划道路的接入距离。
//   node tools/scratch/audit-building-access.mjs [plan.json] [threshold_m]
import { readFile } from 'node:fs/promises';
import { expandCityPlan } from '../../mcp/planning-renderer.mjs';

const planPath = process.argv[2] ?? 'plans/peiqi-pentagon-city-plan.json';
const threshold = Number(process.argv[3] ?? 60);

const document = JSON.parse(await readFile(planPath, 'utf8'));
const plan = expandCityPlan(document.plan ?? document);

const roads = plan.roads.filter(road => road.points?.length >= 2);

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function cornersOf(building) {
  const rotation = ((building.rotation_degrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfX = building.size_m.x / 2, halfZ = building.size_m.z / 2;
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]].map(([localX, localZ]) => ({
    x: building.position.x + localX * cos - localZ * sin,
    z: building.position.z + localX * sin + localZ * cos,
  }));
}

// 点到道路「路面外缘」的距离：中心线距离 - 半路宽（可为负 = 压在路上）
function nearestRoadEdge(point) {
  let best = { id: null, centerline: Infinity, edge: Infinity };
  for (const road of roads) {
    for (let index = 1; index < road.points.length; index++) {
      const distance = pointSegmentDistance(point, road.points[index - 1], road.points[index]);
      if (distance < best.centerline) {
        best = { id: road.id, centerline: distance, edge: distance - (road.width_m ?? 8) / 2 };
      }
    }
  }
  return best;
}

const report = plan.buildings.map(building => {
  const corners = cornersOf(building);
  // 真正的前场指标：footprint 最近外缘到最近道路「路面外缘」的距离（应为个位数米）。
  let nearest = { edge: Infinity, id: null };
  let farthest = { edge: -Infinity, id: null };
  for (const corner of corners) {
    const hit = nearestRoadEdge(corner);
    if (hit.edge < nearest.edge) nearest = { edge: hit.edge, id: hit.id };
    if (hit.edge > farthest.edge) farthest = { edge: hit.edge, id: hit.id };
  }
  return {
    label: building.label ?? building.name ?? building.id,
    prefab: building.prefab,
    rotation_degrees: building.rotation_degrees ?? 0,
    x: Math.round(building.position.x),
    z: Math.round(building.position.z),
    frontage_edge_m: Math.round(nearest.edge * 10) / 10,
    far_edge_m: Math.round(farthest.edge * 10) / 10,
    nearest_road: nearest.id,
  };
});

report.sort((left, right) => right.frontage_edge_m - left.frontage_edge_m);

const beyond = report.filter(entry => entry.frontage_edge_m > threshold);
console.log(JSON.stringify({
  plan_path: planPath,
  buildings: report.length,
  roads: roads.length,
  threshold_m: threshold,
  beyond_threshold: beyond.length,
  max_frontage_edge_m: report[0]?.frontage_edge_m ?? 0,
  worst_8: report.slice(0, 8),
  histogram: [1, 2, 4, 6, 8, 12, 20].map(limit => ({
    frontage_within_m: limit,
    buildings: report.filter(entry => entry.frontage_edge_m <= limit).length,
  })),
}, null, 2));
