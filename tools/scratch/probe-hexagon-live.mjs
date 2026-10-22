// Probe live state before applying hexagon-town zoning.
import { queryGame } from '../../mcp/bridge-client.mjs';

const PLAN = 'plans/peiqi-hexagon-town-bound.json';
const fs = await import('node:fs');
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));

function log(...a) { console.log(...a); }

const status = (await queryGame('get_game_status', {})).data;
log('city:', status.city_name, '| paused:', status.paused, '| speed:', status.simulation_speed, '| money:', status.money);

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds,
  include_roads: true,
  max_features_per_layer: 1200,
});
const roads = snap.data?.roads ?? [];
log('roads in bounds:', roads.length);
const byPrefab = {};
for (const r of roads) byPrefab[r.prefab] = (byPrefab[r.prefab] || 0) + 1;
log('prefab histogram:', JSON.stringify(byPrefab));
log('sample road keys:', Object.keys(roads[0] ?? {}).join(','));
log('sample road:', JSON.stringify(roads[0]));
