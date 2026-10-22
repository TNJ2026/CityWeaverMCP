#!/usr/bin/env node
// Identify road edge ...:356591:115 (the outermost Large Road candidate at the west corner)
// and the full ring structure near r>900.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);
const CENTRE = { x: -400, z: -1248 };
const SESSION = 'fd537682d55349c282f74590a72dea69';

const snap = await queryGame('get_planning_map_snapshot', { bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000 });
const roads = snap.data.roads ?? [];
console.log(`roads ${roads.length}`);

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};

const target = roads.find((r) => r.id === `${SESSION}:356591:115`);
console.log('\n=== edge 356591:115 ===');
console.log(target ? JSON.stringify({ id: target.id, prefab: target.prefab, name: target.name, curve: target.curve, flags: target.flags }, null, 2) : 'NOT FOUND');
if (target) {
  console.log('   endpoints:', JSON.stringify(bez(target.curve, 0)), JSON.stringify(bez(target.curve, 1)));
}

console.log('\n=== every edge whose closest approach to centre is > 900 ===');
for (const r of roads) {
  let min = Infinity, pt = null;
  for (let i = 0; i <= 40; i++) {
    const q = bez(r.curve, i / 40);
    const d = Math.hypot(q.x - CENTRE.x, q.z - CENTRE.z);
    if (d < min) { min = d; pt = q; }
  }
  if (min <= 900) continue;
  const a0 = bez(r.curve, 0), a1 = bez(r.curve, 1);
  console.log(`  ${r.id} ${String(r.prefab).padEnd(28)} near=${min.toFixed(0)} nearPt=(${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})  a0=(${a0.x.toFixed(1)}, ${a0.z.toFixed(1)}) a1=(${a1.x.toFixed(1)}, ${a1.z.toFixed(1)})`);
}

console.log('\n=== prefab histogram among ring (Large Road) ===');
const ring = roads.filter((r) => /large/i.test(r.prefab));
console.log(`  count ${ring.length}`);
const ids = ring.map((r) => r.id.split(':')[1]).sort();
console.log('  edge ids:', ids.join(' '));
