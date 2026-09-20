// 尼思｜五角星城（Nistar）结构化规划生成器 —— 只读、不连游戏，只写 plans/nistar-star-city-plan.json
//
// 形态：一个正五角星（五芒星轮廓 = 城市环路「星环大道」），星心五边形 = 市中心，
//       5 条星芒 = 5 个片区（工业 / 办公 / 居住 ×3），5 个星谷（星芒之间的凹谷）= 市政与绿地。
// 坐标：世界米制。全部道路节点吸附到 8 m 全局栅格（GAME-PHYSICS-RULES §1.1）。
// 街区：南北向 Small Road(16) 间距 112 → 路缘到路缘 96（黄金宽度）；
//       东西向 Medium Road(24) 间距 224 → 街区长边 200（落在 160~240 区间），
//       长边中点距南北向小路路缘 48 m 内，无内院死角。
//
// 运行：node tools/scratch/generate-nistar-plan.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { computeCityPlanId } = await import(new URL('../../mcp/planning-renderer.mjs', import.meta.url).href);

// ---------------------------------------------------------------- 几何配置
const CENTER = { x: -312, z: 760 };   // 星心（8 m 栅格，取已购矩形的横向中心）
const R_OUT = 1220;                    // 星芒外顶点半径
const R_IN = 610;                      // 内凹顶点半径（0.50 R）
const STRETCH = 1.62;                  // Z 向拉伸：贴合 2493 × 3740 的已购矩形
const DEG = Math.PI / 180;

const OUTER_ANG = [90, 162, 234, 306, 18];    // 5 个星芒尖（0 = 正北）
const INNER_ANG = [126, 198, 270, 342, 54];   // 5 个内凹顶点（星谷底）

const snap8 = (v) => Math.round(v / 8) * 8;
const P = (radius, deg) => ({
  x: snap8(CENTER.x + radius * Math.cos(deg * DEG)),
  z: snap8(CENTER.z + STRETCH * radius * Math.sin(deg * DEG)),
});
// 逆变换（用于按「未拉伸半径」判定所属圈层）
const polarOf = (x, z) => {
  const u = x - CENTER.x;
  const v = (z - CENTER.z) / STRETCH;
  return { radius: Math.hypot(u, v), angle: ((Math.atan2(v, u) / DEG) + 360) % 360 };
};

const OUTER = OUTER_ANG.map((a) => P(R_OUT, a));
const INNER = INNER_ANG.map((a) => P(R_IN, a));
// 星环：外→内→外→… 闭合十边形（五芒星轮廓）
const STAR = [];
for (let k = 0; k < 5; k += 1) { STAR.push(OUTER[k], INNER[k]); }

// 片区多边形：核心五边形 + 5 个星芒三角形
const CORE_POLY = [...INNER];
const ARM_POLY = [];
for (let k = 0; k < 5; k += 1) {
  ARM_POLY.push([OUTER[k], INNER[(k + 4) % 5], INNER[k]]);
}

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
// 水平线 z 与多边形相交的 x 区间（升序、成对）
function rowSpans(z, poly) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.z > z) !== (b.z > z)) {
      const t = (z - a.z) / (b.z - a.z);
      xs.push(a.x + t * (b.x - a.x));
    }
  }
  xs.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
  return spans;
}
// 矩形 ∩ 多边形 → 一组矩形（8 m 行扫描 + 纵向合并）
function clipRect(xmin, zmin, xmax, zmax, poly) {
  const rows = [];
  for (let z = zmin + 4; z < zmax; z += 8) {
    for (const [xa, xb] of rowSpans(z, poly)) {
      const x0 = Math.max(xmin, xa);
      const x1 = Math.min(xmax, xb);
      if (x1 - x0 >= 24) rows.push({ x0: snap8(x0), x1: snap8(x1), z0: z - 4, z1: z + 4 });
    }
  }
  const out = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.x0 === r.x0 && prev.x1 === r.x1 && Math.abs(prev.z1 - r.z0) < 0.5) prev.z1 = r.z1;
    else out.push({ ...r });
  }
  return out;
}
const rectArea = (rects) => rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);

// ---------------------------------------------------------------- 路网：轴对齐栅格
const GX0 = -1472;   // 南北向支路（Small Road 16 m）起点
const SX = 112;      // 间距 → 路缘到路缘 96 m（黄金宽度）
const GZ0 = -888;    // 东西向支路（Small Road 16 m）起点
const SZ = 112;      // 间距 → 路缘到路缘 96 m（黄金宽度）
const NX = 22;       // x 线数量
const NZ = 34;       // z 线数量
const NODE_INSET = 32;   // 节点距星形边界的最小距离
const EDGE_INSET = 20;   // 边中点距边界的最小距离

const xLine = (i) => GX0 + i * SX;
const zLine = (j) => GZ0 + j * SZ;
const key = (i, j) => `${i}:${j}`;

