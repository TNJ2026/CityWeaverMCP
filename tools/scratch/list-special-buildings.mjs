import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

async function inspect() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
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

  console.log(`Special/service live buildings count: ${specialLive.length}`);
  for (const b of specialLive) {
    console.log(JSON.stringify({
      id: b.id,
      prefab: b.prefab,
      position: b.position,
      rotation: b.rotation,
      road_edge_id: b.road_edge_id
    }));
  }
}
inspect().catch(console.error);
