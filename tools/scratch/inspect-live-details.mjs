import { readFileSync } from 'node:fs';
import { queryGame } from '../../mcp/bridge-client.mjs';

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

async function run() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const roads = planDoc.plan.roads;
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_buildings: true,
    include_roads: false,
    max_features_per_layer: 5000,
  });
  const live = (snap.data?.buildings ?? []).filter(b => 
    !b.prefab.includes('Residential') && !b.prefab.includes('Commercial') && !b.prefab.includes('Industrial') && !b.prefab.includes('Office')
  );

  const roadById = new Map(roads.map(r => [r.id, r]));

  console.log(`Found ${live.length} live buildings:`);
  const results = [];
  for (const b of live) {
    let bestRoad = null, bestDist = Infinity;
    for (const r of roads) {
      const d = distanceToPolyline(b.position, r.points);
      if (d < bestDist) {
        bestDist = d;
        bestRoad = r;
      }
    }
    results.push({
      live_id: b.id,
      prefab: b.prefab,
      position: { x: Math.round(b.position.x * 10) / 10, z: Math.round(b.position.z * 10) / 10 },
      closest_road: bestRoad.id,
      road_label: bestRoad.label,
      road_width: bestRoad.width_m,
      distance_to_road: Math.round(bestDist * 10) / 10
    });
  }
  console.log(JSON.stringify(results, null, 2));
}
run().catch(console.error);
