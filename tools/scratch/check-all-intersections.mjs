import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkAllNodes() {
  const edges = [
    { name: 'X=-352路口', edge: '5fda330cf2a149849a42f7b9b9a4a702:297982:3' },
    { name: 'X=-592路口', edge: '5fda330cf2a149849a42f7b9b9a4a702:286565:9' },
    { name: 'X=-1080路口', edge: '5fda330cf2a149849a42f7b9b9a4a702:58904:9' },
    { name: 'X=-1608路口', edge: '5fda330cf2a149849a42f7b9b9a4a702:58700:3' },
  ];

  for (const item of edges) {
    const res = await queryGame('get_entity_components', {
      entity_id: item.edge,
      component_types: ['Game.Net.Edge']
    });
    const edgeComp = res.data.components['Game.Net.Edge'].fields;
    for (const [nodeField, nodeId] of Object.entries(edgeComp)) {
      const nodeDetails = await queryGame('get_entity_details', { entity_id: nodeId });
      const types = nodeDetails.data?.component_types ?? [];
      const hasTL = types.includes('Game.Net.TrafficLights');
      const hasRoundabout = types.some(t => t.toLowerCase().includes('roundabout'));
      console.log(`${item.name} -> Node ${nodeId} (${nodeField}): TrafficLights=${hasTL}, Roundabout=${hasRoundabout}`);
    }
  }
}
checkAllNodes().catch(console.error);
