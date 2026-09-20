import { readFileSync } from 'node:fs';
import { queryGame } from '../../mcp/bridge-client.mjs';

async function check() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_buildings: true,
    include_roads: false,
    max_features_per_layer: 5000,
  });
  const live = (snap.data?.buildings ?? []).filter(b => 
    !b.prefab.includes('Residential') && !b.prefab.includes('Commercial') && !b.prefab.includes('Industrial') && !b.prefab.includes('Office')
  );

  console.log('Live building modulo 8 analysis:');
  for (const b of live) {
    const mx = ((b.position.x % 8) + 8) % 8;
    const mz = ((b.position.z % 8) + 8) % 8;
    console.log(`${b.prefab.padEnd(28)} pos=(${b.position.x.toFixed(1)}, ${b.position.z.toFixed(1)}) mod8=(${mx}, ${mz})`);
  }
}
check().catch(console.error);
