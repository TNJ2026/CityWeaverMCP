// 佩奇代尔（欧洲主题）已购区域内的「正五边形城市」结构化规划生成器
//
//   node tools/scratch/generate-pentagon-city-plan.mjs [输出 JSON 路径]
//
// 只读、不连游戏：不调用任何 MCP 工具，也不提交任何施工，只写入
// plans/peiqi-pentagon-city-plan.json 一份权威规划。图面由 mcp/render-live-plan.mjs
// 依据实时城市数据渲染；正式建设必须先 render_city_plan 重新渲染确认 plan_id，
// 再用 prepare_city_plan_construction / advance_city_plan_construction 逐批原生预检。
//
// 本版规划口径（按用户要求）：住宅/商业/工业/办公四类用途全部用网格工具表达
// （plan.grids[]），每张网格片区只含一种用途，四类用途各自独立、互不混合；
// 分区由网格的单元格生成，单元格四边都是本片区自己的道路，因此任何分区都不会跨过道路。
//
// 为什么是「多张分离的网格片区」而不是一整张：mcp/city-plan-construction-workflow.mjs 的
// validateGridSeparation 会拒绝任何「重叠或共享外围道路」的两张网格（PLAN_GRID_OVERLAP），
// 这正是《规划图指南》「相邻网格不得重复生成共享外围道路」的硬约束。所以片区之间必须留缝，
// 缝里走连接路（connectors），由它们把各片区接进环路与放射大道。
//
// 场地硬约束（2026-09-20 实测）：
//   · 已购 20 格（4×5），x ∈ [-1558.26, 934.96]，z ∈ [-2804.87, 311.65]。
//   · 东侧有真实河道：深水段最深 19.6 m、浅滩段 0.7–1.5 m，浅滩西岸最远伸到 x ≈ 312
//     （z ∈ [-1176, -712]）。list_map_tiles 对这些格报 SurfaceWater=0，与原生水深读数矛盾；
//     按《规划图指南》以原生水深为准，本脚本内置实测岸线表。区域北半区（z ∈ -224…320）
//     另行补测，确认完全无水。
//   · 铁路斜穿西南角；高速终点 (-1384,-1135) 与高压线终点 (-1376,-552) 在区域西缘。
//   · 地形 617.4–617.9 m，起伏 < 1 m，无坡度问题。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { buildGridExceptions } from '../../mcp/grid-eligibility.mjs';
import { MAX_ZONING_DEPTH_M, OPTIMAL_BLOCK_WIDTH_M } from '../lib/physics-rules.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CITY = '佩奇代尔';
const TARGET_POPULATION = 14000;
const REGION_BOUNDS = { min_x: -1558.26, min_z: -2804.87, max_x: 934.96, max_z: 311.65 };

// 对外接口实测（read_surface_water_mask 后的 node 回读）：
//   高速公路为双向分离式单向车道，两条车行道各自断头：东行终到节点 51166，西行起于节点 51169。
//   原规划的 (-1384,-1136) 是粗测值，与真实节点 51166 相差 9.3 m，超过施工器 2 m 锚点容差。
const HIGHWAY_TERMINUS = { x: -1384.4610595703125, z: -1142.673583984375 };
const HIGHWAY_TERMINUS_NODE = '6476c9aae8944378b59be4f588c4303c:51166:3';
const HIGHWAY_PORTAL = { x: -1383.5009765625, z: -1126.7022705078125 };
const HIGHWAY_PORTAL_NODE = '6476c9aae8944378b59be4f588c4303c:51169:3';
// 既有高压线东端线塔实测位置（PowerLinePylon47m01），门户路必须绕开。
const HV_TERMINUS = { x: -1374.68652, z: -554.980835 };
const RAILWAY = [
  { x: -1636.655, z: -1795.8479 }, { x: -1495.33691, z: -1976.46631 },
  { x: -1320.12927, z: -2182.6355 }, { x: -1128.83948, z: -2373.94043 },
  { x: -922.710144, z: -2549.144 }, { x: -703.0851, z: -2707.11084 },
  { x: -471.4129, z: -2846.80176 },
];

// 原生水深实测包络（read_surface_water_mask，20 m 采样，阈值 0.02 m）：
//   · x ∈ [300, 620 × z ∈ [-500, 280]：624 格全部无水（滨水带所在）
//   · x ∈ [280, 690 × z ∈ [-1400, -600]：仅在 z ∈ [-1386, -458] 出现水域，最西西岸 x ≈ 630
//   · x ∈ [560, 900 × z ∈ [-2810, 300]：水域同样只落在 z ∈ [-1386, -458]，x ≥ 640
//   · 南城园区（z ≤ -1512）与五边形以南区域完全无水。
// 因此水域包络可简化为一条 z 区间带 + 一条西岸线。
const WATER_BAND = { min_z: -1386, max_z: -458, west_shore_x: 630 };

function waterShoreAt(z) {
  if (z < WATER_BAND.min_z || z > WATER_BAND.max_z) return Infinity;
  return WATER_BAND.west_shore_x;
}

const PENTAGON = (() => {
  // 东移 48 m（相对初版 V0.x=-520）：原西边 V1→V2 在 z≈-555 处正好压在既有高压线东端
  // 线塔 PowerLinePylon47m01（(-1374.69,-554.98)，实测距环路中心线 0.9 m）上，游戏原生校验
  // 直接拒绝该段（GAME_VALIDATION_ERROR / GAME_REJECTED_ROAD）。东移后该处净距约 44.8 m。
  const V0 = { x: -472, z: 160 };
  const V1 = { x: V0.x - 110 * 8, z: V0.z - 80 * 8 };
  const V2 = { x: V1.x + 42 * 8, z: V1.z - 129 * 8 };
  const V3 = { x: V2.x + 136 * 8, z: V2.z };
  const V4 = { x: V3.x + 42 * 8, z: V3.z + 129 * 8 };
  return [V0, V1, V2, V3, V4];
})();
const CENTER = {
  x: PENTAGON.reduce((sum, vertex) => sum + vertex.x, 0) / 5,
  z: PENTAGON.reduce((sum, vertex) => sum + vertex.z, 0) / 5,
};
const EDGE_LENGTHS = PENTAGON.map((vertex, index) => {
  const next = PENTAGON[(index + 1) % PENTAGON.length];
  return Math.hypot(next.x - vertex.x, next.z - vertex.z);
});
const R = Math.hypot(PENTAGON[0].x - CENTER.x, PENTAGON[0].z - CENTER.z);
const RADIAL_CENTER = { x: Math.round(CENTER.x / 8) * 8, z: Math.round(CENTER.z / 8) * 8 };

const ROAD = {
  ring: { prefab: 'Large Road', width_m: 32 },
  radial: { prefab: 'Medium Road', width_m: 24 },
  grid: { prefab: 'Small Road', width_m: 16 },
  gateway: { prefab: 'Large Road', width_m: 32 },
  riverside: { prefab: 'Medium Road', width_m: 24 },
  connector: { prefab: 'Small Road', width_m: 16 },
};

const ZONE = {
  officeHigh: 'Office High',
  officeLow: 'Office Low',
  commercialHigh: 'EU Commercial High',
  commercialLow: 'EU Commercial Low',
  residentialHigh: 'EU Residential High',
  residentialMedium: 'EU Residential Medium',
  residentialRow: 'EU Residential Medium Row',
  residentialLow: 'EU Residential Low',
  industrial: 'Industrial Manufacturing',
};

const ZONE_KIND_OF = {
  [ZONE.officeHigh]: 'office', [ZONE.officeLow]: 'office',
  [ZONE.commercialHigh]: 'commercial', [ZONE.commercialLow]: 'commercial',
  [ZONE.residentialHigh]: 'residential', [ZONE.residentialMedium]: 'residential',
  [ZONE.residentialRow]: 'residential', [ZONE.residentialLow]: 'residential',
  [ZONE.industrial]: 'industrial',
};

const HOUSEHOLD_AREA_M2 = {
  [ZONE.residentialLow]: 300,
  [ZONE.residentialRow]: 170,
  [ZONE.residentialMedium]: 120,
  [ZONE.residentialHigh]: 70,
};
const PEOPLE_PER_HOUSEHOLD = 2.4;
const PEOPLE_RANGE = [2.2, 2.8];

const GOLDEN = OPTIMAL_BLOCK_WIDTH_M;
const PITCH = 112;
const CELL_AREA_M2 = (PITCH - ROAD.grid.width_m) ** 2;

const LATTICE_X0 = -1400;
const LATTICE_Z0 = -1512;
const latticeX = index => LATTICE_X0 + index * PITCH;
const latticeZ = index => LATTICE_Z0 + index * PITCH;

// 净距下限由「半宽相加 + 8 m」推出：
// 环路 Large(32) ↔ 片区 Small(16) = 16+8+8 = 32；放射大道 Medium(24) ↔ 片区 Small(16) = 12+8+8 = 28。
// 两条 Small(16) 之间 = 8+8+8 = 24。取整后分别为 36 / 32 / 24。
const RING_INSET = 34;
const RADIAL_INSET = 30;
const DISTRICT_GAP = 24;

const DISTRICTS = {
  core: '五边形中央商务核心',
  ne: '东北产业带',
  n: '北城办公文教区',
  w: '西城中密居住区',
  s: '南城居住区',
  se: '东南花园居住区',
  riverside: '河东滨水市政与产业带',
  campus: '南城设施园',
  connector: '片区连接路',
};

const toRad = deg => deg * Math.PI / 180;

const EDGES = PENTAGON.map((start, index) => {
  const end = PENTAGON[(index + 1) % PENTAGON.length];
  const dx = end.x - start.x, dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  let nx = dz / length, nz = -dx / length;
  const mid = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  if ((mid.x - CENTER.x) * nx + (mid.z - CENTER.z) * nz < 0) { nx = -nx; nz = -nz; }
  return { start, end, nx, nz, length, index };
});

