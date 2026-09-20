// 尼思｜五边形城（Pentagonia）结构化规划生成器 —— 只读、不连游戏，只写 plans/nis-pentagon-city-plan.json
//
// 形态：一个正五边形（8 m 栅格取整，边长偏差 ≤0.5%）。五条放射大道连接中心与五个角，
//       五边形边线 = 城市外环路；内部 7 圈同心五边形环路（法距 120 m ≈ 黄金街宽 96）+
//       环间辐条支路（沿环弧间距 ≤233 → 路缘落在住宅长边区间）。南侧平地开「南市政带」
//       承接大占地公共服务/市政设施（120 m 环距内放不下 96 m 以上进深的建筑）。
//       分区按 16 m 栅格逐格划：到最近路缘距离 ∈ [0,48] 才成区，圈层（弦距）× 方位查用途表，
//       贪心最大矩形合并输出（保证 < 1024 个分区多边形）。
// 坐标：世界米制，全部道路节点吸附 8 m 全局栅格（GAME-PHYSICS-RULES §1.1）。
//
// 运行：node tools/scratch/generate-nis-pentagon-plan.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { computeCityPlanId } = await import(new URL('../../mcp/planning-renderer.mjs', import.meta.url).href);

// ---------------------------------------------------------------- 几何配置
const CENTER = { x: -312, z: 1000 };  // 五边形中心（8 m 栅格）
const R_OUT = 1200;                   // 外接圆半径（顶点到中心）
const DEG = Math.PI / 180;
const COS36 = Math.cos(36 * DEG);

const snap8 = (v) => Math.round(v / 8) * 8;
const P = (radius, deg) => ({
  x: snap8(CENTER.x + radius * Math.cos(deg * DEG)),
  z: snap8(CENTER.z + radius * Math.sin(deg * DEG)),
});
const polarOf = (x, z) => {
  const u = x - CENTER.x; const v = z - CENTER.z;
  return { radius: Math.hypot(u, v), angle: ((Math.atan2(v, u) / DEG) + 360) % 360 };
};

// 五个角（0 = 正北）
const VERTEX_ANG = [90, 18, 306, 234, 162];
const VERTS = VERTEX_ANG.map((a) => P(R_OUT, a));
const PENT = VERTS;

// 同心环：法距（apothem）→ 顶点半径 = a / cos36°
const RING_A = [160, 280, 400, 520, 640, 760, 880];
const RING_R = RING_A.map((a) => snap8(a / COS36));
const EDGE_A = 971;

const RADIAL_ANG = [90, 18, 306, 234, 162];
const SECTOR_ID = ['n', 'ne', 'se', 's', 'w'];
const BISECTOR_ANG = [54, 342, 270, 198, 126];

// ---------------------------------------------------------------- 多边形工具
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.z > pt.z) !== (b.z > pt.z)) {
      const t = (pt.z - a.z) / (b.z - a.z);
      if (pt.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}
function distToPolyEdge(pt, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    const vx = b.x - a.x; const vz = b.z - a.z;
    const len2 = vx * vx + vz * vz;
    let t = len2 === 0 ? 0 : ((pt.x - a.x) * vx + (pt.z - a.z) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * vx), pt.z - (a.z + t * vz)));
  }
  return best;
}
// 射线（自中心，角度 deg）与半径 rB 的环（正五边形）求交：返回交点（未 snap）。
// 中心在多边形内部，恰好一条边满足 s∈(0,1)，无需角度区间判断。
function rayHitChord(deg, rB) {
  const ux = Math.cos(deg * DEG); const uz = Math.sin(deg * DEG);
  const verts = VERTEX_ANG.map((ang) => ({ x: CENTER.x + rB * Math.cos(ang * DEG), z: CENTER.z + rB * Math.sin(ang * DEG) }));
  for (let i = 0; i < 5; i += 1) {
    const p1 = verts[i]; const p2 = verts[(i + 1) % 5];
    const ex = p2.x - p1.x; const ez = p2.z - p1.z;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p1.x - CENTER.x) * ez - (p1.z - CENTER.z) * ex) / den;
    const s = ((p1.x - CENTER.x) * uz - (p1.z - CENTER.z) * ux) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) return { x: CENTER.x + ux * t, z: CENTER.z + uz * t };
  }
  return null;
}

// ---------------------------------------------------------------- 已购范围（24 格并集包围盒）
const BOUNDS = { min_x: -1528, min_z: -920, max_x: 896, max_z: 2792 };
const OWNED = { min_x: -1558.26, min_z: -934.96, max_x: 934.96, max_z: 2804.87 };

// ---------------------------------------------------------------- 输出容器
const roads = [];
const zones = [];
const buildings = [];
const reserves = [];
const addRoad = (o) => { roads.push(o); return o; };

