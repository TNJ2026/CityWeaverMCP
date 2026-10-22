#!/usr/bin/env node
// Probe how far the three small wind turbines are from the nearest live permanent road,
// and read the terrain profile of the corridor between the nearest road and the turbines.
import { queryGame } from '../../mcp/bridge-client.mjs';

const TURBINES = [
  { id: 'bld-007', label: '小型风机 1', x: 634.0, z: -658.8 },
  { id: 'bld-008', label: '小型风机 2', x: 694.4, z: -587.8 },
  { id: 'bld-009', label: '小型风机 3', x: 681.6, z: -715.8 },
];

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    y: u * u * u * c.a.y + 3 * u * u * t * c.b.y + 3 * u * t * t * c.c.y + t * t * t * c.d.y,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};
const sample = (c, n = 24) => Array.from({ length: n + 1 }, (_, i) => bez(c, i / n));
const distToPoly = (px, pz, pts) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - a.x) * dx + (pz - a.z) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz)));
  }
  return best;
};

const bounds = { min_x: -200, max_x: 1200, min_z: -1600, max_z: -100 };
const snap = await queryGame('get_planning_map_snapshot', {
  bounds, include_roads: true, include_buildings: false, max_features_per_layer: 4000,
});
const roads = (snap.data.roads || []).map((r) => ({ ...r, pts: sample(r.curve) }));
console.log('roads in window:', roads.length, 'truncated:', snap.data.truncated);

for (const t of TURBINES) {
  const ranked = roads
    .map((r) => ({ d: distToPoly(t.x, t.z, r.pts), id: r.id, prefab: r.prefab, width_m: r.width_m, pts: r.pts }))
    .sort((a, b) => a.d - b.d);
  console.log(`\n--- ${t.id} ${t.label} (${t.x}, ${t.z})`);
  for (const r of ranked.slice(0, 4)) {
    const near = r.pts.reduce((p, q) => (Math.hypot(q.x - t.x, q.z - t.z) < Math.hypot(p.x - t.x, p.z - t.z) ? q : p));
    console.log(
      `    d=${r.d.toFixed(1)} m  ${r.id}  [${r.prefab} ${r.width_m} m]  nearest point (${near.x.toFixed(1)}, ${near.y.toFixed(1)}, ${near.z.toFixed(1)})`,
    );
  }
}

// terrain profile along the corridor from the nearest road point to the wind farm centre
const cx = -400, cz = -1248;
const centreOfFarm = {
  x: TURBINES.reduce((s, t) => s + t.x, 0) / TURBINES.length,
  z: TURBINES.reduce((s, t) => s + t.z, 0) / TURBINES.length,
};
console.log('\nfarm centre:', centreOfFarm.x.toFixed(1), centreOfFarm.z.toFixed(1));

const nearest = roads
  .map((r) => ({ d: distToPoly(centreOfFarm.x, centreOfFarm.z, r.pts), id: r.id, pts: r.pts }))
  .sort((a, b) => a.d - b.d)[0];
const anchor = nearest.pts.reduce((p, q) =>
  Math.hypot(q.x - centreOfFarm.x, q.z - centreOfFarm.z) < Math.hypot(p.x - centreOfFarm.x, p.z - centreOfFarm.z) ? q : p);
console.log('nearest road to farm centre:', nearest.id, 'd=', nearest.d.toFixed(1), 'anchor', anchor.x, anchor.z);

const profile = [];
const N = 16;
for (let i = 0; i <= N; i++) {
  const t = i / N;
  profile.push({ x: +(anchor.x + (centreOfFarm.x - anchor.x) * t).toFixed(1), z: +(anchor.z + (centreOfFarm.z - anchor.z) * t).toFixed(1) });
}
const terr = await queryGame('sample_terrain', { points: profile });
console.log('\nterrain profile road -> farm centre:');
for (const p of terr.data.points ?? terr.data.samples ?? []) {
  console.log(`   (${p.x.toFixed(1)}, ${p.z.toFixed(1)})  y=${(p.y ?? p.height ?? p.elevation_m).toFixed(2)}`);
}
