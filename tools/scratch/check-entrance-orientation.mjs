#!/usr/bin/env node
// Validate the orientation rule: does a building's entrance face its bound road?
// forward = (sin(rot), cos(rot)) vs the direction from the building centre to its road edge.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const strip = (id) => id.split(':').slice(1). join();

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};
const sample = (c, n = 32) => Array.from({ length: n + 1 }, (_, i) => bez(c, i / n));

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const live = new Map();
for (const r of snap.data.roads || []) live.set(r.id, { ...r, pts: sample(r.curve) });
console.log('live roads in plan bounds:', live.size);

let toward = 0, away = 0, perp = 0, missing = 0;
const rows = [];
for (const b of plan.plan.buildings) {
  if (!b.road_edge_id || !b.position) continue;
  const e = live.get(b.road_edge_id);
  if (!e) { missing++; continue; }
  const near = e.pts.reduce((p, q) =>
    Math.hypot(q.x - b.position.x, q.z - b.position.z) < Math.hypot(p.x - b.position.x, p.z - b.position.z) ? q : p);
  const dx = near.x - b.position.x, dz = near.z - b.position.z;
  const dist = Math.hypot(dx, dz);
  const r = (b.rotation_degrees ?? 0) * Math.PI / 180;
  const f = { x: Math.sin(r), z: Math.cos(r) };
  const cos = (f.x * dx + f.z * dz) / (dist || 1);
  const kind = cos > 0.5 ? 'toward' : cos < -0.5 ? 'away' : 'perpendicular';
  if (kind === 'toward') toward++; else if (kind === 'away') away++; else perp++;
  rows.push({ id: b.id, prefab: b.prefab, dist: dist.toFixed(1), cos: cos.toFixed(3), kind });
}
console.log('buildings checked:', rows.length, '| road edge missing from live:', missing);
console.log('forward TOWARD road:', toward, '| AWAY:', away, '| perpendicular/other:', perp);
console.log('\nsample rows (20):');
for (const r of rows.slice(0, 20)) console.log('  ', r.id.padEnd(9), r.prefab.padEnd(28), 'dist=' + r.dist.padStart(6), 'cos=' + r.cos.padStart(7), r.kind);
console.log('\nthe three turbines and their bound state:');
for (const b of plan.plan.buildings.filter((x) => /WindTurbine/.test(x.prefab))) {
  console.log('  ', b.id, b.prefab, 'rot=' + b.rotation_degrees, 'road_edge_id=' + b.road_edge_id);
}