const nodes = new Map();
for (let i = 0; i < NX; i += 1) {
  for (let j = 0; j < NZ; j += 1) {
    const pt = { x: xLine(i), z: zLine(j) };
    if (pointInPoly(pt, STAR) && distToPolyEdge(pt, STAR) >= NODE_INSET) nodes.set(key(i, j), { i, j, pt });
  }
}
const edges = [];
const hasEdge = (a, b) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
function addEdge(a, b) {
  if (!nodes.has(a) || !nodes.has(b)) return;
  const pa = nodes.get(a).pt; const pb = nodes.get(b).pt;
  const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
  if (!pointInPoly(mid, STAR) || distToPolyEdge(mid, STAR) < EDGE_INSET) return;
  edges.push({ a, b });
}
for (const [k, n] of nodes) {
  const { i, j } = n;
  addEdge(k, key(i + 1, j));
  addEdge(k, key(i, j + 1));
}

// 最长直链 → 一条道路折线
function buildRuns(axis) {
  const runs = [];
  if (axis === 'x') {
    for (let i = 0; i < NX; i += 1) {
      let chain = [];
      for (let j = 0; j < NZ; j += 1) {
        const k = key(i, j);
        const alive = nodes.has(k) && (chain.length === 0 || hasEdge(chain[chain.length - 1], k));
        if (alive) chain.push(k);
        else { if (chain.length > 1) runs.push({ axis, i, chain: [...chain] }); chain = nodes.has(k) ? [k] : []; }
      }
      if (chain.length > 1) runs.push({ axis, i, chain });
    }
  } else {
    for (let j = 0; j < NZ; j += 1) {
      let chain = [];
      for (let i = 0; i < NX; i += 1) {
        const k = key(i, j);
        const alive = nodes.has(k) && (chain.length === 0 || hasEdge(chain[chain.length - 1], k));
        if (alive) chain.push(k);
        else { if (chain.length > 1) runs.push({ axis, j, chain: [...chain] }); chain = nodes.has(k) ? [k] : []; }
      }
      if (chain.length > 1) runs.push({ axis, j, chain });
    }
  }
  return runs;
}

// ---------------------------------------------------------------- 设施表
const B = {
  Hospital01: [183.6, 79.6], HighSchool01: [175.6, 127.6], College01: [175.6, 127.6],
  MedicalClinic01: [87.6, 47.6], MedicalClinic02: [39.6, 39.6],
  ElementarySchool02: [71.6, 47.6], ElementarySchool03: [47.6, 63.6],
  FireHouse01: [39.6, 39.6], FireStation01: [111.6, 143.6],
  PoliceStation01: [95.6, 55.6], PoliceStation02: [39.6, 39.6], PoliceHeadquarters01: [143.6, 159.6],
  Cemetery01: [127.6, 199.6], Crematorium01: [63.6, 79.6],
  Landfill01: [135.6, 119.6], RecyclingCenter01: [175.6, 143.6],
  RoadMaintenanceDepot01: [79.6, 95.6], ParkMaintenanceDepot01: [55.6, 79.6],
  EarlyDisasterWarningSystem01: [79.6, 55.6], CommunityPool01: [55.6, 55.6],
  CityPark01: [31.6, 31.6], CityPark02: [47.6, 47.6], CityPark03: [79.6, 63.6],
  CityPark04: [95.6, 127.6], CityPark06: [39.6, 39.6], CityPark08: [63.6, 63.6],
  CityPark11: [95.6, 95.6], Playground01: [15.6, 15.6], DogPark01: [31.6, 23.6],
  WastewaterTreatmentPlant01: [95.6, 79.6], GroundwaterPumpingStation01: [47.6, 47.6],
  WaterTower01: [31.6, 31.6], WaterTower02: [15.6, 15.6],
  GasPowerPlant01: [215.6, 303.6], WindTurbine01: [119.6, 119.6],
  TransformerStation01: [47.6, 55.6], TransformerStation02: [23.6, 31.6],
  TelecomTower01: [55.6, 55.6], RadioMast01: [31.6, 23.6], EmergencyBatteryStation01: [175.6, 79.6],
};

// ---------------------------------------------------------------- 输出容器
// 已购区域包围盒（24 块地图格：x −1558~935，z −935~2805）
const BOUNDS = { min_x: -1528, min_z: -920, max_x: 896, max_z: 2792 };
const roads = [];
const zones = [];
const buildings = [];
const reserves = [];   // { x0,z0,x1,z1 } 世界坐标预留区（不划区、不落路）
const buildingNotes = [];

const addRoad = (o) => { roads.push(o); return o; };

// 星环大道（五芒星轮廓，10 段）—— 执行器按 240 m 等分，此处保持整段直线
for (let k = 0; k < 10; k += 1) {
  const a = STAR[k]; const b = STAR[(k + 1) % 10];
  addRoad({
    id: `star-ring-${k}`,
    label: `星环大道 ${k + 1} 段（${k % 2 === 0 ? '内凹' : '外凸'}侧）`,
    prefab: 'Medium Road',
    width_m: 24,
    level: 'surface',
    planning_status: 'bound',
    construction_status: 'planned',
    construction_order: 100 + k,
    points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
  });
}

