/**
 * 佩奇代尔 · 正六边形城镇施工图生成器（只读规划，不施工）
 *
 * 几何母题：
 *   正六边形环城路连接六个角点；六条放射路连接中心与六个角点；
 *   中心套一个同心小正六边形环路；六边形内部用「网格工具」(plan.grids)
 *   布置住宅 / 商业 / 工业 / 办公开发单元。
 *
 * 网格工具（Game.Zones 原生网格）在 CS2 里只能轴对齐，因此内部开发单元
 * 全部落在 112 m 栅格上（96 m 路缘对路缘 = 2×48 m 满进深），
 * 由骨架路沿栅格线组织连通。
 *
 * 用法：node tools/generate-hexagon-town-plan.mjs
 * 产出：plans/peiqi-hexagon-town-plan.json
 * 依赖实时只读数据：artifacts/hex-survey-*.json + list_map_tiles
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';

const ROOT = 'D:/Develop/game/CityWeaverMCP';
const url = p => `file:///${ROOT}/${p}`;

const { computeCityPlanId, expandCityPlan } = await import(url('mcp/planning-renderer.mjs'));
const { validateCityPlan } = await import(url('mcp/planning-validator.mjs'));
const { buildGridExceptions, analyzePlanGridUsage } = await import(url('mcp/grid-eligibility.mjs'));
const { CELL_SIZE, MAX_ZONING_DEPTH_M, OPTIMAL_BLOCK_WIDTH_M, POLLUTION_RULES, snapToCell } = await import(url('tools/lib/physics-rules.mjs'));

// ─────────────────────────── 0. 常量 ───────────────────────────
const CENTER = { x: -400, z: -1248 };           // 圆心，8 m 格点上
const R_OUT = 896, DZ_OUT = 776;                // 外六边形顶点 (±896,0) / (±448,±776)
const R_IN = 360, DZ_IN = 312;                  // 核心小六边形（0.402 倍同心；dz/dr 偏差 0.074%）
const PITCH = 112;                              // 网格节距：112 - 16 = 96 m 满进深
const W_RING = 32, W_RADIAL = 24, W_CORE = 16, W_AXIS = 24, W_CONN = 16;
const FRONTAGE_GAP_M = 4;                   // 建筑外缘到路缘的退距（校验器按 reserved+半路宽 保守外扩，需 > 2 m）
const BUILD_CLEARANCE = 4;                      // 建筑离道路中心线之外再留的净空
const INSET_BOUNDARY = W_RING / 2 + BUILD_CLEARANCE;   // 20 m：格点距六边形边界的最小值
const PAD_RADIAL = W_RADIAL / 2 + BUILD_CLEARANCE;     // 16 m
const PAD_CORE = W_CORE / 2 + BUILD_CLEARANCE;         // 12 m
const MAX_GRID_SPAN = 5;                        // 单张原生网格最多 5×5
const ZONEABLE_PER_CELL_M2 = (PITCH - W_CORE) ** 2;    // 96×96 = 9216 m²
const D2R = Math.PI / 180;

const OWNED_BOUNDS = { min_x: -1558.26074, min_z: -2804.86914, max_x: 934.956543, max_z: 311.652344 };
const WATER_SHORE_X = 636;                      // 实测水域自 x≈636 起（东侧湖面）

// ─────────────────────── 1. 通用几何工具 ───────────────────────
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyCentroid = poly => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  z: poly.reduce((s, p) => s + p.z, 0) / poly.length,
});
const polygonArea = poly => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
};
const pointInPolygon = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (((pi.z > z) !== (pj.z > z)) && (x < ((pj.x - pi.x) * (z - pi.z)) / (pj.z - pi.z) + pi.x)) inside = !inside;
  }
  return inside;
};
// 凸多边形各边内向法向（用于精确内缩判定）
const inwardEdges = poly => {
  const c = polyCentroid(poly);
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x, ez = q.z - p.z, len = Math.hypot(ex, ez);
    let nx = -ez / len, nz = ex / len;
    if ((c.x - p.x) * nx + (c.z - p.z) * nz < 0) { nx = -nx; nz = -nz; }
    return { p, nx, nz };
  });
};
const boundaryDistance = (x, z, edges) => Math.min(...edges.map(e => (x - e.p.x) * e.nx + (z - e.p.z) * e.nz));

// 线段 vs 轴对齐矩形（带 pad）
const segIntersectsRect = (ax, az, bx, bz, x0, z0, x1, z1, pad) => {
  const rx0 = x0 - pad, rx1 = x1 + pad, rz0 = z0 - pad, rz1 = z1 + pad;
  const inside = (x, z) => x >= rx0 && x <= rx1 && z >= rz0 && z <= rz1;
  if (inside(ax, az) || inside(bx, bz)) return true;
  const seg = (px, pz, qx, qz) => {   // 线段与线段相交
    const d1 = (qx - px) * (az - pz) - (qz - pz) * (ax - px);
    const d2 = (qx - px) * (bz - pz) - (qz - pz) * (bx - px);
    const d3 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
    const d4 = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  return seg(rx0, rz0, rx1, rz0) || seg(rx1, rz0, rx1, rz1) || seg(rx1, rz1, rx0, rz1) || seg(rx0, rz1, rx0, rz0);
};
const distPointSeg = (p, a, b) => {
  const vx = b.x - a.x, vz = b.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz));
};
const distToPolylines = (p, polylines) => Math.min(...polylines.flatMap(pl =>
  pl.slice(1).map((q, i) => distPointSeg(p, pl[i], q))));

// 与 planning-validator.mjs 完全同口径的「道路是否侵入建筑净空」判定。
// 校验器把建筑框按 max(reserved, size)/2 + 半路宽 外扩后再做 OBB-线段相交测试。
const roadHitsBuilding = (road, b, margin = 0) => {
  const angle = -(b.rotation_degrees ?? 0) * D2R;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const halfRoad = (road.width_m || 8) / 2;
  const halfX = Math.max(b.reserved_size_m.x, b.size_m.x) / 2 + halfRoad + margin;
  const halfZ = Math.max(b.reserved_size_m.z, b.size_m.z) / 2 + halfRoad + margin;
  const local = p => {
    const dx = p.x - b.position.x, dz = p.z - b.position.z;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const hits = (start, end) => {
    let minimum = 0, maximum = 1;
    for (const [origin, delta, extent] of [[start.x, end.x - start.x, halfX], [start.z, end.z - start.z, halfZ]]) {
      if (Math.abs(delta) < 1e-9) { if (origin < -extent || origin > extent) return false; continue; }
      let near = (-extent - origin) / delta, far = (extent - origin) / delta;
      if (near > far) [near, far] = [far, near];
      minimum = Math.max(minimum, near); maximum = Math.min(maximum, far);
      if (minimum > maximum) return false;
    }
    return true;
  };
  const pts = road.points ?? [];
  for (let i = 1; i < pts.length; i++) if (hits(local(pts[i - 1]), local(pts[i]))) return true;
  return false;
};

// ─────────────────────── 2. 六边形顶点 ───────────────────────
const at = (dx, dz) => ({ x: CENTER.x + dx, z: CENTER.z + dz });
// 顺序：东 → 东北 → 西北 → 西 → 西南 → 东南（简单多边形）
const V_OUT = [at(R_OUT, 0), at(448, DZ_OUT), at(-448, DZ_OUT), at(-R_OUT, 0), at(-448, -DZ_OUT), at(448, -DZ_OUT)];
const V_IN = [at(R_IN, 0), at(R_IN / 2, DZ_IN), at(-R_IN / 2, DZ_IN), at(-R_IN, 0), at(-R_IN / 2, -DZ_IN), at(R_IN / 2, -DZ_IN)];
const EDGES_OUT = inwardEdges(V_OUT);
const EDGES_IN = inwardEdges(V_IN);
const SIDE_LENGTHS = V_OUT.map((p, i) => dist(p, V_OUT[(i + 1) % 6]));
const APOTHEM = R_OUT * Math.cos(30 * D2R);
const HEX_AREA_M2 = polygonArea(V_OUT);

// 六个扇区（按 floor(角度/60) 索引）
const SECTORS = [
  { key: 'ENE', name: '东北滨湖商业区', kind: 'commercial', inner: 'EU Commercial High', outer: 'EU Commercial Low', mid: 30 },
  { key: 'N', name: '北城居住区', kind: 'residential', inner: 'EU Residential Medium', outer: 'EU Residential Low', mid: 90 },
  { key: 'WNW', name: '西北产业区', kind: 'industrial', inner: 'Industrial Manufacturing', outer: 'Industrial Manufacturing', mid: 150 },
  { key: 'WSW', name: '西南产业区', kind: 'industrial', inner: 'Industrial Manufacturing', outer: 'Industrial Manufacturing', mid: 210 },
  { key: 'S', name: '南城居住区', kind: 'residential', inner: 'EU Residential High', outer: 'EU Residential Medium Row', mid: 270 },
  { key: 'ESE', name: '东南办公区', kind: 'office', inner: 'Office High', outer: 'Office Low', mid: 330 },
];
const CORE = { key: 'CORE', name: '中央核心区', kind: 'office', inner: 'EU Commercial High', outer: 'Office High' };
const CORE_MIX_RADIUS_M = 180;                 // 核心内圈：商业高密（CBD 广场）
const INNER_THRESHOLD_M = 560;

const sectorIndexAt = (x, z) => {
  const ang = ((Math.atan2(z - CENTER.z, x - CENTER.x) / D2R) % 360 + 360) % 360;
  return Math.floor(ang / 60) % 6;
};
const zoneForCell = (cx, cz) => {
  const d = dist({ x: cx, z: cz }, CENTER);
  if (pointInPolygon(cx, cz, V_IN)) return d <= CORE_MIX_RADIUS_M ? CORE.inner : CORE.outer;
  const s = SECTORS[sectorIndexAt(cx, cz)];
  return d <= INNER_THRESHOLD_M ? s.inner : s.outer;
};
const districtForCell = (cx, cz) => {
  if (pointInPolygon(cx, cz, V_IN)) return CORE.name;
  return SECTORS[sectorIndexAt(cx, cz)].name;
};

// ─────────────────────── 3. 骨架道路 ───────────────────────
const RING_DISTRICT = '六边形环城骨架';
const CONNECTOR_DISTRICT = '片区连接路';
const roads = [];
let roadSeq = 0;
const pushRoad = spec => { roads.push({ id: spec.id ?? `road-${++roadSeq}`, ...spec }); return roads[roads.length - 1]; };

const closedRing = (id, label, prefab, width, vertices, role, district, order) => pushRoad({
  id, label, prefab, width_m: width, level: 'surface', kind: 'road',
  road_class: role === 'ring' ? 'arterial' : role === 'core_ring' ? 'collector' : 'arterial',
  role, district, widening_policy: 'perimeter_expandable',
  planning_status: 'conceptual', construction_status: 'planned', construction_order: order,
  max_cost: Math.round(vertices.reduce((s, p, i) => s + dist(p, vertices[(i + 1) % vertices.length]), 0) * 900 * 1.3),
  points: [...vertices, vertices[0]],
});

closedRing('hex-ring', '六边形环城路（Large Road 32 m，串联六个角点）', 'Large Road', W_RING, V_OUT, 'ring', RING_DISTRICT, 10);
closedRing('hex-core-ring', '中央核心小六边形环路（Small Road 16 m）', 'Small Road', W_CORE, V_IN, 'core_ring', RING_DISTRICT, 12);

const RADIAL_LABELS = ['东', '东北', '西北', '西', '西南', '东南'];
V_OUT.forEach((v, i) => pushRoad({
  id: `hex-radial-${SECTORS[(i + 5) % 6].key}`,
  label: `放射大道 · ${RADIAL_LABELS[i]}角 → 中心（Medium Road 24 m）`,
  prefab: 'Medium Road', width_m: W_RADIAL, level: 'surface', kind: 'road',
  road_class: 'arterial', role: 'radial', district: RING_DISTRICT,
  planning_status: 'conceptual', construction_status: 'planned', construction_order: 11 + i,
  max_cost: Math.round(dist(CENTER, v) * 700 * 1.3),
  points: [{ ...CENTER }, { ...v }],
}));

// 南北中央大道：沿栅格线 x = -400，把中心与环城路（上下边中点）直连，兼顾内部连通
pushRoad({
  id: 'hex-axis-ns', label: '中央南北大道（Medium Road 24 m，连接环城路上下边中点）',
  prefab: 'Medium Road', width_m: W_AXIS, level: 'surface', kind: 'road',
  road_class: 'arterial', role: 'axis', district: RING_DISTRICT,
  planning_status: 'conceptual', construction_status: 'planned', construction_order: 20,
  max_cost: Math.round((2 * APOTHEM) * 700 * 1.3),
  points: [{ x: CENTER.x, z: CENTER.z + APOTHEM }, { x: CENTER.x, z: CENTER.z - APOTHEM }],
});

// ─────────────────────── 4. 对外接口（高速公路门户） ───────────────────────
const snapshot = JSON.parse(await readFile(`${ROOT}/artifacts/hex-survey-snapshot.json`, 'utf8')).data ?? {};
const existingRoadPolylines = (snapshot.roads ?? []).map(r => {
  const c = r.curve ?? {};
  const pts = ['a', 'b', 'c', 'd'].map(k => c[k]).filter(Boolean);
  return pts.length >= 2 ? pts : null;
}).filter(Boolean);
const nodeCandidates = existingRoadPolylines.flat();
const W_VERTEX = V_OUT[3];
const portal = nodeCandidates
  .map(p => ({ p, d: dist(p, W_VERTEX) }))
  .filter(e => e.d > 20 && e.d < 400)
  .sort((a, b) => a.d - b.d)[0];
if (portal) pushRoad({
  id: 'hex-gateway-highway', label: `西向高速门户连接（Medium Road 24 m → ${portal.p.x.toFixed(0)},${portal.p.z.toFixed(0)}）`,
  prefab: 'Medium Road', width_m: W_RADIAL, level: 'surface', kind: 'road',
  road_class: 'arterial', role: 'gateway', district: `西向门户接口`,
  planning_status: 'conceptual', construction_status: 'planned', construction_order: 21,
  max_cost: Math.round(portal.d * 700 * 1.3),
  points: [{ ...W_VERTEX }, { x: snapToCell(portal.p.x), z: snapToCell(portal.p.z) }],
});

// ─────────────────────── 5. 内部开发单元（网格工具） ───────────────────────
const latticeX = k => CENTER.x + PITCH * k;
const latticeZ = j => CENTER.z + PITCH * j;
const K_RANGE = [-8, 8], J_RANGE = [-7, 7];

// 判定「单元被骨架路穿过」时只看中心线是否真正进入单元内部（pad 取负 = 内缩）：
// 沿栅格线走的轴向放射路（东/西）只贴边、不穿过，因此不再误杀整排单元；
// 斜向放射路（60°/120°/240°/300°）仍会切掉它真正穿过的单元。
const CORRIDOR_PAD = -1;
const corridorBlockers = [
  ...V_OUT.map(v => ({ a: CENTER, b: v, pad: CORRIDOR_PAD })),                      // 六条放射路
  ...V_IN.map((v, i) => ({ a: v, b: V_IN[(i + 1) % 6], pad: CORRIDOR_PAD })),        // 核心小六边形环路
];
if (portal) corridorBlockers.push({ a: W_VERTEX, b: { x: snapToCell(portal.p.x), z: snapToCell(portal.p.z) }, pad: CORRIDOR_PAD });

const cellKey = (k, j) => `${k}|${j}`;
const cellRect = (k, j) => ({ x0: latticeX(k), x1: latticeX(k + 1), z0: latticeZ(j), z1: latticeZ(j + 1) });

const cellUsable = (k, j) => {
  const { x0, x1, z0, z1 } = cellRect(k, j);
  const probes = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]];
  if (probes.some(([x, z]) => !pointInPolygon(x, z, V_OUT))) return false;
  if (probes.some(([x, z]) => boundaryDistance(x, z, EDGES_OUT) < INSET_BOUNDARY)) return false;
  return !corridorBlockers.some(b => segIntersectsRect(b.a.x, b.a.z, b.b.x, b.b.z, x0, z0, x1, z1, b.pad));
};
if (process.argv.includes('--why')) {
  const k = Number(process.argv[process.argv.indexOf('--why') + 1]);
  const j = Number(process.argv[process.argv.indexOf('--why') + 2]);
  const { x0, x1, z0, z1 } = cellRect(k, j);
  const probes = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [(x0 + x1) / 2, (z0 + z1) / 2]];
  console.log(`单元 k=${k} j=${j} → x[${x0},${x1}] z[${z0},${z1}]`);
  console.log('  全部探针在六边形内:', probes.every(([x, z]) => pointInPolygon(x, z, V_OUT)));
  console.log('  探针到边界最小距离:', Math.min(...probes.map(([x, z]) => boundaryDistance(x, z, EDGES_OUT))).toFixed(1), `(需 ≥ ${INSET_BOUNDARY})`);
  corridorBlockers.forEach((b, i) => {
    if (segIntersectsRect(b.a.x, b.a.z, b.b.x, b.b.z, x0, z0, x1, z1, b.pad)) console.log(`  被走廊 #${i} 穿过: (${b.a.x},${b.a.z})→(${b.b.x},${b.b.z})`);
  });
  console.log('  中心在核心小六边形内:', pointInPolygon(probes[4][0], probes[4][1], V_IN));
  process.exit(0);
}

const gridSpecs = [];

// ── 5a. 设施预留地块：占地 > 96 m 的大型市政设施需要独占矩形地块 ──
// 这些地块不划区，只在外围加一圈 Small Road 形成净空场院；地块内部无路。
const RESERVATIONS = [
  { prefab: 'SmallCoalPowerPlant01', label: '小型燃煤电厂', cols: 2, rows: 2, sectors: ['WNW', 'WSW'] },
  { prefab: 'Landfill01', label: '垃圾填埋场', cols: 2, rows: 2, sectors: ['WNW', 'WSW'] },
  { prefab: 'College01', label: '城市学院', cols: 2, rows: 2, sectors: ['ESE', 'ENE'] },
  { prefab: 'WelfareOffice01', label: '福利办事处', cols: 2, rows: 2, sectors: ['ESE', 'ENE'] },
  { prefab: 'Hospital01', label: '综合医院', cols: 2, rows: 1, sectors: ['ESE', 'ENE'] },
];
RESERVATIONS.forEach(r => { if (!r.count) r.count = 1; });

const reservationSites = [];
const reservedCells = new Set();
// 骨架路段（含中央大道）：设施场院内部不得再穿过任何骨架路
const skeletonSegs = [
  ...V_OUT.map((v, i) => ({ a: v, b: V_OUT[(i + 1) % 6] })),
  ...V_OUT.map(v => ({ a: CENTER, b: v })),
  ...V_IN.map((v, i) => ({ a: v, b: V_IN[(i + 1) % 6] })),
  { a: { x: CENTER.x, z: CENTER.z + APOTHEM }, b: { x: CENTER.x, z: CENTER.z - APOTHEM } },
];
if (portal) skeletonSegs.push({ a: W_VERTEX, b: { x: snapToCell(portal.p.x), z: snapToCell(portal.p.z) } });
// 场院可以被骨架路贴边（边界重合），但不允许骨架路从内部穿过
const rectCrossedBySkeleton = (x0, z0, x1, z1) =>
  skeletonSegs.some(s => segIntersectsRect(s.a.x, s.a.z, s.b.x, s.b.z, x0, z0, x1, z1, -1));
const reservationShortfall = [];
{
  const taken = reservedCells;
  for (const res of RESERVATIONS) {
    res.sites = [];
    for (let n = 0; n < res.count; n++) {
      let best = null, tried = 0, unusable = 0, wrongSector = 0, crossed = 0;
      for (let j = J_RANGE[0]; j + res.rows <= J_RANGE[1]; j++) {
        for (let k = K_RANGE[0]; k + res.cols <= K_RANGE[1]; k++) {
          let ok = true, sectorHits = 0;
          tried++;
          for (let dj = 0; dj < res.rows && ok; dj++) for (let dc = 0; dc < res.cols; dc++) {
            if (!cellUsable(k + dc, j + dj) || taken.has(cellKey(k + dc, j + dj))) { ok = false; unusable++; break; }
            const { x0, x1, z0, z1 } = cellRect(k + dc, j + dj);
            const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
            const key = pointInPolygon(cx, cz, V_IN) ? CORE.key : SECTORS[sectorIndexAt(cx, cz)].key;
            if (res.sectors.includes(key)) sectorHits++;
          }
          if (!ok) continue;
          if (sectorHits < res.cols * res.rows - 1) { wrongSector++; continue; }
          const rx0 = latticeX(k), rz0 = latticeZ(j);
          if (rectCrossedBySkeleton(rx0, rz0, rx0 + res.cols * PITCH, rz0 + res.rows * PITCH)) { crossed++; continue; }
          // 评分：优先落在期望扇区，其次靠近中心（便于市政服务覆盖）
          const { x0, z0 } = cellRect(k, j);
          const cx = x0 + (res.cols * PITCH) / 2, cz = z0 + (res.rows * PITCH) / 2;
          const score = dist({ x: cx, z: cz }, CENTER) - n * 1e6;
          if (!best || score < best.score) best = { k, j, cx, cz, score };
        }
      }
      if (!best) {
        console.log(`  !! 设施预留地块找不到位置：${res.label}（候选 ${tried} / 不可用 ${unusable} / 扇区不符 ${wrongSector} / 被骨架穿过 ${crossed}）`);
        reservationShortfall.push(res.label);
        continue;
      }
      for (let dj = 0; dj < res.rows; dj++) for (let dc = 0; dc < res.cols; dc++) taken.add(cellKey(best.k + dc, best.j + dj));
      res.sites.push(best);
      reservationSites.push({ res, ...best });
    }
  }
}

// 预留地块外围道路（Small Road 16 m，绕行一圈，内部净空）
reservationSites.forEach((site, idx) => {
  const x0 = latticeX(site.k), x1 = latticeX(site.k + site.res.cols);
  const z0 = latticeZ(site.j), z1 = latticeZ(site.j + site.res.rows);
  pushRoad({
    id: `hex-yard-${idx + 1}`,
    label: `${site.res.label} 场院环路（Small Road 16 m）`,
    prefab: 'Small Road', width_m: W_CORE, level: 'surface', kind: 'road',
    road_class: 'collector', role: 'yard', district: CONNECTOR_DISTRICT,
    planning_status: 'conceptual', construction_status: 'planned', construction_order: 25,
    max_cost: Math.round(2 * ((x1 - x0) + (z1 - z0)) * 450 * 1.3),
    points: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }, { x: x0, z: z0 }],
  });
  site.area = { x0, z0, x1, z1 };
});
{
  const usable = new Map();
  for (let k = K_RANGE[0]; k < K_RANGE[1]; k++) for (let j = J_RANGE[0]; j < J_RANGE[1]; j++) {
    if (!cellUsable(k, j) || reservedCells.has(cellKey(k, j))) continue;
    const { x0, x1, z0, z1 } = cellRect(k, j);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const inCore = pointInPolygon(cx, cz, V_IN);
    usable.set(cellKey(k, j), {
      zone: zoneForCell(cx, cz),
      district: inCore ? CORE.name : SECTORS[sectorIndexAt(cx, cz)].name,
      sectorKey: inCore ? CORE.key : SECTORS[sectorIndexAt(cx, cz)].key,
    });
  }
  const used = new Set();
  for (let j = J_RANGE[0]; j < J_RANGE[1]; j++) for (let k = K_RANGE[0]; k < K_RANGE[1]; k++) {
    if (!usable.has(cellKey(k, j)) || used.has(cellKey(k, j))) continue;
    const here = usable.get(cellKey(k, j));
    let columns = 1;
    while (columns < MAX_GRID_SPAN) {
      const next = usable.get(cellKey(k + columns, j));
      if (!next || used.has(cellKey(k + columns, j)) || next.zone !== here.zone) break;
      columns++;
    }
    let rows = 1;
    grow: while (rows < MAX_GRID_SPAN) {
      for (let dc = 0; dc < columns; dc++) {
        const next = usable.get(cellKey(k + dc, j + rows));
        if (!next || used.has(cellKey(k + dc, j + rows)) || next.zone !== here.zone) break grow;
      }
      rows++;
    }
    for (let dj = 0; dj < rows; dj++) for (let dc = 0; dc < columns; dc++) used.add(cellKey(k + dc, j + dj));
    gridSpecs.push({ k, j, columns, rows, zone: here.zone, district: here.district, sectorKey: here.sectorKey });
  }
}

const KIND_OF_TYPE = {
  'EU Residential Low': 'residential', 'EU Residential Medium': 'residential',
  'EU Residential Medium Row': 'residential', 'EU Residential High': 'residential',
  'EU Commercial Low': 'commercial', 'EU Commercial High': 'commercial',
  'Office Low': 'office', 'Office High': 'office',
  'Industrial Manufacturing': 'industrial',
};
const grids = gridSpecs.map((g, i) => {
  const { x0, z0 } = cellRect(g.k, g.j);
  const w = g.columns * PITCH, h = g.rows * PITCH;
  return {
    id: `grid-${String(i + 1).padStart(3, '0')}`,
    label: `${g.zone} ${g.columns}×${g.rows} 开发单元`,
    district: g.district,
    origin: { x: x0, z: z0 },
    columns: g.columns, rows: g.rows,
    block_width_m: PITCH, block_height_m: PITCH,
    road_prefab: 'Small Road', road_width_m: W_CORE,
    zone_type: g.zone, zone_kind: KIND_OF_TYPE[g.zone],
    construction_status: 'planned', construction_order: 40,
    depends_on: ['hex-ring'],
    max_cost: 60000 + (g.columns * g.rows) * 90000,
  };
});

// ─────────────────────── 6. 连通性：自动补连接路 ───────────────────────
const gridSectorById = new Map(grids.map((g, i) => [g.id, gridSpecs[i].sectorKey]));
const skeletonIds = new Set(roads.map(r => r.id));
const tagRoad = road => {
  if (road.role === 'yard') return 'YARD';
  if (skeletonIds.has(road.id)) return road.id === 'hex-core-ring' ? 'CORE' : 'BONE';
  const m = /^grid-(.+)-(v|h)-\d+$/.exec(road.id);
  if (m && gridSectorById.has(m[1])) return gridSectorById.get(m[1]);
  return CONNECTOR_DISTRICT;
};
const roadDistrict = road => {
  const m = /^grid-(.+)-(v|h)-\d+$/.exec(road.id);
  if (m && gridSectorById.has(m[1])) return grids.find(g => g.id === m[1]).district;
  return skeletonIds.has(road.id) ? RING_DISTRICT : CONNECTOR_DISTRICT;
};

const buildNetwork = () => {
  const expanded = expandCityPlan({ roads, buildings: [], zones: [], grids, tracks: [], utilities: [] }).roads;
  const nodeKey = p => `${Math.round(p.x / 4) * 4}|${Math.round(p.z / 4) * 4}`;
  const nodes = new Map();          // nodeKey -> {x,z}
  const segments = [];              // {a,b}
  for (const r of expanded) {
    const pts = r.points ?? [];
    for (const p of pts) if (!nodes.has(nodeKey(p))) nodes.set(nodeKey(p), { x: p.x, z: p.z });
    for (let i = 1; i < pts.length; i++) segments.push({ a: pts[i - 1], b: pts[i] });
  }
  const keys = [...nodes.keys()];
  const parent = new Map(keys.map(k => [k, k]));
  const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const parsed = keys.map(k => { const [x, z] = k.split('|').map(Number); return { k, x, z }; });
  // 1) 端点重合 / 距离 ≤ 8 m（游戏吸附半径）
  for (let i = 0; i < parsed.length; i++) for (let j = i + 1; j < parsed.length; j++) {
    if (Math.hypot(parsed[i].x - parsed[j].x, parsed[i].z - parsed[j].z) <= 8.001) union(parsed[i].k, parsed[j].k);
  }
  // 2) T 型接头：某节点落在另一条路段中部 ≤ 8 m（施工时会被吸附打断）
  for (const { k, x, z } of parsed) for (const s of segments) {
    if (distPointSeg({ x, z }, s.a, s.b) <= 8.001) union(k, nodeKey(s.a));
  }
  const comps = new Map();
  for (const { k } of parsed) {
    const c = find(k);
    if (!comps.has(c)) comps.set(c, []);
    comps.get(c).push(k);
  }
  return { expanded, parsed, compOf: k => find(k), comps };
};

let net = buildNetwork();
const connectors = [];
if (net.comps.size > 1) {
  // 主分量 = 含环城路的分量
  const ringNodeKeys = net.expanded.filter(r => r.id === 'hex-ring').flatMap(r => (r.points ?? []).map(p => `${Math.round(p.x / 4) * 4}|${Math.round(p.z / 4) * 4}`));
  let main = null;
  for (const [c, members] of net.comps) if (ringNodeKeys.some(k => net.compOf(k) === c)) { main = c; break; }
  if (main == null) main = [...net.comps.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  const mainPts = net.parsed.filter(p => net.compOf(p.k) === main);
  for (const [c, members] of net.comps) {
    if (c === main) continue;
    const pts = net.parsed.filter(p => net.compOf(p.k) === c);
    let best = null;
    for (const a of pts) for (const b of mainPts) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (!best || d < best.d) best = { a, b, d };
    }
    if (best) connectors.push(best);
  }
}
connectors.forEach((c, i) => pushRoad({
  id: `hex-connector-${i + 1}`, label: `片区连接路 #${i + 1}（Small Road 16 m，接入环城骨架）`,
  prefab: 'Small Road', width_m: W_CONN, level: 'surface', kind: 'road',
  road_class: 'collector', role: 'connector', district: CONNECTOR_DISTRICT,
  planning_status: 'conceptual', construction_status: 'planned', construction_order: 30,
  max_cost: Math.round(c.d * 450 * 1.3),
  points: [{ x: c.a.x, z: c.a.z }, { x: c.b.x, z: c.b.z }],
}));
if (connectors.length) net = buildNetwork();

// ─────────────────────── 7. 公共服务与公用设施 ───────────────────────
const loadCatalog = async file => {
  const raw = JSON.parse(await readFile(`${ROOT}/artifacts/${file}`, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new Error(`测绘产物 ${file} 结构无法识别（期望裸数组或 {data:{items}}）`);
};
const catalog = [...await loadCatalog('hex-survey-services.json'), ...await loadCatalog('hex-survey-utilities.json')];
const findPrefab = name => {
  const hit = catalog.find(i => i.name === name);
  if (!hit) throw new Error(`实时目录里找不到 prefab：${name}（请重跑 tools/survey-hexagon-site.mjs）`);
  return hit;
};

// sectors: 期望落位的扇区；industrial 标记用于地下水井避让
const WATER_FIRST = [
  { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站', sectors: ['N', 'S', 'ENE', 'ESE'], count: 2 },
  { prefab: 'WaterTower01', label: '水塔', sectors: ['N', 'S', 'CORE'], count: 3 },
  { prefab: 'SewageOutlet01', label: '污水排口', sectors: ['N', 'S'], count: 1 },
];
const MAIN_SPECS = [
  { prefab: 'WindTurbine02', label: '小型风机', sectors: ['WNW', 'WSW', 'N', 'S', 'ESE'], count: 3 },
  { prefab: 'TransformerStation01', label: '变电站', sectors: ['WNW', 'WSW'], count: 2 },
  { prefab: 'TransformerStation02', label: '配电站', sectors: ['N', 'S', 'ENE', 'ESE'], count: 2 },
  { prefab: 'WastewaterTreatmentPlant01', label: '污水处理厂', sectors: ['WSW', 'WNW'], count: 1, industrial: true },
  { prefab: 'MedicalClinic01', label: '社区诊所', sectors: ['N', 'S', 'ENE', 'ESE'], count: 2 },
  { prefab: 'MedicalClinic02', label: '社区诊所（小）', sectors: ['N', 'S'], count: 2 },
  { prefab: 'FireHouse01', label: '消防站', sectors: ['CORE', 'N', 'S', 'WNW', 'WSW'], count: 4 },
  { prefab: 'PoliceStation01', label: '警察局', sectors: ['CORE'], count: 1 },
  { prefab: 'PoliceStation02', label: '派出所', sectors: ['N', 'S', 'ENE', 'ESE'], count: 3 },
  { prefab: 'ElementarySchool02', label: '小学', sectors: ['N', 'S'], count: 3 },
  { prefab: 'HighSchool02', label: '完全中学', sectors: ['N', 'S'], count: 1 },
  { prefab: 'Cemetery02', label: '墓园', sectors: ['WNW', 'WSW'], count: 1, industrial: true },
  { prefab: 'Crematorium01', label: '火葬场', sectors: ['WSW', 'WNW'], count: 1, industrial: true },
  { prefab: 'PostOffice01', label: '邮政局', sectors: ['CORE', 'ENE'], count: 1 },
  { prefab: 'ParkMaintenanceDepot01', label: '公园维护站', sectors: ['N', 'ENE'], count: 1 },
  { prefab: 'RoadMaintenanceDepot01', label: '道路维护站', sectors: ['WNW'], count: 1 },
  { prefab: 'LargeEmergencyShelter01', label: '大型应急避难所', sectors: ['N', 'S'], count: 2 },
  { prefab: 'EmergencyShelter01', label: '社区避难所', sectors: ['N', 'S', 'ESE'], count: 2 },
  { prefab: 'EarlyDisasterWarningSystem01', label: '灾害预警中心', sectors: ['WNW', 'WSW'], count: 1 },
  { prefab: 'TelecomTower01', label: '通信塔', sectors: ['WNW', 'ENE', 'ESE'], count: 2 },
  { prefab: 'RadioMast01', label: '无线电桅杆', sectors: ['WSW', 'S'], count: 1 },
  { prefab: 'CityPark02', label: '城市公园', sectors: ['N', 'S', 'ENE', 'ESE'], count: 2 },
  { prefab: 'CityPark08', label: '城市公园（北）', sectors: ['N'], count: 1 },
  { prefab: 'CommunityPool01', label: '社区泳池', sectors: ['S', 'N'], count: 1 },
  { prefab: 'BasketballCourt01', label: '篮球场', sectors: ['N', 'S', 'ESE'], count: 3 },
  { prefab: 'Playground01', label: '儿童游乐场', sectors: ['N', 'S', 'ENE', 'ESE'], count: 5 },
  { prefab: 'PocketPark05', label: '口袋公园', sectors: ['CORE', 'N', 'S', 'ENE'], count: 5 },
  { prefab: 'ParkingLot01', label: '露天停车场', sectors: ['CORE', 'ENE', 'ESE'], count: 5 },
];

const roadPool = net.expanded.map(r => ({
  id: r.id, points: r.points ?? [], width_m: r.width_m ?? 16,
  sector: tagRoad(r), district: roadDistrict(r), yard: r.role === 'yard',
}));

const cornersOf = (pos, size, rotDeg) => {
  const a = rotDeg * D2R, ca = Math.cos(a), sa = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const dx = (sx * size.x) / 2, dz = (sz * size.z) / 2;
    return { x: pos.x + dx * ca - dz * sa, z: pos.z + dx * sa + dz * ca };
  });
};
const obbOverlap = (a, b, margin = 0) => {
  const test = (corners, other) => {
    for (const axis of [[1, 0], [0, 1]]) {
      const proj = cs => cs.map(c => c.x * axis[0] + c.z * axis[1]);
      const pa = proj(corners), pb = proj(other);
      if (Math.max(...pa) + margin < Math.min(...pb) || Math.max(...pb) + margin < Math.min(...pa)) return false;
    }
    return true;
  };
  // 分离轴：用 AABB 近似（建筑均为轴对齐或沿路切向，够用且保守）
  return test(a, b) && test(b, a);
};
const withinRoadCorridor = (pos, size, reserved, rotDeg) => {
  const probe = { position: pos, rotation_degrees: rotDeg, size_m: size, reserved_size_m: reserved };
  return roadPool.some(r => roadHitsBuilding(r, probe, 0.5));
};
const placed = [];
const groundWells = [];
const placedBySector = new Map();
const placeBuilding = (spec, prefabName, prefab) => {
  const size = { x: prefab.size_m.x, z: prefab.size_m.z };
  const reserved = { x: size.x + 4, z: size.z + 4 };
  const matches = roadPool.filter(r => spec.sectors.includes(r.sector));
  // 场院环路只服务于该场院的主力设施，普通建筑不得落进场院
  const fallback = roadPool.filter(r => !r.yard || spec.sectors.includes('YARD'));
  const reasons = new Map();
  const rej = why => reasons.set(why, (reasons.get(why) ?? 0) + 1);
  for (const road of [...matches, ...fallback]) {
    if (road.points.length < 2) continue;
    const segs = road.points.slice(1).map((q, i) => ({ a: road.points[i], b: q }));
    for (const seg of segs) {
      for (const side of [1, -1]) {
        for (const lt of [0.25, 0.5, 0.35, 0.65, 0.15, 0.75, 0.45, 0.55, 0.85]) {
          const anchor = { x: seg.a.x + (seg.b.x - seg.a.x) * lt, z: seg.a.z + (seg.b.z - seg.a.z) * lt };
          const angle = Math.atan2(seg.b.z - seg.a.z, seg.b.x - seg.a.x);
          const normal = { x: Math.sin(angle), z: -Math.cos(angle) };
          const offset = road.width_m / 2 + size.z / 2 + FRONTAGE_GAP_M;
          const position = { x: anchor.x + normal.x * offset * side, z: anchor.z + normal.z * offset * side };
          // 沿街切向旋转：局部 x 轴沿路（宽），局部 z 轴垂直路面（进深）
          const rotation = ((angle / D2R) % 360 + 360) % 360;
          const cs = cornersOf(position, reserved, rotation);
          if (cs.some(c => !pointInPolygon(c.x, c.z, V_OUT))) { rej('出六边形'); continue; }
          if (cs.some(c => !insidePurchased(c))) { rej('出已购'); continue; }
          if (cs.some(c => boundaryDistance(c.x, c.z, EDGES_OUT) < BUILD_CLEARANCE)) { rej('压环城路净空'); continue; }
          if (spec.area && cs.some(c => c.x < spec.area.x0 - 0.5 || c.x > spec.area.x1 + 0.5 || c.z < spec.area.z0 - 0.5 || c.z > spec.area.z1 + 0.5)) { rej('出场院'); continue; }
          if (withinRoadCorridor(position, size, reserved, rotation)) { rej('压路'); continue; }
          if (placed.some(o => obbOverlap(cornersOf(o.position, o.reserved, o.rotation), cs, 4))) { rej('与他建筑重叠'); continue; }
          if (position.x + reserved.x / 2 >= WATER_SHORE_X - 40) { rej('近水域'); continue; }
          if (spec.industrial) {
            if (groundWells.some(w => dist(w, position) < POLLUTION_RULES.water_well_safe_clearance_m)) { rej('离地下水井 <250 m'); continue; }
          } else if (prefab.kind === 'water_pump') {
            if (placed.some(b => b.industrial && dist(b.position, position) < POLLUTION_RULES.water_well_safe_clearance_m)) { rej('离产业 <250 m'); continue; }
          }
          if (placed.some(o => dist(o.position, position) < 40)) { rej('与已有建筑过近'); continue; }
          placed.push({ position, rotation, reserved, spec, prefabName, industrial: !!spec.industrial });
          if (prefab.kind === 'water_pump') groundWells.push({ ...position });
          const list = placedBySector.get(road.sector) ?? [];
          list.push(prefabName);
          placedBySector.set(road.sector, list);
          return { position, rotation, road_id: road.id };
        }
      }
    }
  }
  if (spec.debug) console.log(`    · ${spec.label} 未落位原因：${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('，')}`);
  return null;
};

// ─────────────────────── 8. 已购区域判定 ───────────────────────
const ownedBounds = [OWNED_BOUNDS];
const insidePurchased = p => ownedBounds.some(b => p.x >= b.min_x && p.x <= b.max_x && p.z >= b.min_z && p.z <= b.max_z);

// ─────────────────────── 9. 组装方案 ───────────────────────
const buildings = [];
const emitBuilding = (spec, prefab, hit, n = 0, extra = {}) => {
  buildings.push({
    id: `bld-${String(buildings.length + 1).padStart(3, '0')}`,
    label: spec.count > 1 && !extra.forceLabel ? `${spec.label} ${n + 1}` : spec.label,
    name: spec.label, prefab: spec.prefab, kind: 'service',
    category: prefab.kind ?? 'city_service',
    position: { x: +hit.position.x.toFixed(1), y: 0, z: +hit.position.z.toFixed(1) },
    rotation_degrees: +hit.rotation.toFixed(1), rotation_source: 'road_tangent',
    placement_status: 'candidate_bound', construction_status: 'planned',
    construction_order: 101, depends_on: [hit.road_id],
    max_cost: Math.round((prefab.construction_cost ?? 100000) * 1.2),
    size_m: { x: prefab.size_m.x, z: prefab.size_m.z },
    reserved_size_m: { x: prefab.size_m.x + 4, z: prefab.size_m.z + 4 },
    industrial: !!spec.industrial,
    ...extra.fields,
  });
};

const skipped = [];
for (const spec of [...WATER_FIRST, ...MAIN_SPECS]) {
  const prefab = findPrefab(spec.prefab);
  for (let n = 0; n < spec.count; n++) {
    const hit = placeBuilding(spec, spec.prefab, prefab);
    if (!hit) { skipped.push(`${spec.label} #${n + 1}`); continue; }
    emitBuilding(spec, prefab, hit, n);
  }
}

// 大型设施：落在专属场院地块内，正面贴场院环路
for (const site of reservationSites) {
  const prefab = findPrefab(site.res.prefab);
  const spec = { prefab: site.res.prefab, label: site.res.label, sectors: ['YARD'], count: 1, debug: true, industrial: ['GasPowerPlant01', 'Landfill01', 'Cemetery01'].includes(site.res.prefab), area: site.area };
  const hit = placeBuilding(spec, spec.prefab, prefab);
  if (!hit) { skipped.push(`${site.res.label}（场院 ${site.area.x0},${site.area.z0}）`); continue; }
  emitBuilding(spec, prefab, hit, 0, { forceLabel: true, fields: { yard: site.area, yard_road: 'hex-yard' } });
}

const planInput = { roads, buildings, zones: [], grids, utilities: [], tracks: [] };
planInput.grid_exceptions = buildGridExceptions(planInput);
const gridAnalysis = analyzePlanGridUsage(planInput);

// ─────────────────────── 10. 核算 ───────────────────────
const HOUSEHOLD_AREA_M2 = {
  'EU Residential Low': 300, 'EU Residential Medium Row': 170,
  'EU Residential Medium': 120, 'EU Residential High': 70,
};
const zoneTypeCells = {};
for (const g of grids) zoneTypeCells[g.zone_type] = (zoneTypeCells[g.zone_type] ?? 0) + g.columns * g.rows;
const kindCells = {};
for (const [type, n] of Object.entries(zoneTypeCells)) kindCells[KIND_OF_TYPE[type]] = (kindCells[KIND_OF_TYPE[type]] ?? 0) + n;

let households = 0;
const householdByType = {};
for (const [type, n] of Object.entries(zoneTypeCells)) {
  const area = n * ZONEABLE_PER_CELL_M2;
  const h = HOUSEHOLD_AREA_M2[type] ? Math.round(area / HOUSEHOLD_AREA_M2[type]) : 0;
  householdByType[type] = h;
  households += h;
}
const people = Math.round(households * 2.4);

const polyLen = pts => pts.slice(1).reduce((t, q, i) => t + dist(pts[i], q), 0);
const roadLength = roads.reduce((s, r) => s + polyLen(r.points), 0)
  + net.expanded.filter(r => !skeletonIds.has(r.id)).reduce((s, r) => s + polyLen(r.points), 0);
const nodeClusters = new Set(net.parsed.map(p => net.compOf(p.k)));

const districtsOut = Object.entries(
  grids.reduce((acc, g) => {
    const e = acc[g.district] ?? (acc[g.district] = { key: g.district, name: g.district, grid_count: 0, cells: 0, uses: new Set() });
    e.grid_count++; e.cells += g.columns * g.rows; e.uses.add(g.zone_type);
    return acc;
  }, {})).map(([, e]) => ({ ...e, uses: [...e.uses] }));

// ─────────────────────── 11. 自检 ───────────────────────
const checks = [];
const addCheck = (name, ok, detail) => checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });

const sideDev = (Math.max(...SIDE_LENGTHS) - Math.min(...SIDE_LENGTHS)) / Math.min(...SIDE_LENGTHS);
addCheck('六条边长偏差 ≤ 1%（正六边形）', sideDev <= 0.01, `${Math.min(...SIDE_LENGTHS).toFixed(1)}–${Math.max(...SIDE_LENGTHS).toFixed(1)} m / 偏差 ${(sideDev * 100).toFixed(3)}%`);
addCheck('外六边形顶点全部落在 8 m 格点上',
  V_OUT.every(v => Math.abs(v.x / CELL_SIZE - Math.round(v.x / CELL_SIZE)) < 1e-6 && Math.abs(v.z / CELL_SIZE - Math.round(v.z / CELL_SIZE)) < 1e-6),
  V_OUT.map(v => `(${v.x},${v.z})`).join(' '));
addCheck('核心小六边形与外六边形同心同向（顶点落在放射线上）',
  V_IN.every((w, i) => {
    const va = { x: V_OUT[i].x - CENTER.x, z: V_OUT[i].z - CENTER.z };
    const wa = { x: w.x - CENTER.x, z: w.z - CENTER.z };
    const sin = Math.abs(va.x * wa.z - va.z * wa.x) / (Math.hypot(va.x, va.z) * Math.hypot(wa.x, wa.z));
    return sin < 0.005;
  }) &&
  (() => { const rs = V_IN.map((w, i) => dist(w, CENTER) / dist(V_OUT[i], CENTER)); return (Math.max(...rs) - Math.min(...rs)) / Math.min(...rs) < 0.005; })(),
  `相似比 ${(R_IN / R_OUT).toFixed(4)} / dz/dr 偏差 ${(Math.abs(DZ_IN / R_IN - Math.cos(30 * D2R)) / Math.cos(30 * D2R) * 100).toFixed(3)}%`);
addCheck('环城路由道路连接六个角点', roads.find(r => r.id === 'hex-ring').points.length === 7);
addCheck('六条放射路连接中心与六个角点',
  roads.filter(r => r.id.startsWith('hex-radial-')).length === 6 &&
  roads.filter(r => r.id.startsWith('hex-radial-')).every(r => r.points.length === 2 && dist(r.points[0], CENTER) < 1e-6 && V_OUT.some(v => dist(v, r.points[1]) < 1e-6)),
  `6 条放射路，起点均在圆心`);
addCheck('四类用途齐全（住宅/商业/工业/办公）',
  ['residential', 'commercial', 'industrial', 'office'].every(k => (kindCells[k] ?? 0) > 0),
  Object.entries(kindCells).map(([k, n]) => `${k}=${n}`).join(' / '));
addCheck('四类用途全部由 plan.grids 表达（使用网格工具）', grids.length > 0 && planInput.zones.length === 0, `${grids.length} 张开发单元 / ${Object.values(zoneTypeCells).reduce((a, b) => a + b, 0)} 个分区格`);
addCheck('每张开发单元只含一种用途', grids.every(g => KIND_OF_TYPE[g.zone_type]), `${new Set(grids.map(g => g.zone_type)).size} 种分区类型`);
{
  const boxes = grids.map(g => { const { x0, z0 } = cellRect(g.k, g.j); return { id: g.id, x0, z0, x1: x0 + g.columns * PITCH, z1: z0 + g.rows * PITCH }; });
  let overlap = null;
  for (let i = 0; i < boxes.length && !overlap; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) { overlap = `${a.id}×${b.id}`; break; }
  }
  addCheck('开发单元之间互不重叠', !overlap, overlap ?? '无');
}
{
  // 判定标准：骨架路中心线是否进入开发单元内部（路缘恰好贴边的轴对齐骨架不算“穿过”）
  const skeletonSegs = roads.flatMap(r => r.points.slice(1).map((q, i) => ({ a: r.points[i], b: q, id: r.id })));
  const bad = [];
  for (const g of grids) {
    const { x0, z0 } = cellRect(g.k, g.j);
    const x1 = x0 + g.columns * PITCH, z1 = z0 + g.rows * PITCH;
    for (const s of skeletonSegs) {
      if (segIntersectsRect(s.a.x, s.a.z, s.b.x, s.b.z, x0, z0, x1, z1, -0.5)) { bad.push(`${g.id}×${s.id}`); break; }
    }
  }
  addCheck('骨架路（环路/放射/核心环/中央大道/门户/场院）不穿过任何开发单元', bad.length === 0, bad.join(', ') || '无');
}
{
  const c = polyCentroid(V_OUT);
  const marginX = Math.min(c.x - OWNED_BOUNDS.min_x, OWNED_BOUNDS.max_x - c.x) - R_OUT;
  const marginZ = Math.min(c.z - OWNED_BOUNDS.min_z, OWNED_BOUNDS.max_z - c.z) - DZ_OUT;
  addCheck('六边形全部顶点位于已购区域内', marginX > 0 && marginZ > 0, `x 余量 ${marginX.toFixed(1)} m / z 余量 ${marginZ.toFixed(1)} m`);
}
{
  const allPoints = [...roads.flatMap(r => r.points), ...buildings.flatMap(b => cornersOf(b.position, b.reserved_size_m, b.rotation_degrees))];
  const outside = allPoints.filter(p => !insidePurchased(p)).length;
  addCheck('全部规划几何位于已购区域内', outside === 0, `${allPoints.length} 个控制点，越界 ${outside}`);
}
addCheck('路网为单一连通分量', nodeClusters.size === 1, `${nodeClusters.size} 个分量${connectors.length ? `（自动补 ${connectors.length} 条连接路）` : ''}`);
{
  const bad = buildings.filter(b => roadPool.some(r => roadHitsBuilding(r, b, 0))).map(b => b.id);
  addCheck('规划建筑不压规划道路（与校验器同口径）', bad.length === 0, bad.join(', ') || '无');
}
{
  // 立面退距：建筑外缘到最近道路「外缘」（而非中心线）的距离
  const edgeGap = c => Math.min(...roadPool.map(r => Math.max(0, distToPolylines(c, [r.points]) - r.width_m / 2)));
  let worst = 0, worstId = null;
  for (const b of buildings) {
    const outer = cornersOf(b.position, b.size_m, b.rotation_degrees);
    const gap = Math.min(...outer.map(edgeGap));
    if (gap > worst) { worst = gap; worstId = b.id; }
  }
  addCheck('每栋建筑外缘到最近道路外缘 ≤ 8 m（沿街接入）', worst <= 8.001, `最远 ${worst.toFixed(1)} m${worstId ? ` @${worstId}` : ''}`);
}
addCheck('全部建筑落位', buildings.length > 0 && skipped.length === 0 && reservationShortfall.length === 0,
  `${buildings.length} 栋${skipped.length ? `，未落位：${skipped.join('、')}` : ''}${reservationShortfall.length ? `，无场院：${reservationShortfall.join('、')}` : ''}`);
addCheck('全部设施预留地块均已选中场院', reservationSites.length === RESERVATIONS.reduce((a, r) => a + r.count, 0),
  `${reservationSites.length} / ${RESERVATIONS.reduce((a, r) => a + r.count, 0)}`);
addCheck('公共服务与公用设施均绑定到具体道路', buildings.every(b => b.depends_on.length > 0));
{
  const minWater = Math.min(...roads.flatMap(r => r.points.map(p => WATER_SHORE_X - p.x)));
  addCheck('全部规划几何离实测水域 ≥ 40 m', minWater >= 40, `最近 ${minWater.toFixed(1)} m`);
}
{
  const tracks = (snapshot.tracks ?? []).map(t => {
    const c = t.curve ?? {};
    return ['a', 'b', 'c', 'd'].map(k => c[k]).filter(Boolean);
  }).filter(p => p.length >= 2);
  const railClear = tracks.length ? Math.min(...V_OUT.map(v => distToPolylines(v, tracks))) : Infinity;
  addCheck('六边形离既有铁路 ≥ 150 m', railClear >= 150, tracks.length ? `${railClear.toFixed(1)} m` : '本范围内无既有铁路');
}
{
  const wells = buildings.filter(b => b.prefab === 'GroundwaterPumpingStation01');
  const industry = buildings.filter(b => b.industrial);
  const minGap = wells.length && industry.length ? Math.min(...wells.map(w => Math.min(...industry.map(i => dist(w.position, i.position))))) : Infinity;
  addCheck(`地下水井离产业 ≥ ${POLLUTION_RULES.water_well_safe_clearance_m} m`, minGap >= POLLUTION_RULES.water_well_safe_clearance_m,
    wells.length ? `${minGap === Infinity ? 'n/a' : minGap.toFixed(0) + ' m'}` : '无地下水井');
}
addCheck('非网格骨架路已逐组登记 grid_exceptions', gridAnalysis.issues.filter(i => i.code === 'GRID_INELIGIBILITY_UNDECLARED').length === 0, `${planInput.grid_exceptions.length} 组例外`);
addCheck('未出现「可用原生网格却被拆成逐路施工」', gridAnalysis.issues.filter(i => i.code === 'REGULAR_GRID_EXPANDED_AS_ROADS').length === 0);
addCheck('施工图尚未生成任何原生预览（只读）', roads.every(r => r.native_preview === undefined) && grids.every(g => g.native_preview === undefined));

// ─────────────────────── 12. 离线校验 ───────────────────────
const bounds = OWNED_BOUNDS;
const validation = validateCityPlan({ bounds, purchased_tiles: [], roads: snapshot.roads ?? [], buildings: snapshot.buildings ?? [], tracks: snapshot.tracks ?? [], utilities: snapshot.utilities ?? [] }, planInput, bounds);

// ─────────────────────── 13. 输出 ───────────────────────
const plan = {
  plan_id: computeCityPlanId(bounds, planInput),
  city: '佩奇代尔',
  name: '佩奇代尔｜正六边形城镇施工图（只读规划，尚未授权施工）',
  target_population: people,
  bounds,
  render: { title: '佩奇代尔｜正六边形城镇施工图（只读规划，尚未授权施工）', width: 2200, height: 1600, view: 'surface', format: 'static_html' },
  water_cell_size_m: 128,
  terrain_cell_size_m: null,
  geometry: {
    hexagon: {
      center: CENTER, circumradius_m: R_OUT, apothem_m: +APOTHEM.toFixed(1),
      vertices: V_OUT, edge_length_m: SIDE_LENGTHS.map(v => +v.toFixed(1)),
      orientation_note: '上下边水平、东西为尖角；顶点全部落在 8 m 格点上',
      regularity_note: `边长 ${Math.min(...SIDE_LENGTHS).toFixed(1)}–${Math.max(...SIDE_LENGTHS).toFixed(1)} m，偏差 ${(sideDev * 100).toFixed(3)}%`,
      area_m2: Math.round(HEX_AREA_M2),
    },
    core_hexagon: { center: CENTER, circumradius_m: R_IN, vertices: V_IN, ratio: +(R_IN / R_OUT).toFixed(4), note: '同心小六边形，顶点恰好落在六条放射路上' },
    grid: { pitch_m: PITCH, curb_to_curb_m: PITCH - W_CORE, lane: 'Small Road 16 m', zoning_depth_m: (PITCH - W_CORE) / 2, max_zoning_depth_m: MAX_ZONING_DEPTH_M, optimal_block_width_m: OPTIMAL_BLOCK_WIDTH_M, note: '节距 112 m → 96 m 路缘对路缘，两侧各 48 m 满进深' },
    gateway: portal ? { portal: { x: snapToCell(portal.p.x), z: snapToCell(portal.p.z) }, distance_from_west_vertex_m: +portal.d.toFixed(1) } : null,
  },
  zoning_model: {
    sectors: SECTORS.map(s => ({ key: s.key, name: s.name, kind: s.kind, bisector_deg: s.mid, inner_zone: s.inner, outer_zone: s.outer })),
    core: { name: CORE.name, inner_zone: CORE.inner, outer_zone: CORE.outer },
    rationale: '西北/西南两区靠近高速门户与铁路，布置工业；东北、东南滨湖朝向东侧湖面，布置商业与办公；北城、南城为居住区；圆心小六边形为中央核心区（商业高密 + 办公）。',
    pollution_note: `本会话未提供实时风向，未做风场锥形校验；产业区刻意置于西侧（远离湖面与居住核心），并强制地下水井离产业 ≥ ${POLLUTION_RULES.water_well_safe_clearance_m} m。`,
  },
  districts: districtsOut,
  reserved_sites: [],
  service_coverage: Object.entries(buildings.reduce((acc, b) => {
    (acc[b.category] ??= []).push(`${b.prefab}${b.label !== b.prefab ? `（${b.label}）` : ''}`);
    return acc;
  }, {})).map(([kind, items]) => ({ kind, count: items.length, items })),
  accounting: {
    target_population: people,
    households,
    people,
    people_per_household: 2.4,
    household_area_m2: HOUSEHOLD_AREA_M2,
    household_rule: '按分区类型汇总可划区面积（每格 96×96 = 9216 m²）后 round(面积 / 户均占地)，再乘每户人数',
    household_by_kind: householdByType,
    zone_area_m2: Object.fromEntries(Object.entries(zoneTypeCells).map(([t, n]) => [t, n * ZONEABLE_PER_CELL_M2])),
    grid_count: grids.length,
    grid_size_histogram: [...Object.entries(grids.reduce((a, g) => { const k = `${g.columns}x${g.rows}`; a[k] = (a[k] ?? 0) + 1; return a; }, {}))].sort(),
    zone_kind_cells: kindCells,
    zone_type_cells: zoneTypeCells,
    residential_cells: (kindCells.residential ?? 0),
    residential_zone_area_m2: Object.entries(zoneTypeCells).filter(([t]) => KIND_OF_TYPE[t] === 'residential').reduce((s, [, n]) => s + n * ZONEABLE_PER_CELL_M2, 0),
    building_count: buildings.length,
    road_count: roads.length,
    connector_count: connectors.length,
    grid_generated_road_count: net.expanded.length - roads.length,
    road_length_m: Math.round(roadLength),
    road_connected_components: nodeClusters.size,
    land_area_m2: Math.round(HEX_AREA_M2),
    density_people_per_km2: Math.round(people / (HEX_AREA_M2 / 1e6)),
  },
  construction_staging: [
    { stage: 1, name: '环城骨架', items: ['hex-ring'], note: '先用 Large Road 32 m 闭合六个角点，确定城镇轮廓。' },
    { stage: 2, name: '放射与中央大道', items: ['hex-radial-*', 'hex-axis-ns'], note: '六条放射路与南北中央大道，把中心接到轮廓上。' },
    { stage: 3, name: '核心小六边形', items: ['hex-core-ring'], note: '中心小六边形环路，围合中央核心区。' },
    { stage: 4, name: '开发单元网格', items: ['grid-*'], note: '逐张落网格工具，住宅/商业/工业/办公四类齐备。' },
    { stage: 5, name: '连接路与门户', items: ['hex-connector-*', 'hex-gateway-highway'], note: '补齐连通性并接入既有高速门户。' },
    { stage: 6, name: '公共服务与公用设施', items: ['bld-*'], note: '水先行：抽水站/水塔 → 电网 → 医院学校 → 其余。' },
  ],
  checks,
  notes: [
    '本文件是只读施工图，未调用任何建造/预览工具，城市状态未改变。',
    `网格工具（原生网格）只能轴对齐，因此内部开发单元统一落在节距 ${PITCH} m 的栅格上；放射路按 60° 斜穿，斜边处自然形成阶梯状退台。`,
    connectors.length ? `自动补入 ${connectors.length} 条连接路，把与骨架脱离的开发单元接回主路网（保证单一连通分量）。` : '内部开发单元已随骨架栅格线自然连通，无需额外连接路。',
    '施工前需要：确认方案 → 逐阶段原生预览 → 提交建造。确认之前不会动工。',
  ],
  plan: planInput,
  validation: { issues: validation.issues ?? validation, ...(validation.ok === undefined ? {} : { ok: validation.ok }) },
};

await mkdir(`${ROOT}/plans`, { recursive: true });
await writeFile(`${ROOT}/plans/peiqi-hexagon-town-plan.json`, JSON.stringify(plan, null, 2));

// ─────────────────────── 14. 人读摘要 ───────────────────────
if (process.argv.includes('--map')) {
  const marks = { residential: 'r', commercial: 'c', industrial: 'i', office: 'o' };
  console.log('── 栅格占用图（k 向右 = 东，j 向上 = 北；. 不可用，# 设施预留）──');
  for (let j = J_RANGE[1] - 1; j >= J_RANGE[0]; j--) {
    let row = `j=${String(j).padStart(3)} `;
    for (let k = K_RANGE[0]; k < K_RANGE[1]; k++) {
      const key = cellKey(k, j);
      if (reservedCells.has(key)) { row += '#'; continue; }
      const g = gridSpecs.find(s => k >= s.k && k < s.k + s.columns && j >= s.j && j < s.j + s.rows);
      row += g ? marks[KIND_OF_TYPE[g.zone]] : '.';
    }
    console.log(row);
  }
  const total = (K_RANGE[1] - K_RANGE[0]) * (J_RANGE[1] - J_RANGE[0]);
  console.log(`可用 ${gridSpecs.reduce((a, g) => a + g.columns * g.rows, 0) + reservedCells.size} / 栅格总数 ${total}（六边形外区域本应不可用约 ${Math.round(total - HEX_AREA_M2 / (PITCH * PITCH))}）`);
}

const bad = checks.filter(c => !c.ok);
console.log('════════ 佩奇代尔 · 正六边形城镇施工图 ════════');
console.log(`plan_id       : ${plan.plan_id}`);
console.log(`外六边形      : 外接半径 ${R_OUT} m / 边心距 ${APOTHEM.toFixed(1)} m / 面积 ${(HEX_AREA_M2 / 1e6).toFixed(3)} km²`);
console.log(`核心小六边形  : 外接半径 ${R_IN} m（相似比 ${(R_IN / R_OUT).toFixed(3)}）`);
console.log(`道路          : ${roads.length} 条骨架/门户 + ${net.expanded.length - roads.length} 条网格内部路，总长 ${(roadLength / 1000).toFixed(2)} km`);
console.log(`开发单元      : ${grids.length} 张网格 / ${Object.values(zoneTypeCells).reduce((a, b) => a + b, 0)} 个分区格`);
console.log(`  分区格      : ${Object.entries(kindCells).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`  分区类型    : ${Object.entries(zoneTypeCells).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`公共服务      : ${buildings.length} 栋`);
console.log(`人口          : ${people} 人 / ${households} 户（密度 ${Math.round(people / (HEX_AREA_M2 / 1e6))} 人/km²）`);
console.log(`连通分量      : ${nodeClusters.size}${connectors.length ? `（补连接路 ${connectors.length} 条）` : ''}`);
console.log(`grid_exceptions: ${planInput.grid_exceptions.length} 组`);
console.log('');
console.log(`自检：${checks.length - bad.length}/${checks.length} 通过`);
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const issues = validation.issues ?? [];
console.log('');
console.log(`离线校验：${issues.length} 条 issue${issues.length ? '' : '（干净）'}`);
for (const i of issues.slice(0, 20)) console.log(`  [${i.severity}] ${i.code} ${i.layer ?? ''} ${i.object_id ?? ''} — ${i.message}`);
if (bad.length) { console.log('\nSPEC: 自检未全通过'); process.exitCode = 1; } else console.log('\nSPEC: OK');
