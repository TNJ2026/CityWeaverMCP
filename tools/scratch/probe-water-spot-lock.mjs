#!/usr/bin/env node
// Check whether the planner reliably returns the aimed periphery spots when `near` is centred
// on them, so the move script can lock onto those exact candidates.
import { queryGame } from '../../mcp/bridge-client.mjs';

const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6);
const distC = (p) => Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);

const DESIRED = [
  { id: 'A 180°', x: -1313.9, z: -1281.4 },
  { id: 'A 180° alt', x: -1304.9, z: -1199.0 },
  { id: 'B 300°', x: 85.9, z: -2022.8 },
  { id: 'B 300° alt', x: 94.9, z: -2007.2 },
  { id: 'C 60°', x: 103.9, z: -504.4 },
  { id: 'C 60° alt', x: 10.0, z: -439.8 },
];

for (const d of DESIRED) {
  const r = await queryGame('plan_utility_facility_site', {
    building_prefab: 'WaterTower01', near: { x: d.x, z: d.z }, mode: 'road_edge',
    search_radius_m: 50, road_side: 'either', candidate_count: 8,
  });
  const cs = r.data?.candidates ?? [];
  const near = cs
    .map((c) => ({ ...c, dd: Math.hypot(c.position.x - d.x, c.position.z - d.z) }))
    .sort((a, b) => a.dd - b.dd)[0];
  console.log(`\n${d.id} aimed (${d.x}, ${d.z}) r_aim=${distC(d).toFixed(1)} -> ${cs.length} candidates`);
  if (near) {
    console.log(`   closest: (${near.position.x.toFixed(1)}, ${near.position.z.toFixed(1)}) rot=${Number(near.rotation_degrees).toFixed(1)}` +
      ` offset=${near.dd.toFixed(1)} m  r=${distC(near.position).toFixed(1)}  coll=${near.approximate_collision}  ${near.road_edge_id} [${near.road_prefab}]`);
  }
  for (const c of cs.slice(0, 4)) {
    console.log(`     (${c.position.x.toFixed(1)}, ${c.position.z.toFixed(1)}) rot=${Number(c.rotation_degrees).toFixed(1)} r=${distC(c.position).toFixed(1)} outside=${distC(c.position) > R_EDGE} coll=${c.approximate_collision} side=${c.road_side}`);
  }
  await new Promise((r2) => setTimeout(r2, 200));
}