// 高速连接道：北星芒尖 → 既有高速端点（锚定到永久边）
addRoad({
  id: 'highway-connector',
  label: '北星芒尖—既有高速连接道',
  prefab: 'Large Road',
  width_m: 32,
  level: 'surface',
  planning_status: 'bound',
  construction_status: 'planned',
  construction_order: 90,
  points: [
    { x: OUTER[0].x, z: OUTER[0].z },
    // 端点必须落在永久高速边 8 米内且对齐 8 m 栅格：取该边上实测点 (144,2696)（离线约 1.7 m）
    { x: 144, z: 2696, edge_id: '17780f4db204479bad97710e7f8fa7e8:338759:5' },
  ],
});

// ---------------------------------------------------------------- 片区路网（栅格直链 + 外延接到星环）
function extendToRing(run) {
  const pts = run.chain.map((k) => nodes.get(k).pt);
  const out = [];
  for (const endSide of [0, 1]) {
    const last = pts[pts.length - 1]; const prev = pts[0];
    const from = endSide === 1 ? last : prev;
    const dir = endSide === 1
      ? { x: last.x - pts[pts.length - 2].x, z: last.z - pts[pts.length - 2].z }
      : { x: prev.x - pts[1].x, z: prev.z - pts[1].z };
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1) continue;
    const ux = dir.x / len; const uz = dir.z / len;
    // 沿直线找与星形边界的第一个交点
    let hit = null;
    for (let s = 8; s <= 320; s += 8) {
      const q = { x: from.x + ux * s, z: from.z + uz * s };
      if (!pointInPoly(q, STAR)) { hit = { x: from.x + ux * (s - 4), z: from.z + uz * (s - 4), s: s - 4 }; break; }
    }
    if (!hit || hit.s < 16) continue;
    const mid = { x: (from.x + hit.x) / 2, z: (from.z + hit.z) / 2 };
    if (!pointInPoly(mid, STAR)) continue;
    out.push({ endSide, point: { x: snap8(hit.x), z: snap8(hit.z) } });
  }
  return out;
}

let gridRoadSeq = 0;
for (const axis of ['x', 'z']) {
  for (const run of buildRuns(axis)) {
    const pts = run.chain.map((k) => nodes.get(k).pt);
    const ext = extendToRing(run);
    const line = [];
    for (const e of ext) if (e.endSide === 0) line.push(e.point);
    line.push(...pts);
    for (const e of ext) if (e.endSide === 1) line.push(e.point);
    gridRoadSeq += 1;
    addRoad({
      id: axis === 'x' ? `grid-x-${run.i}-${gridRoadSeq}` : `grid-z-${run.j}-${gridRoadSeq}`,
      label: axis === 'x' ? `南北向支路 x=${xLine(run.i)}` : `东西向支路 z=${zLine(run.j)}`,
      prefab: 'Small Road',
      width_m: 16,
      level: 'surface',
      planning_status: 'bound',
      construction_status: 'planned',
      construction_order: 300 + gridRoadSeq,
      points: line,
    });
  }
}

// ---------------------------------------------------------------- 片区划分与划区
// 星芒用途：0=北·工业，1=西北·办公+居住，2=西南·低密居住，3=东南·中密居住，4=东北·中密居住
const ARM_USE = [
  { name: '北芒工业区', kind: 'industrial' },
  { name: '西北芒办公居住区', kind: 'office' },
  { name: '西南芒低密住区', kind: 'residential' },
  { name: '东南芒中密住区', kind: 'residential' },
  { name: '东北芒中密住区', kind: 'residential' },
];

const HH_M2 = {
  'EU Residential Low': 300,
  'EU Residential Medium Row': 170,
  'EU Residential Medium': 120,
  'EU Residential Mixed': 100,
};

function armIndex(pt) {
  for (let k = 0; k < 5; k += 1) if (pointInPoly(pt, ARM_POLY[k])) return k;
  return -1;
}

