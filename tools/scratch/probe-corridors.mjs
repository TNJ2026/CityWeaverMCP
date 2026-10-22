import { queryGame } from '../../mcp/bridge-client.mjs';

const bounds = JSON.parse(process.argv[2]);
const res = await queryGame('get_planning_map_snapshot', {
  bounds, include_roads: false, include_buildings: false, include_tracks: true, include_utilities: true,
  max_features_per_layer: 5000,
});
const d = res.data ?? {};
for (const layer of ['tracks', 'utilities']) {
  const items = d[layer] ?? [];
  console.log('=== ' + layer + ' : ' + items.length + (d.truncated ? ' (truncated)' : ''));
  for (const it of items) {
    const c = it.curve ?? {};
    const a = c.a ?? {}, z2 = c.d ?? c.b ?? c.c ?? {};
    console.log('  ' + (it.prefab ?? it.name ?? '?') + '  w=' + (it.width_m ?? '?') +
      '  (' + a.x + ',' + a.z + ') -> (' + z2.x + ',' + z2.z + ')  status=' + (it.status ?? '?'));
  }
}
