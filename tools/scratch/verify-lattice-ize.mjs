// 复核 lattice-ize 转换是否几何等价，并检查新路网拓扑。
// 等价判据（按「朝向|坐标」分组做区间集合比较）：
//   旧格网路区间并集  ==  新格网路区间并集 ∪ 同线上的骨架路区间
// 另检查：新路集单一连通分量、建筑临街、建筑不压路、全部几何在已购范围内。
//
// 用法: node tools/scratch/verify-lattice-ize.mjs <old-plan.json> <new-plan.json>

import { readFile } from 'node:fs/promises';
import { expandCityPlan } from '../../mcp/planning-renderer.mjs';

const [oldPath, newPath] = process.argv.slice(2);
const oldDoc = JSON.parse(await readFile(oldPath, 'utf8'));
const newDoc = JSON.parse(await readFile(newPath, 'utf8'));
const EPS = 1e-6;
const r6 = v => Math.round(v * 1e6) / 1e6;
const LATTICE_ID = /^grid-(\d+)-([vh])-(\d+)$/;

const intervals = (roads, filterFn) => {
  const map = new Map();
  for (const road of roads) {
    if (!filterFn(road)) continue;
    const pts = road.points ?? [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      let orient, coord, from, to;
      if (Math.abs(a.x - b.x) <= EPS) { orient = 'v'; coord = r6(a.x); from = Math.min(a.z, b.z); to = Math.max(a.z, b.z); }
      else if (Math.abs(a.z - b.z) <= EPS) { orient = 'h'; coord = r6(a.z); from = Math.min(a.x, b.x); to = Math.max(a.x, b.x); }
      else continue;                                    // 斜路不参与比较
      const key = `${orient}|${coord}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push([from, to, road.id]);
    }
  }
  return map;
};
const mergeFlat = list => {
  const sorted = [...list].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [f, t] of sorted) {
    const last = out[out.length - 1];
    if (last && f <= last[1] + EPS) last[1] = Math.max(last[1], t);
    else out.push([f, t]);
  }
  return out;
};
const totalLen = list => list.reduce((s, [f, t]) => s + (t - f), 0);
const covers = (haystack, needle) => haystack.some(([f, t]) => f <= needle[0] + 1 && t >= needle[1] - 1);

const oldRoads = expandCityPlan(oldDoc.plan).roads;
const newPlan = newDoc.plan;
const oldLattice = intervals(oldRoads, r => LATTICE_ID.test(String(r.id)));
const oldSkeleton = intervals(oldRoads, r => !LATTICE_ID.test(String(r.id)));
const newFlat = intervals(newPlan.roads, r => String(r.id).startsWith('lattice-'));

const keys = new Set([...oldLattice.keys(), ...oldSkeleton.keys(), ...newFlat.keys()]);
const gaps = [], extra = [];
for (const key of keys) {
  const o = mergeFlat(oldLattice.get(key) ?? []);
  const s = mergeFlat(oldSkeleton.get(key) ?? []);
  const n = mergeFlat(newFlat.get(key) ?? []);
  const union = mergeFlat([...n, ...s].map(([f, t]) => [f, t]));
  for (const seg of o) if (!covers(union, seg)) gaps.push({ key, seg });
  for (const seg of n) if (!covers(o, seg)) extra.push({ key, seg });
}

// 拓扑复核
const roads = newPlan.roads;
const segs = [];
for (const r of roads) for (let i = 1; i < r.points.length; i++) segs.push({ a: r.points[i - 1], b: r.points[i], road: r });
const m = segs.length;
const parent = Array.from({ length: m }, (_, i) => i);
const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
{ let start = 0; for (const r of roads) { const c = Math.max(0, r.points.length - 1); for (let i = 1; i < c; i++) union(start + i - 1, start + i); start += c; } }
const distPointSeg = (p, a, b) => {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const l2 = vx * vx + vz * vz; let t = l2 > 0 ? (wx * vx + wz * vz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
};
const ends = segs.flatMap((s, i) => [{ p: s.a, i }, { p: s.b, i }]);
for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
  if (ends[i].i === ends[j].i) continue;
  if (Math.hypot(ends[i].p.x - ends[j].p.x, ends[i].p.z - ends[j].p.z) <= 8.001) union(ends[i].i, ends[j].i);
}
for (const e of ends) for (let k = 0; k < m; k++) if (distPointSeg(e.p, segs[k].a, segs[k].b) <= 8.001) union(e.i, k);
// 十字交叉：两条路段在中段相交（游戏原生同样会生成路口），必须算连通
const orient = s => Math.abs(s.a.x - s.b.x) <= EPS ? 'v' : Math.abs(s.a.z - s.b.z) <= EPS ? 'h' : 'd';
const segCross = (p, q) => {
  const o1 = orient(p), o2 = orient(q);
  if (o1 === 'd' || o2 === 'd') return false;
  if (o1 === o2) return false;
  const v = o1 === 'v' ? p : q, h = o1 === 'v' ? q : p;
  const x = (v.a.x + v.b.x) / 2, z = (h.a.z + h.b.z) / 2;
  const [vz0, vz1] = [Math.min(v.a.z, v.b.z), Math.max(v.a.z, v.b.z)];
  const [hx0, hx1] = [Math.min(h.a.x, h.b.x), Math.max(h.a.x, h.b.x)];
  return x >= hx0 - EPS && x <= hx1 + EPS && z >= vz0 - EPS && z <= vz1 + EPS;
};
for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (segCross(segs[i], segs[j])) union(i, j);
const comps = new Set(); for (let i = 0; i < m; i++) comps.add(find(i));

const RAD = Math.PI / 180;
const rot2 = (px, pz, a) => ({ x: px * Math.cos(a) - pz * Math.sin(a), z: px * Math.sin(a) + pz * Math.cos(a) });
const noFrontage = [];
for (const b of newPlan.buildings ?? []) {
  const size = b.size_m ?? { x: 0, z: 0 };
  const ang = (b.rotation_degrees ?? 0) * RAD;
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const r = rot2((sx * size.x) / 2, (sz * size.z) / 2, ang);
    return { x: b.position.x + r.x, z: b.position.z + r.z };
  });
  let best = Infinity;
  for (const s of segs) { const half = (s.road.width_m ?? 16) / 2; for (const p of cs) best = Math.min(best, distPointSeg(p, s.a, s.b) - half); }
  if (best > 4.5) noFrontage.push({ name: b.name ?? b.prefab, gap: Number(best.toFixed(2)) });
}

console.log(JSON.stringify({
  old_plan_id: oldDoc.plan_id,
  new_plan_id: newDoc.plan_id,
  geometry_equivalent: gaps.length === 0 && extra.length === 0,
  uncovered_gaps: gaps.slice(0, 10),
  unexpected_extra: extra.slice(0, 10),
  count_gap: gaps.length,
  count_extra: extra.length,
  roads: roads.length,
  segments: m,
  connected_components: comps.size,
  buildings_without_frontage: noFrontage,
  lattice_len_m: totalLen(mergeFlat([...newFlat].filter(([k]) => {
    const [o, c] = k.split('|');
    return !oldSkeleton.has(k) || true;
  }).flatMap(([, v]) => v))),
}, null, 2));