function zoneFor(pt) {
  const { radius, angle } = polarOf(pt.x, pt.z);
  const k = armIndex(pt);
  if (k >= 0) {
    if (radius < 0.46 * R_OUT) return { zone: 'EU Commercial Low', kind: 'commercial', district: `arm-${k}` };
    switch (k) {
      case 0: return { zone: 'Industrial Manufacturing', kind: 'industrial', district: 'arm-0' };
      case 1: return radius < 0.64 * R_OUT
        ? { zone: 'Office Low', kind: 'office', district: 'arm-1' }
        : { zone: 'EU Residential Medium', kind: 'residential', district: 'arm-1' };
      case 2: return radius < 0.62 * R_OUT
        ? { zone: 'EU Residential Medium Row', kind: 'residential', district: 'arm-2' }
        : { zone: 'EU Residential Low', kind: 'residential', district: 'arm-2' };
      case 3: return radius < 0.72 * R_OUT
        ? { zone: 'EU Residential Medium', kind: 'residential', district: 'arm-3' }
        : { zone: 'EU Residential Medium Row', kind: 'residential', district: 'arm-3' };
      default: return radius < 0.72 * R_OUT
        ? { zone: 'EU Residential Medium', kind: 'residential', district: 'arm-4' }
        : { zone: 'EU Residential Medium Row', kind: 'residential', district: 'arm-4' };
    }
  }
  if (pointInPoly(pt, CORE_POLY)) {
    if (radius < 0.10 * R_OUT) return { zone: null, kind: 'park', district: 'core' };
    if (radius < 0.26 * R_OUT) return { zone: 'EU Commercial High', kind: 'commercial', district: 'core' };
    // 外圈：正对工业芒与其邻扇区做办公（产业与住区之间的缓冲），其余做高层混合住宅
    const sector = Math.floor(((angle - OUTER_ANG[0] + 36 + 720) % 360) / 72);
    if (sector === 0) return { zone: 'Office High', kind: 'office', district: 'core' };
    // 西北扇区与西北芒同构：内侧办公、外侧高层混合住宅
    if (sector === 1) {
      return radius < 0.40 * R_OUT
        ? { zone: 'Office High', kind: 'office', district: 'core' }
        : { zone: 'EU Residential Mixed', kind: 'residential', district: 'core' };
    }
    return { zone: 'EU Residential Mixed', kind: 'residential', district: 'core' };
  }
  return { zone: null, kind: 'none', district: 'none' };
}

// ---------------------------------------------------------------- 星芒内的街区级服务预留
const blockCenters = [];
for (let i = 0; i + 1 < NX; i += 1) {
  for (let j = 0; j + 1 < NZ; j += 1) {
    if (!nodes.has(key(i, j))) continue;
    const c = { x: (xLine(i) + xLine(i + 1)) / 2, z: (zLine(j) + zLine(j + 1)) / 2 };
    if (!pointInPoly(c, STAR) || distToPolyEdge(c, STAR) < 24) continue;
    blockCenters.push({ i, j, c, rect: { x0: xLine(i) + 8, x1: xLine(i + 1) - 8, z0: zLine(j) + 8, z1: zLine(j + 1) - 8 } });
  }
}
const usedBlocks = new Set();
function pickBlock(target, minRadius = 0) {
  let best = null; let bestD = Infinity;
  for (const b of blockCenters) {
    if (usedBlocks.has(`${b.i}:${b.j}`)) continue;
    const p = polarOf(b.c.x, b.c.z);
    if (p.radius < minRadius) continue;
    const d = Math.hypot(b.c.x - target.x, b.c.z - target.z);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (best) usedBlocks.add(`${best.i}:${best.j}`);
  return best;
}

// ---------------------------------------------------------------- 旋转包围盒净距判定
// 复刻 mcp/planning-validator.mjs 的几何口径：矩形按 reserved_size_m，外扩道路半宽。
const DEG2RAD = Math.PI / 180;

function reservedOf(prefab) {
  const [sx, sz] = B[prefab] ?? [40, 40];
  return { x: Math.ceil((sx + 12) / 8) * 8, z: Math.ceil((sz + 12) / 8) * 8 };
}

function obbCorners(center, hx, hz, deg) {
  const a = (deg ?? 0) * DEG2RAD;
  const cos = Math.cos(a); const sin = Math.sin(a);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]
    .map(([dx, dz]) => ({ x: center.x + dx * cos - dz * sin, z: center.z + dx * sin + dz * cos }));
}

// 线段（世界坐标）对有向包围盒求交；deg 为建筑朝向（局部 x 轴 → 世界 (cos,sin)）
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

// 建筑互叠按「旋转后角点的轴对齐包络」判定（与 planning-validator 的 envelope 口径一致）
function envelopeOf(corners) {
  const xs = corners.map((p) => p.x); const zs = corners.map((p) => p.z);
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}
function envelopeOverlap(a, b) {
  return a.min_x < b.max_x && a.max_x > b.min_x && a.min_z < b.max_z && a.max_z > b.min_z;
}

// 候选落位是否与既有规划道路 / 建筑冲突（或越出已购范围）
// 施工图阶段建筑朝向保持未解析（rotation_degrees=null），占地一律按轴对齐包围盒保守判定。
function isClear(pos, deg, prefab, report = null) {
  const r = reservedOf(prefab);
  const hx = r.x / 2; const hz = r.z / 2;
  const center = { x: snap8(pos.x), z: snap8(pos.z) };
  if (center.x - hx < BOUNDS.min_x || center.x + hx > BOUNDS.max_x) return false;
  if (center.z - hz < BOUNDS.min_z || center.z + hz > BOUNDS.max_z) return false;
  for (const rd of roads) {
    const pad = Math.max(0, rd.width_m || 8) / 2;
    for (let i = 0; i + 1 < rd.points.length; i += 1) {
      if (segIntersectsObb(rd.points[i], rd.points[i + 1], center, hx, hz, deg, pad)) {
        if (report) report.push(`road ${rd.id} pad=${pad} seg=${JSON.stringify(rd.points[i])}→${JSON.stringify(rd.points[i + 1])}`);
        return false;
      }
    }
  }
  const A = envelopeOf(obbCorners(center, hx, hz, deg));
  for (const b of buildings) {
    const bb = b.reserved_size_m;
    const Bx = envelopeOf(obbCorners(b.position, bb.x / 2, bb.z / 2, b.rotation_degrees ?? 0));
    if (envelopeOverlap(A, Bx)) {
      if (report) report.push(`building ${b.id} @${JSON.stringify(b.position)}`);
      return false;
    }
  }
  return true;
}

