// 诊断：读已建路网真实几何，核对规划坐标 vs 实际吸附结果。
import { queryGame } from '../../mcp/bridge-client.mjs';

const bounds = { min_x: 0, min_z: -1480, max_x: 620, max_z: -1400 };
const snap = await queryGame('get_planning_map_snapshot', {
  bounds, include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false,
  max_features_per_layer: 5000,
});
const roads = snap.data?.roads ?? [];
console.log(`bounds z -1480..-1400 内道路 ${roads.length} 条：`);
for (const road of roads) {
  const c = road.curve ?? {};
  const a = c.a ?? {}, d = c.d ?? {};
  console.log(`  id=${road.id ?? road.edge_id} prefab=${road.prefab ?? '?'} a=(${a.x},${a.y},${a.z}) d=(${d.x},${d.y},${a.z})`);
}

// 再看 x=128 纵向一带（西一街拟建位置两侧 32m）
const snap2 = await queryGame('get_planning_map_snapshot', {
  bounds: { min_x: 96, min_z: -2260, max_x: 160, max_z: -1420 },
  include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false,
  max_features_per_layer: 5000,
});
const roads2 = snap2.data?.roads ?? [];
console.log(`\nx 96..160、z -2260..-1420 内道路 ${roads2.length} 条：`);
for (const road of roads2) {
  const c = road.curve ?? {};
  const a = c.a ?? {}, d = c.d ?? {};
  console.log(`  id=${road.id ?? road.edge_id} prefab=${road.prefab ?? '?'} a=(${a.x},${a.y},${a.z}) d=(${d.x},${d.y},${d.z})`);
}
