#!/usr/bin/env node
// Find native roadside candidates for WindTurbine02 on the OUTER side of the hexagon ring road.
import { queryGame } from '../../mcp/bridge-client.mjs';

const CENTRE = { x: -400, z: -1248 };
const R_CIRCUM = 896;            // hexagon circumradius (corner distance)
const R_EDGE = R_CIRCUM * Math.cos(Math.PI / 6); // 776 m, edge-midpoint radius

// ring's live edges (Large Road) -> to identify which candidate road is the ring
const plan = JSON.parse((await import('node:fs')).readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const ringIds = new Set((snap.data.roads || []).filter((r) => /large/i.test(r.prefab)).map((r) => r.id));
console.log('ring (Large Road) live edges:', ringIds.size);

const dist = (p) => Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);

// three anchors, 120 degrees apart, on edge midpoints, pushed outward
const ANGLES = [30, 150, 270];
for (const deg of ANGLES) {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uz = Math.sin(a);
  const anchor = { x: +(CENTRE.x + (R_EDGE + 90) * ux).toFixed(1), z: +(CENTRE.z + (R_EDGE + 90) * uz).toFixed(1) };
  console.log(`\n=== anchor ${deg}deg  (${anchor.x}, ${anchor.z})  outward=(${ux.toFixed(3)}, ${uz.toFixed(3)})`);
  let cands = [];
  for (const mode of ['road_edge', 'auto']) {
    try {
      const r = await queryGame('plan_utility_facility_site', {
        building_prefab: 'WindTurbine02', near: anchor, mode, search_radius_m: 260,
        road_side: 'either', candidate_count: 10,
      });
      cands = r.data?.candidates ?? [];
      console.log(`  mode=${mode} -> ${cands.length} candidates`);
      if (cands.length) break;
    } catch (e) {
      console.log(`  mode=${mode} ERR ${e.code} ${String(e.message).slice(0, 160)}`);
    }
  }
  for (const c of cands) {
    const d = dist(c.position);
    const outer = d > R_EDGE;
    const onRing = ringIds.has(c.road_edge_id);
    console.log(
      `    #${String(c.index).padStart(2)} (${c.position.x.toFixed(1)}, ${c.position.z.toFixed(1)}) ` +
      `rot=${(c.rotation_degrees ?? 0).toFixed(1)} r=${d.toFixed(0)}m ${outer ? 'OUTER' : 'inner'} ` +
      `ring=${onRing ? 'YES' : 'no '} side=${c.road_side} road=${c.road_prefab} ` +
      `collision=${c.approximate_collision} ${c.road_edge_id}`,
    );
  }
}