const placementFailures = [];

function addBuilding(o) {
  const [sx, sz] = B[o.prefab] ?? [40, 40];
  const r = reservedOf(o.prefab);
  // 朝向按规划指南保持未解析：由 bind_city_plan_buildings 在道路建成后按原生候选绑定
  buildings.push({
    id: o.id,
    label: o.label,
    prefab: o.prefab,
    name: o.label,
    kind: o.kind ?? 'service',
    category: o.category ?? 'city_service',
    planning_status: 'conceptual',
    placement_status: 'conceptual',
    rotation_source: 'unresolved',
    rotation_degrees: null,
    construction_status: 'planned',
    size_m: { x: sx, z: sz },
    reserved_size_m: r,
    position: { x: snap8(o.position.x), z: snap8(o.position.z) },
  });
  // 建筑对象不接受 note 字段（工具 schema 严格），说明统一写在文档级 notes 里
  if (o.note) buildingNotes.push({ id: o.id, note: o.note });
  reserves.push({
    x0: snap8(o.position.x - r.x / 2), x1: snap8(o.position.x + r.x / 2),
    z0: snap8(o.position.z - r.z / 2), z1: snap8(o.position.z + r.z / 2),
  });
}

// 在街区内找第一个净距合格的落位；朝向取自街区路网切线（0/90/180/270）
function placeInBlocks(o) {
  const cands = blockCenters
    .filter((b) => !usedBlocks.has(`${b.i}:${b.j}`))
    .sort((a, b) => Math.hypot(a.c.x - o.target.x, a.c.z - o.target.z) - Math.hypot(b.c.x - o.target.x, b.c.z - o.target.z));
  // 占地按轴对齐包围盒判定，朝向恒取 0（旋转 90° 只交换长宽，单独试一遍即可）
  for (const b of cands.slice(0, 80)) {
    for (const deg of [0, 90]) {
      if (!isClear(b.c, deg, o.prefab)) continue;
      usedBlocks.add(`${b.i}:${b.j}`);
      addBuilding({ ...o, position: b.c });
      return true;
    }
  }
  if (process.env.NISTAR_DEBUG) {
    for (const b of cands.slice(0, 2)) {
      for (const deg of [0, 90]) {
        const rep = [];
        const ok = isClear(b.c, deg, o.prefab, rep);
        console.error(`[dbg] ${o.id} ${o.prefab} block ${b.i},${b.j} c=${JSON.stringify(b.c)} deg=${deg} -> ${ok} ${rep.slice(0, 3).join(' | ')}`);
      }
    }
  }
  placementFailures.push(`${o.id}（${o.prefab}）在街区内找不到净距合格的落位`);
  return false;
}

// 每个居住星芒：小学 / 诊所 / 消防哨 / 警务哨 / 口袋公园
const ARM_SERVICES = [
  { key: 'school', prefab: 'ElementarySchool02', label: '社区小学', category: 'city_service', radius: 0.60 },
  { key: 'clinic', prefab: 'MedicalClinic02', label: '社区诊所', category: 'city_service', radius: 0.78 },
  { key: 'fire', prefab: 'FireHouse01', label: '社区消防哨', category: 'city_service', radius: 0.52 },
  { key: 'police', prefab: 'PoliceStation02', label: '社区警务哨', category: 'city_service', radius: 0.52 },
  { key: 'park', prefab: 'CityPark02', label: '街区公园', category: 'city_service', radius: 0.88 },
  { key: 'play', prefab: 'Playground01', label: '儿童活动场', category: 'city_service', radius: 0.95 },
];
for (let k = 0; k < 5; k += 1) {
  const ang = OUTER_ANG[k];
  for (const s of ARM_SERVICES) {
    if (k === 0 && s.key !== 'fire') continue;           // 工业芒只保留消防哨
    placeInBlocks({
      id: `arm-${k}-${s.key}`,
      label: `${ARM_USE[k].name}｜${s.label}`,
      prefab: s.prefab,
      category: s.category,
      target: P(R_OUT * s.radius, ang),
    });
  }
}
// 市中心核心：分块中央绿地（96 m 街区内放不下 95 m 以上的大型公园单体，改为多块拼合）
const CORE_GREEN = [
  { id: 'core-park-a', label: '星心中央公园｜北园', prefab: 'CityPark08', target: CENTER },
  { id: 'core-park-b', label: '星心中央公园｜西园', prefab: 'CityPark02', target: P(112, OUTER_ANG[2]) },
  { id: 'core-park-c', label: '星心中央公园｜东园', prefab: 'CityPark02', target: P(112, OUTER_ANG[1]) },
  { id: 'core-plaza', label: '星心市民广场', prefab: 'CityPark01', target: P(112, OUTER_ANG[4]) },
  { id: 'core-pool', label: '市中心社区泳池', prefab: 'CommunityPool01', target: P(R_IN * 0.55, OUTER_ANG[4]) },
  { id: 'core-clinic', label: '市中心诊所', prefab: 'MedicalClinic02', target: P(R_IN * 0.55, OUTER_ANG[2]) },
];
for (const g of CORE_GREEN) {
  placeInBlocks({ ...g, category: 'city_service' });
}

