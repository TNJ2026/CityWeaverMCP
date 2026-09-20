import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkRotations() {
  const status = await queryGame('get_entity_details', {
    entity_id: '5fda330cf2a149849a42f7b9b9a4a702:308119:1'
  });
  console.log('Entity details:', JSON.stringify(status.data, null, 2));
}
checkRotations().catch(console.error);
