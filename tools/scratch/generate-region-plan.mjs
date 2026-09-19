// 只读生成器：把「三片独立城区 + 黄金栅格路网」展开成 render_city_plan / 施工流程可用的规划 JSON。
// 不连接游戏、不写入城市。用法：node tools/scratch/generate-region-plan.mjs [输出路径]
//
// 设计要点（对应用户要求 + docs/workflows/new-city.md「小区网格规模与连接方式」）：
//   1. 住宅 / 商业 / 工业三片各自独立成区，中间留空地，互不插入；
//   2. 片区**内部**用规整格子，但格子尺寸不是随手定的：按 docs/reference/GAME-PHYSICS-RULES.md
//      §1.2 的黄金街区（路缘到路缘 96 m）反推中心线间距，见下面的 GOLDEN_* 与 GRID；
//   3. 连接方式按 doc 的「小区内部密连，小区之间疏连，城市主干道统一串联」：
//      三区只靠一条三区大道（Large Road）与一条油场接入路连通，主干道沿线接入口集中到集散路；
//      住宅区有南（三区大道）、北（油场接入路）**两个**对外机动车出口（见 access_points）。
//
// 分区几何不是手画多边形，而是「按道路栅格化」生成：以游戏原生 8 米格为单位，
// 求出每格到最近道路边缘的距离，距离 ≤ 48 米（游戏最大划区进深）的格子才成区，
// 这样既保证每一块地都能真正长出建筑，也不会出现压路的分区。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { compactEligibleRoadGrids } from '../../mcp/grid-eligibility.mjs';
import { CELL_SIZE, MAX_ZONING_DEPTH_M, MAX_ROAD_SEGMENT_LENGTH_M, MIN_ROAD_SEGMENT_LENGTH_M, subdivideRoute } from '../lib/physics-rules.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- 黄金街区常数
// 依据 docs/reference/GAME-PHYSICS-RULES.md §1.2（口径取自反编译 Game.Zones.BlockSystem：
// 分区块中心放在「道路外缘 + 24 m」、块深恒为 6 格 → 48 m 是从**路面外缘**向外的 6 格）。
//   · 黄金宽度：两条对开道路「路缘到路缘 96 m」时两侧分区严丝合缝背靠背，利用率 100%。
//     换算成中心线间距 = 96 + (W₁ + W₂) / 2。
//   · 中心线必须落在全局 8 米栅格上（否则不同街区相遇会错位/撕裂），因此只有这四档
//     中心距能**同时**满足黄金宽度与相位对齐：
//       Small(16)↔Small(16) = 112   Medium(24)↔Medium(24) = 120
//       Large(32)↔Large(32) = 128   Small(16)↔Large(32) = 120
//     而 Small↔Medium = 116、Medium↔Large = 124 都不是 8 的倍数，
//     所以本路网里**不让这两种宽度直接对开**（宽路只放在「街区长边」方向上，
//     那里要的是 160–240 m 区间而不是定值 96 m）。
//   · 黄金长度（沿街方向，区间而非定值）：住宅 160–240 m、商业 96–128 m。
const GOLDEN_CURB_TO_CURB_M = MAX_ZONING_DEPTH_M * 2; // 96
const GOLDEN_BLOCK_LENGTH_M = { residential: [160, 240], commercial: [96, 128], industrial: [160, 240] };
const goldenSpacing = (a, b) => GOLDEN_CURB_TO_CURB_M + (a + b) / 2;