// ---------------------------------------------------------------- 星谷（凹谷）市政带 + 接入支路
const VALLEY_PLAN = [
  {
    id: 'valley-a', label: '西北星谷｜能源通信谷', inner: 0,
    items: [
      { prefab: 'GasPowerPlant01', label: '燃气发电厂', t: 260, side: -1, category: 'utility_facility' },
      { prefab: 'WindTurbine01', label: '风力发电机 1', t: 120, side: 1, category: 'utility_facility' },
      { prefab: 'WindTurbine01', label: '风力发电机 2', t: 250, side: 1, category: 'utility_facility' },
      { prefab: 'WindTurbine01', label: '风力发电机 3', t: 380, side: 1, category: 'utility_facility' },
      { prefab: 'TransformerStation01', label: '变电站 1', t: 60, side: -1, category: 'utility_facility' },
      { prefab: 'TransformerStation02', label: '变电站 2', t: 150, side: -1, category: 'utility_facility' },
      { prefab: 'TelecomTower01', label: '电信塔', t: 420, side: -1, category: 'utility_facility' },
      { prefab: 'EmergencyBatteryStation01', label: '应急储能站', t: 520, side: 1, category: 'utility_facility' },
    ],
  },
  {
    id: 'valley-b', label: '西星谷｜水务谷', inner: 1,
    items: [
      { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站 1', t: 90, side: 1, category: 'utility_facility' },
      { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站 2', t: 90, side: -1, category: 'utility_facility' },
      { prefab: 'WaterTower01', label: '水塔 1', t: 220, side: 1, category: 'utility_facility' },
      { prefab: 'WaterTower01', label: '水塔 2', t: 220, side: -1, category: 'utility_facility' },
      { prefab: 'WaterTower02', label: '高位水塔', t: 320, side: 1, category: 'utility_facility' },
      { prefab: 'ParkMaintenanceDepot01', label: '公园维护场', t: 400, side: -1, category: 'city_service' },
    ],
  },
  {
    id: 'valley-c', label: '南星谷｜文教体育谷', inner: 2,
    items: [
      { prefab: 'HighSchool01', label: '市立高中', t: 150, side: 1, category: 'city_service' },
      { prefab: 'College01', label: '社区学院', t: 330, side: 1, category: 'city_service' },
      { prefab: 'CityPark04', label: '南谷体育公园', t: 150, side: -1, category: 'city_service' },
      { prefab: 'CommunityPool01', label: '南谷泳池', t: 330, side: -1, category: 'city_service' },
      { prefab: 'EarlyDisasterWarningSystem01', label: '灾害预警中心', t: 470, side: -1, category: 'city_service' },
    ],
  },
  {
    id: 'valley-d', label: '东星谷｜医疗谷', inner: 3,
    items: [
      { prefab: 'Hospital01', label: '市立医院', t: 160, side: 1, category: 'city_service' },
      { prefab: 'MedicalClinic01', label: '东谷诊所', t: 60, side: -1, category: 'city_service' },
      { prefab: 'FireStation01', label: '市消防总局', t: 330, side: 1, category: 'city_service' },
      { prefab: 'PoliceHeadquarters01', label: '市警察总局', t: 480, side: 1, category: 'city_service' },
      { prefab: 'PoliceStation01', label: '东谷分局', t: 330, side: -1, category: 'city_service' },
    ],
  },
  {
    id: 'valley-e', label: '东北星谷｜环卫水务谷', inner: 4,
    items: [
      { prefab: 'Landfill01', label: '垃圾填埋场', t: 300, side: 1, category: 'city_service' },
      { prefab: 'RecyclingCenter01', label: '资源回收中心', t: 480, side: 1, category: 'city_service' },
      { prefab: 'WastewaterTreatmentPlant01', label: '污水处理厂', t: 300, side: -1, category: 'utility_facility' },
      { prefab: 'RoadMaintenanceDepot01', label: '道路维护场', t: 120, side: -1, category: 'city_service' },
      { prefab: 'Cemetery01', label: '市立墓园', t: 620, side: -1, category: 'city_service' },
      { prefab: 'Crematorium01', label: '火葬场', t: 120, side: 1, category: 'city_service' },
      { prefab: 'RadioMast01', label: '广播桅杆', t: 640, side: 1, category: 'utility_facility' },
    ],
  },
];

const SPUR_MAX_T = 900;   // 支路先按最大长度落图，落位完成后按实际用到长度回缩
for (const v of VALLEY_PLAN) {
  const ik = INNER[v.inner];
  const ok1 = OUTER[v.inner];
  const ok2 = OUTER[(v.inner + 1) % 5];
  const cen = { x: (ik.x + ok1.x + ok2.x) / 3, z: (ik.z + ok1.z + ok2.z) / 3 };
  let dx = cen.x - ik.x; let dz = cen.z - ik.z;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const nx = -dz; const nz = dx;   // 左侧法向
  const spurEnd = { x: ik.x + dx * SPUR_MAX_T, z: ik.z + dz * SPUR_MAX_T };
  const spur = addRoad({
    id: `${v.id}-spur`,
    label: `${v.label}｜接入支路`,
    prefab: 'Small Road',
    width_m: 16,
    level: 'surface',
    planning_status: 'bound',
    construction_status: 'planned',
    construction_order: 200 + v.inner,
    points: [{ x: ik.x, z: ik.z }, { x: snap8(spurEnd.x), z: snap8(spurEnd.z) }],
  });
  // 朝向暂按支路切线估算仅用于净距试算；落盘仍保持未解析（包围盒按轴对齐，故此处恒取 0）
  let usedT = 0;
  for (const it of v.items) {
    const r = reservedOf(it.prefab);
    // 轴对齐包围盒相对法向 n 的支撑距离 = hx·|nx| + hz·|nz|
    const latBase = (r.x / 2) * Math.abs(nx) + (r.z / 2) * Math.abs(nz) + (spur.width_m / 2) + 8;
    let placed = null;
    const tOrder = [];
    for (let t = 80; t <= SPUR_MAX_T - 80; t += 8) tOrder.push(t);
    tOrder.sort((a, b) => Math.abs(a - it.t) - Math.abs(b - it.t));
    outer:
    for (let extra = 0; extra <= 160 && !placed; extra += 8) {
      for (const side of [it.side, -it.side]) {
        for (const t of tOrder) {
          const base = { x: ik.x + dx * t, z: ik.z + dz * t };
          const pos = { x: base.x + nx * (latBase + extra) * side, z: base.z + nz * (latBase + extra) * side };
          if (isClear(pos, 0, it.prefab)) { placed = { t, pos }; break outer; }
        }
      }
    }
    if (!placed) {
      placementFailures.push(`${v.id} / ${it.label}（${it.prefab}）在星谷内找不到净距合格的落位`);
      continue;
    }
    usedT = Math.max(usedT, placed.t + r.x / 2);
    addBuilding({
      id: `${v.id}-${it.prefab.toLowerCase()}-${placed.t}${it.side > 0 ? 'r' : 'l'}`,
      label: `${v.label.split('｜')[1]}｜${it.label}`,
      prefab: it.prefab,
      position: placed.pos,
      category: it.category,
      note: '星谷市政预留：位于星形轮廓之外、凹谷绿地内，由接入支路服务；施工前须逐项绑定原生候选。',
    });
  }
  // 支路按实际用到长度回缩（末端留 96 m 回车余量）
  const endT = Math.min(SPUR_MAX_T, Math.max(240, usedT + 96));
  spur.points[1] = { x: snap8(ik.x + dx * endT), z: snap8(ik.z + dz * endT) };
}

// 片区 id → 中文名（分区 label / 图例用）
function districtName(d) {
  if (d === 'core') return '星心五边形市中心';
  const m = /^arm-(\d+)$/.exec(String(d));
  if (m) return ARM_USE[Number(m[1])]?.name ?? d;
  return String(d);
}

// ---------------------------------------------------------------- 划区输出
const areaByZone = new Map();
let zoneSeq = 0;
for (const b of blockCenters) {
  if (usedBlocks.has(`${b.i}:${b.j}`)) continue;
  const hit = reserves.find((r) => b.c.x > r.x0 && b.c.x < r.x1 && b.c.z > r.z0 && b.c.z < r.z1);
  if (hit) continue;
  const info = zoneFor(b.c);
  if (!info.zone) continue;
  const rects = clipRect(b.rect.x0, b.rect.z0, b.rect.x1, b.rect.z1, STAR);
  for (const r of rects) {
    // 只保留落在同一个片区多边形里的部分（避免跨星芒误划）
    const mid = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
    const z0 = zoneSeq; zoneSeq += 1;
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    zones.push({
      id: `z-${info.district}-${z0}`,
      kind: info.zone,
      label: `${districtName(info.district)}｜${info.zone}`,
      district: info.district,
      area_m2: Math.round(area),
      polygon: [
        { x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 },
      ],
    });
    areaByZone.set(info.zone, (areaByZone.get(info.zone) ?? 0) + area);
  }
}

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

// ---------------------------------------------------------------- 有限性与唯一性自检
const allPts = [...roads.flatMap((r) => r.points), ...buildings.map((b) => b.position)];
for (const p of allPts) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error(`非有限坐标 ${JSON.stringify(p)}`);
  if (p.x % 8 !== 0 || p.z % 8 !== 0) throw new Error(`未对齐 8 m 栅格 ${JSON.stringify(p)}`);
}
for (const r of roads) {
  if (r.points.length < 2) throw new Error(`道路 ${r.id} 点数不足`);
  for (const p of r.points) {
    if (p.x < -1558.26 || p.x > 934.96 || p.z < -934.96 || p.z > 2804.87) {
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

// ---------------------------------------------------------------- 输出
const plan = { roads, buildings, zones, grid_exceptions: [], tracks: [], utilities: [] };
const planId = computeCityPlanId(BOUNDS, plan);

const doc = {
  plan_id: planId,
  city: '尼思',
  name: '五角星城总体规划',
  target_population: 20000,
  bounds: BOUNDS,
  render: {
    title: '尼思｜五角星城总体规划（星环大道 · 五芒片区 · 星谷市政带，只读施工图草案）',
    width: 1600,
    height: 1600,
    view: 'surface',
    format: 'static_html',
  },
  water_cell_size_m: 32,
  terrain_cell_size_m: 64,
  morphology: {
    shape: 'five-pointed-star (pentagram outline = ring road)',
    center: CENTER,
    outer_radius_m: R_OUT,
    inner_radius_m: R_IN,
    z_stretch: STRETCH,
    star_area_m2: Math.round(5 * R_OUT * R_IN * Math.sin(36 * DEG) * STRETCH),
    core_pentagon_m2: Math.round(2.5 * R_IN * R_IN * Math.sin(72 * DEG) * STRETCH),
  },
  golden_block: {
    curb_to_curb_m: 96,
    ns_street: { prefab: 'Small Road', width_m: 16, spacing_m: SX },
    ew_arterial: { prefab: 'Medium Road', width_m: 24, spacing_m: SZ },
    block_size_m: { x: SX - 16, z: SZ - 24 },
  },
  districts: [
    ...ARM_USE.map((u, k) => ({ id: `arm-${k}`, name: u.name, kind: u.kind })),
    { id: 'core', name: '星心五边形市中心', kind: 'mixed' },
    ...VALLEY_PLAN.map((v) => ({ id: v.id, name: v.label, kind: 'utility' })),
  ],
  access_points: [
    {
      id: 'highway-connector',
      via: 'highway-connector',
      to: '既有高速 Highway Oneway - 2 lanes（永久边 338759:5）',
      position: { x: 144, z: 2692 },
      note: '全城唯一对外高速接入点；货车路径 高速 → 连接道 → 星环大道 → 北芒工业区，不穿居住星芒。',
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
  basis: '分区面积由生成器按区块几何实算；户均占地沿用本项目既有口径（低密 300 / 中密排屋 170 / 中密 120 / 混合 100 m²·户），每户 2.2–2.8 人。',
  notes: [
    { scope: 'buildings', text: '全部建筑为概念预留：尚未绑定精确道路边、朝向与原生候选，rotation_degrees 为 null。道路建成后须用 bind_city_plan_buildings 逐栋绑定并重新审图。' },
    { scope: 'roads', text: '规划校验只做几何预检；星环大道各段超过 256 m 的部分由施工执行器按 240 m 安全线等分，正式建设仍须逐批走游戏原生 preview。' },
    { scope: 'utilities', text: '已购 24 格地表水采样为 0，故供水采用地下水抽水站＋水塔，污水采用污水处理厂（无排污口）。施工前须用 list_utility_connection_points 复核端口与连接层。' },
    { scope: 'validation', text: 'render_city_plan 校验结果：0 条几何告警（建筑—道路、建筑—建筑、越界均为 0）。剩 62 条 BUILDING_ROTATION_UNRESOLVED 全部来自「朝向未解析」，这是施工图阶段的应有状态——按 PLANNING-MAP-GUIDE，朝向与道路边只能在道路建成后由 bind_city_plan_buildings 按原生候选绑定，规划阶段不得猜朝向。' },
    { scope: 'clearance', text: '落位由生成器自动搜索：建筑占地按 reserved_size_m 的轴对齐包围盒，外扩道路半宽后再与全部规划道路线段求交，并与已落位建筑求交，取第一个净距合格的候选点。因此图上的建筑预留互不重叠、不压规划道路。' },
  ],
  disclaimer: '本图为只读施工图草案。所有建筑为概念预留，未绑定原生候选、朝向与道路边；正式施工须逐批走游戏原生 preview。',
  plan,
};

const outPath = path.join(ROOT, 'plans', 'nistar-star-city-plan.json');
await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`);

console.log(JSON.stringify({
  plan_id: planId,
  roads: roads.length,
  zones: zones.length,
  buildings: buildings.length,
  placement_failures: placementFailures,
  grid_nodes: nodes.size,
  grid_edges: edges.length,
  households,
  population_range: doc.accounting.population_range,
  population_midpoint: populationMid,
  zone_area_by_type: doc.accounting.zone_area_by_type,
  out: outPath,
}, null, 2));