function insideDistance(point) {
  let best = Infinity;
  for (const edge of EDGES) {
    const separation = -((point.x - edge.start.x) * edge.nx + (point.z - edge.start.z) * edge.nz);
    if (separation < best) best = separation;
  }
  return best;
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-9 ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.z - (start.z + t * dz));
}

function distanceToRailway(point) {
  let best = Infinity;
  for (let index = 1; index < RAILWAY.length; index++) {
    best = Math.min(best, pointSegmentDistance(point, RAILWAY[index - 1], RAILWAY[index]));
  }
  return best;
}

function segmentHitsBox(a, b, minX, maxX, minZ, maxZ) {
  let t0 = 0, t1 = 1;
  for (const [origin, delta, low, high] of [[a.x, b.x - a.x, minX, maxX], [a.z, b.z - a.z, minZ, maxZ]]) {
    if (Math.abs(delta) < 1e-9) { if (origin < low || origin > high) return false; continue; }
    let near = (low - origin) / delta, far = (high - origin) / delta;
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near); t1 = Math.min(t1, far);
    if (t0 > t1) return false;
  }
  return true;
}

function segmentsCross(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1z = a2.z - a1.z, d2x = b2.x - b1.x, d2z = b2.z - b1.z;
  const denominator = d1x * d2z - d1z * d2x;
  if (Math.abs(denominator) < 1e-9) return false;
  const t = ((b1.x - a1.x) * d2z - (b1.z - a1.z) * d2x) / denominator;
  const u = ((b1.x - a1.x) * d1z - (b1.z - a1.z) * d1x) / denominator;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function polygonArea(polygon) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

const polar = (angleDeg, radius) => ({
  x: CENTER.x + radius * Math.cos(toRad(angleDeg)),
  z: CENTER.z + radius * Math.sin(toRad(angleDeg)),
});

const angleOf = point => {
  const deg = Math.atan2(point.z - CENTER.z, point.x - CENTER.x) * 180 / Math.PI;
  return deg < 0 ? deg + 360 : deg;
};

const VERTEX_ANGLES = PENTAGON.map(angleOf);
const SECTOR_BOUNDARIES = [
  VERTEX_ANGLES[4], VERTEX_ANGLES[0], VERTEX_ANGLES[1], VERTEX_ANGLES[2], VERTEX_ANGLES[3], VERTEX_ANGLES[4] + 360,
];
const SECTOR_ORDER = ['ne', 'n', 'w', 's', 'se'];

function sectorOf(point) {
  let deg = angleOf(point);
  if (deg < SECTOR_BOUNDARIES[0]) deg += 360;
  for (let index = 0; index < SECTOR_ORDER.length; index++) {
    if (deg >= SECTOR_BOUNDARIES[index] && deg < SECTOR_BOUNDARIES[index + 1]) return SECTOR_ORDER[index];
  }
  return 'se';
}

const RADIAL_SEGMENTS = PENTAGON.map(vertex => [
  { x: RADIAL_CENTER.x, z: RADIAL_CENTER.z },
  { x: vertex.x, z: vertex.z },
]);

function rectCorners(rect) {
  return [
    { x: rect.min_x, z: rect.min_z }, { x: rect.max_x, z: rect.min_z },
    { x: rect.max_x, z: rect.max_z }, { x: rect.min_x, z: rect.max_z },
  ];
}

function rectsOverlap(left, right) {
  return left.min_x < right.max_x && left.max_x > right.min_x && left.min_z < right.max_z && left.max_z > right.min_z;
}

function pointRectDistance(point, rect) {
  const dx = Math.max(rect.min_x - point.x, 0, point.x - rect.max_x);
  const dz = Math.max(rect.min_z - point.z, 0, point.z - rect.max_z);
  return Math.hypot(dx, dz);
}

function segmentRectDistance(a, b, rect) {
  if (segmentHitsBox(a, b, rect.min_x, rect.max_x, rect.min_z, rect.max_z)) return 0;
  let best = Infinity;
  for (const corner of rectCorners(rect)) best = Math.min(best, pointSegmentDistance(corner, a, b));
  for (const point of [a, b]) best = Math.min(best, pointRectDistance(point, rect));
  return best;
}

function rectUsable(rect, inset = RING_INSET) {
  if (rectCorners(rect).some(corner => insideDistance(corner) < inset)) return false;
  for (const [a, b] of RADIAL_SEGMENTS) if (segmentRectDistance(a, b, rect) < inset) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 骨架路网
// ─────────────────────────────────────────────────────────────────────────────

const roads = [];
const notes = [];

roads.push({
  id: 'pentagon-ring',
  label: '五边形环路（Large Road 32 m，串联五个角点）',
  prefab: ROAD.ring.prefab, width_m: ROAD.ring.width_m, level: 'surface',
  road_class: 'arterial', role: 'ring', district: DISTRICTS.core,
  widening_policy: 'perimeter_expandable', planning_status: 'conceptual',
  construction_status: 'planned', construction_order: 10, max_cost: 4000000,
  points: [...PENTAGON, PENTAGON[0]].map(point => ({ x: point.x, z: point.z })),
});

PENTAGON.forEach((vertex, index) => {
  roads.push({
    id: `radial-v${index}`,
    label: `放射大道 V${index}（中心 → 角点 ${index}）`,
    prefab: ROAD.radial.prefab, width_m: ROAD.radial.width_m, level: 'surface',
    road_class: 'arterial', role: 'radial', district: DISTRICTS.core,
    planning_status: 'conceptual', construction_status: 'planned',
    construction_order: 20, depends_on: ['pentagon-ring'], max_cost: 1500000,
    points: [{ x: RADIAL_CENTER.x, z: RADIAL_CENTER.z }, { x: vertex.x, z: vertex.z }],
  });
});

roads.push({
  id: 'gateway-highway',
  label: '城市门户大道（角点 V1 → 绕开高压线塔 → 高速公路东侧终点）',
  prefab: ROAD.gateway.prefab, width_m: ROAD.gateway.width_m, level: 'surface',
  road_class: 'trunk', role: 'gateway', district: DISTRICTS.w,
  planning_status: 'bound', construction_status: 'planned', construction_order: 5, max_cost: 1200000,
  // 中间绕行点把门户路推到高压线塔以西约 45 m，再南下接高速公路东端节点。
  points: [
    { x: PENTAGON[1].x, z: PENTAGON[1].z },
    { x: -1424, z: -560 },
    { x: -1404, z: -1060 },
    { x: HIGHWAY_TERMINUS.x, z: HIGHWAY_TERMINUS.z, node_id: HIGHWAY_TERMINUS_NODE },
  ],
});

// 高速公路两条单向车行道的断头相距仅 16.0 m，必须连起来，否则城市只能单向进出高速。
roads.push({
  id: 'highway-portal-link',
  label: '高速门户连接段（西行车道端点 ↔ 东行车道端点）',
  prefab: ROAD.connector.prefab, width_m: ROAD.connector.width_m, level: 'surface',
  road_class: 'collector', role: 'portal', district: DISTRICTS.w,
  planning_status: 'bound', construction_status: 'planned', construction_order: 4, max_cost: 200000,
  points: [
    { x: HIGHWAY_PORTAL.x, z: HIGHWAY_PORTAL.z, node_id: HIGHWAY_PORTAL_NODE },
    { x: HIGHWAY_TERMINUS.x, z: HIGHWAY_TERMINUS.z, node_id: HIGHWAY_TERMINUS_NODE },
  ],
});

// 滨水带：实测 x∈[300,620] × z∈[-500,280] 共 624 格无水（read_surface_water_mask）。
// 服务路沿设施带西缘南北向铺设，三座设施全部沿该路东侧单排沿街布置。
// 建筑西外缘距路面外缘仅 2 m —— 保证原生道路绑定与道路内置水电污水接入成立。
// 东移 64 m（344 → 408）：五边形东移后 V4 到原滨水带只剩约 82 m，
// 垃圾填埋场的预留外框会与环路东南边相交；东移后最近处约 132 m。
// 实测 x∈[300,620] × z∈[-500,280] 无水域，东移后建筑最东缘约 572 m，仍在水域以西。
const RIVERSIDE_SPINE_X = 408;
const RIVERSIDE_ACCESS_POINTS = [
  { x: PENTAGON[4].x, z: PENTAGON[4].z },
  { x: RIVERSIDE_SPINE_X, z: PENTAGON[4].z + 24 },
];
const RIVERSIDE_SPINE_POINTS = [
  { x: RIVERSIDE_SPINE_X, z: PENTAGON[4].z + 24 },
  { x: RIVERSIDE_SPINE_X, z: 264 },
];
const RIVERSIDE_SITES = [
  { label: '垃圾填埋场', min_x: 420, max_x: 548, min_z: -440, max_z: -296 },
  { label: '资源回收中心', min_x: 420, max_x: 572, min_z: -296, max_z: -112 },
  { label: '污水处理厂与变电站', min_x: 420, max_x: 508, min_z: -112, max_z: 24 },
];
for (const site of RIVERSIDE_SITES) {
  site.center = { x: (site.min_x + site.max_x) / 2, z: (site.min_z + site.max_z) / 2 };
}

for (const [id, label, points, dependsOn] of [
  ['riverside-access', '滨水接入路（环路东角点 → 滨水带）', RIVERSIDE_ACCESS_POINTS, 'pentagon-ring'],
  ['riverside-spine', '滨水带纵向服务路', RIVERSIDE_SPINE_POINTS, 'riverside-access'],
]) {
  roads.push({
    id, label,
    prefab: ROAD.riverside.prefab, width_m: ROAD.riverside.width_m, level: 'surface',
    road_class: 'collector', role: 'riverside', district: DISTRICTS.riverside,
    planning_status: 'conceptual', construction_status: 'planned',
    construction_order: id === 'riverside-access' ? 30 : 31,
    depends_on: [dependsOn], max_cost: 600000,
    points: points.map(point => ({ x: point.x, z: point.z })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 设施预留区（不是分区；网格片区会绕开它们）
// ─────────────────────────────────────────────────────────────────────────────

const reserved = [{ label: '中央广场（放射大道汇聚点）', kind: 'circle', x: RADIAL_CENTER.x, z: RADIAL_CENTER.z, r: 128 }];

// 南城设施园：环路以南、已购地内的整片干燥地（原生实测 23×21 采样、0 水域格）。
// 公共服务设施全部移到这里，五边形内因此只剩四类用途的网格片区。
// 园区铺 5 横 3 纵 16 m 街格；所有服务建筑一律沿街布置，footprint 外缘距路面外缘 2 m。
// 因此每栋都有可回读的 Game.Buildings.Building.m_RoadEdge，不会出现「图上有、实际连不上」的建筑。
const CAMPUS_STREETS = {
  'campus-north': { axis: 'x', at: -1512, from: 24, to: 832, label: '设施园北联络路（环路东南角点 → 园区东侧）', depends_on: ['pentagon-ring'], construction_order: 32 },
  'campus-west': { axis: 'z', at: -448, from: -1512, to: -2664, label: '设施园西侧路', depends_on: ['pentagon-ring'], construction_order: 32 },
  'campus-mid': { axis: 'z', at: 192, from: -1512, to: -2664, label: '设施园中路', depends_on: ['campus-north'], construction_order: 33 },
  'campus-east': { axis: 'z', at: 832, from: -1512, to: -2664, label: '设施园东侧路', depends_on: ['campus-north'], construction_order: 33 },
  'campus-cross-1': { axis: 'x', at: -1896, from: -448, to: 832, label: '设施园一横路', depends_on: ['campus-west'], construction_order: 33 },
  'campus-cross-2': { axis: 'x', at: -2280, from: -448, to: 832, label: '设施园二横路', depends_on: ['campus-cross-1'], construction_order: 34 },
  'campus-cross-3': { axis: 'x', at: -2472, from: -448, to: 832, label: '设施园三横路', depends_on: ['campus-cross-2'], construction_order: 34 },
  'campus-cross-4': { axis: 'x', at: -2664, from: -448, to: 832, label: '设施园四横路', depends_on: ['campus-cross-3'], construction_order: 35 },
};
for (const street of Object.values(CAMPUS_STREETS)) street.width_m = ROAD.connector.width_m;
for (const [id, street] of Object.entries(CAMPUS_STREETS)) {
  roads.push({
    id, label: street.label,
    prefab: ROAD.connector.prefab, width_m: ROAD.connector.width_m, level: 'surface',
    road_class: 'collector', role: 'campus', district: DISTRICTS.campus,
    planning_status: 'conceptual', construction_status: 'planned',
    construction_order: street.construction_order, depends_on: street.depends_on, max_cost: 400000,
    points: street.axis === 'x'
      ? [{ x: street.from, z: street.at }, { x: street.to, z: street.at }]
      : [{ x: street.at, z: street.from }, { x: street.at, z: street.to }],
  });
}

// 园区功能分区：只用于说明与「片区不得压设施园」的选址校验，不再决定建筑落点。
const CAMPUS = {
  college: { label: '高教文教园区', min_x: -448, max_x: 192, min_z: -1896, max_z: -1512 },
  hospitalSports: { label: '医院与体育公园', min_x: 192, max_x: 832, min_z: -1896, max_z: -1512 },
  schools: { label: '第二/第三中学', min_x: -448, max_x: 192, min_z: -2280, max_z: -1896 },
  welfare: { label: '社会福利与市政', min_x: 192, max_x: 832, min_z: -2280, max_z: -1896 },
  cemetery: { label: '公墓与火葬场', min_x: -448, max_x: 192, min_z: -2472, max_z: -2280 },
  utilities: { label: '市政公用设施群', min_x: 192, max_x: 832, min_z: -2664, max_z: -2280 },
};
for (const site of Object.values(CAMPUS)) {
  site.kind = 'rect';
  site.center = { x: (site.min_x + site.max_x) / 2, z: (site.min_z + site.max_z) / 2 };
  reserved.push(site);
}

// 沿街落位游标：一条街的一侧从 from 向 to 依次排布建筑。
// 间距必须大于 roadConflictOf 的 +4 m 预留半宽（2 m），否则会与道路中心线判定相交。
const FRONTAGE_GAP_M = 4;
const FRONTAGE_STREETS = {
  ...CAMPUS_STREETS,
  'riverside-spine': { axis: 'z', at: RIVERSIDE_SPINE_X, from: PENTAGON[4].z + 24, to: 264, width_m: ROAD.riverside.width_m },
};
function frontageRun(streetId, side, from, to) {
  return { streetId, street: FRONTAGE_STREETS[streetId], side, from, to, cursor: from };
}
function takeFrontageSlot(run, spec, size, isFree) {
  const { street, side } = run;
  const step = Math.sign(run.to - run.from) || 1;
  const width = size[0], depth = size[1];
  const offset = street.width_m / 2 + FRONTAGE_GAP_M + depth / 2;
  for (let guard = 0; guard < 64; guard++) {
    const start = run.cursor;
    const end = start + step * width;
    if (step > 0 ? end > run.to : end < run.to) return null;
    run.cursor = end + step * FRONTAGE_GAP_M;
    const middle = (start + end) / 2;
    const position = street.axis === 'x'
      ? { x: middle, z: street.at + (side === 'north' ? offset : -offset) }
      : { x: street.at + (side === 'east' ? offset : -offset), z: middle };
    const rotationDegrees = street.axis === 'x' ? (side === 'north' ? 180 : 0) : (side === 'east' ? 90 : 270);
    if (isFree(position, size, rotationDegrees)) return { position, rotation_degrees: rotationDegrees, streetId: run.streetId };
  }
  return null;
}

function inReserved(point) {
  for (const area of reserved) {
    if (area.kind === 'circle') {
      if (Math.hypot(point.x - area.x, point.z - area.z) <= area.r) return true;
    } else if (point.x >= area.min_x && point.x <= area.max_x && point.z >= area.min_z && point.z <= area.max_z) return true;
  }
  return false;
}

function inCoreCircle(rect) {
  const core = reserved[0];
  for (const corner of rectCorners(rect)) {
    if (Math.hypot(corner.x - core.x, corner.z - core.z) < core.r + 16) return true;
  }
  return pointRectDistance({ x: core.x, z: core.z }, rect) < core.r + 16;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 网格片区：住宅/商业/工业/办公四类用途各占若干独立片区。
// ─────────────────────────────────────────────────────────────────────────────

function classifyDistrict(center) {
  const ratio = Math.hypot(center.x - CENTER.x, center.z - CENTER.z) / R;
  const sector = sectorOf(center);
  const edgeDistance = insideDistance(center);
  const pattern = Math.round((center.x + center.z) / 8) % 8;

  if (edgeDistance < 175) {
    if (sector === 'ne') return ZONE.industrial;
    if (sector === 'n') return pattern === 0 ? ZONE.officeLow : ZONE.residentialHigh;
    if (pattern % 8 === 0) return ZONE.commercialLow;
    return ZONE.residentialHigh;
  }

  if (sector === 'ne') {
    if (ratio >= 0.42) return ZONE.industrial;
    if (ratio >= 0.34) return ZONE.officeLow;
    return ZONE.residentialHigh;
  }

  if (sector === 'n') {
    if (ratio < 0.22) return ZONE.officeHigh;
    if (ratio < 0.36) return ZONE.officeLow;
    if (ratio < 0.62) return ZONE.residentialHigh;
    return ZONE.residentialHigh;
  }
  if (sector === 'w' || sector === 's') {
    if (ratio < 0.20) return ZONE.commercialHigh;
    if (ratio < 0.72) return ZONE.residentialHigh;
    if (ratio < 0.90) return ZONE.residentialHigh;
    return ZONE.residentialHigh;
  }
  if (ratio < 0.22) return ZONE.commercialHigh;
  if (ratio < 0.60) return ZONE.residentialHigh;
  if (ratio < 0.86) return ZONE.residentialHigh;
  return ZONE.residentialHigh;
}

const grids = [];
const occupiedRects = [];
const placementDiagnostics = { tested: 0, usable: 0, placed: 0, rejected: {}, bySize: {} };

function tryPlaceDistrict(columns, rows, minX, minZ) {
  const rect = {
    min_x: minX, max_x: minX + columns * PITCH,
    min_z: minZ, max_z: minZ + rows * PITCH,
  };
  if (!rectUsable(rect)) return null;
  placementDiagnostics.usable++;
  const reject = reason => {
    placementDiagnostics.rejected[reason] = (placementDiagnostics.rejected[reason] ?? 0) + 1;
    return null;
  };
  if (inCoreCircle(rect)) return reject('core_circle');
  if (reserved.some(area => area.kind === 'rect' && rectsOverlap(rect, area))) return reject('reserved');
  if (RIVERSIDE_SITES.some(site => rectsOverlap(rect, site))) return reject('riverside');
  for (const other of occupiedRects) {
    const gapX = Math.max(rect.min_x - other.max_x, other.min_x - rect.max_x);
    const gapZ = Math.max(rect.min_z - other.max_z, other.min_z - rect.max_z);
    if (gapX < DISTRICT_GAP && gapZ < DISTRICT_GAP) return reject('gap');
  }
  return rect;
}

// 按 z 带扫描铺片区：每带尽量放 3 行，带内自西向东按 3、2、1 列取最大可用宽度。
// 带间留 DISTRICT_GAP 净距，保证相邻片区不共享外围道路。
function commitDistrict(rect, columns, rows) {
  occupiedRects.push(rect);
  placementDiagnostics.placed++;
  placementDiagnostics.bySize[`${columns}x${rows}`] = (placementDiagnostics.bySize[`${columns}x${rows}`] ?? 0) + 1;
  const center = { x: (rect.min_x + rect.max_x) / 2, z: (rect.min_z + rect.max_z) / 2 };
  const sector = sectorOf(center);
  let zoneType = classifyDistrict(center);
  // 每隔若干张住宅片区插一处邻里商业中心，保证四类用途齐全且商业贴近住户
  if (ZONE_KIND_OF[zoneType] === 'residential' && grids.length % 7 === 3) zoneType = ZONE.commercialLow;
  grids.push({
    id: `grid-${sector}-${grids.length + 1}`,
    label: `${zoneType} ${columns}x${rows} 片区`,
    district: DISTRICTS[sector],
    origin: { x: rect.min_x, z: rect.min_z },
    columns, rows,
    block_width_m: PITCH, block_height_m: PITCH,
    road_prefab: ROAD.grid.prefab, road_width_m: ROAD.grid.width_m,
    zone_type: zoneType, zone_kind: ZONE_KIND_OF[zoneType],
    // 注意：plan.grids[] 的 schema 不接受 widening_policy / rect，网格也不做路宽升级。
    construction_status: 'planned',
    construction_order: 40 + grids.length,
    depends_on: ['pentagon-ring'], max_cost: 900000,
    rect,
  });
}

let bandMinZ = LATTICE_Z0 + 40;
let skippedBands = 0;
while (bandMinZ + PITCH <= 160 + PITCH && skippedBands < 40) {
  let usedRows = 0;
  for (const rows of [2, 1]) {
    let cursorX = LATTICE_X0 + 40;
    let placedInBand = 0;
    while (cursorX + PITCH <= 360) {
      let placed = null;
      for (const columns of [2, 1]) {
        placementDiagnostics.tested++;
        const rect = tryPlaceDistrict(columns, rows, cursorX, bandMinZ);
        if (rect) { commitDistrict(rect, columns, rows); placed = rect; placedInBand++; break; }
      }
      cursorX = placed ? placed.max_x + DISTRICT_GAP : cursorX + 8;
    }
    if (placedInBand) { usedRows = rows; break; }
  }
  if (!usedRows) { bandMinZ += PITCH; skippedBands++; continue; }
  bandMinZ += usedRows * PITCH + DISTRICT_GAP;
}
placementDiagnostics.skipped_bands = skippedBands;

// 第二遍：楔形在收窄处放不下 2×2，用 1×1 片区把剩下的零碎空间填满
for (let minZ = LATTICE_Z0; minZ + PITCH <= 160; minZ += 8) {
  let minX = LATTICE_X0;
  while (minX + PITCH <= 360) {
    placementDiagnostics.tested++;
    const rect = tryPlaceDistrict(1, 1, minX, minZ);
    if (rect) { commitDistrict(rect, 1, 1); minX = rect.max_x + DISTRICT_GAP; }
    else minX += 8;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 片区连接路
// ─────────────────────────────────────────────────────────────────────────────

const connectorRoads = [];
const anchorPoints = [];
for (let index = 0; index < PENTAGON.length; index++) {
  const vertex = PENTAGON[index];
  const next = PENTAGON[(index + 1) % PENTAGON.length];
  anchorPoints.push({ x: vertex.x, z: vertex.z });
  for (const t of [0.25, 0.5, 0.75]) {
    anchorPoints.push({ x: vertex.x + (next.x - vertex.x) * t, z: vertex.z + (next.z - vertex.z) * t });
  }
  for (const t of [0.3, 0.6]) {
    anchorPoints.push({
      x: RADIAL_CENTER.x + (vertex.x - RADIAL_CENTER.x) * t,
      z: RADIAL_CENTER.z + (vertex.z - RADIAL_CENTER.z) * t,
    });
  }
}

function districtPerimeterPoints(grid) {
  const points = [];
  for (let column = 0; column <= grid.columns; column++) {
    for (const z of [grid.rect.min_z, grid.rect.max_z]) points.push({ x: grid.origin.x + column * PITCH, z });
  }
  for (let row = 1; row < grid.rows; row++) {
    for (const x of [grid.rect.min_x, grid.rect.max_x]) points.push({ x, z: grid.origin.z + row * PITCH });
  }
  return points;
}

function nearestPair(from, targets, minLength = 16, maxLength = 300) {
  let best = null;
  for (const a of from) {
    for (const b of targets) {
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance < minLength || distance > maxLength) continue;
      if (!best || distance < best.distance) best = { a, b, distance };
    }
  }
  return best;
}

function connectorClear(from, to, allowedDistrictIds) {
  const padding = 16;
  for (const area of reserved) {
    // 中央广场是环形节点不是实体障碍，连接路可以贴它走
    if (area.kind === 'circle') continue;
    if (segmentHitsBox(from, to, area.min_x - padding, area.max_x + padding, area.min_z - padding, area.max_z + padding)) return false;
  }
  for (const grid of grids) {
    if (allowedDistrictIds.includes(grid.id)) continue;
    if (segmentHitsBox(from, to, grid.rect.min_x - padding, grid.rect.max_x + padding, grid.rect.min_z - padding, grid.rect.max_z + padding)) return false;
  }
  return true;
}

function addConnector(id, label, from, to, order) {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < 16) return false;
  connectorRoads.push({
    id, label,
    prefab: ROAD.connector.prefab, width_m: ROAD.connector.width_m, level: 'surface',
    road_class: 'collector', role: 'connector', district: DISTRICTS.connector,
    planning_status: 'conceptual', construction_status: 'planned',
    construction_order: order, depends_on: ['pentagon-ring'], max_cost: 200000,
    points: [{ x: from.x, z: from.z }, { x: to.x, z: to.z }],
  });
  return true;
}

// 连接路：对「片区 + 骨架」建图后跑最小生成树，保证全城单一连通分量。
const linkEdges = [];
for (let index = 0; index < grids.length; index++) {
  const perimeter = districtPerimeterPoints(grids[index]);
  const toSkeleton = nearestPair(perimeter, anchorPoints, 16, 700);
  if (toSkeleton && connectorClear(toSkeleton.a, toSkeleton.b, [grids[index].id])) {
    linkEdges.push({ from: index, to: -1, fromPoint: toSkeleton.a, toPoint: toSkeleton.b, distance: toSkeleton.distance });
  }
  for (let other = index + 1; other < grids.length; other++) {
    const pair = nearestPair(perimeter, districtPerimeterPoints(grids[other]), 16, 400);
    if (!pair || !connectorClear(pair.a, pair.b, [grids[index].id, grids[other].id])) continue;
    linkEdges.push({ from: index, to: other, fromPoint: pair.a, toPoint: pair.b, distance: pair.distance });
  }
}
linkEdges.sort((left, right) => left.distance - right.distance);
const SKELETON_NODE = grids.length;
const linkParent = Array.from({ length: grids.length + 1 }, (_, index) => index);
const linkFind = value => { while (linkParent[value] !== value) { linkParent[value] = linkParent[linkParent[value]]; value = linkParent[value]; } return value; };
const linkUnion = (left, right) => {
  const a = linkFind(left), b = linkFind(right);
  if (a === b) return false;
  linkParent[a] = b;
  return true;
};
let linkIndex = 0;
const linkedGridIds = new Set();
for (const edge of linkEdges) {
  if (!linkUnion(edge.from, edge.to === -1 ? SKELETON_NODE : edge.to)) continue;
  linkIndex++;
  if (addConnector(`link-${edge.from}-${edge.to}`, `片区连接路 ${linkIndex}`, edge.fromPoint, edge.toPoint, 60)) {
    linkedGridIds.add(grids[edge.from].id);
    if (edge.to >= 0) linkedGridIds.add(grids[edge.to].id);
  }
}
placementDiagnostics.link_edges = linkEdges.length;
placementDiagnostics.link_components = new Set(grids.map((_, index) => linkFind(index))).size;

// ─────────────────────────────────────────────────────────────────────────────
// 5. 公共服务与公用设施建筑
// ─────────────────────────────────────────────────────────────────────────────

const buildingSpecs = [
  { prefab: 'ElementarySchool02', label: '小学', kind: 'service', category: 'city_service', size: [71.6, 47.6], angle: 196, rf: 0.56 },
  { prefab: 'ElementarySchool02', label: '小学', kind: 'service', category: 'city_service', size: [71.6, 47.6], angle: 246, rf: 0.56 },
  { prefab: 'ElementarySchool02', label: '小学', kind: 'service', category: 'city_service', size: [71.6, 47.6], angle: 292, rf: 0.58 },
  { prefab: 'ElementarySchool02', label: '小学', kind: 'service', category: 'city_service', size: [71.6, 47.6], angle: 336, rf: 0.60 },
  { prefab: 'MedicalClinic02', label: '社区诊所', kind: 'service', category: 'city_service', size: [39.6, 39.6], angle: 190, rf: 0.50 },
  { prefab: 'MedicalClinic02', label: '社区诊所', kind: 'service', category: 'city_service', size: [39.6, 39.6], angle: 262, rf: 0.50 },
  { prefab: 'MedicalClinic01', label: '综合门诊', kind: 'service', category: 'city_service', size: [87.6, 47.6], angle: 282, rf: 0.38 },
  { prefab: 'FireHouse01', label: '消防站', kind: 'service', category: 'city_service', size: [39.6, 39.6], angle: 172, rf: 0.54 },
  { prefab: 'FireHouse01', label: '消防站（产业区）', kind: 'service', category: 'city_service', size: [39.6, 39.6], angle: 44, rf: 0.58 },
  { prefab: 'PoliceStation02', label: '警察分局', kind: 'service', category: 'city_service', size: [39.6, 39.6], angle: 176, rf: 0.40 },
  { prefab: 'PostOffice02', label: '邮局', kind: 'service', category: 'city_service', size: [23.6, 31.6], angle: 216, rf: 0.54 },
  { prefab: 'CityPark03', label: '城市公园', kind: 'service', category: 'city_service', size: [79.6, 63.6], angle: 120, rf: 0.68 },
  { prefab: 'CityPark03', label: '城市公园', kind: 'service', category: 'city_service', size: [79.6, 63.6], angle: 188, rf: 0.70 },
  { prefab: 'CityPark03', label: '城市公园', kind: 'service', category: 'city_service', size: [79.6, 63.6], angle: 268, rf: 0.68 },
  { prefab: 'Playground02', label: '儿童活动场', kind: 'service', category: 'city_service', size: [23.6, 31.6], angle: 154, rf: 0.62 },
  { prefab: 'Playground02', label: '儿童活动场', kind: 'service', category: 'city_service', size: [23.6, 31.6], angle: 18, rf: 0.62 },
  { prefab: 'ParkMaintenanceDepot01', label: '公园养护段', kind: 'service', category: 'city_service', size: [55.6, 79.6], angle: 104, rf: 0.64 },
  { prefab: 'LargeEmergencyShelter01', label: '应急避难所', kind: 'service', category: 'city_service', size: [39.6, 55.6], angle: 132, rf: 0.50 },
  { prefab: 'EarlyDisasterWarningSystem01', label: '灾害预警中心', kind: 'service', category: 'city_service', size: [79.6, 55.6], angle: 232, rf: 0.48 },
  { prefab: 'BusStation02', label: '公交枢纽站', kind: 'service', category: 'transport_facility', size: [31.6, 47.6], angle: 90, rf: 0.32 },
  { prefab: 'BusStation02', label: '公交枢纽站', kind: 'service', category: 'transport_facility', size: [31.6, 47.6], angle: 210, rf: 0.32 },
  { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站', kind: 'utility', category: 'utility_facility', size: [47.6, 47.6], angle: 60, rf: 0.44 },
  { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站', kind: 'utility', category: 'utility_facility', size: [47.6, 47.6], angle: 98, rf: 0.44 },
  { prefab: 'GroundwaterPumpingStation01', label: '地下水抽水站', kind: 'utility', category: 'utility_facility', size: [47.6, 47.6], angle: 350, rf: 0.46 },
  { prefab: 'WaterTower01', label: '水塔', kind: 'utility', category: 'utility_facility', size: [31.6, 31.6], angle: 30, rf: 0.38 },
  { prefab: 'WaterTower01', label: '水塔', kind: 'utility', category: 'utility_facility', size: [31.6, 31.6], angle: 326, rf: 0.34 },
  { prefab: 'TransformerStation01', label: '变电站', kind: 'utility', category: 'utility_facility', size: [47.6, 55.6], angle: 138, rf: 0.58 },
  { prefab: 'TelecomTower01', label: '通信塔', kind: 'utility', category: 'utility_facility', size: [55.6, 55.6], angle: 252, rf: 0.34 },
  { prefab: 'RadioMast01', label: '无线电桅杆', kind: 'utility', category: 'utility_facility', size: [31.6, 23.6], angle: 202, rf: 0.68 },
];

// 园区大型设施：按功能分区沿对应街道的一侧排布（全部在街南侧，即园区内侧）。
const reserveBuildings = [
  { run: ['campus-cross-1', 'south', -432, 176], prefab: 'College01', label: '城市学院', kind: 'service', category: 'city_service', size: [175.6, 127.6] },
  { run: ['campus-cross-1', 'south', -432, 176], prefab: 'HighSchool02', label: '第一完全中学', kind: 'service', category: 'city_service', size: [95.6, 63.6] },
  { run: ['campus-cross-1', 'south', 208, 816], prefab: 'Hospital01', label: '区域医院', kind: 'service', category: 'city_service', size: [183.6, 79.6] },
  { run: ['campus-cross-1', 'south', 208, 816], prefab: 'FootballField01', label: '足球场', kind: 'service', category: 'city_service', size: [95.6, 119.6] },
  { run: ['campus-cross-1', 'south', 208, 816], prefab: 'BasketballCourt04', label: '篮球场', kind: 'service', category: 'city_service', size: [63.6, 47.6] },
  { run: ['campus-cross-1', 'south', 208, 816], prefab: 'Playground03', label: '儿童活动区', kind: 'service', category: 'city_service', size: [23.6, 23.6] },
  { run: ['campus-cross-2', 'south', -432, 176], prefab: 'HighSchool02', label: '第二中学', kind: 'service', category: 'city_service', size: [95.6, 63.6] },
  { run: ['campus-cross-2', 'south', -432, 176], prefab: 'HighSchool02', label: '第三中学', kind: 'service', category: 'city_service', size: [95.6, 63.6] },
  { run: ['campus-cross-2', 'south', 208, 816], prefab: 'WelfareOffice01', label: '社会福利中心', kind: 'service', category: 'city_service', size: [119.6, 127.6] },
  { run: ['campus-cross-2', 'south', 208, 816], prefab: 'PostOffice01', label: '邮政分局', kind: 'service', category: 'city_service', size: [79.6, 63.6] },
  { run: ['campus-cross-2', 'south', 208, 816], prefab: 'PoliceStation01', label: '警察局', kind: 'service', category: 'city_service', size: [95.6, 55.6] },
  { run: ['campus-cross-3', 'south', -432, 176], prefab: 'Cemetery02', label: '公墓', kind: 'service', category: 'city_service', size: [111.6, 47.6] },
  { run: ['campus-cross-3', 'south', -432, 176], prefab: 'Crematorium01', label: '火葬场', kind: 'service', category: 'city_service', size: [63.6, 79.6] },
  { run: ['campus-cross-1', 'south', 208, 816], prefab: 'ParkingLot03', label: '公共停车场（医院与体育公园）', kind: 'service', category: 'city_service', size: [79.6, 63.6] },
  { run: ['riverside-spine', 'east', -440, 264], prefab: 'Landfill01', label: '垃圾填埋场', kind: 'service', category: 'city_service', size: [135.6, 119.6] },
  { run: ['riverside-spine', 'east', -440, 264], prefab: 'RecyclingCenter01', label: '资源回收中心', kind: 'service', category: 'city_service', size: [175.6, 143.6] },
  { run: ['riverside-spine', 'east', -440, 264], prefab: 'WastewaterTreatmentPlant01', label: '污水处理厂', kind: 'utility', category: 'utility_facility', size: [95.6, 79.6] },
  { run: ['riverside-spine', 'east', -440, 264], prefab: 'TransformerStation02', label: '高压变电站', kind: 'utility', category: 'utility_facility', size: [23.6, 31.6] },
];

const buildings = [];
let buildingIndex = 0;

function addBuilding(spec, position, siteLabel, rotationDegrees = 0) {
  buildingIndex++;
  buildings.push({
    id: `bld-${String(buildingIndex).padStart(3, '0')}`,
    label: spec.label, name: spec.label, prefab: spec.prefab,
    kind: spec.kind, category: spec.category,
    position: { x: position.x, y: 0, z: position.z },
    rotation_degrees: rotationDegrees,
    rotation_source: 'road_tangent',
    placement_status: 'candidate_bound',
    construction_status: 'planned',
    construction_order: 100 + buildingIndex,
    depends_on: ['pentagon-ring'],
    max_cost: 3000000,
    size_m: { x: spec.size[0], z: spec.size[1] },
    reserved_size_m: { x: spec.size[0] + 4, z: spec.size[1] + 4 },
    // 建筑的 schema 不接受额外键；siteLabel 只用于内部说明，不写入 plan。
  });
  void siteLabel;
}

function roadConflictOf(position, sizeX, sizeZ, rotationDegrees = 0) {
  const { halfX, halfZ } = worldHalfExtents(sizeX + 4, sizeZ + 4, rotationDegrees);
  for (const road of [...roads, ...connectorRoads]) {
    const halfRoad = road.width_m / 2;
    for (let index = 1; index < road.points.length; index++) {
      if (segmentHitsBox(road.points[index - 1], road.points[index],
        position.x - halfX - halfRoad, position.x + halfX + halfRoad,
        position.z - halfZ - halfRoad, position.z + halfZ + halfRoad)) return { road: road.id };
    }
  }
  for (const grid of grids) {
    const halfRoad = grid.road_width_m / 2;
    const r = grid.rect;
    const lines = [
      [{ x: r.min_x, z: r.min_z }, { x: r.max_x, z: r.min_z }],
      [{ x: r.min_x, z: r.max_z }, { x: r.max_x, z: r.max_z }],
      [{ x: r.min_x, z: r.min_z }, { x: r.min_x, z: r.max_z }],
      [{ x: r.max_x, z: r.min_z }, { x: r.max_x, z: r.max_z }],
    ];
    for (const [a, b] of lines) {
      if (segmentHitsBox(a, b,
        position.x - halfX - halfRoad, position.x + halfX + halfRoad,
        position.z - halfZ - halfRoad, position.z + halfZ + halfRoad)) return { road: `${grid.id}-perimeter` };
    }
  }
  return null;
}

const footprintClearsRoads = (position, sizeX, sizeZ, rotationDegrees = 0) =>
  roadConflictOf(position, sizeX, sizeZ, rotationDegrees) === null;

// 沿街落位：所有环外设施都必须在道路街面上，具备可回读的原生道路绑定。
const frontageRejections = {};
function footprintIsFree(position, size, rotationDegrees) {
  const reject = reason => { frontageRejections[reason] = (frontageRejections[reason] ?? 0) + 1; return false; };
  if (insideDistance(position) > -40) return reject('ring_buffer');
  const { halfX, halfZ } = worldHalfExtents(size[0], size[1], rotationDegrees);
  if (position.x - halfX < REGION_BOUNDS.min_x || position.x + halfX > REGION_BOUNDS.max_x) return reject('region_x');
  if (position.z - halfZ < REGION_BOUNDS.min_z || position.z + halfZ > REGION_BOUNDS.max_z) return reject('region_z');
  if (!footprintClearsRoads(position, size[0], size[1], rotationDegrees)) {
    return reject(`road:${roadConflictOf(position, size[0], size[1], rotationDegrees)?.road ?? '?'}`);
  }
  const candidate = {
    position, size_m: { x: size[0], z: size[1] }, rotation_degrees: rotationDegrees,
    reserved_size_m: { x: size[0] + 4, z: size[1] + 4 },
  };
  if (buildings.some(existing => overlaps(existing, candidate))) return reject('overlap');
  return true;
}

function runDistrictLabel(streetId, from) {
  if (streetId === 'riverside-spine') return DISTRICTS.riverside;
  const westColumn = from < 192;
  if (streetId === 'campus-cross-1') return westColumn ? CAMPUS.college.label : CAMPUS.hospitalSports.label;
  if (streetId === 'campus-cross-2') return westColumn ? CAMPUS.schools.label : CAMPUS.welfare.label;
  if (streetId === 'campus-cross-3') return westColumn ? CAMPUS.cemetery.label : CAMPUS.utilities.label;
  return CAMPUS.utilities.label;
}
const campusRuns = new Map();
function takeRunSlot(spec) {
  const [streetId, side, from, to] = spec.run;
  const key = JSON.stringify(spec.run);
  if (!campusRuns.has(key)) campusRuns.set(key, frontageRun(streetId, side, from, to));
  return takeFrontageSlot(campusRuns.get(key), spec, spec.size, footprintIsFree);
}

// 大设施与市政设施：先按功能分区落位；分区游标排满时向后备用街段顺延。
for (const spec of reserveBuildings) {
  const slot = takeRunSlot(spec);
  if (!slot) {
    notes.push(`预留建筑 ${spec.prefab}（${spec.label}）沿「${spec.run[0]}」找不到沿街位置；拒因 ${JSON.stringify(frontageRejections)}`);
    continue;
  }
  addBuilding(spec, slot.position, runDistrictLabel(spec.run[0], spec.run[2]), slot.rotation_degrees);
}

// 单格服务设施：五边形以南的市政公用设施群，沿三横路至四横路两侧沿街排布。
const campusUtilityRuns = [
  ['campus-cross-3', 'south', 208, 816],
  ['campus-cross-4', 'north', 208, 816],
  ['campus-cross-4', 'south', 208, 816],
  ['campus-mid', 'east', -2280, -2664],
  ['campus-east', 'west', -2280, -2664],
  ['campus-cross-3', 'south', -432, 176],
];
const campusUtilityCursors = campusUtilityRuns.map(([streetId, side, from, to]) => frontageRun(streetId, side, from, to));
for (const spec of buildingSpecs) {
  let slot = null;
  for (const run of campusUtilityCursors) {
    slot = takeFrontageSlot(run, spec, spec.size, footprintIsFree);
    if (slot) break;
  }
  if (!slot) { notes.push(`未能为 ${spec.prefab}（${spec.label}）在南城市政公用设施群找到沿街位置`); continue; }
  addBuilding(spec, slot.position, CAMPUS.utilities.label, slot.rotation_degrees);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 独立管网
// ─────────────────────────────────────────────────────────────────────────────

const utilities = [];
const transformer = buildings.find(building => building.prefab === 'TransformerStation02');
if (transformer) {
  utilities.push({
    id: 'hv-import',
    label: '高压进线（既有高压线终点 → 高压变电站）',
    prefab: 'High-voltage Line', network_type: 'electricity', level: 'surface',
    construction_status: 'planned', construction_order: 90, max_cost: 400000,
    points: [
      { x: HV_TERMINUS.x, z: HV_TERMINUS.z },
      { x: transformer.position.x, z: transformer.position.z },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. 核算与自检
// ─────────────────────────────────────────────────────────────────────────────

// 与渲染器一致：世界坐标下按 rotation_degrees 旋转局部 footprint（渲染器 SVG 用 rotate(-θ)）。
function buildingCorners(building) {
  const halfX = Math.max(building.size_m.x, building.reserved_size_m?.x ?? 0) / 2;
  const halfZ = Math.max(building.size_m.z, building.reserved_size_m?.z ?? 0) / 2;
  const rotation = ((building.rotation_degrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]]
    .map(([x, z]) => ({
      x: building.position.x + x * cos - z * sin,
      z: building.position.z + x * sin + z * cos,
    }));
}

function worldHalfExtents(sizeX, sizeZ, rotationDegrees = 0) {
  const rotation = ((rotationDegrees ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rotation)), sin = Math.abs(Math.sin(rotation));
  return { halfX: (sizeX / 2) * cos + (sizeZ / 2) * sin, halfZ: (sizeX / 2) * sin + (sizeZ / 2) * cos };
}

function overlaps(left, right) {
  const a = buildingCorners(left), b = buildingCorners(right);
  return Math.min(...a.map(p => p.x)) < Math.max(...b.map(p => p.x))
    && Math.max(...a.map(p => p.x)) > Math.min(...b.map(p => p.x))
    && Math.min(...a.map(p => p.z)) < Math.max(...b.map(p => p.z))
    && Math.max(...a.map(p => p.z)) > Math.min(...b.map(p => p.z));
}

const cellCountByZone = {};
for (const grid of grids) cellCountByZone[grid.zone_type] = (cellCountByZone[grid.zone_type] ?? 0) + grid.columns * grid.rows;
const areaByKind = Object.fromEntries(Object.entries(cellCountByZone).map(([kind, cells]) => [kind, cells * CELL_AREA_M2]));
const householdByKind = {};
let households = 0;
for (const [kind, cells] of Object.entries(cellCountByZone)) {
  if (!HOUSEHOLD_AREA_M2[kind]) continue;
  householdByKind[kind] = Math.round((cells * CELL_AREA_M2) / HOUSEHOLD_AREA_M2[kind]);
  households += householdByKind[kind];
}
const residentialCells = Object.entries(cellCountByZone)
  .filter(([kind]) => HOUSEHOLD_AREA_M2[kind]).reduce((sum, [, cells]) => sum + cells, 0);

const allRoadObjects = [...roads, ...connectorRoads];
const roadLength = allRoadObjects.reduce((sum, road) => sum + road.points.slice(1)
  .reduce((inner, point, index) => inner + Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z), 0), 0);

// 与渲染器/施工器一致：把 plan.grids 展开成实际道路后再判连通性。
function gridRoadObjects() {
  const list = [];
  for (const grid of grids) {
    for (let column = 0; column <= grid.columns; column++) {
      list.push({
        id: `${grid.id}-v-${column}`, width_m: grid.road_width_m,
        points: [
          { x: grid.origin.x + column * PITCH, z: grid.origin.z },
          { x: grid.origin.x + column * PITCH, z: grid.origin.z + grid.rows * PITCH },
        ],
      });
    }
    for (let row = 0; row <= grid.rows; row++) {
      list.push({
        id: `${grid.id}-h-${row}`, width_m: grid.road_width_m,
        points: [
          { x: grid.origin.x, z: grid.origin.z + row * PITCH },
          { x: grid.origin.x + grid.columns * PITCH, z: grid.origin.z + row * PITCH },
        ],
      });
    }
  }
  return list;
}

function connectedComponents() {
  const network = [...allRoadObjects, ...gridRoadObjects()];
  const parent = network.map((_, index) => index);
  const find = value => { while (parent[value] !== value) { parent[value] = parent[parent[value]]; value = parent[value]; } return value; };
  const union = (left, right) => { const a = find(left), b = find(right); if (a !== b) parent[a] = b; };
  for (let left = 0; left < network.length; left++) {
    for (let right = left + 1; right < network.length; right++) {
      let touches = false;
      const endpoints = object => [object.points[0], object.points[object.points.length - 1]];
      for (const point of endpoints(network[left])) {
        for (let index = 1; index < network[right].points.length && !touches; index++) {
          if (pointSegmentDistance(point, network[right].points[index - 1], network[right].points[index]) <= 2) touches = true;
        }
        if (touches) break;
      }
      if (!touches) {
        for (const point of endpoints(network[right])) {
          for (let index = 1; index < network[left].points.length && !touches; index++) {
            if (pointSegmentDistance(point, network[left].points[index - 1], network[left].points[index]) <= 2) touches = true;
          }
          if (touches) break;
        }
      }
      if (!touches) {
        for (let a = 1; a < network[left].points.length && !touches; a++) {
          for (let b = 1; b < network[right].points.length && !touches; b++) {
            if (segmentsCross(network[left].points[a - 1], network[left].points[a],
              network[right].points[b - 1], network[right].points[b])) touches = true;
          }
        }
      }
      if (touches) union(left, right);
    }
  }
  return new Set(network.map((_, index) => find(index))).size;
}

const marginX = Math.min(
  PENTAGON.reduce((min, v) => Math.min(min, v.x), Infinity) - REGION_BOUNDS.min_x,
  REGION_BOUNDS.max_x - PENTAGON.reduce((max, v) => Math.max(max, v.x), -Infinity));
const marginZ = Math.min(
  PENTAGON.reduce((min, v) => Math.min(min, v.z), Infinity) - REGION_BOUNDS.min_z,
  REGION_BOUNDS.max_z - PENTAGON.reduce((max, v) => Math.max(max, v.z), -Infinity));
const railwayClearance = Math.min(...PENTAGON.map(distanceToRailway));

let waterClearance = Infinity;
for (const edge of EDGES) {
  const steps = Math.ceil(edge.length / 8);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const point = { x: edge.start.x + (edge.end.x - edge.start.x) * t, z: edge.start.z + (edge.end.z - edge.start.z) * t };
    const shore = waterShoreAt(point.z);
    if (!Number.isFinite(shore)) continue;
    waterClearance = Math.min(waterClearance, shore - point.x);
  }
}

// 环外服务园区、滨水带与全部道路/建筑同样按实测水域包络校核（不只五边形边界）
const WATER_MARGIN_M = 40;
const waterIntrusions = [];
function auditWater(label, x, z) {
  const shore = waterShoreAt(z);
  if (!Number.isFinite(shore) || shore - x >= WATER_MARGIN_M) return;
  waterIntrusions.push(`${label}(${x.toFixed(0)},${z.toFixed(0)}) 距水域 ${(shore - x).toFixed(1)} m`);
}
for (const road of allRoadObjects) for (const point of road.points) auditWater(road.id, point.x, point.z);
for (const building of buildings) for (const corner of buildingCorners(building)) auditWater(building.label, corner.x, corner.z);

const arterialsCrossingDistricts = [];
for (const road of roads) {
  for (const grid of grids) {
    for (let index = 1; index < road.points.length; index++) {
      if (segmentHitsBox(road.points[index - 1], road.points[index],
        grid.rect.min_x, grid.rect.max_x, grid.rect.min_z, grid.rect.max_z)) {
        arterialsCrossingDistricts.push(`${road.id} x ${grid.id}`);
      }
    }
  }
}

const sharedPerimeterPairs = [];
for (let left = 0; left < grids.length; left++) {
  for (let right = left + 1; right < grids.length; right++) {
    const a = grids[left].rect, b = grids[right].rect;
    const overlapX = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x);
    const overlapZ = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z);
    const sharedVertical = Math.abs(overlapX) < 1e-6 && overlapZ > 0;
    const sharedHorizontal = Math.abs(overlapZ) < 1e-6 && overlapX > 0;
    if ((overlapX > 0 && overlapZ > 0) || sharedVertical || sharedHorizontal) {
      sharedPerimeterPairs.push(`${grids[left].id} x ${grids[right].id}`);
    }
  }
}

const districtsWithoutConnector = grids
  .filter(grid => !linkedGridIds.has(grid.id))
  .map(grid => grid.id);

const overlappingBuildings = [];
for (let left = 0; left < buildings.length; left++) {
  for (let right = left + 1; right < buildings.length; right++) {
    if (overlaps(buildings[left], buildings[right])) overlappingBuildings.push(`${buildings[left].label} x ${buildings[right].label}`);
  }
}
const blockedBuildings = buildings
  .map(building => ({ building, conflict: roadConflictOf(building.position, building.size_m.x, building.size_m.z, building.rotation_degrees) }))
  .filter(entry => entry.conflict)
  .map(entry => `${entry.building.label}(${entry.building.prefab}) <- ${entry.conflict.road}`);

const buildingsInsideRing = buildings
  .filter(building => insideDistance(building.position) > -40)
  .map(building => building.label);

// 道路接入：每栋建筑的可达外缘到最近规划道路「路面外缘」的距离。
// 《建筑指南》的道路绑定硬门禁要求普通沿街设施有精确 road_edge_id；
// 因此规划阶段就必须保证 footprint 真正贴街，而不是「图上离得近」。
const ACCESS_LIMIT_M = 8;
const buildingAccess = buildings.map(building => {
  const corners = buildingCorners(building);
  let best = Infinity, roadId = null;
  for (const corner of corners) {
    for (const road of allRoadObjects) {
      const halfRoad = road.width_m / 2;
      for (let index = 1; index < road.points.length; index++) {
        const distance = pointSegmentDistance(corner, road.points[index - 1], road.points[index]) - halfRoad;
        if (distance < best) { best = distance; roadId = road.id; }
      }
    }
  }
  return { label: `${building.label}(${building.prefab})`, edge_distance_m: best, road: roadId };
});
const disconnectedBuildings = buildingAccess
  .filter(entry => entry.edge_distance_m > ACCESS_LIMIT_M)
  .map(entry => `${entry.label} 距路缘 ${entry.edge_distance_m.toFixed(1)} m`);

const gridExceptions = buildGridExceptions({ roads: allRoadObjects, buildings, zones: [], utilities, tracks: [] });

const nonFinite = [
  ...allRoadObjects.filter(road => road.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))).map(road => `road:${road.id}`),
  ...grids.filter(grid => !Number.isFinite(grid.origin.x) || !Number.isFinite(grid.origin.z)).map(grid => `grid:${grid.id}`),
  ...buildings.filter(b => !Number.isFinite(b.position.x) || !Number.isFinite(b.position.z)).map(b => `building:${b.label}`),
];
if (nonFinite.length) throw new Error(`存在非有限坐标：${nonFinite.slice(0, 6).join('、')}`);
if (!grids.length) notes.push(`没有任何网格片区（诊断 ${JSON.stringify(placementDiagnostics)}）`);

const checks = [
  { name: '五边形全部顶点位于已购区域内', ok: PENTAGON.every(v => v.x > REGION_BOUNDS.min_x && v.x < REGION_BOUNDS.max_x && v.z > REGION_BOUNDS.min_z && v.z < REGION_BOUNDS.max_z) },
  { name: '四周退距 ≥ 150 m', ok: marginX >= 150 && marginZ >= 150, detail: `x ${marginX.toFixed(1)} m / z ${marginZ.toFixed(1)} m` },
  { name: '五边形边界离实测河道 ≥ 40 m', ok: waterClearance >= 40, detail: `${waterClearance.toFixed(1)} m` },
  { name: '全部道路与建筑离实测水域 ≥ 40 m', ok: waterIntrusions.length === 0, detail: waterIntrusions.slice(0, 4).join('；') || '无（含南城园区与滨水带）' },
  { name: '五边形离既有铁路 ≥ 150 m', ok: railwayClearance >= 150, detail: `${railwayClearance.toFixed(1)} m` },
  { name: '五条边长偏差 ≤ 1%（正五边形）', ok: (Math.max(...EDGE_LENGTHS) - Math.min(...EDGE_LENGTHS)) / (EDGE_LENGTHS.reduce((a, b) => a + b, 0) / 5) <= 0.01, detail: `${Math.min(...EDGE_LENGTHS).toFixed(1)}-${Math.max(...EDGE_LENGTHS).toFixed(1)} m` },
  { name: '五边形顶点全部落在 8 m 格点上', ok: PENTAGON.every(v => v.x % 8 === 0 && v.z % 8 === 0) },
  { name: '四类用途全部由 plan.grids 表达', ok: grids.length > 0 && grids.every(grid => grid.zone_kind && grid.zone_type), detail: `${grids.length} 张片区 / ${grids.reduce((sum, grid) => sum + grid.columns * grid.rows, 0)} 个分区格` },
  { name: '四类用途齐全（住宅/商业/工业/办公）', ok: ['residential', 'commercial', 'industrial', 'office'].every(kind => grids.some(grid => grid.zone_kind === kind)), detail: [...new Set(grids.map(grid => grid.zone_kind))].join('、') },
  { name: '每张片区只含一种用途', ok: grids.every(grid => ZONE_KIND_OF[grid.zone_type] === grid.zone_kind) },
  { name: '片区之间不重叠、不共享外围道路', ok: sharedPerimeterPairs.length === 0, detail: sharedPerimeterPairs.slice(0, 4).join('；') || '无' },
  { name: '环路与放射大道不穿过任何片区', ok: arterialsCrossingDistricts.length === 0, detail: arterialsCrossingDistricts.slice(0, 4).join('；') || '无' },
  { name: '每张片区都有连接路接入骨架', ok: districtsWithoutConnector.length === 0, detail: districtsWithoutConnector.slice(0, 6).join('；') || '无' },
  { name: '路网为单一连通分量', ok: connectedComponents() === 1, detail: `${connectedComponents()} 个分量` },
  { name: '全部规划几何位于已购区域内', ok: [...allRoadObjects.flatMap(road => road.points), ...buildings.flatMap(buildingCorners)]
      .every(p => p.x >= REGION_BOUNDS.min_x && p.x <= REGION_BOUNDS.max_x && p.z >= REGION_BOUNDS.min_z && p.z <= REGION_BOUNDS.max_z) },
  { name: '规划建筑互不重叠', ok: overlappingBuildings.length === 0, detail: overlappingBuildings.slice(0, 4).join('；') || '无' },
  { name: '规划建筑不压规划道路', ok: blockedBuildings.length === 0, detail: blockedBuildings.slice(0, 4).join('；') || '无' },
  { name: `每栋建筑外缘到最近道路外缘 ≤ ${ACCESS_LIMIT_M} m（沿街接入）`, ok: disconnectedBuildings.length === 0, detail: disconnectedBuildings.slice(0, 4).join('；') || `最远 ${Math.max(...buildingAccess.map(entry => entry.edge_distance_m)).toFixed(1)} m` },
  { name: '全部建筑落位（含环外滨水带）', ok: buildings.length === buildingSpecs.length + reserveBuildings.length, detail: `${buildings.length} / ${buildingSpecs.length + reserveBuildings.length} 栋` },
  { name: '全部公共服务与公用设施位于环路之外', ok: buildingsInsideRing.length === 0, detail: buildingsInsideRing.join('；') || '无' },
  { name: '对外接口带当前会话节点锚点', ok: roads.some(road => road.points.some(point => point.node_id === HIGHWAY_TERMINUS_NODE)) },
  { name: '非网格路网已逐组登记 grid_exceptions', ok: gridExceptions.length > 0, detail: gridExceptions.map(exception => exception.scope_id).join('、') },
  { name: '人口落在 1.2-1.6 万', ok: households * PEOPLE_PER_HOUSEHOLD >= 12000 && households * PEOPLE_PER_HOUSEHOLD <= 16000, detail: `${Math.round(households * PEOPLE_PER_HOUSEHOLD)} 人` },
];

const allX = [...allRoadObjects.flatMap(road => road.points.map(p => p.x)), ...buildings.flatMap(b => buildingCorners(b).map(p => p.x))];
const allZ = [...allRoadObjects.flatMap(road => road.points.map(p => p.z)), ...buildings.flatMap(b => buildingCorners(b).map(p => p.z))];
const bounds = {
  min_x: Math.round((Math.min(...allX) - 40) / 8) * 8, min_z: Math.round((Math.min(...allZ) - 40) / 8) * 8,
  max_x: Math.round((Math.max(...allX) + 40) / 8) * 8, max_z: Math.round((Math.max(...allZ) + 40) / 8) * 8,
};

const plan = {
  roads: allRoadObjects,
  buildings,
  zones: [],
  grids: grids.map(grid => {
    const { rect, ...rest } = grid;
    return rest;
  }),
  utilities,
  tracks: [],
  grid_exceptions: gridExceptions,
};
const planId = computeCityPlanId(bounds, plan);

const document = {
  plan_id: planId,
  city: CITY,
  name: '佩奇代尔正五边形城',
  target_population: TARGET_POPULATION,
  bounds,
  render: { title: '佩奇代尔｜正五边形城施工图（只读规划，尚未授权施工）', width: 2200, height: 1500, view: 'surface', format: 'static_html' },
  water_cell_size_m: 32,
  terrain_cell_size_m: 64,
  geometry: {
    pentagon: {
      center: CENTER, circumradius_m: Math.round(R), vertices: PENTAGON,
      edge_length_m: EDGE_LENGTHS.map(value => Math.round(value)),
      edge_vectors_cells_8m: [[136, 0], [42, 129], [-110, 80], [-110, -80], [42, -129]],
      regularity_note: '边向量以 8 m 格为单位相加恒为零（自动闭合），边长 136 / 135.7 格，最大偏差 0.22%，顶角偏差 < 0.2°',
      orientation_note: '顶点 V0 朝正北、南边水平；街区格网相位与南边、西顶点对齐',
    },
    region_margin_m: { x: marginX, z: marginZ },
    railway_clearance_m: Math.round(railwayClearance),
    river_clearance_m: Math.round(waterClearance),
    golden_block: {
      curb_to_curb_m: GOLDEN, center_pitch_m: PITCH,
      note: '片区内部 Small(16) ↔ Small(16) 中心距 112 m → 路缘 96 m；环路 Large(32) 与放射大道 Medium(24) 分别为 36 m / 32 m 净距与片区退让。',
      max_zoning_depth_m: MAX_ZONING_DEPTH_M,
    },
    sectors: SECTOR_ORDER.map((key, index) => ({
      key, name: DISTRICTS[key],
      from_deg: Math.round(SECTOR_BOUNDARIES[index] * 10) / 10,
      to_deg: Math.round(SECTOR_BOUNDARIES[index + 1] * 10) / 10,
    })),
    existing_constraints: {
      highway_terminus: { ...HIGHWAY_TERMINUS, node_id: HIGHWAY_TERMINUS_NODE, note: '已购区内唯一的对外机动车接口，锚点绑定当前城市会话，换存档后必须重新回读。' },
      high_voltage_terminus: HV_TERMINUS,
      railway_note: `铁路斜穿已购区西南角，五边形最近角点仍留 ${Math.round(railwayClearance)} m 净距，全部开发单元与分区不跨越铁路。`,
      river_note: `已购区东侧存在实测河道（深水 19.6 m / 浅滩 0.7-1.5 m）。五边形按实测西岸收缩，边界离河最近 ${Math.round(waterClearance)} m；河道整体留在五边形之外。`
        + '注意 list_map_tiles 对这些格报 SurfaceWater=0，与原生水深读数矛盾，本规划以原生水深为准；区域北半区另行补测确认无水。',
      surface_water_note: '五边形内实测无地表水：给水只能取地下水（GroundwaterPumpingStation01 + WaterTower01），污水走河东滨水带的 WastewaterTreatmentPlant01，两者都不需要岸线。',
      wind_note: '实测恒定风矢量 (0.275, 0.275) → 45°；产业片区放在东北扇区外圈（下风向），内圈位于产业区上风向可住人，中间留办公缓冲片区。',
      terrain_note: '全场高程 617.4-617.9 m，起伏 < 1 m，无坡度约束，不需要整地。',
    },
  },
  zoning_model: {
    rule: '住宅/商业/工业/办公四类用途全部由 plan.grids 表达：每张片区是轴对齐规则网格，只用 Small Road，内部横纵等宽；'
      + '每张片区只含一种用途，四类用途各占若干互不相邻的片区。分区由网格单元格生成，单元格四条边都是本片区自己的道路，'
      + '因此任何分区都不会跨过道路，也不会与别的用途混在同一张网格里。',
    why_separate_grids: 'mcp/city-plan-construction-workflow.mjs 的 validateGridSeparation 会拒绝「重叠或共享外围道路」的两张网格（PLAN_GRID_OVERLAP），'
      + '对应《规划图指南》「相邻网格不得重复生成共享外围道路」。因此片区之间留 24 m 净距，并由 connector 连接路接入骨架。',
    max_blocks_per_district: '3x3（《从零建城》对单个开发单元的建议上限；原生单次网格预览硬上限为 5x5）',
    insets: { ring_inset_m: RING_INSET, radial_inset_m: RADIAL_INSET, district_gap_m: DISTRICT_GAP },
  },
  districts: SECTOR_ORDER.map(key => ({
    key, name: DISTRICTS[key],
    grid_count: grids.filter(grid => grid.district === DISTRICTS[key]).length,
    cells: grids.filter(grid => grid.district === DISTRICTS[key]).reduce((sum, grid) => sum + grid.columns * grid.rows, 0),
    uses: [...new Set(grids.filter(grid => grid.district === DISTRICTS[key]).map(grid => grid.zone_type))],
  })),
  reserved_sites: reserved.map(area => area.kind === 'circle'
    ? { label: area.label, shape: 'circle', center: { x: area.x, z: area.z }, radius_m: area.r }
    : { label: area.label, shape: 'rect', min_x: area.min_x, max_x: area.max_x, min_z: area.min_z, max_z: area.max_z, center: area.center }),
  riverside_band: RIVERSIDE_SITES.map(site => ({
    label: site.label, min_x: site.min_x, max_x: site.max_x, min_z: site.min_z, max_z: site.max_z,
    note: '城市滨水带，位于环路之外、河道以西，经 riverside-access / riverside-spine 接入环路东角点。',
  })),
  service_coverage: {
    education: ['ElementarySchool02 x4（小学 1,600 座）', 'HighSchool02 x3（中学 1,200 座）', 'College01 x1（城市学院）'],
    healthcare: ['Hospital01 x1（500 床）', 'MedicalClinic01 x1 + MedicalClinic02 x2'],
    fire: ['FireHouse01 x2'],
    police: ['PoliceStation01 x1 + PoliceStation02 x1'],
    garbage: ['Landfill01 x1', 'RecyclingCenter01 x1（滨水带）'],
    deathcare: ['Cemetery02 x1', 'Crematorium01 x1'],
    post: ['PostOffice01 x1 + PostOffice02 x1'],
    park: ['CityPark03 x3', 'Playground02 x2', 'Playground03 x1', 'FootballField01 x1', 'BasketballCourt04 x1'],
    welfare: ['WelfareOffice01 x1'],
    maintenance: ['ParkMaintenanceDepot01 x1'],
    emergency: ['LargeEmergencyShelter01 x1', 'EarlyDisasterWarningSystem01 x1'],
    transport: ['BusStation02 x2'],
    telecom: ['TelecomTower01 x1', 'RadioMast01 x1'],
    power: ['High-voltage Line 进线 x1', 'TransformerStation01 x1', 'TransformerStation02 x1'],
    water: ['GroundwaterPumpingStation01 x3', 'WaterTower01 x2'],
    sewage: ['WastewaterTreatmentPlant01 x1（滨水带）'],
    parking: ['ParkingLot03 x1'],
  },
  accounting: {
    target_population: TARGET_POPULATION,
    households,
    people: Math.round(households * PEOPLE_PER_HOUSEHOLD),
    people_range: [Math.round(households * PEOPLE_RANGE[0]), Math.round(households * PEOPLE_RANGE[1])],
    people_per_household: PEOPLE_PER_HOUSEHOLD,
    household_area_m2: HOUSEHOLD_AREA_M2,
    household_rule: '按分区类型汇总可划区面积（每格 96x96 = 9216 m²）后 round(面积 / 户均占地)，再乘每户人数',
    household_by_kind: householdByKind,
    zone_area_m2: areaByKind,
    grid_count: grids.length,
    grid_size_histogram: Object.entries(grids.reduce((accumulator, grid) => {
      const key = `${grid.columns}x${grid.rows}`;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {})),
    zone_kind_cells: Object.fromEntries(['residential', 'commercial', 'industrial', 'office']
      .map(kind => [kind, grids.filter(grid => grid.zone_kind === kind).reduce((sum, grid) => sum + grid.columns * grid.rows, 0)])),
    zone_type_cells: cellCountByZone,
    residential_cells: residentialCells,
    residential_zone_area_m2: Math.round(residentialCells * CELL_AREA_M2),
    building_count: buildings.length,
    road_count: allRoadObjects.length,
    connector_count: connectorRoads.length,
    road_length_m: Math.round(roadLength),
    road_connected_components: connectedComponents(),
    pentagon_area_m2: Math.round(polygonArea(PENTAGON)),
    density_people_per_km2: Math.round((households * PEOPLE_PER_HOUSEHOLD) / (polygonArea(PENTAGON) / 1e6)),
    placement_diagnostics: placementDiagnostics,
  },
  construction_staging: [
    { phase: 1, name: '门户与环路骨架', content: 'gateway-highway -> pentagon-ring -> 5 条放射大道 -> riverside-access/spine', note: '先接对外高速终点并回读永久节点，再铺环路与放射；放射大道在中心汇聚点施工时应转为原生环岛（preview_intersection_roundabout）。' },
    { phase: 2, name: '生命线', content: '3 座地下水抽水站 + 2 座水塔 + 滨水污水处理厂 + 高压进线与 2 座变电站', note: '道路自带低压电/给水/污水网，设施道路侧落在普通道路功能区格子即自动接入；高压进线必须单独铺设并回读到既有高压线终点。' },
    { phase: 3, name: '网格片区逐张施工', content: `${grids.length} 张片区 + ${connectorRoads.length} 条连接路；每张片区走一次原生网格预览（不超过 3x3），提交后回读永久道路`, note: '片区必须逐张串行、各自独立预览与提交；相邻片区不得共享外围道路。' },
{ phase: 4, name: '分区与公共服务', content: '片区道路建成后用 preview_zoning / apply_zoning 按 zone_type 施划；公共服务与公用设施建筑落在预留区与空余格', note: '每栋建筑施工前必须用 bind_city_plan_buildings 取得原生候选与 road_edge_id，不能沿用本规划的 candidate_bound 位置直接提交。' },
  ],
  checks,
  notes,
  plan,
};

const outputPath = process.argv[2] ?? path.join(repoRoot, 'plans', 'peiqi-pentagon-city-plan.json');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: checks.every(check => check.ok),
  output_path: path.resolve(outputPath),
  plan_id: planId,
  bounds,
  accounting: document.accounting,
  failed_checks: checks.filter(check => !check.ok),
  checks,
  notes,
}, null, 2));