// ---- 外环（五边形边线，5 段）
for (let k = 0; k < 5; k += 1) {
  const a = VERTS[k]; const b = VERTS[(k + 1) % 5];
  addRoad({
    id: `edge-${k}`, label: `五边外环 ${k + 1} 段`, prefab: 'Medium Road', width_m: 24,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 100 + k,
    points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
  });
}
// ---- 同心内环（7 圈 × 5 段）
for (let k = 0; k < RING_R.length; k += 1) {
  for (let s = 0; s < 5; s += 1) {
    const a = P(RING_R[k], VERTEX_ANG[s]); const b = P(RING_R[k], VERTEX_ANG[(s + 1) % 5]);
    addRoad({
      id: `ring${RING_A[k]}-${s}`, label: `内环 a=${RING_A[k]} 第 ${s + 1} 边`, prefab: 'Medium Road', width_m: 24,
      level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 120 + k * 5 + s,
      points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
    });
  }
}
// ---- 放射大道（中心 → 五个角）
for (let k = 0; k < 5; k += 1) {
  const v = VERTS[k];
  addRoad({
    id: `radial-${SECTOR_ID[k]}`, label: `${SECTOR_ID[k].toUpperCase()} 放射大道（中心→顶点）`, prefab: 'Medium Road', width_m: 24,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 90 + k,
    points: [{ x: CENTER.x, z: CENTER.z }, { x: v.x, z: v.z }],
  });
}
// ---- 环间辐条（Small Road；每缺口辐条数封顶 5，最外缺口弧距 ≈233 m，落在住宅长边区间）
let spokeSeq = 0;
const GAP_A = [...RING_A, EDGE_A];
for (let g = 0; g + 1 < GAP_A.length; g += 1) {
  const a1 = GAP_A[g]; const a2 = GAP_A[g + 1];
  const r1 = snap8(a1 / COS36); const r2 = a2 === EDGE_A ? R_OUT : snap8(a2 / COS36);
  const aMid = (a1 + a2) / 2;
  const n = Math.min(5, Math.max(2, Math.round((aMid * 72 * DEG) / 128)));
  for (let w = 0; w < 5; w += 1) {
    for (let i = 0; i < n; i += 1) {
      const th = RADIAL_ANG[w] + ((i + 0.5) * 360) / (5 * n);
      const p1 = rayHitChord(th, r1); const p2 = rayHitChord(th, r2);
      if (!p1 || !p2) continue;
      spokeSeq += 1;
      addRoad({
        id: `spoke-${g}-${w}-${i}`, label: `辐条支路 g${g} w${w} i${i}`, prefab: 'Small Road', width_m: 16,
        level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 300 + spokeSeq,
        points: [{ x: snap8(p1.x), z: snap8(p1.z) }, { x: snap8(p2.x), z: snap8(p2.z) }],
      });
    }
  }
}
// ---- 高速连接道：北顶点 → 既有高速端点（锚定永久边 338759:5，星城同款实测点）
addRoad({
  id: 'highway-connector', label: '北顶点—既有高速连接道', prefab: 'Large Road', width_m: 32,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 80,
  points: [
    { x: VERTS[0].x, z: VERTS[0].z },
    { x: -88, z: 2520 },  // 折点：避开 (124,2544) 128 m 水格
    { x: 144, z: 2696, edge_id: '17780f4db204479bad97710e7f8fa7e8:338759:5' },
  ],
});
// ---- 南市政带（五边形南侧平地，dry band z −436~32）：承接大占地公服/市政
addRoad({
  id: 'campus-spine', label: '南市政带主干道', prefab: 'Medium Road', width_m: 24,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 70,
  points: [{ x: -312, z: 32 }, { x: -312, z: -416 }],   // 与外环南边中点 T 交
});
addRoad({
  id: 'campus-cross-1', label: '南市政带横一路', prefab: 'Medium Road', width_m: 24,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 71,
  points: [{ x: -696, z: -160 }, { x: 72, z: -160 }],
});
addRoad({
  id: 'campus-cross-2', label: '南市政带横二路', prefab: 'Medium Road', width_m: 24,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 72,
  points: [{ x: -600, z: -352 }, { x: -24, z: -352 }],
});

// ---------------------------------------------------------------- 建筑尺寸表（实时 prefab 目录实测）
const B = {
  Hospital01: [183.6, 79.6], HighSchool02: [95.6, 63.6], College01: [175.6, 127.6],
  MedicalClinic01: [87.6, 47.6], MedicalClinic02: [39.6, 39.6],
  ElementarySchool02: [71.6, 47.6],
  FireHouse01: [39.6, 39.6], FireStation01: [111.6, 143.6],
  PoliceStation01: [95.6, 55.6], PoliceStation02: [39.6, 39.6], PoliceHeadquarters01: [143.6, 159.6],
  Cemetery01: [127.6, 199.6], Crematorium01: [63.6, 79.6],
  Landfill01: [135.6, 119.6], RecyclingCenter01: [175.6, 143.6],
  RoadMaintenanceDepot01: [79.6, 95.6], ParkMaintenanceDepot01: [55.6, 79.6],
  EarlyDisasterWarningSystem01: [79.6, 55.6], CommunityPool01: [55.6, 55.6],
  CityPark01: [31.6, 31.6], CityPark02: [47.6, 47.6], CityPark03: [79.6, 63.6],
  CityPark08: [63.6, 63.6], Playground01: [15.6, 15.6], DogPark01: [31.6, 23.6],
  PostOffice02: [23.6, 31.6], WelfareOffice01: [119.6, 127.6],
  ParkingLot01: [39.6, 39.6], ParkingHall02: [47.6, 79.6],
  WastewaterTreatmentPlant01: [95.6, 79.6], GroundwaterPumpingStation01: [47.6, 47.6],
  WaterTower01: [31.6, 31.6], WaterTower02: [15.6, 15.6],
  SmallCoalPowerPlant01: [111.6, 127.6], WindTurbine01: [119.6, 119.6],
  TransformerStation01: [47.6, 55.6], TelecomTower01: [55.6, 55.6],
};

