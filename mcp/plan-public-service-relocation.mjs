import { queryGame } from './bridge-client.mjs';

const targets = [
  { prefab: 'PoliceStation02', near: { x: -1576, z: 552 }, domain: 'city_service' },
  { prefab: 'FireHouse02', near: { x: -1504, z: 552 }, domain: 'city_service' },
  { prefab: 'MedicalClinic02', near: { x: -1432, z: 552 }, domain: 'city_service' },
  { prefab: 'Hospital01', near: { x: -1248, z: 568 }, domain: 'city_service' },
  { prefab: 'CityPark03', near: { x: -1872, z: 560 }, domain: 'city_service' },
  { prefab: 'CommunityPool01', near: { x: -928, z: 560 }, domain: 'city_service' },
  { prefab: 'BusDepot01', near: { x: -1760, z: 1248 }, domain: 'transport_facility' },
  { prefab: 'Landfill01', near: { x: -832, z: 1320 }, domain: 'city_service' },
  { prefab: 'Cemetery02', near: { x: -1840, z: 1376 }, domain: 'city_service' },
];

const status = await queryGame('get_game_status', {});
const results = [];
for (const target of targets) {
  const planner = target.domain === 'transport_facility' ? 'plan_transport_facility_site' : 'plan_city_service_site';
  try {
    const response = await queryGame(planner, {
      building_prefab: target.prefab,
      near: target.near,
      mode: 'auto',
      search_radius_m: 320,
      road_side: 'either',
      candidate_count: 16,
      reserve_upgrade_prefabs: [],
      ...(target.domain === 'city_service' ? { consider_service_coverage: false } : {}),
    });
    results.push({
      ...target,
      ok: true,
      reserved_footprint_half_extents_m: response.data?.reserved_footprint_half_extents_m,
      candidates: (response.data?.candidates ?? [])
        .filter(candidate => !candidate.approximate_collision)
        .slice(0, 8)
        .map(candidate => ({
          index: candidate.index,
          position: candidate.position,
          rotation_degrees: candidate.rotation_degrees,
          road_edge_id: candidate.road_edge_id,
          road_prefab: candidate.road_prefab,
          road_side: candidate.road_side,
          distance_from_request_m: candidate.distance_from_request_m,
          site_terrain_relief_m: candidate.site_terrain_relief_m,
        })),
      rejected: response.data?.rejected,
    });
  } catch (error) {
    results.push({ ...target, ok: false, error: { code: error?.code ?? null, message: error?.message ?? String(error) } });
  }
}

process.stdout.write(`${JSON.stringify({ status: status.data, results }, null, 2)}\n`);