// 三片城区的内部路网全部由黄金间距推出来，不在 road 表里手写坐标。
// 每条栅格线只声明「位置 + 道路等级」，间距是否正确由生成器自带校验与回归测试把关。
const GRID = {
  residential: {
    // 外围西环路与东环路为集散路（Medium 24 m，可向外拓宽）；
    // 网格中间所有纵横道路统一为 16 m 生活支路（Small Road，严禁拓宽，防止破坏 96m 黄金进深与临街建筑）。
    // 中间两两纵街 184/184/184/184/192 m，均落在住宅黄金长边 160–240 m 区间。
    xLines: [
      { id: 'res-west-ring', label: '住宅西环路', x: -2720, class: 'collector', role: 'perimeter_collector', widening_policy: 'perimeter_expandable' },
      { id: 'res-local-x1', label: '住宅西内街', x: -2536, class: 'local', role: 'interior_local', widening_policy: 'forbidden' },
      { id: 'res-mid-west-ring', label: '住宅中西内街', x: -2352, class: 'local', role: 'interior_local', widening_policy: 'forbidden', continuous: true },
      { id: 'res-local-x2', label: '住宅中内街', x: -2168, class: 'local', role: 'interior_local', widening_policy: 'forbidden' },
      { id: 'res-mid-east-ring', label: '住宅中东内街', x: -1984, class: 'local', role: 'interior_local', widening_policy: 'forbidden', continuous: true },
      { id: 'res-local-x3', label: '住宅东内街', x: -1800, class: 'local', role: 'interior_local', widening_policy: 'forbidden' },
      { id: 'res-east-ring', label: '住宅东环路', x: -1608, class: 'collector', role: 'perimeter_collector', widening_policy: 'perimeter_expandable' },
    ],
    // 东西向全部本地路，中心距 112 m → 路缘到路缘正好 96 m（黄金宽度）。
    // 1216 那条**刻意留空**：形成 112 m 宽的绿带（见 greenBelt），放学校与公园。
    //
    // res-w7 是例外：它向东延伸到厂区西界的油场接入路（x = −1080，`to_x`），
    // 作为住宅区的**第二处对外机动车出口**（doc §2：每个普通组团优先 2 个机动车出口）。
    // 原来整片 1.2 km 的住宅区只有东南角 (−1608, 544) 一处对外口，是路网瓶颈。
    // 延长段走在两片区之间的空地上（两侧不划区），不占用任何住宅地块；
    // 它与 res-east-ring 交叉，所以住宅区四条南北集散路都能就近上北通道。
    zLines: [
      { id: 'res-w-s2', label: '住宅东西街（南2）', z: 320 },
      { id: 'res-w-s1', label: '住宅东西街（南1）', z: 432 },
      { id: 'res-w1', label: '住宅东西街 1', z: 544 },
      { id: 'res-w2', label: '住宅东西街 2', z: 656 },
      { id: 'res-w3', label: '住宅东西街 3', z: 768 },
      { id: 'res-w4', label: '住宅东西街 4', z: 880 },
      { id: 'res-w5', label: '住宅东西街 5', z: 992 },
      { id: 'res-w6', label: '住宅东西街 6', z: 1104 },
      { id: 'res-w7', label: '住宅东西街 7（北通道 · 第二出口）', z: 1328, to_x: -1080, tie_to: 'yard-access' },
    ],
    greenBelt: { min_z: 1160, max_z: 1272 },
  },
  commercial: {
    // 南北向 5 条商业街：用「带双向路边停车」的 24 m 支路，中心距 120 m → 路缘正好 96 m。
    // 只有 2 条穿过北端接上三区大道，其余 3 条止于商业主街——对应 doc
    //「主干道沿线接入口应集中到集散路，不要让每条本地道路都直接开口」。
    xLines: [
      { id: 'shop-link-west', label: '商业西街', x: -712 },
      { id: 'shop-link-1', label: '商业纵街 1', x: -592, reachSpine: true },
      { id: 'shop-link-2', label: '商业纵街 2', x: -472 },
      { id: 'shop-link-3', label: '商业纵街 3', x: -352, reachSpine: true },
      { id: 'shop-link-east', label: '商业东街', x: -232 },
    ],
    // 东西向三条本地路（Small 16 m），中心距 112 m → 路缘 96 m。
    // 最北那条与三区大道（Large 32 m）中心距 120 m = 96 + (32+16)/2，路缘同样正好 96 m。
    zLines: [
      { id: 'shop-street', label: '商业主街', z: 664 },
      { id: 'shop-mid-street', label: '商业中街', z: 776 },
      { id: 'shop-back-street', label: '商业后街', z: 888 },
    ],
    // 三区大道：高速北向支线终点 → 住宅东环路，全程一条直线（z 恒为 544，8 米相位）。
    spine: { id: 'trunk-avenue', label: '三区大道', z: 544, from_x: -1608, to_x: -128 },
  },
  office: {
    // 南北向 5 条办公街：用「带双向路边停车」的 24 m 支路，中心距 120 m → 路缘正好 96 m。
    // 其中 2 条向北穿过接上三区大道（z=544），其余 3 条止于办公主街（z=312）。
    xLines: [
      { id: 'office-link-west', label: '办公西街', x: -712, class: 'office' },
      { id: 'office-link-1', label: '办公纵街 1', x: -592, class: 'office', reachSpine: true },
      { id: 'office-link-mid', label: '办公中街', x: -472, class: 'office' },
      { id: 'office-link-2', label: '办公纵街 2', x: -352, class: 'office', reachSpine: true },
      { id: 'office-link-east', label: '办公东街', x: -232, class: 'office' },
    ],
    // 东西向三条内部支路（Small 16 m），中心距 112 m → 路缘正好 96 m。
    zLines: [
      { id: 'office-south-street', label: '办公南街', z: 88, class: 'local' },
      { id: 'office-mid-street', label: '办公中街', z: 200, class: 'local' },
      { id: 'office-street', label: '办公主街', z: 312, class: 'local' },
    ],
  },
  industrial: {
    // 西界是油场接入路（Medium 24 m），向北一路接到厂区北街；其余 4 条南北街（Small 16 m）
    // 与它中心距都是 184 m → 路缘 164/168 m，落在工业街区长边区间。
    xLines: [
      { id: 'yard-access', label: '油场接入路', x: -1080, class: 'collector', from_z: 544, to_z: 1328 },
      { id: 'yard-x1', label: '厂区纵街 1', x: -896 },
      { id: 'yard-x2', label: '厂区纵街 2', x: -712 },
      { id: 'yard-x3', label: '厂区纵街 3', x: -528 },
      { id: 'yard-x4', label: '厂区纵街 4', x: -344 },
    ],
    // 厂区主街用 4 车道 Medium Road（货车走廊，与左侧住宅北通道平直对齐）：
    // 北侧主街对齐住宅北通道（z=1328），与南侧 Small 16 m 中心距 144 m → 路缘 124 m。
    // 北侧主街（z=1328）离铁路（z=1438）保留 110 米绿色生态隔离带。
    zLines: [
      { id: 'yard-south-street', label: '厂区南街', z: 1184, class: 'local' },
      { id: 'yard-main-street', label: '厂区主街', z: 1328, class: 'collector' },
    ],
    // 原来这里还有一条「能源支路」（沿厂区主街向西延伸、风机挂它北侧）。
    // 已撤销：它 z=1304 与住宅北通道（res-w7 东延段，z=1328）在 x −1440~−1080 平行相距 24 m，
    // 两条 16 m 路的路缘会挤到只剩 8 m，中间的格子两侧分区重叠。两台风机改挂住宅北通道北侧
    // （x −1200 / −1376，正好在延长段的范围内），那条路同时承担能源接入与第二出口，少一条路。
  },
};

// 片区范围 = 最外侧栅格线 ±（半路宽 + 48 m 最大进深），再取到 8 米整数倍。
// **必须是 8 的整数倍**：分区栅格化从 min_x 起步长 8，宽度不是 8 的倍数时最后一列会溢出边界
// （这正是本轮把工业区从 -1140/-288 改成 -1144/-288 的原因）。
const DISTRICT_BOUNDS = {
  residential: { min_x: -2784, max_x: -1544, min_z: 264, max_z: 1384 },
  commercial: { min_x: -776, max_x: -168, min_z: 480, max_z: 944 },
  office: { min_x: -776, max_x: -168, min_z: 32, max_z: 360 },
  industrial: { min_x: -1144, max_x: -288, min_z: 1128, max_z: 1384 },
};

