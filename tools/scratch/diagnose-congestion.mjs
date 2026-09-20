import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

async function diagnose() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_roads: true,
    max_features_per_layer: 1000,
  });
  const allRoads = snap.data?.roads ?? [];
  const roadById = new Map(allRoads.map(r => [r.id, r]));

  const traffic = await queryGame('analyze_traffic_flow', { limit: 20 });
  const items = traffic.data?.items ?? [];

  console.log(`Top ${items.length} congested road segments:`);
  for (const item of items) {
    const road = roadById.get(item.road_edge_id);
    const prefab = road?.prefab ?? 'unknown';
    const curve = road?.curve;
    const mid = curve ? { x: ((curve.a?.x ?? curve.x) + (curve.d?.x ?? curve.x))/2, z: ((curve.a?.z ?? curve.z) + (curve.d?.z ?? curve.z))/2 } : null;
    console.log(`- Edge ${item.road_edge_id} (${prefab}) @ (${mid?.x?.toFixed(1)}, ${mid?.z?.toFixed(1)})`);
    console.log(`  Vehicles: ${item.vehicle_count}, Stopped: ${item.stopped_count} (${(item.stopped_ratio*100).toFixed(0)}%), AvgSpeed: ${item.average_speed_mps?.toFixed(1)} m/s, Score: ${item.score}`);
  }
}
diagnose().catch(console.error);
