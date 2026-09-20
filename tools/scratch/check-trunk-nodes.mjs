import { queryGame } from '../../mcp/bridge-client.mjs';

async function main() {
  const edges = [
    // -352 intersection edges
    '5fda330cf2a149849a42f7b9b9a4a702:297982:3',
    // -592 intersection edges
    '5fda330cf2a149849a42f7b9b9a4a702:286565:9',
    // -1080 intersection edges
    '5fda330cf2a149849a42f7b9b9a4a702:58904:9',
    // -1608 intersection edges
    '5fda330cf2a149849a42f7b9b9a4a702:58700:3'
  ];

  for (const edgeId of edges) {
    const edgeData = await queryGame('read_entity_field', {
      entity_id: edgeId,
      component: 'Game.Net.Edge'
    });
    console.log(`Edge ${edgeId}:`);

    for (const nodeId of [edgeData.data?.value?.m_Start, edgeData.data?.value?.m_End]) {
      if (!nodeId) continue;
      const nodePos = await queryGame('read_entity_field', {
        entity_id: nodeId,
        component: 'Game.Net.Node'
      });
      const pos = nodePos.data?.value?.m_Position;
      let hasTL = false;
      try {
        const tf = await queryGame('read_entity_field', {
          entity_id: nodeId,
          component: 'Game.Net.TrafficLights'
        });
        hasTL = tf.ok;
      } catch (e) {
        hasTL = false;
      }
      console.log(`  Node ${nodeId} @ (${pos?.x?.toFixed(1)}, ${pos?.z?.toFixed(1)}): TrafficLights = ${hasTL}`);
    }
  }
}

main().catch(console.error);
