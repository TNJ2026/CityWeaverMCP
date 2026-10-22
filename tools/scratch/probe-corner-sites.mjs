#!/usr/bin/env node
// 1) what now blocks the 300deg corner spots, and 2) the outermost free candidate at each of the
// three target corners.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);
const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6);
const distC = (p) => Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);

const snap = await queryGame('get_planning_map_snapshot', { bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000 });
const roads = snap.data.roads ?? [];
const ringIds = new Set(roads.filter((r) => /large/i.test(r.prefab)).map((r) => r.id));
const buildings = snap.data.buildings ?? [];
console.log(`roads ${roads.length} ring ${ringIds.size} | buildings ${buildings.length}`);

console.log('\n=== live buildings within 140 m of the 300deg aimed spots ===');
for (const aim of [{ x: 85.9, z: -2022.8 }, { x: 94.9, z: -2007.2 }, { x: 141.9, z: -1925.8 }]) {
  const near = buildings.filter((b) => b.position && Math.hypot(b.position.x - aim.x, b.position.z - aim.z) < 140)
    .sort((a, b) => Math.hypot(a.position.x - aim.x, a.position.z - aim.z) - Math.hypot(b.position.x - aim.x, b.position.z - aim.z));
  console.log(`  aim (${aim.x}, ${aim.z}):`);
  for (const b of near.slice(0, 6)) {
    console.log(`     ${(b.id ?? b.entity_id).padEnd(46)} ${String(b.prefab).padEnd(30)} (${b.position.x.toFixed(1)}, ${b.position.z.toFixed(1)}) d=${Math.hypot(b.position.x - aim.x, b.position.z - aim.z).toFixed(1)}`);
  }
}

const CORNERS = [
  { name: '180° 西角', v: { x: -1296, z: -1248 } },
  { name: '300° 东南角', v: { x: 48, z: -2024 } },
  { name: '60° 东北角', v: { x: 48, z: -472 } },
];

for (const c of CORNERS) {
  const a = Math.atan2(c.v.z - CENTRE.z, c.v.x - CENTRE.x);
  const anchor = { x: +(c.v.x + Math.cos(a) * 35).toFixed(1), z: +(c.v.z + Math.sin(a) * 35).toFixed(1) };
  const r = await queryGame('plan_utility_facility_site', {
    building_prefab: 'WaterTower01', near: anchor, mode: 'road_edge',
    search_radius_m: 150, road_side: 'either', candidate_count: 12,
  }).catch((e) => { console.log(`  ${c.name} ERR ${e.code}`); return null; });
  const cs = (r?.data?.candidates ?? [])
    .filter((x) => ringIds.has(x.road_edge_id) && distC(x.position) > R_EDGE)
    .sort((x, y) => distC(y.position) - distC(x.position));
  console.log(`\n=== ${c.name} anchor (${anchor.x}, ${anchor.z}) -> ${(r?.data?.candidates ?? []).length} candidates, ${cs.length} outside+onRing ===`);
  for (const x of cs.slice(0, 8)) {
    console.log(`   (${x.position.x.toFixed(1)}, ${x.position.z.toFixed(1)}) rot=${Number(x.rotation_degrees).toFixed(1)} r=${distC(x.position).toFixed(1)} coll=${String(x.approximate_collision).padEnd(5)} side=${String(x.road_side).padEnd(5)} ${x.road_edge_id}`);
  }
  await new Promise((res) => setTimeout(res, 250));
}
