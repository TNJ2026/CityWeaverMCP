// 独立复核六边形城镇规划：不依赖生成器自检，直接从 plan JSON + expandCityPlan 重算。
// 检查项：
//   1) 全部道路（含 grid 展开）连通为单一网络（8 m 吸附 + T 型接入）
//   2) 每座建筑 footprint 到最近道路中心线距离 <= 半路宽 + 容差（即临街可达）
//   3) 所有几何落在已购地图范围内
//   4) 建筑不压在道路面上（validator 同款 OBB 判据，按建筑实际尺寸）
//
// 用法: node tools/audit-hexagon-town-plan.mjs <plan.json>

import { readFile } from 'node:fs/promises';
import { expandCityPlan } from '../mcp/planning-renderer.mjs';

const planPath = process.argv[2];
if (!planPath) throw new Error('Usage: node tools/audit-hexagon-town-plan.mjs <plan.json>');
const doc = JSON.parse(await readFile(planPath, 'utf8'));
const plan = doc.plan ?? doc;
const bounds = doc.bounds;

const expanded = expandCityPlan(plan);
const roads = expanded.roads ?? [];
const zones = expanded.zones ?? [];
const buildings = plan.buildings ?? [];

const RAD = Math.PI / 180;

function rot2(px, pz, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: px * c - pz * s, z: px * s + pz * c };
}
function segmentsOf(road) {
  const out = [];
  for (let i = 0; i + 1 < road.points.length; i++) out.push({ a: road.points[i], b: road.points[i + 1] });
  return out;
}
// 建筑局部坐标 (x 沿路, z 垂直) -> 世界四角
function buildingCorners(b) {
  const size = b.size_m ?? b.size ?? { x: 0, z: 0 };
  const hx = size.x / 2, hz = size.z / 2;
  const ang = (b.rotation_degrees ?? 0) * RAD;
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => {
    const r = rot2(x, z, ang);
    return { x: b.position.x + r.x, z: b.position.z + r.z };
  });
}
function distPointSeg(p, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const wx = p.x - a.x, wz = p.z - a.z;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
}
// validator 同款：OBB（可旋转矩形）与线段相交判定
function segCrossesBox(a, b, center, half, rot, halfRoad) {
  const rel = (p) => rot2(p.x - center.x, p.z - center.z, -rot);
  const ra = rel(a), rb = rel(b);
  const hx = half.x + halfRoad, hz = half.z + halfRoad;
  const inside = (p) => Math.abs(p.x) <= hx && Math.abs(p.z) <= hz;
  if (inside(ra) || inside(rb)) return true;
  let t0 = 0, t1 = 1;
  const dx = rb.x - ra.x, dz = rb.z - ra.z;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, ra.x + hx)) return false;
  if (!clip(dx, hx - ra.x)) return false;
  if (!clip(-dz, ra.z + hz)) return false;
  if (!clip(dz, hz - ra.z)) return false;
  return t0 <= t1;
}

// ---------- 1) 连通性 ----------
const SNAP = 8;
const allSegs = [];
for (const r of roads) for (const s of segmentsOf(r)) allSegs.push({ ...s, road: r });

const m = allSegs.length;
const parent = Array.from({ length: m }, (_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };

// 同一 polyline 的相邻段相连
let segStart = 0;
for (const r of roads) {
  const count = Math.max(0, r.points.length - 1);
  for (let i = 1; i < count; i++) union(segStart + i - 1, segStart + i);
  segStart += count;
}
// 端点吸附：任意两段端点距离 <= SNAP 视为同一路口
const ends = allSegs.flatMap((s, i) => [{ p: s.a, i }, { p: s.b, i }]);
for (let i = 0; i < ends.length; i++) {
  for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].i === ends[j].i) continue;
    if (Math.hypot(ends[i].p.x - ends[j].p.x, ends[i].p.z - ends[j].p.z) <= SNAP) union(ends[i].i, ends[j].i);
  }
}
// T 型：某段端点落在另一段中段
for (const e of ends) {
  for (let k = 0; k < allSegs.length; k++) {
    if (allSegs[k].road === roads[0] && false) continue;
    if (distPointSeg(e.p, allSegs[k].a, allSegs[k].b) <= SNAP) union(e.i, k);
  }
}
const comps = new Set();
for (let i = 0; i < m; i++) comps.add(find(i));

// ---------- 2) 临街可达 ----------
const noFrontage = [];
for (const b of buildings) {
  const c = buildingCorners(b);
  let best = Infinity;
  for (const s of allSegs) {
    const half = (s.road.width_m ?? 16) / 2;
    for (const p of c) best = Math.min(best, distPointSeg(p, s.a, s.b) - half);
  }
  if (best > 4.5) noFrontage.push({ name: b.name ?? b.prefab, gap_m: Number(best.toFixed(2)) });
}

// ---------- 3) 已购范围内 ----------
const outside = new Set();
function inBounds(p) { return p.x >= bounds.min_x && p.x <= bounds.max_x && p.z >= bounds.min_z && p.z <= bounds.max_z; }
for (const s of allSegs) { if (!inBounds(s.a) || !inBounds(s.b)) outside.add('road'); }
for (const z of zones) { if (!z.polygon.every(inBounds)) outside.add(`zone:${z.kind}`); }
for (const b of buildings) { if (!buildingCorners(b).every(inBounds)) outside.add(`building:${b.name ?? b.prefab}`); }

// ---------- 4) 压盖 ----------
const roadOverlaps = [];
for (const b of buildings) {
  const size = b.size_m ?? { x: 0, z: 0 };
  const half = { x: size.x / 2, z: size.z / 2 };
  const ang = (b.rotation_degrees ?? 0) * RAD;
  for (const s of allSegs) {
    const halfRoad = (s.road.width_m ?? 16) / 2;
    if (segCrossesBox(s.a, s.b, b.position, half, ang, halfRoad)) {
      roadOverlaps.push({ building: b.name ?? b.prefab, road: s.road.role ?? s.road.kind ?? 'grid' });
    }
  }
}

// ---------- 5) 分区类型统计 ----------
const zoneKinds = {};
for (const z of zones) zoneKinds[z.kind] = (zoneKinds[z.kind] ?? 0) + 1;

console.log(JSON.stringify({
  plan_id: doc.plan_id,
  roads_total: roads.length,
  road_segments: m,
  roads_planned: (plan.roads ?? []).length,
  grids: (plan.grids ?? []).length,
  zone_cells: zones.length,
  zone_kinds: zoneKinds,
  building_count: buildings.length,
  connected_components: comps.size,
  buildings_without_frontage: noFrontage,
  road_building_overlap_count: roadOverlaps.length,
  road_building_overlaps: roadOverlaps.slice(0, 10),
  outside_purchased_area: [...outside],
}, null, 2));
