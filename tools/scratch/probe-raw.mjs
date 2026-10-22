import { queryGame } from '../../mcp/bridge-client.mjs';
const bounds = JSON.parse(process.argv[2]);
const res = await queryGame('get_planning_map_snapshot', { bounds, include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false, max_features_per_layer: 5000 });
const d = res.data ?? {};
console.log(JSON.stringify(d.roads?.[0], null, 2));
console.log('---keys---', Object.keys(d.roads?.[0] ?? {}));
