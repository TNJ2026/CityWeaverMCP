import { queryGame } from './bridge-client.mjs';

const prefabs = [
  'ElementarySchool02', 'HighSchool02', 'PoliceStation02', 'FireHouse02',
  'MedicalClinic02', 'Hospital01', 'CityPark03', 'CommunityPool01',
  'BusDepot01', 'Landfill01', 'Cemetery02',
];

const [status, summary, buildings] = await Promise.all([
  queryGame('get_game_status', {}),
  queryGame('get_city_summary', {}),
  queryGame('get_planning_map_snapshot', {
    bounds: { min_x: -2181.565, min_z: -311.652, max_x: -311.652, max_z: 1558.261 },
    include_roads: false,
    include_buildings: true,
    include_tracks: false,
    include_utilities: false,
    max_features_per_layer: 5000,
  }),
]);

const items = (buildings.data?.buildings ?? []).filter(item => prefabs.includes(item.prefab));
process.stdout.write(`${JSON.stringify({
  status: status.data,
  summary: summary.data,
  public_services: items,
}, null, 2)}\n`);
