import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkStoppedVehicles() {
  const flow = await queryGame('analyze_traffic_flow', { limit: 10 });
  const worstEdge = flow.data.items[0].road_edge_id;
  console.log('Worst edge:', worstEdge);

  const vehicles = await queryGame('list_vehicles', {
    offset: 0,
    limit: 50
  });
  console.log('Total vehicles sampled:', vehicles.data.items?.length);

  // Check vehicles on worst edge
  const onEdge = (vehicles.data.items ?? []).filter(v => v.current_road_edge_id === worstEdge);
  console.log(`Found ${onEdge.length} vehicles on worst edge:`);
  for (const v of onEdge.slice(0, 10)) {
    console.log(`- ${v.id} (${v.prefab_name}), speed: ${v.speed_mps} m/s, state: ${v.state}, target: ${v.target_name ?? v.target_id}`);
  }
}
checkStoppedVehicles().catch(console.error);
