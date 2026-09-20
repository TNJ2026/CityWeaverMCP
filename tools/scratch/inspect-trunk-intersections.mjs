import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkIntersections() {
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: { min_x: -1700, max_x: -50, min_z: 450, max_z: 650 },
    include_roads: true,
    max_features_per_layer: 500,
  });
  const roads = snap.data?.roads ?? [];
  const largeRoads = roads.filter(r => r.prefab === 'Large Road');

  console.log(`Found ${largeRoads.length} segments of Large Road on trunk-avenue.`);

  // Find all endpoints (nodes) along trunk-avenue
  const endpoints = [];
  for (const r of largeRoads) {
    const a = r.curve?.a ?? r.curve;
    const d = r.curve?.d ?? a;
    endpoints.push({ edge_id: r.id, pt: a });
    endpoints.push({ edge_id: r.id, pt: d });
  }

  // Group by coordinates (within 2m)
  const nodeGroups = [];
  for (const ep of endpoints) {
    let group = nodeGroups.find(g => Math.hypot(g.x - ep.pt.x, g.z - ep.pt.z) < 2);
    if (!group) {
      group = { x: ep.pt.x, z: ep.pt.z, edges: [] };
      nodeGroups.push(group);
    }
    group.edges.push(ep.edge_id);
  }

  // Find intersecting local roads for each group
  for (const g of nodeGroups) {
    const connectingRoads = roads.filter(r => {
      const a = r.curve?.a ?? r.curve;
      const d = r.curve?.d ?? a;
      return Math.hypot(a.x - g.x, a.z - g.z) < 2 || Math.hypot(d.x - g.x, d.z - g.z) < 2;
    });
    console.log(`\nIntersection @ (${g.x.toFixed(1)}, ${g.z.toFixed(1)}): ${connectingRoads.length} connecting branches:`);
    for (const cr of connectingRoads) {
      console.log(`  - ${cr.id} (${cr.prefab})`);
    }
  }
}
checkIntersections().catch(console.error);
