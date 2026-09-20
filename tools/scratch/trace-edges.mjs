import { queryGame } from '../../mcp/bridge-client.mjs';

async function traceEdges() {
  const flow = await queryGame('analyze_traffic_flow', { limit: 10 });
  for (const item of flow.data.items) {
    const details = await queryGame('get_entity_details', { entity_id: item.road_edge_id });
    const pos = details.data?.position;
    console.log(`${item.road_edge_id}: ${details.data?.prefab_name}, pos: (${pos?.x?.toFixed(1)}, ${pos?.z?.toFixed(1)}), vehicles: ${item.vehicle_count}, stopped: ${item.stopped_count} (${(item.stopped_ratio*100).toFixed(0)}%), speed: ${item.average_speed_mps?.toFixed(1)}m/s`);
  }
}
traceEdges().catch(console.error);
