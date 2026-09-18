import { readFile } from 'node:fs/promises';
import { queryGame } from './bridge-client.mjs';

const source = JSON.parse(await readFile(new URL('../artifacts/weford-master-plan.json', import.meta.url), 'utf8'));
const pending = new Set(['Hospital01', 'CityPark03', 'CommunityPool01', 'BusDepot01', 'Landfill01', 'Cemetery02']);
const buildings = (source.plan?.buildings ?? []).filter(item => pending.has(item.prefab));
const results = [];

for (const building of buildings) {
  const transport = building.category === 'transport_facility';
  const response = await queryGame(transport ? 'plan_transport_facility_site' : 'plan_city_service_site', {
    building_prefab: building.prefab,
    near: { x: building.position.x, z: building.position.z },
    mode: 'auto',
    search_radius_m: 96,
    road_side: 'either',
    candidate_count: 12,
    reserve_upgrade_prefabs: [],
    ...(transport ? {} : { consider_service_coverage: false }),
  });
  const candidates = (response.data?.candidates ?? []).map(candidate => ({
    position: candidate.position,
    rotation_degrees: candidate.rotation_degrees,
    road_edge_id: candidate.road_edge_id,
    road_prefab: candidate.road_prefab,
    approximate_collision: candidate.approximate_collision,
    transform_error: Math.hypot(
      candidate.position.x - building.position.x,
      candidate.position.z - building.position.z,
    ) + Math.abs((((candidate.rotation_degrees - Number(building.rotation_degrees ?? 0)) + 540) % 360) - 180),
  })).sort((a, b) => a.transform_error - b.transform_error);
  results.push({ prefab: building.prefab, planned: building.position, candidates: candidates.slice(0, 4) });
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
