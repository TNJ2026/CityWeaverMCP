// Final functional verification of the hexagon town: buildings, services, utilities, connectivity.
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const b = plan.bounds;
const inPlan = (x, z) => x >= b.min_x && x <= b.max_x && z >= b.min_z && z <= b.max_z;
const P = (o) => console.log(JSON.stringify(o));

console.log('### 1. city service facilities (should include the 70 planned buildings)');
const fac = (await queryGame('list_city_service_facilities', { kind: 'all' }, { timeoutMs: 40000 })).data;
const items = fac?.items ?? fac?.facilities ?? [];
console.log('total service facilities in city:', items.length);
const inTown = items.filter(f => inPlan(f.position?.x ?? 0, f.position?.z ?? 0));
console.log('inside hexagon plan bounds:', inTown.length);
const byKind = {};
for (const f of inTown) byKind[f.kind ?? f.service_type ?? '?'] = (byKind[f.kind ?? f.service_type ?? '?'] || 0) + 1;
P({ town_facilities_by_kind: byKind });
const inefficient = inTown.filter(f => (f.efficiency ?? 1) < 0.6);
console.log('town facilities with efficiency < 60%:', inefficient.length, inefficient.slice(0, 10).map(f => `${f.prefab ?? f.name}:${f.efficiency}`));

console.log('\n### 2. plan buildings that are missing or unusable');
const wanted = plan.plan.buildings.map(x => ({ id: x.id, prefab: x.prefab ?? x.building_prefab, pos: x.position, road_edge_id: x.road_edge_id }));
console.log('planned buildings:', wanted.length, '| with road_edge_id:', wanted.filter(w => w.road_edge_id).length);
const facByPos = new Map(inTown.map(f => [`${Math.round(f.position.x)},${Math.round(f.position.z)}`, f]));
let missing = 0;
for (const w of wanted) {
  if (!w.pos) continue;
  const key = `${Math.round(w.pos.x)},${Math.round(w.pos.z)}`;
  if (!facByPos.has(key)) missing++;
}
console.log('planned buildings not found at their planned position among service facilities:', missing);

console.log('\n### 3. service coverage around town centre');
const cov = (await queryGame('analyze_service_coverage', { position: { x: -400, z: -1248 }, kind: 'all', radius_m: 900, facility_limit: 64 }, { timeoutMs: 40000 })).data;
P({ residential_buildings: cov?.residential_building_count ?? cov?.nearby_residential_buildings, households: cov?.household_count, facilities: (cov?.facilities ?? []).length });
console.log('coverage keys:', Object.keys(cov ?? {}).join(', '));

console.log('\n### 4. utilities');
const net = (await queryGame('list_utility_networks', {}, { timeoutMs: 30000 })).data;
P({ utility_networks: (net?.items ?? []).length });
const netDetail = (await queryGame('get_utility_network', {}, { timeoutMs: 30000 }).catch(e => ({ data: { error: e.code } }))).data;
console.log('utility network snapshot:', JSON.stringify(netDetail).slice(0, 600));

console.log('\n### 5. economy / population');
const eco = (await queryGame('get_city_economy', {}, { timeoutMs: 30000 })).data;
P({ money: eco?.money, income: eco?.income, expense: eco?.expense, hourly_delta: eco?.hourly_delta });
const demo = (await queryGame('get_population_demographics', {}, { timeoutMs: 30000 })).data;
P({ population: demo?.population, happiness: demo?.happiness, health: demo?.health, homelessness: demo?.homelessness });
const house = (await queryGame('get_housing_statistics', {}, { timeoutMs: 30000 })).data;
P({ housing: house });
const emp = (await queryGame('get_employment_statistics', {}, { timeoutMs: 30000 })).data;
P({ employment: { workplaces: emp?.workplaces, vacancies: emp?.vacancies, unemployment_rate: emp?.unemployment_rate } });

console.log('\n### 6. game status');
const st = (await queryGame('get_game_status', {})).data;
P({ city: st.city_name, paused: st.paused, speed: st.simulation_speed });
