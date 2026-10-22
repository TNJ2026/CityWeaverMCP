import { queryGame } from '../../mcp/bridge-client.mjs';
const bounds = JSON.parse(process.argv[2]);
const res = await queryGame('get_planning_map_snapshot', { bounds, include_roads: true, include_buildings: true, include_tracks: false, include_utilities: false, max_features_per_layer: 5000 });
const d = res.data ?? {};
console.log('roads', d.roads?.length ?? 0, 'buildings', d.buildings?.length ?? 0, 'truncated', d.truncated);
for (const r of d.roads ?? []) {
  const c = r.curve ?? {};
  const a = c.a ?? {}, z2 = c.d ?? c.b ?? {};
  console.log('ROAD ' + r.prefab + ' (' + a.x + ',' + a.z + ') -> (' + z2.x + ',' + z2.z + ') status=' + r.status);
}
for (const b of d.buildings ?? []) {
  console.log('BLDG ' + JSON.stringify(b).slice(0, 200));
}
