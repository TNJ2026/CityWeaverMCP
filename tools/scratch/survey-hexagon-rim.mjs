#!/usr/bin/env node
// Precise survey of the hexagon rim: for every road edge, compute the closest point to the
// hexagon centre and the radius band it occupies. Also snapshot terrain/water so we can judge
// groundwater at candidate sites.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);
const CENTRE = { x: -400, z: -1248 };

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const roads = snap.data?.roads ?? [];
console.log(`live road edges: ${roads.length}\n`);
console.log('snapshot layers:');
for (const [k, v] of Object.entries(snap.data ?? {})) {
  console.log(`  ${k}: ${Array.isArray(v) ? `array(${v.length})` : typeof v}`);
}

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};

const rows = [];
for (const r of roads) {
  let best = null;
  for (let i = 0; i <= 40; i++) {
    const q = bez(r.curve, i / 40);
    const d = Math.hypot(q.x - CENTRE.x, q.z - CENTRE.z);
    if (!best || d < best.d) best = { d, q };
  }
  const a0 = bez(r.curve, 0), a1 = bez(r.curve, 1);
  rows.push({ r, near: best.d, nearPt: best.q, a0, a1, len: Math.hypot(a1.x - a0.x, a1.z - a0.z) });
}

const band = rows.filter((x) => x.near > 640).sort((a, b) => a.near - b.near);
console.log(`\n--- edges whose closest approach to centre is > 640 m (rim band) : ${band.length} ---`);
for (const x of band) {
  const deg = (Math.atan2(x.nearPt.z - CENTRE.z, x.nearPt.x - CENTRE.x) * 180) / Math.PI;
  console.log(
    `  ${x.r.id}  ${x.r.prefab.padEnd(26)} near=${x.near.toFixed(0)}  ` +
      `nearPt=(${x.nearPt.x.toFixed(1)}, ${x.nearPt.z.toFixed(1)}) bearing=${deg.toFixed(1)}deg len=${x.len.toFixed(1)}`,
  );
}

writeFileSync('tools/scratch/_rim-edges.json', JSON.stringify(
  band.map((x) => ({
    id: x.r.id, prefab: x.r.prefab, near: +x.near.toFixed(2),
    nearPt: x.nearPt, a0: x.a0, a1: x.a1, len: +x.len.toFixed(2),
  })), null, 2));
console.log('\nwritten tools/scratch/_rim-edges.json');