// 把 GRID 展开成道路表。端点一律落在本片区栅格的外框上，竖向连接路两端直接落在标称高度，
// 不依赖吸附（吸附是幂等的，只负责把端点精确落到目标路上）。
function regionRoads() {
  const roads = [];
  const push = road => roads.push({ kind: 'line', ...road });

  // ---------- 住宅区 ----------
  const res = GRID.residential;
  const resZ = { min: res.zLines[0].z, max: res.zLines[res.zLines.length - 1].z };
  const resX = { min: res.xLines[0].x, max: res.xLines[res.xLines.length - 1].x };
  const beltSouth = Math.max(...res.zLines.filter(line => line.z < res.greenBelt.min_z).map(line => line.z));
  const beltNorth = Math.min(...res.zLines.filter(line => line.z > res.greenBelt.max_z).map(line => line.z));
  for (const [index, line] of res.xLines.entries()) {
    if (line.class === 'collector' || line.continuous) {
      push({
        id: line.id, label: line.label, class: line.class, order: 20 + index,
        district: 'residential', axis: 'x',
        role: line.role ?? (line.class === 'collector' ? 'perimeter_collector' : 'interior_local'),
        widening_policy: line.widening_policy ?? (line.class === 'collector' ? 'perimeter_expandable' : 'forbidden'),
        points: [{ x: line.x, z: resZ.min }, { x: line.x, z: resZ.max }],
      });
      continue;
    }
    // 本地路在绿带处断开，绿带里只留集散路/穿行路穿过
    push({
      id: `${line.id}-south`, label: `${line.label}（南段）`, class: line.class, order: 30 + index,
      district: 'residential', axis: 'x',
      role: 'interior_local', widening_policy: 'forbidden',
      points: [{ x: line.x, z: resZ.min }, { x: line.x, z: beltSouth }],
    });
    if (beltNorth < resZ.max) {
      push({
        id: `${line.id}-north`, label: `${line.label}（北段）`, class: line.class, order: 30 + index,
        district: 'residential', axis: 'x',
        role: 'interior_local', widening_policy: 'forbidden',
        points: [{ x: line.x, z: beltNorth }, { x: line.x, z: resZ.max }],
      });
    }
  }
  for (const [index, line] of res.zLines.entries()) {
    let points;
    if (line.id === 'res-w7') {
      points = [
        { x: -2720, z: line.z },
        { x: -2536, z: line.z },
        { x: -2352, z: line.z },
        { x: -2168, z: line.z },
        { x: -1984, z: line.z },
        { x: -1800, z: line.z },
        { x: -1608, z: line.z },
        { x: -1432, z: line.z },
        { x: -1256, z: line.z },
        { x: -1080, z: line.z },
      ];
    } else {
      points = [{ x: resX.min, z: line.z }, { x: line.to_x ?? resX.max, z: line.z }];
    }
    push({
      id: line.id, label: line.label, class: 'local', order: 40 + index,
      district: 'residential', axis: 'z',
      role: line.id === 'res-w7' ? 'perimeter_connector' : 'interior_local',
      widening_policy: line.id === 'res-w7' ? 'perimeter_expandable' : 'forbidden',
      // 带 tie_to 的（当前只有 res-w7 北通道）终点落在厂区西界的油场接入路上，
      // snap 只是保险：坐标本来就精确落在目标折线上，吸附是幂等的。
      snap: line.tie_to ? [{ point: 'end', to: line.tie_to }] : undefined,
      points,
    });
  }

  // ---------- 商业区 ----------
  const com = GRID.commercial;
  const comZ = { min: com.zLines[0].z, max: com.zLines[com.zLines.length - 1].z };
  const comX = { min: com.xLines[0].x, max: com.xLines[com.xLines.length - 1].x };
  for (const [index, line] of com.xLines.entries()) {
    const isPerimeter = line.id === 'shop-link-west' || line.id === 'shop-link-east';
    push({
      id: line.id, label: line.label, class: 'commercial', order: 54 + index,
      district: 'commercial', axis: 'x',
      role: isPerimeter ? 'perimeter_collector' : 'interior_local',
      widening_policy: isPerimeter ? 'perimeter_expandable' : 'forbidden',
      points: [{ x: line.x, z: line.reachSpine ? com.spine.z : comZ.min }, { x: line.x, z: comZ.max }],
    });
  }
  for (const [index, line] of com.zLines.entries()) {
    push({
      id: line.id, label: line.label, class: 'local', order: 62 + index,
      district: 'commercial', axis: 'z',
      role: 'interior_local', widening_policy: 'forbidden',
      points: com.xLines.map(xLine => ({ x: xLine.x, z: line.z })),
    });
  }
  // 三区大道：末端吸附到住宅东环路（坐标本来就落在它的端点上，吸附是幂等的）
  push({
    id: com.spine.id, label: com.spine.label, class: 'spine', order: 5, district: 'commercial', axis: 'z',
    role: 'perimeter_arterial', widening_policy: 'perimeter_expandable',
    snap: [{ point: 'end', to: 'res-east-ring' }],
    points: [{ x: com.spine.to_x, z: com.spine.z }, { x: com.spine.from_x, z: com.spine.z }],
  });

  // ---------- 办公区 ----------
  const off = GRID.office;
  const offZ = { min: off.zLines[0].z, max: off.zLines[off.zLines.length - 1].z };
  for (const [index, line] of off.xLines.entries()) {
    const isPerimeter = line.reachSpine || line.id === 'office-link-west' || line.id === 'office-link-east';
    push({
      id: line.id, label: line.label, class: line.class ?? 'office', order: 66 + index,
      district: 'office', axis: 'x',
      role: isPerimeter ? 'perimeter_collector' : 'interior_local',
      widening_policy: isPerimeter ? 'perimeter_expandable' : 'forbidden',
      points: [{ x: line.x, z: offZ.min }, { x: line.x, z: line.reachSpine ? com.spine.z : offZ.max }],
    });
  }
  for (const [index, line] of off.zLines.entries()) {
    push({
      id: line.id, label: line.label, class: line.class ?? 'local', order: 72 + index,
      district: 'office', axis: 'z',
      role: 'interior_local', widening_policy: 'forbidden',
      points: off.xLines.map(xLine => ({ x: xLine.x, z: line.z })),
    });
  }

  // ---------- 工业区 ----------
  const ind = GRID.industrial;
  const indZ = { min: ind.zLines[0].z, max: ind.zLines[ind.zLines.length - 1].z };
  const indX = { min: ind.xLines[0].x, max: ind.xLines[ind.xLines.length - 1].x };
  for (const [index, line] of ind.xLines.entries()) {
    let points;
    if (line.id === 'yard-access') {
      points = [
        { x: line.x, z: 544 },
        { x: line.x, z: 704 },
        { x: line.x, z: 864 },
        { x: line.x, z: 1024 },
        { x: line.x, z: 1184 },
        { x: line.x, z: 1328 },
      ];
    } else {
      points = [
        { x: line.x, z: line.from_z ?? indZ.min },
        { x: line.x, z: line.to_z ?? indZ.max },
      ];
    }
    push({
      id: line.id, label: line.label, class: line.class ?? 'local', order: 70 + index,
      district: 'industrial', axis: 'x',
      role: line.class === 'collector' ? 'perimeter_collector' : 'interior_local',
      widening_policy: line.class === 'collector' ? 'perimeter_expandable' : 'forbidden',
      snap: line.class === 'collector' ? [{ point: 'start', to: 'trunk-avenue' }] : undefined,
      points,
    });
  }
  for (const [index, line] of ind.zLines.entries()) {
    push({
      id: line.id, label: line.label, class: line.class, order: 76 + index,
      district: 'industrial', axis: 'z',
      role: line.id === 'yard-main-street' ? 'perimeter_arterial' : 'interior_local',
      widening_policy: line.id === 'yard-main-street' ? 'perimeter_expandable' : 'forbidden',
      points: [{ x: indX.min, z: line.z }, { x: indX.max, z: line.z }],
    });
  }
  // 原「能源支路」已撤销，见 GRID.industrial 的注释：两台风机改挂住宅北通道（res-w7 东延段）。

  return roads;
}

