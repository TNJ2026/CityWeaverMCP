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

async function check() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const roads = planDoc.plan.roads;
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_buildings: true,
    include_roads: false,
    max_features_per_layer: 5000,
  });
  const liveBuildings = snap.data?.buildings ?? [];
  const specialLive = liveBuildings.filter(b => {
    return !b.prefab.includes('Residential') && !b.prefab.includes('Commercial') && !b.prefab.includes('Industrial') && !b.prefab.includes('Office');
  });

  console.log(`Found ${specialLive.length} special live buildings:`);
  for (const b of specialLive) {
    // find closest road
    let closestRoad = null, minDist = Infinity;
    for (const r of roads) {
      const d = distanceToPolyline(b.position, r.points);
      if (d < minDist) {
        minDist = d;
        closestRoad = r;
      }
    }
    const isSnap8 = (Math.round(b.position.x) % 8 === 0) && (Math.round(b.position.z) % 8 === 0);
    console.log(`${b.prefab} @ (${b.position.x.toFixed(1)}, ${b.position.z.toFixed(1)}) -> closest road: ${closestRoad.id} (${closestRoad.label}, w=${closestRoad.width_m}), dist=${minDist.toFixed(1)}m, 8m-aligned: ${isSnap8}`);
  }
}
check().catch(console.error);