// ---------------------------------------------------------------- 旋转包围盒净距判定（复刻 planning-validator 口径）
function reservedOf(prefab) {
  const [sx, sz] = B[prefab] ?? [40, 40];
  return { x: Math.ceil((sx + 12) / 8) * 8, z: Math.ceil((sz + 12) / 8) * 8 };
}
const DEG2RAD = Math.PI / 180;
function obbCorners(center, hx, hz, deg) {
  const a = (deg ?? 0) * DEG2RAD;
  const cos = Math.cos(a); const sin = Math.sin(a);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
    .map(([dx, dz]) => ({ x: center.x + dx * cos - dz * sin, z: center.z + dx * sin + dz * cos }));
}
function segIntersectsObb(p0, p1, center, hx, hz, deg, pad) {
  const a = -(deg ?? 0) * DEG2RAD;
  const cos = Math.cos(a); const sin = Math.sin(a);
  const local = (p) => {
    const dx = p.x - center.x; const dz = p.z - center.z;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const s = local(p0); const e = local(p1);
  const HX = hx + pad; const HZ = hz + pad;
  let t0 = 0; let t1 = 1;
  for (const [o, d, lo, hi] of [[s.x, e.x - s.x, -HX, HX], [s.z, e.z - s.z, -HZ, HZ]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a1 = (lo - o) / d; let b1 = (hi - o) / d;
    if (a1 > b1) { const t = a1; a1 = b1; b1 = t; }
    t0 = Math.max(t0, a1); t1 = Math.min(t1, b1);
    if (t0 > t1) return false;
  }
  return true;
}
function envelopeOf(corners) {
  const xs = corners.map((p) => p.x); const zs = corners.map((p) => p.z);
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}
function envelopeOverlap(a, b) {
  return a.min_x < b.max_x && a.max_x > b.min_x && a.min_z < b.max_z && a.max_z > b.min_z;
}
// 允许落位区：五边形内部 或 南市政带（z < 24 的南侧平地，已避开 z<−436 水域与东西水缘）
function inPlaceArea(pos) {
  if (pointInPoly(pos, PENT)) return true;
  return pos.z < 24 && pos.z > -430 && pos.x > -1200 && pos.x < 500;
}
function isClear(pos, deg, prefab, report = null) {
  const r = reservedOf(prefab);
  const hx = r.x / 2; const hz = r.z / 2;
  const center = { x: snap8(pos.x), z: snap8(pos.z) };
  if (center.x - hx < BOUNDS.min_x || center.x + hx > BOUNDS.max_x) return false;
  if (center.z - hz < BOUNDS.min_z || center.z + hz > BOUNDS.max_z) return false;
  if (!inPlaceArea(center)) return false;
  for (const rd of roads) {
    const pad = Math.max(0, rd.width_m || 8) / 2;
    for (let i = 0; i + 1 < rd.points.length; i += 1) {
      if (segIntersectsObb(rd.points[i], rd.points[i + 1], center, hx, hz, deg, pad)) {
        if (report) report.push(`road ${rd.id}`);
        return false;
      }
    }
  }
  const A = envelopeOf(obbCorners(center, hx, hz, deg));
  for (const b of buildings) {
    const bb = b.reserved_size_m;
    const Bx = envelopeOf(obbCorners(b.position, bb.x / 2, bb.z / 2, b.rotation_degrees ?? 0));
    if (envelopeOverlap(A, Bx)) {
      if (report) report.push(`building ${b.id}`);
      return false;
    }
  }
  return true;
}
const placementFailures = [];
function addBuilding(o) {
  const [sx, sz] = B[o.prefab] ?? [40, 40];
  const r = reservedOf(o.prefab);
  buildings.push({
    id: o.id, label: o.label, prefab: o.prefab, name: o.label,
    kind: o.kind ?? 'service', category: o.category ?? 'city_service',
    planning_status: 'conceptual', placement_status: 'conceptual',
    rotation_source: 'unresolved', rotation_degrees: null, construction_status: 'planned',
    size_m: { x: sx, z: sz }, reserved_size_m: r,
    position: { x: snap8(o.position.x), z: snap8(o.position.z) },
  });
  reserves.push({
    x0: snap8(o.position.x - r.x / 2) - 8, x1: snap8(o.position.x + r.x / 2) + 8,
    z0: snap8(o.position.z - r.z / 2) - 8, z1: snap8(o.position.z + r.z / 2) + 8,
  });
}

// 沿路落位：在目标点附近找一条规划道路，沿路滑移 + 横向偏移搜索净距合格点
function placeAlong(o) {
  const r = reservedOf(o.prefab);
  const hx = r.x / 2; const hz = r.z / 2;
  const cand = [];
  for (const rd of roads) {
    if (rd.id === 'highway-connector') continue;
    for (let i = 0; i + 1 < rd.points.length; i += 1) {
      const a = rd.points[i]; const b = rd.points[i + 1];
      const vx = b.x - a.x; const vz = b.z - a.z;
      const len2 = vx * vx + vz * vz || 1;
      let t = ((o.target.x - a.x) * vx + (o.target.z - a.z) * vz) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(o.target.x - (a.x + t * vx), o.target.z - (a.z + t * vz));
      cand.push({ rd, seg: [a, b], d, t });
    }
  }
  cand.sort((p, q) => p.d - q.d);
  const tOrder = [];
  for (let dt = 0; dt <= 480; dt += 8) { tOrder.push(dt); if (dt > 0) tOrder.push(-dt); }
  let best = null;
  for (const c of cand.slice(0, 40)) {
    const [a, b] = c.seg;
    const ux = (b.x - a.x); const uz = (b.z - a.z);
    const len = Math.hypot(ux, uz) || 1;
    const nx = -uz / len; const nz = ux / len;
    const latBase = (hx * Math.abs(nx) + hz * Math.abs(nz)) + c.rd.width_m / 2 + 8;
    for (const side of [1, -1]) {
      for (const dt of tOrder) {
        const tt = c.t * len + dt;
        if (tt < 40 || tt > len - 8) continue;
        const base = { x: a.x + (ux / len) * tt, z: a.z + (uz / len) * tt };
        for (let extra = 0; extra <= 160; extra += 8) {
          const pos = { x: base.x + nx * (latBase + extra) * side, z: base.z + nz * (latBase + extra) * side };
          if (!isClear(pos, 0, o.prefab)) continue;
          const dTarget = Math.hypot(pos.x - o.target.x, pos.z - o.target.z);
          if (!best || dTarget < best.dTarget) best = { pos, dTarget };
          break;
        }
      }
    }
    if (best && best.dTarget < 200) break;
  }
  if (!best) {
    placementFailures.push(`${o.id}（${o.prefab}）沿路搜索找不到净距合格落位`);
    return false;
  }
  addBuilding({ ...o, position: best.pos });
  return true;
}

// ---------------------------------------------------------------- 服务设施落位
// 市中心核心（五边形内）
const CORE = [
  { id: 'core-park-a', label: '五心中央公园｜北园', prefab: 'CityPark08', target: P(112, 90) },
  { id: 'core-park-b', label: '五心中央公园｜西园', prefab: 'CityPark02', target: P(112, 198) },
  { id: 'core-park-c', label: '五心中央公园｜东园', prefab: 'CityPark02', target: P(112, 306) },
  { id: 'core-plaza', label: '五心市民广场', prefab: 'CityPark01', target: P(112, 18) },
  { id: 'core-pool', label: '市中心社区泳池', prefab: 'CommunityPool01', target: P(260, 270) },
  { id: 'core-clinic', label: '市中心诊所', prefab: 'MedicalClinic02', target: P(260, 162) },
  { id: 'core-post', label: '市中心邮局', prefab: 'PostOffice02', target: P(260, 90) },
];
for (const o of CORE) placeAlong(o);

// 各扇区街区级服务（小体量，扇区内沿环落位）
const SECTOR_NAME = { n: '北扇工业区', ne: '东北扇办公区', se: '东南扇住区', s: '南扇住区', w: '西扇住区' };
const SECTOR_SVCS = {
  n: [{ prefab: 'FireHouse01', label: '工业消防哨', r: 700 }],
  ne: [
    { prefab: 'FireHouse01', label: '消防哨', r: 600 },
    { prefab: 'PoliceStation02', label: '警务哨', r: 600 },
  ],
  se: [
    { prefab: 'ElementarySchool02', label: '社区小学', r: 700 },
    { prefab: 'MedicalClinic02', label: '社区诊所', r: 860 },
    { prefab: 'FireHouse01', label: '消防哨', r: 560 },
    { prefab: 'PoliceStation02', label: '警务哨', r: 560 },
    { prefab: 'CityPark02', label: '街区公园', r: 920 },
    { prefab: 'Playground01', label: '儿童活动场', r: 980 },
  ],
  s: [
    { prefab: 'ElementarySchool02', label: '社区小学', r: 700 },
    { prefab: 'MedicalClinic02', label: '社区诊所', r: 860 },
    { prefab: 'FireHouse01', label: '消防哨', r: 560 },
    { prefab: 'PoliceStation02', label: '警务哨', r: 560 },
    { prefab: 'CityPark02', label: '街区公园', r: 920 },
    { prefab: 'Playground01', label: '儿童活动场', r: 980 },
  ],
  w: [
    { prefab: 'MedicalClinic02', label: '社区诊所', r: 860 },
    { prefab: 'FireHouse01', label: '消防哨', r: 560 },
    { prefab: 'PoliceStation02', label: '警务哨', r: 560 },
    { prefab: 'CityPark02', label: '街区公园', r: 920 },
    { prefab: 'Playground01', label: '儿童活动场', r: 980 },
  ],
};
for (const [sid, svcs] of Object.entries(SECTOR_SVCS)) {
  const ang = RADIAL_ANG[SECTOR_ID.indexOf(sid)];
  for (const s of svcs) {
    placeAlong({
      id: `sec-${sid}-${s.prefab.toLowerCase()}-${s.r}`,
      label: `${SECTOR_NAME[sid]}｜${s.label}`, prefab: s.prefab,
      target: P(s.r, ang), category: 'city_service',
    });
  }
}

// 全城级大型服务 → 南市政带（120 m 环距内放不下 96 m 以上进深建筑）
const CAMPUS_SVCS = [
  { id: 'hospital', prefab: 'Hospital01', label: '市立医院', target: { x: -560, z: -92 } },
  { id: 'college', prefab: 'College01', label: '社区学院', target: { x: -300, z: -100 } },
  { id: 'welfare', prefab: 'WelfareOffice01', label: '市福利院', target: { x: -40, z: -100 } },
  { id: 'police-hq', prefab: 'PoliceHeadquarters01', label: '市警察总局', target: { x: -600, z: -228 } },
  { id: 'fire-hq', prefab: 'FireStation01', label: '市消防总局', target: { x: -360, z: -236 } },
  { id: 'police-branch', prefab: 'PoliceStation01', label: '西扇分局', target: { x: -120, z: -228 } },
  { id: 'highschool', prefab: 'HighSchool02', label: '市立高中', target: { x: 20, z: -236 } },
  { id: 'recycle', prefab: 'RecyclingCenter01', label: '资源回收中心', target: { x: -520, z: -288 } },
  { id: 'landfill', prefab: 'Landfill01', label: '垃圾填埋场', target: { x: -300, z: -292 } },
  { id: 'power-1', prefab: 'SmallCoalPowerPlant01', label: '小火电厂', target: { x: -80, z: -296 } },
  { id: 'cemetery', prefab: 'Cemetery01', label: '市立墓园', target: { x: -520, z: -440 } },
  { id: 'wastewater', prefab: 'WastewaterTreatmentPlant01', label: '污水处理厂', target: { x: -300, z: -432 } },
  { id: 'crematorium', prefab: 'Crematorium01', label: '火葬场', target: { x: -100, z: -432 } },
  { id: 'disaster', prefab: 'EarlyDisasterWarningSystem01', label: '灾害预警中心', target: { x: -380, z: -60 } },
  { id: 'road-depot', prefab: 'RoadMaintenanceDepot01', label: '道路维护场', target: { x: -244, z: -60 } },
  { id: 'park-depot', prefab: 'ParkMaintenanceDepot01', label: '公园维护场', target: { x: -380, z: -140 } },
  { id: 'groundwater-2', prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站 2', target: { x: -244, z: -140 } },
  { id: 'transformer-1', prefab: 'TransformerStation01', label: '变电站 1', target: { x: -244, z: -240 } },
  { id: 'park-ne', prefab: 'CityPark03', label: '办公区公园', target: { x: -380, z: -240 } },
  { id: 'school-w1', prefab: 'ElementarySchool02', label: '西扇第一小学（市政带校区）', target: { x: -120, z: -320 } },
  { id: 'school-w2', prefab: 'ElementarySchool02', label: '西扇第二小学（市政带校区）', target: { x: -20, z: -60 } },
];
for (const o of CAMPUS_SVCS) placeAlong({ ...o, category: o.prefab === 'Cemetery01' ? 'city_service' : 'city_service' });

// 市政小设施（五边形内）
const UTIL_IN = [
  { id: 'groundwater-1', prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站 1', target: P(420, 100) },
  { id: 'watertower-1', prefab: 'WaterTower01', label: '水塔 1', target: P(300, 140) },
  { id: 'watertower-2', prefab: 'WaterTower01', label: '水塔 2', target: P(520, 18) },
  { id: 'watertower-3', prefab: 'WaterTower02', label: '高位水塔', target: P(210, 250) },
  { id: 'transformer-2', prefab: 'TransformerStation01', label: '变电站 2', target: P(460, 16) },
  { id: 'telecom', prefab: 'TelecomTower01', label: '电信塔', target: P(560, 350) },
  { id: 'post-2', prefab: 'PostOffice02', label: '南扇邮局', target: P(750, 260) },
  { id: 'parking-1', prefab: 'ParkingLot01', label: '商业区停车场', target: P(360, 90) },
  { id: 'parking-2', prefab: 'ParkingLot01', label: '南扇停车场', target: P(470, 234) },
  { id: 'dogpark', prefab: 'DogPark01', label: '宠物公园', target: P(880, 220) },
];
for (const o of UTIL_IN) placeAlong({ ...o, category: 'utility_facility' });

// 风力发电机（南市政带外缘空地，不需道路）
const WIND = [
  { id: 'wind-1', target: { x: 200, z: -480 } },
  { id: 'wind-2', target: { x: 60, z: -560 } },
  { id: 'wind-3', target: { x: -200, z: -480 } },
];
for (const o of WIND) {
  placeAlong({ id: o.id, label: `风力发电机 ${o.id.slice(-1)}`, prefab: 'WindTurbine01', target: o.target, category: 'utility_facility' });
}

// ---------------------------------------------------------------- 用途表（圈层 a-band × 方位 sector）
const BAND_NAMES = ['core', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];
const USE = {
  core: { n: 'EU Commercial High', ne: 'EU Commercial High', se: 'EU Commercial High', s: 'EU Commercial High', w: 'EU Commercial High' },
  b1: { n: 'Office High', ne: 'Office High', se: 'EU Commercial High', s: 'EU Commercial High', w: 'EU Commercial High' },
  b2: { n: 'Office High', ne: 'Office High', se: 'EU Residential Mixed', s: 'EU Residential Mixed', w: 'EU Residential Mixed' },
  b3: { n: 'Office Low', ne: 'Office Low', se: 'EU Residential Medium', s: 'EU Residential Medium', w: 'EU Residential Medium' },
  b4: { n: 'Industrial Manufacturing', ne: 'Office Low', se: 'EU Residential Medium', s: 'EU Residential Medium Row', w: 'EU Residential Medium' },
  b5: { n: 'Industrial Manufacturing', ne: 'EU Commercial Low', se: 'EU Residential Medium Row', s: 'EU Residential Medium Row', w: 'EU Residential Low' },
  b6: { n: 'Industrial Manufacturing', ne: 'EU Residential Medium', se: 'EU Residential Low', s: 'EU Residential Low', w: 'EU Residential Low' },
  b7: { n: 'Industrial Manufacturing', ne: 'EU Residential Medium Row', se: 'EU Residential Low', s: 'EU Residential Low', w: 'EU Residential Low' },
};
const HH_M2 = {
  'EU Residential Low': 300, 'EU Residential Medium Row': 170,
  'EU Residential Medium': 120, 'EU Residential Mixed': 100,
};
function bandOf(aMetric) {
  const edges = [0, ...RING_A, EDGE_A];
  for (let k = 0; k + 1 < edges.length; k += 1) if (aMetric < edges[k + 1]) return k;
  return 7;
}
function sectorOf(angle) {
  let best = 0; let bd = Infinity;
  for (let k = 0; k < 5; k += 1) {
    const diff = Math.abs(((angle - RADIAL_ANG[k] + 540) % 360) - 180);
    if (diff < bd) { bd = diff; best = k; }
  }
  return best;
}
function useFor(aMetric, angle) {
  const band = BAND_NAMES[bandOf(aMetric)];
  const sector = SECTOR_ID[sectorOf(angle)];
  if (band === 'core' && aMetric < 96) return { zone: null, district: 'core' };
  return { zone: USE[band][sector], district: `${sector}-${band}` };
}

// ---------------------------------------------------------------- 分区栅格化（16 m 格 + 贪心最大矩形合并）
const allSegs = [];
for (const rd of roads) {
  for (let i = 0; i + 1 < rd.points.length; i += 1) {
    allSegs.push({ a: rd.points[i], b: rd.points[i + 1], half: rd.width_m / 2 });
  }
}
function segDist(px, pz, a, b) {
  const vx = b.x - a.x; const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz || 1;
  let t = ((px - a.x) * vx + (pz - a.z) * vz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * vx), pz - (a.z + t * vz));
}
const CELL = 16;
const NX = Math.ceil((BOUNDS.max_x - BOUNDS.min_x) / CELL);
const NZ = Math.ceil((BOUNDS.max_z - BOUNDS.min_z) / CELL);
const grid = new Array(NX * NZ).fill(null);   // key = zone|district 或 null
for (let iz = 0; iz < NZ; iz += 1) {
  for (let ix = 0; ix < NX; ix += 1) {
    const x = BOUNDS.min_x + ix * CELL + CELL / 2;
    const z = BOUNDS.min_z + iz * CELL + CELL / 2;
    if (!pointInPoly({ x, z }, PENT)) continue;
    if (distToPolyEdge({ x, z }, PENT) < 6) continue;
    let minCurb = Infinity;
    for (const s of allSegs) {
      const d = segDist(x, z, s.a, s.b) - s.half;
      if (d < minCurb) minCurb = d;
      if (minCurb < 0) break;
    }
    if (minCurb < 0 || minCurb > 48) continue;
    const { radius, angle } = polarOf(x, z);
    let phi = Infinity;
    for (const bA of BISECTOR_ANG) phi = Math.min(phi, Math.abs(((angle - bA + 540) % 360) - 180));
    const aMetric = radius * Math.cos(phi * DEG);
    if (aMetric > EDGE_A + 12) continue;
    let inReserve = false;
    for (const r of reserves) {
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) { inReserve = true; break; }
    }
    if (inReserve) continue;
    const use = useFor(aMetric, angle);
    if (!use.zone) continue;
    grid[iz * NX + ix] = `${use.zone}|${use.district.split('-')[0]}`;
  }
}
// 贪心最大矩形：扫描未访问格 → 向右扩展 → 向下扩展（整行同键）→ 输出互斥矩形
const visited = new Array(NX * NZ).fill(false);
const rects = [];
for (let iz = 0; iz < NZ; iz += 1) {
  for (let ix = 0; ix < NX; ix += 1) {
    const idx = iz * NX + ix;
    if (visited[idx] || !grid[idx]) continue;
    const key = grid[idx];
    let ix2 = ix;
    while (ix2 + 1 < NX && !visited[iz * NX + ix2 + 1] && grid[iz * NX + ix2 + 1] === key) ix2 += 1;
    let iz2 = iz;
    outer:
    while (iz2 + 1 < NZ) {
      for (let i2 = ix; i2 <= ix2; i2 += 1) {
        const j = (iz2 + 1) * NX + i2;
        if (visited[j] || grid[j] !== key) break outer;
      }
      iz2 += 1;
    }
    for (let jz = iz; jz <= iz2; jz += 1) for (let jx = ix; jx <= ix2; jx += 1) visited[jz * NX + jx] = true;
    rects.push({
      x0: BOUNDS.min_x + ix * CELL, x1: BOUNDS.min_x + (ix2 + 1) * CELL,
      z0: BOUNDS.min_z + iz * CELL, z1: BOUNDS.min_z + (iz2 + 1) * CELL, key,
    });
  }
}
// 同键矩形 → 栅格并集 → 边界环游提取直角多边形（一个键产 1~数个闭合多边形）
function unionPolygons(keyRects) {
  const xs = [...new Set(keyRects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const zs = [...new Set(keyRects.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const xi = new Map(xs.map((v, i) => [v, i]));
  const zi = new Map(zs.map((v, i) => [v, i]));
  const inside = new Set();
  for (const r of keyRects) {
    for (let iz = zi.get(r.z0); iz < zi.get(r.z1); iz += 1) {
      for (let ix = xi.get(r.x0); ix < xi.get(r.x1); ix += 1) inside.add(`${ix}:${iz}`);
    }
  }
  const isIn = (ix, iz) => ix >= 0 && ix < xs.length - 1 && iz >= 0 && iz < zs.length - 1 && inside.has(`${ix}:${iz}`);
  // 有向边界边（内部在左 → 逆时针环）
  const edges = new Map(); // "x,z" 起点 → [终点]
  const addEdge = (a, b) => {
    const k = `${a.x},${a.z}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };
  for (let iz = 0; iz < zs.length - 1; iz += 1) {
    for (let ix = 0; ix < xs.length - 1; ix += 1) {
      if (!isIn(ix, iz)) continue;
      const x0 = xs[ix]; const x1 = xs[ix + 1]; const z0 = zs[iz]; const z1 = zs[iz + 1];
      if (!isIn(ix, iz - 1)) addEdge({ x: x0, z: z0 }, { x: x1, z: z0 });
      if (!isIn(ix + 1, iz)) addEdge({ x: x1, z: z0 }, { x: x1, z: z1 });
      if (!isIn(ix, iz + 1)) addEdge({ x: x1, z: z1 }, { x: x0, z: z1 });
      if (!isIn(ix - 1, iz)) addEdge({ x: x0, z: z1 }, { x: x0, z: z0 });
    }
  }
  const polygons = [];
  while (edges.size) {
    const [startKey, outs] = [...edges][0];
    const start = startKey.split(',').map(Number);
    const loop = [{ x: start[0], z: start[1] }];
    let cur = outs.shift();
    if (!outs.length) edges.delete(startKey);
    while (cur.x !== start[0] || cur.z !== start[1]) {
      loop.push({ x: cur.x, z: cur.z });
      const k = `${cur.x},${cur.z}`;
      const nexts = edges.get(k);
      if (!nexts || !nexts.length) break;
      cur = nexts.shift();
      if (!nexts.length) edges.delete(k);
    }
    if (loop.length >= 4) polygons.push(loop);
  }
  return polygons;
}

const areaByZone = new Map();
let zoneSeq = 0;
// 按键分组 → 并集成多边形；环游自动产生「外圈（正有向面积）」与「洞（负有向面积）」，
// 洞是路/预留格，不单独成区，面积从所属外圈中扣除。
function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}
const keyRects = new Map();
for (const r of rects) {
  if (!keyRects.has(r.key)) keyRects.set(r.key, []);
  keyRects.get(r.key).push(r);
}
const keyLoops = [...keyRects.keys()].sort();
for (const key of keyLoops) {
  const [zone, district] = key.split('|');
  const loops = unionPolygons(keyRects.get(key));
  const outers = [];
  const holes = [];
  for (const poly of loops) {
    const a = signedArea(poly);
    if (a > 0) outers.push({ poly, area: a });
    else holes.push({ poly, area: -a });
  }
  for (const o of outers) {
    // 面积按多边形鞋带口径（与测试/复算自洽）；洞是路格，图面上由道路图层覆盖
    const area = o.area;
    if (area < 1) continue;
    zoneSeq += 1;
    zones.push({
      id: `z-${district}-${zoneSeq}`,
      kind: zone, label: `${district}｜${zone}`, district,
      area_m2: Math.round(area),
      polygon: o.poly,
    });
    areaByZone.set(zone, (areaByZone.get(zone) ?? 0) + area);
  }
}
if (zones.length > 1000) throw new Error(`分区多边形 ${zones.length} 超过 1024 上限`);

// ---------------------------------------------------------------- 人口核算
const peopleLo = 2.2; const peopleHi = 2.8;
let households = 0;
const hhBreakdown = [];
for (const [zone, area] of [...areaByZone].sort((a, b) => b[1] - a[1])) {
  const m2 = HH_M2[zone];
  if (!m2) continue;
  const hh = Math.round(area / m2);
  households += hh;
  hhBreakdown.push({ zone_type: zone, area_m2: Math.round(area), household_area_m2: m2, households: hh });
}
const populationMid = Math.round(households * (peopleLo + peopleHi) / 2);

// ---------------------------------------------------------------- 生成器断言
for (const p of [...roads.flatMap((r) => r.points), ...buildings.map((b) => b.position)]) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error(`非有限坐标 ${JSON.stringify(p)}`);
  if (p.x % 8 !== 0 || p.z % 8 !== 0) throw new Error(`未对齐 8 m 栅格 ${JSON.stringify(p)}`);
}
for (const r of roads) {
  if (r.points.length < 2) throw new Error(`道路 ${r.id} 点数不足`);
  for (const p of r.points) {
    if (p.x < OWNED.min_x || p.x > OWNED.max_x || p.z < OWNED.min_z || p.z > OWNED.max_z) {
      throw new Error(`道路 ${r.id} 超出已购地图格 ${JSON.stringify(p)}`);
    }
  }
}
const ids = new Set();
for (const o of [...roads, ...buildings, ...zones]) {
  if (!o.id) throw new Error('缺少 id');
  if (ids.has(o.id)) throw new Error(`id 重复 ${o.id}`);
  ids.add(o.id);
}
// 路网单一连通分量（允许被别的路中途横穿；容差 = 半宽和 + 2 m）
function segMinDist(s1, s2) {
  const d = (p, a, b) => segDist(p.x, p.z, a, b);
  let best = Math.min(d(s1.a, s2.a, s2.b), d(s1.b, s2.a, s2.b), d(s2.a, s1.a, s1.b), d(s2.b, s1.a, s1.b));
  const ccw = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const segIntersect = (p1, p2, p3, p4) => {
    const s1o = ccw(p1, p2, p3), s1t = ccw(p1, p2, p4), s2o = ccw(p3, p4, p1), s2t = ccw(p3, p4, p2);
    return ((s1o > 0) !== (s1t > 0)) && ((s2o > 0) !== (s2t > 0));
  };
  if (segIntersect(s1.a, s1.b, s2.a, s2.b)) best = 0;
  return best;
}
const parent = new Map();
const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (const r of roads) parent.set(r.id, r.id);
for (let i = 0; i < roads.length; i += 1) {
  for (let j = i + 1; j < roads.length; j += 1) {
    const A = roads[i]; const Bb = roads[j];
    const tol = (A.width_m + Bb.width_m) / 2 + 2;
    let done = false;
    for (let s1 = 0; s1 + 1 < A.points.length && !done; s1 += 1) {
      for (let s2 = 0; s2 + 1 < Bb.points.length; s2 += 1) {
        if (segMinDist({ a: A.points[s1], b: A.points[s1 + 1] }, { a: Bb.points[s2], b: Bb.points[s2 + 1] }) <= tol) {
          union(A.id, Bb.id); done = true; break;
        }
      }
    }
  }
}
const comps = new Set(roads.map((r) => find(r.id)));
if (comps.size !== 1) throw new Error(`路网不是单一连通分量：${comps.size} 个分量（${[...comps].join(',')}）`);
if (placementFailures.length) throw new Error(`落位失败 ${placementFailures.length} 项：${placementFailures.join('; ')}`);

// ---------------------------------------------------------------- 输出
const plan = { roads, buildings, zones, grid_exceptions: [], tracks: [], utilities: [] };
const planId = computeCityPlanId(BOUNDS, plan);

const doc = {
  plan_id: planId,
  city: '尼思',
  name: '五边形城总体规划',
  target_population: 20000,
  bounds: BOUNDS,
  render: {
    title: '尼思｜五边形城总体规划（五角放射 · 同心环带 · 南市政带，只读施工图草案）',
    width: 1600, height: 1600, view: 'surface', format: 'static_html',
  },
  water_cell_size_m: 32,
  terrain_cell_size_m: 64,
  morphology: {
    shape: 'regular pentagon (vertices snapped to 8 m grid, side deviation <= 0.5%)',
    center: CENTER,
    outer_radius_m: R_OUT,
    ring_apothems_m: RING_A,
    edge_apothem_m: EDGE_A,
    pentagon_area_m2: Math.round(2.5 * R_OUT * R_OUT * Math.sin(72 * DEG)),
  },
  golden_block: {
    curb_to_curb_m: 96,
    ring_road: { prefab: 'Medium Road', width_m: 24, center_spacing_m: 120 },
    spoke_road: { prefab: 'Small Road', width_m: 16, arc_spacing_m: '<= 233 (residential long-side interval)' },
  },
  districts: [
    { id: 'core', name: '五心商业核心', kind: 'commercial' },
    { id: 'n', name: '北扇工业区', kind: 'industrial' },
    { id: 'ne', name: '东北扇办公区', kind: 'office' },
    { id: 'se', name: '东南扇住区', kind: 'residential' },
    { id: 's', name: '南扇住区', kind: 'residential' },
    { id: 'w', name: '西扇住区', kind: 'residential' },
    { id: 'campus', name: '南市政带（文教医疗环卫）', kind: 'civic' },
  ],
  access_points: [
    {
      id: 'highway-connector',
      via: 'highway-connector',
      to: '既有高速 Highway Oneway - 2 lanes（永久边 338759:5）',
      position: { x: 144, z: 2692 },
      note: '全城唯一对外高速接入点；货车路径 高速 → 连接道 → 北顶点 → 外环 → 北扇工业区，不穿居住扇区。连接道设折点避开 (124,2544) 水格。',
    },
  ],
  accounting: {
    zone_area_by_type: [...areaByZone].map(([zone_type, area_m2]) => ({ zone_type, area_m2: Math.round(area_m2) })).sort((a, b) => b.area_m2 - a.area_m2),
    household_breakdown: hhBreakdown,
    households,
    people_per_household: [peopleLo, peopleHi],
    population_range: [Math.round(households * peopleLo), Math.round(households * peopleHi)],
    population_midpoint: populationMid,
  },
  basis: '分区面积由生成器按 16 m 栅格实算（只计距路缘 0–48 m 的可划区格，建筑预留剔除）；户均占地沿用本项目既有口径（低密 300 / 中密排屋 170 / 中密 120 / 混合 100 m²·户），每户 2.2–2.8 人。',
  notes: [
    { scope: 'buildings', text: '全部建筑为概念预留：尚未绑定精确道路边、朝向与原生候选，rotation_degrees 为 null。道路建成后须用 bind_city_plan_buildings 逐栋绑定并重新审图。' },
    { scope: 'roads', text: '放射大道与五边外环构成「角—中心」骨架；7 圈内环法距 120 m（Medium+Medium，路缘到路缘 96 m 黄金宽度），环间辐条 Small Road。极坐标布局不共享全局 8 m 相位，环距按实际几何落在 112–128 m 区间。超过 256 m 的路段由施工执行器按 240 m 安全线等分。' },
    { scope: 'campus', text: '南市政带位于五边形外、外环南边以南的干燥平地（z −436~32），由主干道+两条横路服务；医院/学院/警消总局/高中/墓园/火葬场/电厂/填埋场/回收/污水等大占地设施在此集中落位，避免切穿 120 m 环距的居住街区。' },
    { scope: 'utilities', text: '已购 24 格地表水采样为 0（水掩码在南北缘另有水域，规划已避开），供水采用地下水抽水站＋水塔，污水采用污水处理厂（无排污口）。施工前须用 list_utility_connection_points 复核端口与连接层。' },
    { scope: 'validation', text: 'BUILDING_ROTATION_UNRESOLVED 在 placement_status=conceptual 时必报，属施工图阶段应有状态；压路 / 互叠 / 越界告警必须为 0。' },
    { scope: 'clearance', text: '落位由生成器自动搜索：建筑占地按 reserved_size_m 轴对齐包围盒外扩道路半宽后与全部规划道路求交、与已落位建筑求交，沿路滑移取距目标最近净距合格点。' },
  ],
  disclaimer: '本图为只读施工图草案。所有建筑为概念预留，未绑定原生候选、朝向与道路边；正式施工须逐批走游戏原生 preview。规划按本存档（尼思）已购 24 格绘制，换存档须重新勘察重画。',
  plan,
};

const outPath = path.join(ROOT, 'plans', 'nis-pentagon-city-plan.json');
await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`);

console.log(JSON.stringify({
  plan_id: planId,
  roads: roads.length,
  zones: zones.length,
  buildings: buildings.length,
  households,
  population_range: doc.accounting.population_range,
  population_midpoint: populationMid,
  zone_area_by_type: doc.accounting.zone_area_by_type,
  out: outPath,
}, null, 2));