// ---------------------------------------------------------------- 布局定义
const REGION = {
  fileName: 'egelin-region-plan.json',
  cityName: '埃格林',
  name: '四区规划',
  title: '埃格林｜四区规划（西丘住宅 · 路口商业 · 高原办公 · 油场工业，只读草案）',

  streets: {
    spine: { prefab: 'Large Road', width_m: 32 },
    collector: { prefab: 'Medium Road', width_m: 24 },
    commercial: { prefab: 'Small Road - Double Sided Parking', width_m: 24 },
    office: { prefab: 'Small Road - Double Sided Parking', width_m: 24 },
    local: { prefab: 'Small Road', width_m: 16 },
    lane: { prefab: 'Alley', width_m: 8 },
  },

  // 四片城区的范围：**不是手填的**，等于「本片区最外侧栅格线 ± (半路宽 + 48 m 最大进深)」，
  // 也就是路网能真正划到区的外沿。绿带是被排除在分区之外的（见 greenBelts）。
  districts: [
    {
      key: 'residential', name: '西丘住宅区', kind: '住宅',
      bounds: { min_x: -2780, max_x: -1548, min_z: 264, max_z: 1384 },
      base_kind: 'EU Residential Low',
      kinds: [
        { kind: 'EU Residential Medium', bounds: { min_x: -1648, max_x: -1548, min_z: 264, max_z: 1384 } },
        { kind: 'EU Residential Medium Row', bounds: { min_x: -2352, max_x: -2168, min_z: 264, max_z: 1384 } },
      ],
      greenBelts: [{ ...GRID.residential.greenBelt, min_x: DISTRICT_BOUNDS.residential.min_x, max_x: DISTRICT_BOUNDS.residential.max_x }],
      note: '位于主风向（西南风）上风侧，距工业区 400 米；东西向 112 米宽绿带（z 1160–1272）放学校与公园，绿带内不划区；对外机动车出口 2 处（南接三区大道、北接油场接入路）；北侧距铁路保持 110 米以上安全与生态退距，不穿跨铁路。',
    },
    {
      key: 'commercial', name: '路口商业区', kind: '商业',
      bounds: { min_x: -772, max_x: -172, min_z: 480, max_z: 944 },
      base_kind: 'EU Commercial Low',
      kinds: [{ kind: 'EU Commercial High', bounds: { min_x: -592, max_x: -172, min_z: 544, max_z: 776 } }],
      note: '紧贴高速北向支线终点（−123, 544），南北向商业街直接接上三区大道；高地价核心靠近路口。',
    },
    {
      key: 'office', name: '高原办公区', kind: '办公',
      bounds: DISTRICT_BOUNDS.office,
      base_kind: 'Office Low',
      kinds: [{ kind: 'Office High', bounds: { min_x: -592, max_x: -172, min_z: 200, max_z: 360 } }],
      note: '位于三区大道南侧平缓台地，与商业区隔三区大道相望；形成南北双翼 CBD 联动，边界间距 120 米独立缓冲；规划高密度金融核心与低密度创新研发园。',
    },
    {
      key: 'industrial', name: '油场工业区', kind: '工业',
      bounds: DISTRICT_BOUNDS.industrial,
      base_kind: 'Industrial Manufacturing',
      kinds: [{ kind: 'Industrial Oil', bounds: { min_x: -1144, max_x: -712, min_z: 1128, max_z: 1384 } }],
      note: '压在实测油斑（地图格 −1247 / −623）上；位于住宅区下风向 550 米外；北侧距铁路保持 110 米缓冲绿带，与住宅北通道平直对齐（z=1328），不侵入铁路走廊。',
    },
  ],

  // 道路表不再手写坐标：全部由上面的 GRID 栅格线按黄金间距展开（见 regionRoads）。
  // 改间距只需要动 GRID 里的一处数字，不会再出现「图上看着一样、实际差 8 米」的情况。
  roads: regionRoads(),

  // 服务与市政建筑：align = 「贴着某条路的一侧、离路缘 2 米」，坐标由脚本沿法向算出，
  // 所以设施一定落在可划区带里、且真正临路（游戏里多数设施必须临路才能落地）。
  // 服务与市政建筑：已全面同步为实机地图上的实际已落成位置（精确到米）。
  buildings: [
    // ---- 住宅区：实机已建成的教育、游憩与日常市政设施 ----
    { id: 'bld-elementary-west', prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（西）',
      roadside_of: 'res-w6', position: { x: -2596, z: 1136 } },
    { id: 'bld-elementary-east', prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（东）',
      roadside_of: 'res-east-ring', position: { x: -1572, z: 1192 } },
    { id: 'bld-high-school', prefab: 'HighSchool02', size: { x: 95.6, z: 63.6 }, label: '规划中学',
      roadside_of: 'res-w7', position: { x: -2128, z: 1288 } },
    { id: 'bld-park-central', prefab: 'CityPark08', size: { x: 63.6, z: 63.6 }, label: '规划西丘公园',
      roadside_of: 'res-w7', position: { x: -2400, z: 1288 } },
    { id: 'bld-playground-west', prefab: 'Playground04', size: { x: 31.6, z: 31.6 }, label: '儿童活动场（西）',
      roadside_of: 'res-west-ring', position: { x: -2692, z: 1132 } },
    { id: 'bld-playground-east', prefab: 'Playground02', size: { x: 23.6, z: 31.6 }, label: '儿童活动场（东）',
      roadside_of: 'res-w6', position: { x: -2188, z: 1128 } },
    { id: 'bld-clinic', prefab: 'MedicalClinic02', size: { x: 39.6, z: 39.6 }, label: '规划社区诊所',
      roadside_of: 'res-w3', position: { x: -1724, z: 796 } },
    { id: 'bld-fire-station', prefab: 'FireHouse02', size: { x: 23.6, z: 31.6 }, label: '规划消防站',
      roadside_of: 'res-local-x2-south', position: { x: -2188, z: 904 } },
    { id: 'bld-police', prefab: 'PoliceStation02', size: { x: 39.6, z: 39.6 }, label: '规划警察分局',
      roadside_of: 'res-local-x2-south', position: { x: -2196, z: 684 } },
    { id: 'bld-crematorium', prefab: 'Crematorium01', size: { x: 63.6, z: 79.6 }, label: '规划殡仪馆',
      roadside_of: 'res-w-s2', position: { x: -2560, z: 272 } },
    { id: 'bld-pocket-park-1', prefab: 'PocketPark05', size: { x: 15.6, z: 15.6 }, label: '口袋公园 1',
      roadside_of: 'res-east-ring', position: { x: -1588, z: 332 } },
    { id: 'bld-pocket-park-2', prefab: 'PocketPark07', size: { x: 31.6, z: 7.6 }, label: '口袋公园 2',
      roadside_of: 'res-w5', position: { x: -2096, z: 976 } },
    { id: 'bld-water-tower-town', prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, label: '规划水塔（住宅）',
      roadside_of: 'res-w7', position: { x: -2704, z: 1352 } },

    // ---- 商业区 ----
    { id: 'bld-park-commercial', prefab: 'CityPark02', size: { x: 47.6, z: 47.6 }, label: '规划商业主广场',
      roadside_of: 'shop-back-street', position: { x: -424, z: 856 } },
    { id: 'bld-park-commercial-north', prefab: 'CityPark02', size: { x: 47.6, z: 47.6 }, label: '规划商业北广场',
      roadside_of: 'shop-back-street', position: { x: -424, z: 920 } },

    // ---- 办公区 ----
    { id: 'bld-park-office', prefab: 'CityPark02', size: { x: 47.6, z: 47.6 }, label: '规划科技绿洲广场',
      roadside_of: 'office-south-street', position: { x: -464, z: 56 } },

    // ---- 工业区：实机已建成的公用市政与能源设施 ----
    { id: 'bld-coal-power-plant', prefab: 'SmallCoalPowerPlant01', size: { x: 111.6, z: 127.6 }, label: '规划小型燃煤电厂',
      roadside_of: 'yard-x4', position: { x: -272, z: 1272 } },
    { id: 'bld-wastewater-plant', prefab: 'WastewaterTreatmentPlant01', size: { x: 95.6, z: 79.6 }, label: '规划污水处理厂',
      roadside_of: 'yard-south-street', position: { x: -808, z: 1136 } },
    { id: 'bld-transformer', prefab: 'TransformerStation01', size: { x: 47.6, z: 55.6 }, label: '规划变电站',
      roadside_of: 'yard-main-street', position: { x: -1060, z: 1368 } },
    { id: 'bld-landfill', prefab: 'Landfill01', size: { x: 135.6, z: 119.6 }, label: '规划垃圾填埋场',
      roadside_of: 'yard-south-street', position: { x: -448, z: 1112 } },
    { id: 'bld-water-tower-yard', prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, label: '规划水塔（厂区）',
      roadside_of: 'yard-south-street', position: { x: -496, z: 1208 } },
    { id: 'bld-telecom-tower', prefab: 'TelecomTower01', size: { x: 55.6, z: 55.6 }, label: '规划通信塔',
      roadside_of: 'yard-x2', position: { x: -676, z: 1220 } },
    { id: 'bld-wind-turbine-north', prefab: 'WindTurbine01', size: { x: 23.6, z: 23.6 }, label: '规划风力发电机（北）',
      roadside_of: 'res-w7', position: { x: -1252, z: 1348 } },
    { id: 'bld-wind-turbine-south', prefab: 'WindTurbine01', size: { x: 23.6, z: 23.6 }, label: '规划风力发电机（南）',
      roadside_of: 'res-w7', position: { x: -1444, z: 1348 } },
  ],

  // 人口口径：分区面积 ÷ 每户占地（平方米），乘户均人口
  householdAreaM2: { 'EU Residential Low': 300, 'EU Residential Medium Row': 170, 'EU Residential Medium': 120 },
  peoplePerHousehold: 2.5,
  peoplePerHouseholdRange: [2.2, 2.8],
  targetPopulation: 10000,
};

