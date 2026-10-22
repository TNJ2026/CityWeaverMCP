import { queryGame } from '../../mcp/bridge-client.mjs';

const res = await queryGame('get_planning_map_snapshot', {
  bounds: { min_x: 40, min_z: -1260, max_x: 280, max_z: -1236 },
  include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false, max_features_per_layer: 5000,
});
const roads = res.data?.roads ?? [];
console.log('roads near z=-1248:', roads.length);
for (const r of roads) {
  const c = r.curve ?? {};
  const a = c.a ?? {}, z2 = c.d ?? {};
  const touches = (Math.abs(a.x - 160) < 1 && Math.abs(a.z + 1248) < 1) || (Math.abs(z2.x - 160) < 1 && Math.abs(z2.z + 1248) < 1);
  console.log('---', r.id, r.prefab, '(' + Math.round(a.x) + ',' + Math.round(a.z) + ')->(' + Math.round(z2.x) + ',' + Math.round(z2.z) + ')', 'status=' + r.status, 'touches160=' + touches);
  if (!touches && roads.length > 12) continue;
  try {
    const comp = await queryGame('get_entity_components', { entity_id: r.id, offset: 0, limit: 40 });
    const d = comp.data ?? {};
    const names = (d.items ?? []).map(i => i.type ?? i.name ?? JSON.stringify(i).slice(0, 60));
    console.log('     components:', JSON.stringify(names).slice(0, 800));
  } catch (e) {
    console.log('     components ERR', e.code, e.message.slice(0, 120));
  }
}
