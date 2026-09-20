import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkNodes() {
  const nodeDetails = await queryGame('get_entity_details', {
    entity_id: '5fda330cf2a149849a42f7b9b9a4a702:297982:3'
  });
  console.log('Edge details:', JSON.stringify(nodeDetails.data, null, 2));
}
checkNodes().catch(console.error);