// ---------------------------------------------------------------- 几何工具
const snap8 = value => Math.round(value / 8) * 8;
const snap4 = value => Math.round(value / 4) * 4;
const snapPoint = point => ({ x: snap8(point.x), z: snap8(point.z) });
const snapBuildingPoint = point => ({ x: snap4(point.x), z: snap4(point.z) });

// 沿轴向起伏的曲线：把直线按 segments 段切开，逐点施加垂直方向的正弦偏移。
// 备选能力：当前规划的道路已全部改为直线（kind: 'line'），此函数保留未删——
// 若想让支路恢复有机弯曲，把道路的 kind 改回 'wave' 并去掉 points、
// 补上 axis / from / to / amp / phase / segments 六个字段即可。
function wavyLine(road) {
  const points = [];
  for (let index = 0; index <= road.segments; index++) {
    const t = index / road.segments;
    const along = road.from + (road.to - road.from) * t;
    const offset = road.amp * Math.sin(Math.PI * 2 * (t * 1.35 + road.phase)) * (1 - Math.abs(0.5 - t) * 0.35);
    points.push(road.axis === 'x' ? { x: along, z: road.z + offset } : { x: road.x + offset, z: along });
  }
  return points;
}

const dedupPoints = points => points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.z !== points[index - 1].z);

// 先把原始控制点搬到 8 米格上，细分留到吸附之后再做——
// 吸附会把端点挪动几十米，先细分会把某些段重新拉过 200 米上限。
function roadPoints(road) {
  const raw = road.kind === 'wave' ? wavyLine(road) : road.points;
  return dedupPoints(raw.map(snapPoint));
}

// 吸附之后再细分：每段都 ≤ 上限，且留一格余量吸收 snapToCell 的四舍五入。
function subdivideAndClean(points) {
  const subdivided = dedupPoints(subdivideRoute(points, MAX_ROAD_SEGMENT_LENGTH_M - CELL_SIZE).map(snapPoint));
  const cleaned = [subdivided[0]];
  for (const point of subdivided.slice(1)) {
    const previous = cleaned[cleaned.length - 1];
    if (Math.hypot(point.x - previous.x, point.z - previous.z) < MIN_ROAD_SEGMENT_LENGTH_M) {
      if (cleaned.length > 1) cleaned[cleaned.length - 1] = point;
      continue;
    }
    cleaned.push(point);
  }
  return cleaned;
}

function buildRoads() {
  const roads = REGION.roads.map(road => {
    const spec = REGION.streets[road.class];
    const points = roadPoints(road);
    return {
      id: road.id,
      label: road.label,
      district: road.district,
      prefab: spec.prefab,
      level: 'surface',
      width_m: spec.width_m,
      road_class: road.class,
      role: road.role,
      widening_policy: road.widening_policy,
      axis: road.axis,
      construction_status: 'planned',
      construction_order: road.order,
      snap: road.snap,
      points,
    };
  });
  applySnaps(roads);
  // 细分与残段清理必须排在吸附之后：吸附会把端点挪到目标路上（可能几十米），
  // 先细分的话被挪过的那一段就重新超过 200 米上限了。
  for (const road of roads) road.points = subdivideAndClean(road.points);
  return roads.map(({ snap, ...road }) => road);
}

// 折线上离目标最近的点，附带该处的单位法向量
function closestOnPolyline(target, points) {
  let best = null;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / lengthSquared));
    const px = a.x + t * dx, pz = a.z + t * dz;
    const distance = Math.hypot(target.x - px, target.z - pz);
    if (!best || distance < best.distance) {
      const length = Math.sqrt(lengthSquared);
      best = { distance, x: px, z: pz, nx: -dz / length, nz: dx / length, tx: dx / length, tz: dz / length };
    }
  }
  if (!best) throw new Error('道路折线缺少有效线段');
  return best;
}

// 把道路端点吸附到目标道路上（保证丁字路口真的接上），并清掉吸附后过短的残段
function applySnaps(roads) {
  const byId = new Map(roads.map(road => [road.id, road]));
  for (const road of roads) for (const rule of road.snap ?? []) {
    const target = byId.get(rule.to);
    if (!target) throw new Error(`${road.id} 的吸附目标不存在：${rule.to}`);
    const index = rule.point === 'start' ? 0 : road.points.length - 1;
    const hit = closestOnPolyline(road.points[index], target.points);
    road.points[index] = snapPoint({ x: hit.x, z: hit.z });
  }
}

// 两条折线间的最短距离（点到线段，双向取最小）
function polylineDistance(a, b) {
  const toSegment = (point, p, q) => {
    const dx = q.x - p.x, dz = q.z - p.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.z - p.z) * dz) / lengthSquared));
    return Math.hypot(point.x - (p.x + t * dx), point.z - (p.z + t * dz));
  };
  const toPolyline = (points, other) => Math.min(...points.map(point =>
    Math.min(...other.slice(1).map((q, index) => toSegment(point, other[index], q)))));
  return Math.min(toPolyline(a, b), toPolyline(b, a));
}

