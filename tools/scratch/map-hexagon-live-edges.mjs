// Match live permanent road edges to the hexagon plan's logical roads by geometry.
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const PLAN = 'plans/peiqi-hexagon-town-bound.json';
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));

function segsOf(road) {
  const pts = road.points || [];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    out.push({ x0: pts[i].x, z0: pts[i].z, x1: pts[i + 1].x, z1: pts[i + 1].z, planId: road.id, prefab: road.prefab, role: road.role });
  }
  return out;
}
const segs = plan.plan.roads.flatMap(segsOf);

function distPointSeg(px, pz, s) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const L2 = dx * dx + dz * dz;
  let t = L2 === 0 ? 0 : ((px - s.x0) * dx + (pz - s.z0) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x0 + t * dx, cz = s.z0 + t * dz;
  return { d: Math.hypot(px - cx, pz - cz), t };
}

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 1500,
});
const roads = snap.data?.roads ?? [];

const TOL = 2.5; // metres
const matched = [];
const unmatched = [];
for (const r of roads) {
  const a = r.curve?.a, d = r.curve?.d;
  if (!a || !d) { unmatched.push(r); continue; }
  const mx = (a.x + d.x) / 2, mz = (a.z + d.z) / 2;
  let best = null;
  for (const s of segs) {
    const da = distPointSeg(a.x, a.z, s), dd = distPointSeg(d.x, d.z, s), dm = distPointSeg(mx, mz, s);
    if (da.d <= TOL && dd.d <= TOL && dm.d <= TOL) {
      const score = da.d + dd.d + dm.d;
      if (!best || score < best.score) best = { s, score };
    }
  }
  if (best) matched.push({ id: r.id, prefab: r.prefab, planId: best.s.planId, role: best.s.role, len: Math.hypot(d.x - a.x, d.z - a.z), a, d });
  else unmatched.push(r);
}

const byPlan = {};
for (const m of matched) (byPlan[m.planId] ??= []).push(m);
console.log(`live edges=${roads.length} matched=${matched.length} unmatched=${unmatched.length}`);
console.log('\n--- matched per plan road ---');
for (const [pid, arr] of Object.entries(byPlan)) {
  console.log(pid.padEnd(22), arr.length, arr.map(m => m.len.toFixed(0)).join(','));
}
const planIds = plan.plan.roads.map(r => r.id);
const missing = planIds.filter(id => !byPlan[id]);
console.log('\nplan roads with NO live edges:', missing.length ? missing.join(', ') : '(none)');

const unmatchedPrefab = {};
for (const r of unmatched) unmatchedPrefab[r.prefab] = (unmatchedPrefab[r.prefab] || 0) + 1;
console.log('\nunmatched prefab histogram:', JSON.stringify(unmatchedPrefab));

fs.writeFileSync('tools/scratch/_live-edge-map.json', JSON.stringify({ tolerance_m: TOL, matched, byPlan, unmatchedIds: unmatched.map(r => r.id) }, null, 1));
console.log('\nwrote tools/scratch/_live-edge-map.json');
