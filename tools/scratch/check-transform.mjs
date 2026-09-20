import { queryGame } from '../../mcp/bridge-client.mjs';

async function checkTransform() {
  const status = await queryGame('get_entity_components', {
    entity_id: '5fda330cf2a149849a42f7b9b9a4a702:308119:1',
    component_types: ['Game.Objects.Transform']
  });
  console.log('Transform:', JSON.stringify(status.data, null, 2));
}
checkTransform().catch(console.error);
