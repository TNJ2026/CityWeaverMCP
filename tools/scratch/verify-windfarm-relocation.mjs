#!/usr/bin/env node
// Verify the three relocated small wind turbines: position, road access, production.
// Runs the simulation briefly (the city must be unpaused for the road connection and the
// production statistic to be updated), then re-pauses and reports.
import { queryGame } from '../../mcp/bridge-client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN_SECONDS = Number(process.argv[2] ?? 25);

const read = async (label) => {
  const r = await queryGame('list_utility_facilities', { kind: 'power_plant' });
  const winds = r.data.items.filter((f) => /wind/i.test(f.prefab));
  console.log(`\n--- ${label}`);
  for (const f of winds) {
    console.log(
      `   ${f.facility_id.padEnd(46)} (${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)}) ` +
      `road=${f.road_edge_id ?? 'NONE'} cap=${f.electricity_capacity} last=${f.last_electricity_production} eff=${JSON.stringify(f.efficiency_factors)}`,
    );
  }
  const st = (await queryGame('get_game_status', {})).data;
  const ov = await queryGame('get_city_management_overview', {});
  console.log(`   paused=${st.paused}  population=${ov.data.population.population}  money=${ov.data.economy.money}`);
  return winds;
};

const before = await read('before running the simulation');
const productionBefore = before.reduce((s, f) => s + (f.last_electricity_production ?? 0), 0);

console.log(`\nunpausing at normal speed for ${RUN_SECONDS} s ...`);
await queryGame('set_simulation_speed', { speed: 'normal' });
await sleep(RUN_SECONDS * 1000);
await queryGame('set_simulation_speed', { speed: 'paused' });
await sleep(1200);

const after = await read('after running the simulation');
const productionAfter = after.reduce((s, f) => s + (f.last_electricity_production ?? 0), 0);

console.log('\n=== verdict ===');
console.log(`   turbines producing: ${after.filter((f) => (f.last_electricity_production ?? 0) > 0).length}/${after.length}`);
console.log(`   total wind production: before ${productionBefore} kW -> after ${productionAfter} kW`);
for (const f of after) {
  const d = Math.hypot(f.position.x + 400, f.position.z + 1248);
  console.log(`   ${f.facility_id}  r=${d.toFixed(0)} m from centre  ${d > 776 ? 'OUTSIDE the hexagon (outer periphery)' : 'inside'}`);
}