// 路网必须是一个连通分量：只要有一条支路的两端都没接上任何东西，它整片分区在游戏里
// 就永远没有车流，而且这种断口在图上完全看不出来（端点只差十几米）。所以这里硬校验。
function assertRoadNetworkConnected(roads) {
  const parent = roads.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const gap = polylineDistance(roads[i].points, roads[j].points);
      // 路面相交即视为连通：两条路的半宽之和再多给 2 米
      if (gap <= roads[i].width_m / 2 + roads[j].width_m / 2 + 2) {
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const components = new Map();
  for (let i = 0; i < roads.length; i++) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(roads[i].id);
  }
  if (components.size > 1) {
    const detail = [...components.values()].sort((a, b) => b.length - a.length)
      .map(ids => `[${ids.join(', ')}]`).join(' ');
    throw new Error(`路网不是单一连通分量（${components.size} 块），请补 snap 规则：${detail}`);
  }
  return components.size;
}

const SIDE_HINTS = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
// 贴着某条路的一侧放建筑：沿法向偏移「半个路宽 + 占地一半 + 2 米」，弯路上也贴边。
// side 也支持 'ahead' / 'behind'：沿路方向越过终点/起点摆放（接入支路尽头的厂区设施用）。
function alignToRoad(road, near, side, size) {
  if (side === 'ahead' || side === 'behind') {
    const index = side === 'ahead' ? road.points.length - 1 : 0;
    const anchor = road.points[index];
    const neighbour = road.points[side === 'ahead' ? index - 1 : index + 1];
    const dx = anchor.x - neighbour.x, dz = anchor.z - neighbour.z;
    const length = Math.hypot(dx, dz) || 1;
    const tx = dx / length, tz = dz / length;
    const extent = Math.abs(size.x * tx) + Math.abs(size.z * tz);
    return snapPoint({ x: anchor.x + tx * (extent / 2 + 4), z: anchor.z + tz * (extent / 2 + 4) });
  }
  const hit = closestOnPolyline(near, road.points);
  const hint = SIDE_HINTS[side];
  if (!hint) throw new Error(`未知方位：${side}`);
  const sign = hit.nx * hint.x + hit.nz * hint.z >= 0 ? 1 : -1;
  const nx = hit.nx * sign, nz = hit.nz * sign;
  const extent = Math.abs(size.x * nx) + Math.abs(size.z * nz);
  const distance = road.width_m / 2 + extent / 2 + 2;
  return snapPoint({ x: hit.x + nx * distance, z: hit.z + nz * distance });
}

// 沿道路方向前后挪一挪，用来避开弯路弧顶与其它设施
function shiftedNear(road, near, offset) {
  const hit = closestOnPolyline(near, road.points);
  return { x: near.x + hit.tx * offset, z: near.z + hit.tz * offset };
}

// 逐个建筑沿所在道路试位移，用真正的规划校验器打分，挑「告警最少、位移最小」的位置。
// 目的：弯路弧顶会扫到贴边建筑，或两栋设施在不同路上算出来的位置互相压到。
function refinePlacements(buildings, roads, bounds) {
  const scoreOf = list => validateCityPlan({ utilities: [] }, { roads, buildings: list, zones: [] }, bounds)
    .issues.filter(issue => issue.layer === 'buildings').length;
  const offsets = [0, 24, -24, 48, -48, 72, -72, 96, -96, 128, -128, 160, -160];
  const result = buildings.map(building => ({ ...building }));
  let score = scoreOf(result);
  for (const building of result) {
    const spec = REGION.buildings.find(entry => entry.id === building.id);
    if (!spec?.align || spec?.position) continue;
    const road = roadById.get(spec.align.road);
    let best = { score, position: building.position };
    for (const offset of offsets) {
      const position = alignToRoad(road, shiftedNear(road, spec.align.near, offset), spec.align.side, spec.size);
      const trial = result.map(entry => (entry === building ? { ...entry, position } : entry));
      const trialScore = scoreOf(trial);
      if (trialScore < best.score) best = { score: trialScore, position };
      if (best.score === 0) break;
    }
    building.position = best.position;
    score = best.score;
  }
  return { buildings: result, warnings: score };
}

// ---------------------------------------------------------------- 分区栅格化
const segmentList = roads => roads.flatMap(road => road.points.slice(1).map((point, index) => ({
  ax: road.points[index].x, az: road.points[index].z, bx: point.x, bz: point.z, half: road.width_m / 2,
})));

function distanceToSegment(x, z, segment) {
  const dx = segment.bx - segment.ax, dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / lengthSquared));
  return Math.hypot(x - (segment.ax + t * dx), z - (segment.az + t * dz));
}

// 返回格子到最近道路「边缘」的距离；负数表示落在路面里。
function depthAt(x, z, segments) {
  let best = Infinity;
  for (const segment of segments) best = Math.min(best, distanceToSegment(x, z, segment) - segment.half);
  return best;
}

function kindFor(district, x, z) {
  for (const entry of district.kinds ?? []) {
    const box = entry.bounds;
    if (x >= box.min_x && x <= box.max_x && z >= box.min_z && z <= box.max_z) return entry.kind;
  }
  return district.base_kind;
}

// 绿带（住宅区那条放学校与公园的东西向走廊）是**明确不划区**的：
// 落到绿带里的格子即使进深合规也跳过，这样绿地在图上是真的空的，
// 而不是「看着像绿地、其实已经被两侧街道划满了」。
function inGreenBelt(district, x, z) {
  return (district.greenBelts ?? []).some(belt =>
    x >= (belt.min_x ?? -Infinity) && x <= (belt.max_x ?? Infinity)
    && z >= belt.min_z && z <= belt.max_z);
}

