// Check the natively resolved building positions never sit on a road surface.
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));

const segs = [];
for (const r of plan.plan.roads) {
  const half = (r.width_m ?? 8) / 2;
  const pts = r.points;
  for (let i = 0; i + 1 < pts.length; i++) segs.push({ ...pts[i], x2: pts[i + 1].x, z2: pts[i + 1].z, half, id: r.id });
}
function distPointSeg(px, pz, s) {
  const dx = s.x2 - s.x, dz = s.z2 - s.z;
  const L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - s.x) * dx + (pz - s.z) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x + t * dx), pz - (s.z + t * dz));
}

let onRoad = 0, tight = 0;
const rows = [];
for (const b of plan.plan.buildings) {
  if (!b.position) continue;
  const cx = b.position.x, cz = b.position.z;
  const halfB = Math.max(b.size_m?.x ?? 20, b.size_m?.z ?? 20) / 2;
  let worst = null;
  for (const s of segs) {
    const clear = distPointSeg(cx, cz, s) - s.half - halfB;   // gap between surfaces (negative = overlap)
    if (!worst || clear < worst.clear) worst = { clear, id: s.id, half: s.half };
  }
  const verge = distPointSeg(cx, cz, segs.reduce((a, s) => {
    const d = distPointSeg(cx, cz, s) - s.half;
    return d < a.d ? { d, s } : a;
  }, { d: 1e9, s: segs[0] }).s) ;
  rows.push({ id: b.id, prefab: b.prefab, center_to_road_edge_m: +verge.toFixed(2), clearance_m: +worst.clear.toFixed(2), road: worst.id });
  if (worst.clear < -2) onRoad++;
  else if (worst.clear < 0.5) tight++;
}
rows.sort((a, b) => a.clearance_m - b.clearance_m);
console.log('buildings checked:', rows.length);
console.log('buildings whose footprint centroid is INSIDE a road surface (blocking):', onRoad);
console.log('buildings with clearance < 0.5 m (touching the road envelope):', tight);
console.log('\n10 tightest:');
for (const r of rows.slice(0, 10)) console.log(' ', JSON.stringify(r));
console.log('\nmin clearance:', rows[0]?.clearance_m, 'm | max:', rows[rows.length - 1]?.clearance_m, 'm');
const near = rows.filter(r => r.center_to_road_edge_m <= 8.05).length;
console.log(`buildings with centroid within 8 m of a road surface edge (roadside access): ${near}/${rows.length}`);
