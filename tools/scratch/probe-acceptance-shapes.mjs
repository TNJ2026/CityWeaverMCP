#!/usr/bin/env node
// Inspect the exact item shape returned by query_entities / get_game_status so the acceptance
// reads use the right field paths.
import { queryGame } from '../../mcp/bridge-client.mjs';

const gs = await queryGame('get_game_status', {});
console.log('=== get_game_status ===');
console.log(JSON.stringify(gs.data, null, 2).slice(0, 2500));

for (const [tool, args] of [
  ['query_entities', { all_components: ['Game.Buildings.WaterConsumer'], include_components: ['Game.Buildings.WaterConsumer'], limit: 3 }],
  ['query_entities', { all_components: ['Game.Simulation.WaterPipeEdge'], include_components: ['Game.Simulation.WaterPipeEdge'], limit: 3 }],
]) {
  console.log(`\n=== ${tool} ${args.all_components[0]} ===`);
  const r = await queryGame(tool, args);
  console.log('data keys:', Object.keys(r.data));
  console.log(JSON.stringify(r.data.items, null, 2).slice(0, 2500));
}

console.log('\n=== get_entity_components on a water tower ===');
const ec = await queryGame('get_entity_components', {
  entity_id: 'fd537682d55349c282f74590a72dea69:391504:55',
  components: ['Game.Buildings.Building', 'Game.Buildings.WaterTower', 'Game.Simulation.WaterPipeBuildingConnection'],
}).catch((e) => ({ err: e }));
console.log(JSON.stringify(ec.data ?? ec.err?.message ?? ec, null, 2).slice(0, 3000));

console.log('\n=== read_entity_field m_RoadEdge ===');
const rf = await queryGame('read_entity_field', {
  entity_id: 'fd537682d55349c282f74590a72dea69:391504:55',
  component: 'Game.Buildings.Building', field: 'm_RoadEdge',
}).catch((e) => ({ err: e }));
console.log(JSON.stringify(rf.data ?? rf.err?.message ?? rf, null, 2).slice(0, 1200));