// 逐格判定「能划区」，再把同类的相邻格子合并成长条矩形，减少多边形数量。
// 可划区窗口直接采用引擎的真实规则：Game.Zones.BlockSystem 生成分区块时
// 块中心放在「道路外缘 + 24m」、块深 m_Size.y = 6 格，即 48m 是从**路面外缘**向外的 6 格。
// 所以这里用 depthAt（已减掉半路宽）∈ [0, 48]，不做任何额外收边：
// 实测这个窗口与 2m 无偏采样只差 0.4%，既不过报也不缩水。
function rasterizeZones(roads) {
  const segments = segmentList(roads);
  const zones = [];
  const stats = [];
  for (const district of REGION.districts) {
    const box = district.bounds;
    const cells = new Map();
    let candidate = 0, kept = 0;
    for (let x = box.min_x; x < box.max_x; x += CELL_SIZE) {
      for (let z = box.min_z; z < box.max_z; z += CELL_SIZE) {
        candidate += 1;
        const centerX = x + CELL_SIZE / 2, centerZ = z + CELL_SIZE / 2;
        const depth = depthAt(centerX, centerZ, segments);
        if (depth < 0 || depth > MAX_ZONING_DEPTH_M) continue;
        if (inGreenBelt(district, centerX, centerZ)) continue;
        kept += 1;
        const kind = kindFor(district, centerX, centerZ);
        if (!cells.has(kind)) cells.set(kind, new Map());
        cells.get(kind).set(`${x}|${z}`, { x, z });
      }
    }
    let zoneIndex = 0;
    for (const [kind, grid] of cells) {
      // 先按行合并成横向长条，再把上下相邻、范围完全一致的长条纵向合并
      const rows = new Map();
      for (const { x, z } of grid.values()) {
        const list = rows.get(z) ?? [];
        list.push(x);
        rows.set(z, list);
      }
      const runs = [];
      let open = new Map(); // 'x0|x1' -> 上一行里可以继续向下延伸的长条
      for (const z of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = rows.get(z).sort((a, b) => a - b);
        const rowRuns = [];
        let start = xs[0], previous = xs[0];
        for (const x of xs.slice(1)) {
          if (x - previous > CELL_SIZE) { rowRuns.push([start, previous]); start = x; }
          previous = x;
        }
        rowRuns.push([start, previous]);
        const next = new Map();
        for (const [x0, x1] of rowRuns) {
          const key = `${x0}|${x1}`;
          const carried = open.get(key);
          if (carried && carried.z1 === z - CELL_SIZE) { carried.z1 = z; next.set(key, carried); continue; }
          const run = { x0, x1, z0: z, z1: z };
          next.set(key, run);
          runs.push(run);
        }
        open = next;
      }
      for (const run of runs) {
        const x0 = run.x0, z0 = run.z0, x1 = run.x1 + CELL_SIZE, z1 = run.z1 + CELL_SIZE;
        zones.push({
          id: `${district.key}-zone-${++zoneIndex}`,
          kind,
          district: district.key,
          area_m2: (x1 - x0) * (z1 - z0),
          polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
        });
      }
    }
    stats.push({ district: district.key, name: district.name, cells_candidate: candidate, cells_zoned: kept, zones: zoneIndex });
  }
  return { zones, stats };
}

// ---------------------------------------------------------------- 核算与主流程
const roads = buildRoads();
const roadComponentCount = assertRoadNetworkConnected(roads);
const roadById = new Map(roads.map(road => [road.id, road]));
const { zones, stats } = rasterizeZones(roads);
const initialBuildings = REGION.buildings.map((building, index) => {
  const roadId = building.align ? building.align.road : (building.roadside_of ?? null);
  const road = roadId ? roadById.get(roadId) : null;
  if (roadId && !road) throw new Error(`${building.id} 的临路目标不存在：${roadId}`);
  const position = building.position
    ? snapBuildingPoint(building.position)
    : (road ? alignToRoad(road, building.align.near, building.align.side, building.size) : snapBuildingPoint(building.position));
  return {
    id: building.id,
    prefab: building.prefab,
    label: building.label,
    name: building.label,
    kind: building.id.includes('wind') || building.id.includes('power') || building.id.includes('water') ? 'utility' : 'service',
    roadside_of: road?.id ?? null,
    planning_status: 'bound',
    construction_status: building.construction_status ?? 'completed',
    construction_order: 80 + index,
    position,
    rotation_degrees: building.rotation_degrees ?? 0,
    size_m: building.size,
  };
});
// 先按道路与分区算出范围，再据此微调建筑位置（此时校验器只用 bounds 判越界）
const geometryXs = roads.flatMap(road => road.points.map(point => point.x)).concat(zones.flatMap(zone => zone.polygon.map(point => point.x)));
const geometryZs = roads.flatMap(road => road.points.map(point => point.z)).concat(zones.flatMap(zone => zone.polygon.map(point => point.z)));
const geometryBounds = {
  min_x: snap8(Math.min(...geometryXs) - 40), min_z: snap8(Math.min(...geometryZs) - 40),
  max_x: snap8(Math.max(...geometryXs) + 40), max_z: snap8(Math.max(...geometryZs) + 40),
};
const refined = refinePlacements(initialBuildings, roads, geometryBounds);
const buildings = refined.buildings;
const { plan } = compactEligibleRoadGrids({ roads, zones, buildings });

const roadLengthByClass = {};
let roadLength = 0;
for (const road of roads) {
  let length = 0;
  for (let index = 1; index < road.points.length; index++) length += Math.hypot(road.points[index].x - road.points[index - 1].x, road.points[index].z - road.points[index - 1].z);
  roadLength += length;
  roadLengthByClass[road.road_class] = (roadLengthByClass[road.road_class] ?? 0) + length;
}
const segmentLengths = roads.flatMap(road => road.points.slice(1).map((point, index) => Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z)));

const areaByKind = {};
for (const zone of zones) areaByKind[zone.kind] = (areaByKind[zone.kind] ?? 0) + zone.area_m2;
let households = 0;
const householdByKind = {};
for (const [kind, area] of Object.entries(areaByKind)) {
  const perHousehold = REGION.householdAreaM2[kind];
  if (!perHousehold) continue;
  // 按分区类型汇总面积后取整（不是逐块取整，否则几百个小块会各自损失零头）；
  // 口径写在 accounting.household_rule 里，测试按同一条规则复算。
  householdByKind[kind] = Math.round(area / perHousehold);
  households += householdByKind[kind];
}
const residentialZoneArea = Object.entries(areaByKind).filter(([kind]) => REGION.householdAreaM2[kind]).reduce((sum, [, area]) => sum + area, 0);
const commercialZoneArea = Object.entries(areaByKind).filter(([kind]) => kind.includes('Commercial')).reduce((sum, [, area]) => sum + area, 0);
const officeZoneArea = Object.entries(areaByKind).filter(([kind]) => kind.includes('Office')).reduce((sum, [, area]) => sum + area, 0);
const industrialZoneArea = Object.entries(areaByKind).filter(([kind]) => kind.includes('Industrial')).reduce((sum, [, area]) => sum + area, 0);

const allX = plan.roads.flatMap(road => road.points.map(point => point.x))
  .concat(plan.zones.flatMap(zone => zone.polygon.map(point => point.x)))
  .concat(plan.buildings.map(building => building.position.x));
const allZ = plan.roads.flatMap(road => road.points.map(point => point.z))
  .concat(plan.zones.flatMap(zone => zone.polygon.map(point => point.z)))
  .concat(plan.buildings.map(building => building.position.z));
const bounds = {
  min_x: snap8(Math.min(...allX) - 40), min_z: snap8(Math.min(...allZ) - 40),
  max_x: snap8(Math.max(...allX) + 40), max_z: snap8(Math.max(...allZ) + 40),
};

const planId = computeCityPlanId(bounds, plan);
const districtById = Object.fromEntries(REGION.districts.map(district => [district.key, district]));

