// 排查规划中「不同道路共线且区间重叠」的重复路段（同一条路自身的相邻段不算）。
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plan = j.plan ?? j;
const roads = (plan.roads ?? []).filter(r => (r.points ?? []).length >= 2);

const TOL = 0.5; // 共线容差（m）
const segs = [];
for (const r of roads) {
  const pts = r.points;
  const closed = pts.length > 2 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 1e-6 && Math.abs(pts[0].z - pts[pts.length - 1].z) < 1e-6;
  const n = closed ? pts.length - 1 : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const horizontal = Math.abs(dz) < 1e-6;
    const vertical = Math.abs(dx) < 1e-6;
    if (!horizontal && !vertical) continue; // 只查轴对齐段
    segs.push({
      road: r.id, role: r.role, prefab: r.prefab, i,
      dir: horizontal ? 'H' : 'V',
      fixed: horizontal ? a.z : a.x,
      lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.z, b.z),
      hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.z, b.z),
      text: '(' + a.x + ',' + a.z + ')->(' + b.x + ',' + b.z + ')',
    });
  }
}

const found = [];
for (let p = 0; p < segs.length; p++) {
  for (let q = p + 1; q < segs.length; q++) {
    const s = segs[p], t = segs[q];
    if (s.dir !== t.dir) continue;
    if (Math.abs(s.fixed - t.fixed) > TOL) continue;
    const lo = Math.max(s.lo, t.lo), hi = Math.min(s.hi, t.hi);
    const ov = hi - lo;
    if (ov <= TOL) continue;
    if (s.road === t.road && Math.abs(s.i - t.i) === 1) continue; // 同路相邻段
    if (s.road === t.road) continue; // 同一设施内部（环路闭合）忽略
    found.push({ s, t, ov });
  }
}
console.log('plan roads', roads.length, '| axis-aligned segs', segs.length, '| 共线重叠对', found.length);
for (const f of found) {
  console.log('重叠 ' + f.ov.toFixed(1) + 'm  [' + f.s.dir + ' @' + f.s.fixed + ']');
  console.log('   ' + f.s.road.padEnd(16) + (f.s.prefab ?? '').padEnd(13) + f.s.text);
  console.log('   ' + f.t.road.padEnd(16) + (f.t.prefab ?? '').padEnd(13) + f.t.text);
}