const document = {
  plan_id: planId,
  city: REGION.cityName,
  name: REGION.name,
  target_population: REGION.targetPopulation,
  bounds,
  render: { title: REGION.title, width: 2200, height: 1400, view: 'surface', format: 'static_html' },
  water_cell_size_m: 32,
  terrain_cell_size_m: 64,
  // 黄金街区自述：声明每个片区「哪条轴走黄金宽度、哪条轴走街区长边」，
  // 回归测试按这份声明去量**实际**路缘间距，防止以后改坐标时悄悄破坏间距。
  golden_block: {
    curb_to_curb_m: GOLDEN_CURB_TO_CURB_M,
    block_length_m: GOLDEN_BLOCK_LENGTH_M,
    collector_pitch_m: { residential: [300, 1200] },
    widening_rules: {
      rule: '网格中间道路严禁拓宽（永久保持 16m 本地生活支路，防止破坏 96m 黄金进深与临街建筑）；仅外围环路与骨干道具备拓宽属性',
      interior_allowed_to_widen: false,
      perimeter_allowed_to_widen: true,
    },
    axes: {
      residential: {
        // 东西向街（axis 'z'）中心距 112 m → 路缘正好 96 m；
        // 中间那条 224 m 的缺口是绿带，多出来的 112 m 不划区，属声明过的例外。
        z: {
          exact_m: 96,
          green_gaps: [{
            from: GRID.residential.zLines[7].z, to: GRID.residential.zLines[8].z,
            unzoned_width_m: GRID.residential.greenBelt.max_z - GRID.residential.greenBelt.min_z,
          }],
        },
        x: { range_m: GOLDEN_BLOCK_LENGTH_M.residential },
      },
      commercial: { z: { exact_m: 96 }, x: { range_m: GOLDEN_BLOCK_LENGTH_M.commercial } },
      office: { z: { exact_m: 96 }, x: { exact_m: 96 } },
      industrial: { z: { exact_m: 124 }, x: { range_m: GOLDEN_BLOCK_LENGTH_M.industrial } },
    },
    note: '中心线间距 = 96 + (W₁ + W₂) / 2，且必须落在全局 8 m 相位上；'
      + '因此可精确对开的组合只有 Small↔Small(112)、Medium↔Medium(120)、Large↔Large(128)、Small↔Large(120)。'
      + '宽路（Medium/Large）只放在「街区长边」那条轴上，那里要的是 160–240 m 区间而非定值 96 m。',
  },
  districts: REGION.districts.map(district => ({
    key: district.key, name: district.name, kind: district.kind, bounds: district.bounds,
    greenBelts: district.greenBelts ?? [],
    zone_area_m2: zones.filter(zone => zone.district === district.key).reduce((sum, zone) => sum + zone.area_m2, 0),
    note: district.note,
  })),

  // 对外机动车出口。doc §2 要求「每个普通组团优先 2 个机动车出口（一主一备）」，
  // 而住宅区是整片 1.2 km，只有一处对外口就是瓶颈——所以这里显式声明，不在图上靠眼看。
  // 回归测试会反查：每个点的坐标是否真的落在 via 与 to 两条路的折线上、
  // 且 to 那条路确实**不属于本片区**（否则等于把片区内部路口当成出口）。
  access_points: [
    {
      id: 'access-res-south', district: 'residential', label: '住宅南出口（三区大道）',
      via: 'res-east-ring', to: 'trunk-avenue',
      position: { x: GRID.commercial.spine.from_x, z: GRID.commercial.spine.z },
      note: '住宅东环路南端与三区大道西端的十字口，也是全城唯一高速接入方向（北向支线终点 −123, 544）。',
    },
    {
      id: 'access-res-north', district: 'residential', label: '住宅北出口（油场接入路）',
      via: 'res-w7', to: 'yard-access',
      position: { x: GRID.industrial.xLines[0].x, z: GRID.residential.zLines[8].z },
      note: '住宅北通道东端与油场接入路的丁字口；北通厂区、南接三区大道，住宅东北片不必再绕到东南角。',
    },
  ],

  accounting: {
    target_population: REGION.targetPopulation,
    households,
    people: Math.round(households * REGION.peoplePerHousehold),
    peopleRange: [Math.round(households * REGION.peoplePerHouseholdRange[0]), Math.round(households * REGION.peoplePerHouseholdRange[1])],
    peoplePerHousehold: REGION.peoplePerHousehold,
    household_area_m2: REGION.householdAreaM2,
    household_rule: '按分区类型汇总可划区面积后 round(面积 ÷ 户均占地)，再乘每户人数；不是逐块取整',
    household_by_kind: householdByKind,
    zone_area_m2: areaByKind,
    residential_zone_area_m2: residentialZoneArea,
    commercial_zone_area_m2: commercialZoneArea,
    office_zone_area_m2: officeZoneArea,
    industrial_zone_area_m2: industrialZoneArea,
    zoning_fill: Object.fromEntries(stats.map(entry => [entry.district, { cells_zoned: entry.cells_zoned, cells_candidate: entry.cells_candidate, zones: entry.zones }])),
    road_count: roads.length,
    road_length_m: Math.round(roadLength),
    road_length_by_class_m: Object.fromEntries(Object.entries(roadLengthByClass).map(([key, value]) => [key, Math.round(value)])),
    road_segment_m: { min: Math.round(Math.min(...segmentLengths)), max: Math.round(Math.max(...segmentLengths)) },
    road_connected_components: roadComponentCount,
    building_placement_warnings: refined.warnings,
    geometry_bbox: {
      min_x: snap8(Math.min(...allX)), min_z: snap8(Math.min(...allZ)),
      max_x: snap8(Math.max(...allX)), max_z: snap8(Math.max(...allZ)),
    },
  },
  plan,
};

const outputPath = process.argv[2] ?? path.join(repoRoot, 'plans', REGION.fileName);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const summary = [
  `片区范围：${REGION.districts.map(district => `${district.name} ${((district.bounds.max_x - district.bounds.min_x) / 1000).toFixed(2)}×${((district.bounds.max_z - district.bounds.min_z) / 1000).toFixed(2)} km`).join('；')}`,
  `划区填充：${stats.map(entry => `${entry.name} ${entry.cells_zoned}/${entry.cells_candidate} 格 → ${entry.zones} 块`).join('；')}`,
  `分区面积：住宅 ${(residentialZoneArea / 1e6).toFixed(2)} km²、商业 ${(commercialZoneArea / 1e6).toFixed(2)} km²、办公 ${(officeZoneArea / 1e6).toFixed(2)} km²、工业 ${(industrialZoneArea / 1e6).toFixed(2)} km²`,
  `户数组成：${Object.entries(householdByKind).map(([kind, value]) => `${kind} ${value}`).join('；')}`,
  `人口：${households} 户 → 中位 ${Math.round(households * REGION.peoplePerHousehold)} 人（区间 ${Math.round(households * REGION.peoplePerHouseholdRange[0])}–${Math.round(households * REGION.peoplePerHouseholdRange[1])}）`,
  `道路：${roads.length} 条 / ${(roadLength / 1000).toFixed(2)} km，单段 ${Math.round(Math.min(...segmentLengths))}–${Math.round(Math.max(...segmentLengths))} 米，连通分量 ${roadComponentCount}`,
  `建筑：${buildings.length} 栋；分区块：${zones.length} 个；建筑放置告警 ${refined.warnings}`,
  `输出：${path.relative(repoRoot, outputPath)}，plan_id=${planId}`,
];
console.log(JSON.stringify({ ok: true, output_path: path.resolve(outputPath), bounds, accounting: document.accounting, summary }, null, 2));
