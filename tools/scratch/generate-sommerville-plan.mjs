// 只读生成器：萨默斯维尔「湖湾镇」——把 L 形黄金街区网格 + 鞍部接入大道展开成
// render_city_plan / 施工流程可用的规划 JSON。不连接游戏、不写入城市。
// 用法：node tools/scratch/generate-sommerville-plan.mjs [输出路径]
//
// 勘察事实（2026-09-19 实时采样，萨默斯维尔存档，North American 主题，unlock_all）：
//   · 主平原高程恒定 895.58 m；水面高程约 864 m；南岸水线在 z ≈ −2950~−3000（x 830~1130 一带）。
//   · 城堡山（RuinsCastle01 @ (828,−1161)，~936 m）与东南山嘴（峰值 ~920 m，x 1120~1320、z −1450~−1650）
//     横亘在高速立交与镇址之间；鞍部在 x 1360~1420、z −1050~−1250（894~897 m，几乎与平原等高）。
//   · 全图唯一现成道路锚点：高速立交匝道终点 (1019.8, −351.9)（Medium Road Divided）。
//   · 东南角为向水湾均匀下降的干坡（895 → 872），水深仅在 z < −2950：作湾滨绿带不划区。
//   · 主大道实测坡度：鞍部走廊 895.6 → 905.2 → 896.2，逐段 ≤ 5%，远低于 9% 设计上限。
//
// 设计要点（对应用户要求 + docs/guides/planning/PLANNING-MAP-GUIDE.md + docs/reference/GAME-PHYSICS-RULES.md §1.2）：
//   1. L 形镇址：主网格（迎宾大道以北缘、南环路以南缘）+ 西翼 3 排 + 沿湖 2 排；
//      东南湾坡、城堡山整体留绿，不划区；
//   2. 街区全部按黄金宽度（路缘到路缘 96 m）反推中心线间距：
//      Small↔Small 112、Small↔Large 120，全部落在 8 m 相位上；
//   3. 中央抽掉一条东西街（z −2352），形成 208 m 宽绿廊，放学校 / 公园 / 市政设施；
//   4. 分区由 8 m 栅格化生成（进深 [0,48] 自路面外缘），不手画多边形；
//   5. 人口口径：NA 主题分区（Low 300 / Medium Row 170 / Medium 120 m²/户）× 户均 2.5 人，目标 1 万 ±10%。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { CELL_SIZE, MAX_ZONING_DEPTH_M, MAX_ROAD_SEGMENT_LENGTH_M, MIN_ROAD_SEGMENT_LENGTH_M, subdivideRoute } from '../lib/physics-rules.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- 黄金街区常数
// 依据 docs/reference/GAME-PHYSICS-RULES.md §1.2（反编译 Game.Zones.BlockSystem：
// 块中心 = 道路外缘 + 24 m、块深恒 6 格 → 48 m 自**路面外缘**算起）。
//   · 中心线间距 = 96 + (W₁ + W₂) / 2，且必须落在全局 8 m 相位上；
//   · 本镇只用到两档：Small(16)↔Small(16) = 112、Small(16)↔Large(32) = 120。
const GOLDEN_CURB_TO_CURB_M = MAX_ZONING_DEPTH_M * 2; // 96
const goldenSpacing = (a, b) => GOLDEN_CURB_TO_CURB_M + (a + b) / 2;
if (goldenSpacing(16, 16) !== 112 || goldenSpacing(16, 32) !== 120) throw new Error('黄金间距推导与实测常数不符');

// ---------------------------------------------------------------- 路网栅格线表
// 迎宾大道：匝道终点 → 鞍部（x 1360 走廊）→ 对角下到网格东北角 → 沿网格北缘向西。
// 全部坐标已落 8 m 格；起点 (1024,−352) 距真实匝道终点 (1019.8,−351.9) 4.2 m，在 8 m 吸附容差内。
const AVENUE_Z = -1784;
const AVENUE = {
  id: 'avenue', label: '迎宾大道', class: 'spine', district: 'avenue', axis: 'z',
  role: 'perimeter_arterial', widening_policy: 'perimeter_expandable', order: 5,
  points: [
    { x: 1024, z: -352 },
    { x: 1360, z: -952 },
    { x: 1360, z: -1656 },
    { x: 1248, z: AVENUE_Z },
    { x: 16, z: AVENUE_Z },
  ],
};

// 纵街（axis 'x'）：全部 Small Road 16 m。西环路/主街纵贯到湖滩街（各自直达湖滨台地），
// 西一~西四街止于湖滨大道（−2880）——再往南是通湖陡坎与干沟（实测 x40−56 坡 21%、x≈280 沟底 871 m），不可建。
// 东 4 条止于南环路，湾景两条伸到南一街（南一街东延后撑起湾景网格南界）。
const X_LINES = [
  { id: 'street-x-16', label: '西环路', x: 16, z0: -1440, z1: -3072, perimeter: true },
  { id: 'street-x-128', label: '西一街', x: 128, z0: -1440, z1: -2880 },
  { id: 'street-x-240', label: '西二街', x: 240, z0: -1440, z1: -2880 },
  { id: 'street-x-352', label: '西三街', x: 352, z0: -1440, z1: -2880 },
  { id: 'street-x-464', label: '西四街', x: 464, z0: -1440, z1: -2880 },
  { id: 'street-x-576', label: '主街', x: 576, z0: -1440, z1: -3072 },
  { id: 'street-x-688', label: '东一街', x: 688, z0: -1784, z1: -2800 },
  { id: 'street-x-800', label: '东二街', x: 800, z0: -1784, z1: -2800 },
  { id: 'street-x-912', label: '东三街', x: 912, z0: -1784, z1: -2800 },
  { id: 'street-x-1024', label: '东环路', x: 1024, z0: -1784, z1: -2800, perimeter: true },
  { id: 'street-x-1136', label: '湾景一街', x: 1136, z0: -1784, z1: -2128 },
  { id: 'street-x-1248', label: '湾景二街', x: 1248, z0: -1784, z1: -2128 },
];

// 横街（axis 'z'）：全部 Small Road 16 m。绿廊 = z −2240 与 −2464 之间刻意抽掉的 224 m 间距。
// 湖滨带实测被一条 NE→SW 干沟斜切（z=−2960 处 x≈136、z=−3064 处 x≈216−312，沟底 872 m），
// 且 x40−56 有通湖陡坎（坡 21%）：湖滨街（−2960）整条取消，湖滩街（−3072）劈成西段（x16−136）
// 与东段（x408−576）两个台地段，各自接西环路/主街；四车道湖滨大道（−2880）全程平缓保留。
const Z_LINES = [
  { id: 'street-z-1440', label: '北环路', z: -1440, x0: 16, x1: 576, district: 'westwing', perimeter: true },
  { id: 'street-z-1552', label: '北一街', z: -1552, x0: 16, x1: 576, district: 'westwing' },
  { id: 'street-z-1664', label: '北二街', z: -1664, x0: 16, x1: 576, district: 'westwing' },
  { id: 'street-z-1904', label: '中心北街', z: -1904, x0: 16, x1: 1248 },
  { id: 'street-z-2016', label: '中心街', z: -2016, x0: 16, x1: 1248 },
  { id: 'street-z-2128', label: '南一街', z: -2128, x0: 16, x1: 1248 },
  { id: 'street-z-2240', label: '绿廊北街', z: -2240, x0: 16, x1: 1024 },
  { id: 'street-z-2464', label: '绿廊南街', z: -2464, x0: 16, x1: 1024 },
  { id: 'street-z-2576', label: '南二街', z: -2576, x0: 16, x1: 1024 },
  { id: 'street-z-2688', label: '南三街', z: -2688, x0: 16, x1: 1024 },
  { id: 'street-z-2800', label: '南环路', z: -2800, x0: 16, x1: 1024, perimeter: true },
  { id: 'street-z-3072-w', label: '湖滩街（西段）', z: -3072, x0: 16, x1: 136, perimeter: true },
  { id: 'street-z-3072-e', label: '湖滩街（东段）', z: -3072, x0: 408, x1: 576, perimeter: true },
];
const GREEN_CORRIDOR = { from_z: -2240, to_z: -2464 }; // 中心距 224 → 路缘 208 = 96 + 112 不划区
// 绿廊内只保留 3 处穿越（西环路 / 主街 / 东环路，彼此 560 m 与 448 m），其余纵街在绿廊段断开，
// 让中央绿廊成为一条 1 km 长、208 m 宽的连续绿轴——否则 112 m 的窄条放不下 95.6 m 进深的中学。
const CORRIDOR_CROSSINGS = new Set(['street-x-16', 'street-x-576', 'street-x-1024']);

function spansCorridor(line) {
  return line.z0 >= GREEN_CORRIDOR.from_z && line.z1 <= GREEN_CORRIDOR.to_z;
}

// 工业园（2 列 × 4 行）：迎宾大道 x=1360 直段以东的台地。实测水体掩码显示水湾向西北
// 伸进两支——东北角 (1672~1704, −950~−1020) 与东南角 (1576~1650, −1560 起) 都在水下，
// 所以柱距收窄为 88 m（72 m 工业地块）、东界收到 x=1656、南界止于大道节点 −1480。
// 四条横行街接在纵街节点上（N-S 街写成多点折线自带节点），只有工业北街/南街接大道
// 的细分节点 −952/−1480（跨 prefab 中段接入是 preview 误判指纹，严禁）。
const INDUSTRY_ROADS = [
  { id: 'ind-z-952', label: '工业北街', axis: 'z', points: [{ x: 1360, z: -952 }, { x: 1568, z: -952 }, { x: 1656, z: -952 }] },
  { id: 'ind-z-1080', label: '工业二街', axis: 'z', points: [{ x: 1480, z: -1080 }, { x: 1656, z: -1080 }] },
  { id: 'ind-z-1208', label: '工业三街', axis: 'z', points: [{ x: 1480, z: -1208 }, { x: 1656, z: -1208 }] },
  { id: 'ind-z-1336', label: '工业四街', axis: 'z', points: [{ x: 1480, z: -1336 }, { x: 1656, z: -1336 }] },
  { id: 'ind-z-1480', label: '工业南街', axis: 'z', points: [{ x: 1360, z: -1480 }, { x: 1568, z: -1480 }, { x: 1656, z: -1480 }] },
  { id: 'ind-x-1480', label: '工业一街', axis: 'x', points: [{ x: 1480, z: -952 }, { x: 1480, z: -1080 }, { x: 1480, z: -1208 }, { x: 1480, z: -1336 }, { x: 1480, z: -1480 }] },
  { id: 'ind-x-1568', label: '工业五街', axis: 'x', points: [{ x: 1568, z: -952 }, { x: 1568, z: -1080 }, { x: 1568, z: -1208 }, { x: 1568, z: -1336 }, { x: 1568, z: -1480 }] },
  { id: 'ind-x-1656', label: '工业六街', axis: 'x', points: [{ x: 1656, z: -952 }, { x: 1656, z: -1080 }, { x: 1656, z: -1208 }, { x: 1656, z: -1336 }, { x: 1656, z: -1480 }] },
];

// 四车道绿带连接线（Medium Road 24 m）：铺在住宅网格之间的绿带正中，
// 两侧各留 ≥44 m 绿缘、不临任何分区——Small↔Medium 的黄金档 116 不在 8 m 相位上，
// 四车道只能走「两侧留绿」的公园路形式，这正是各网格互不相邻的分隔带。
const CONNECTOR_ROADS = [
  // 只留两条：东西向主连接靠绿廊大道（贯穿全镇 1 km），南片靠湖滨大道；
  // 西翼↔西北之间不再加连接线——西环路/主街等纵街本就横穿大道，北园路是冗余复线。
  { id: 'conn-corridor', label: '绿廊大道（四车道）', axis: 'z', points: [{ x: 16, z: -2352 }, { x: 1024, z: -2352 }] },
  { id: 'conn-south', label: '湖滨大道（四车道）', axis: 'z', points: [{ x: 16, z: -2880 }, { x: 576, z: -2880 }] },
];

function townRoads() {
  const roads = [];
  roads.push({ kind: 'line', ...AVENUE });
  for (const [index, line] of X_LINES.entries()) {
    const common = {
      class: 'local', district: 'town', axis: 'x',
      role: line.perimeter ? 'perimeter_collector' : 'interior_local',
      widening_policy: line.perimeter ? 'perimeter_expandable' : 'forbidden',
    };
    if (spansCorridor(line) && !CORRIDOR_CROSSINGS.has(line.id)) {
      roads.push({
        kind: 'line', id: `${line.id}-n`, label: `${line.label}（绿廊以北）`,
        ...common, order: 40 + index,
        points: [{ x: line.x, z: line.z0 }, { x: line.x, z: GREEN_CORRIDOR.from_z }],
      });
      roads.push({
        kind: 'line', id: `${line.id}-s`, label: `${line.label}（绿廊以南）`,
        ...common, order: 140 + index,
        points: [{ x: line.x, z: GREEN_CORRIDOR.to_z }, { x: line.x, z: line.z1 }],
      });
      continue;
    }
    roads.push({
      kind: 'line', id: line.id, label: line.label, ...common, order: 40 + index,
      points: [{ x: line.x, z: line.z0 }, { x: line.x, z: line.z1 }],
    });
  }
  for (const [index, line] of Z_LINES.entries()) {
    roads.push({
      kind: 'line', id: line.id, label: line.label, class: 'local', district: line.district ?? 'town', axis: 'z',
      role: line.perimeter ? 'perimeter_collector' : 'interior_local',
      widening_policy: line.perimeter ? 'perimeter_expandable' : 'forbidden',
      order: 20 + index,
      points: [{ x: line.x0, z: line.z }, { x: line.x1, z: line.z }],
    });
  }
  for (const [index, line] of INDUSTRY_ROADS.entries()) {
    roads.push({
      kind: 'line', id: line.id, label: line.label, class: 'local', district: 'industry', axis: line.axis,
      role: 'interior_local', widening_policy: 'forbidden', order: 200 + index,
      points: line.points,
    });
  }
  for (const [index, line] of CONNECTOR_ROADS.entries()) {
    roads.push({
      kind: 'line', id: line.id, label: line.label, class: 'connector', district: 'connector', axis: line.axis,
      role: 'greenway_connector', widening_policy: 'forbidden', order: 300 + index,
      points: line.points,
    });
  }
  return roads;
}

// ---------------------------------------------------------------- 布局定义
const TOWN = {
  fileName: 'sommerville-town-plan.json',
  cityName: '萨默斯维尔',
  name: '湖湾镇规划',
  title: '萨默斯维尔｜湖湾镇总体规划（七网格住区 · 绿带分隔 · 四车道连接 · 河东工业园 2×4 · 中央绿廊，只读草案）',

  streets: {
    spine: { prefab: 'Large Road', width_m: 32 },
    local: { prefab: 'Small Road', width_m: 16 },
    connector: { prefab: 'Medium Road', width_m: 24 },
  },

  roads: townRoads(),

  // 分区范围 = 各网格的「路缘内盒」（边界街道路缘之间），网格外围 48 m 一律不划区——
  // 住宅拆成 7 个独立网格（每个 ≤5×5 街区），网格之间以 ≥120 m 绿带相隔、互不相邻，
  // 绿带正中铺四车道连接线（conn-corridor / conn-south 共两条）；
  // 商业独占河东商埠网格，工业 2×4 自成一格；所有服务/市政建筑都放在网格外围绿带。
  districts: [
    {
      key: 'westwing', name: '西翼网格', kind: '联排住宅 5×3',
      bounds: { min_x: 24, max_x: 568, min_z: -1768, max_z: -1448 },
      base_kind: 'NA Residential Medium Row',
      kinds: [],
      note: '独立住宅网格一：北环路~迎宾大道之间 5 列×3 排联排；湖滨退线损失的人口由此补回。大道南缘与西北网格之间是北缘绿带（纯绿，不铺路）。',
    },
    {
      key: 'northwest', name: '西北网格', kind: '联排住宅 5×3',
      bounds: { min_x: 24, max_x: 568, min_z: -2232, max_z: -1912 },
      base_kind: 'NA Residential Medium Row',
      kinds: [],
      note: '独立住宅网格二：中心北街~绿廊北街之间 5 列×3 排联排；大道南侧退线 112 m（北缘绿带），与西翼网格隔带相望、互不相邻。',
    },
    {
      key: 'northeast', name: '东北网格', kind: '中密度公寓 3×3',
      bounds: { min_x: 696, max_x: 1016, min_z: -2232, max_z: -1912 },
      base_kind: 'NA Residential Medium',
      kinds: [],
      note: '独立住宅网格三：中心北街~绿廊北街之间 3 列×3 排中密度公寓，紧邻商业网格与迎宾大道入镇口；边缘 48 m 不划区。',
    },
    {
      key: 'bayview', name: '湾景网格', kind: '联排住宅 1×2',
      bounds: { min_x: 1144, max_x: 1240, min_z: -2120, max_z: -1912 },
      base_kind: 'NA Residential Medium Row',
      kinds: [],
      note: '独立住宅网格四：湾景一/二街之间的 1×2 小网格，东望湾滨；西侧留 96 m 湾景绿带与东北网格相隔，南界是东延的南一街。',
    },
    {
      key: 'commerce', name: '河东商埠', kind: '商业 5×1',
      bounds: { min_x: 696, max_x: 1240, min_z: -1896, max_z: -1800 },
      base_kind: 'NA Commercial Low',
      kinds: [],
      note: '全镇唯一商业网格：迎宾大道入镇口第一排 5 块商业，与住宅网格以中心北街相隔、与工业园共享大道货运通道；南北外缘 48 m 不划区。',
    },
    {
      key: 'southwest', name: '西南网格', kind: '联排住宅 5×3',
      bounds: { min_x: 24, max_x: 568, min_z: -2792, max_z: -2472 },
      base_kind: 'NA Residential Medium Row',
      kinds: [],
      note: '独立住宅网格五：绿廊南街~南环路之间 5 列×3 排联排；边缘 48 m 不划区。',
    },
    {
      key: 'southeast', name: '东南网格', kind: '中密度公寓 3×3',
      bounds: { min_x: 696, max_x: 1016, min_z: -2792, max_z: -2472 },
      base_kind: 'NA Residential Medium',
      kinds: [],
      note: '独立住宅网格六：绿廊南街~南环路之间 3 列×3 排中密度公寓，西隔绿巷与西南网格相望、东临湾滨绿带；边缘 48 m 不划区。',
    },
    {
      key: 'lakeside', name: '湖滨台地（西）', kind: '低密度住宅 1×1（48 m 滨湖带）',
      bounds: { min_x: 24, max_x: 120, min_z: -3064, max_z: -3016 },
      base_kind: 'NA Residential Low',
      kinds: [],
      note: '湖滨网格七（西台地）：湖滩街西段北侧的 96×48 m 单排湖景房。湖滨带实测被 NE→SW 干沟斜切'
        + '（沟底 872 m）且 x40−56 有 21% 通湖陡坎，原 5×1 网格横跨沟谷不可行——收缩为东西两块台地。',
    },
    {
      key: 'lakeside-east', name: '湖滨台地（东）', kind: '低密度住宅 1×1（48 m 滨湖带）',
      bounds: { min_x: 424, max_x: 520, min_z: -3064, max_z: -3016 },
      base_kind: 'NA Residential Low',
      kinds: [],
      note: '湖滨网格八（东台地）：湖滩街东段北侧的 96×48 m 单排湖景房，经主街直达；与西台地之间是干沟绿谷。',
    },
    {
      key: 'industry', name: '河东工业园', kind: '制造业 2×4',
      bounds: { min_x: 1488, max_x: 1648, min_z: -1472, max_z: -960 },
      base_kind: 'Industrial Manufacturing',
      kinds: [],
      greenBelts: [{ min_x: 1376, max_x: 1472, min_z: -1480, max_z: -952 }],
      note: '迎宾大道 x=1360 段以东的台地，2 列 × 4 行网格（柱距 88 m、地块 72×112 m）。实测水体掩码：水湾东北支伸到 (1672,−950)、东南支伸到 (1576,−1560)，'
        + '故东界收到 x=1656、南界止于大道节点 −1480。工业北街/南街直接接在大道细分节点上，货运车流从匝道直进园区、不穿镇；'
        + '网格内部不设任何服务建筑，园区消防站放在工业北街北侧绿带。大道与工业一街之间 48 m 缓冲带留作风电路（3 台风机已排）。',
    },
    {
      key: 'greencorridor', name: '中央绿廊', kind: '绿地', zoning: false,
      bounds: { min_x: -40, max_x: 1080, min_z: -2472, max_z: -2248 },
      greenBelts: [{ min_x: 16, max_x: 1024, min_z: -2472, max_z: -2248 }],
      note: '绿廊北街与绿廊南街之间刻意抽掉的 224 m 间距（路缘 208 m）：中小学、中央公园、儿童活动场沿两缘排布，只保留西环路/主街/东环路 3 处穿越，全长 1 km 不划区。',
    },
    {
      key: 'castlehill', name: '城堡山公园', kind: '公园', zoning: false,
      bounds: { min_x: 640, max_x: 1104, min_z: -1552, max_z: -960 },
      greenBelts: [{ min_x: 640, max_x: 1104, min_z: -1552, max_z: -960 }],
      note: 'RuinsCastle01 城堡遗址所在山体（~936 m）整体留绿，不划区、不修路；东侧鞍部走廊留给迎宾大道。两座水塔分居山西/东坡（免临路 prefab，高处白赚静水压），与城堡遗址各距 170 m 以上。',
    },
    {
      key: 'bayshore', name: '湾滨绿带', kind: '绿地', zoning: false,
      bounds: { min_x: 1136, max_x: 1304, min_z: -2856, max_z: -2128 },
      greenBelts: [{ min_x: 1136, max_x: 1304, min_z: -2856, max_z: -2128 }],
      note: '东南角向水湾均匀下降的干坡（895 → 872 m，坡 6~9%），不划区；预留为湾滨公园与未来观景路走廊。北界收到 −2128 给湾景网格让位。',
    },
    {
      key: 'northgreen', name: '北缘绿带', kind: '绿地', zoning: false,
      bounds: { min_x: 16, max_x: 568, min_z: -1912, max_z: -1800 },
      greenBelts: [{ min_x: 16, max_x: 568, min_z: -1912, max_z: -1800 }],
      note: '迎宾大道与西北网格之间的 112 m 退线绿带保持纯绿（北缘绿带）——西翼与西北两网格由此互不相邻，区间车流走西环路/主街横穿大道即可。',
    },
    {
      key: 'southgreen', name: '南缘绿带', kind: '绿地', zoning: false,
      bounds: { min_x: 16, max_x: 568, min_z: -2960, max_z: -2808 },
      greenBelts: [{ min_x: 16, max_x: 568, min_z: -2960, max_z: -2808 }],
      note: '南环路以南、湖滨街以北的 152 m 滨湖绿带，正中铺四车道湖滨大道（conn-south）；口袋公园设于带内（水塔已迁往城堡山）。',
    },
    {
      key: 'bayviewgreen', name: '湾景绿带', kind: '绿地', zoning: false,
      bounds: { min_x: 1032, max_x: 1128, min_z: -2120, max_z: -1912 },
      greenBelts: [{ min_x: 1032, max_x: 1128, min_z: -2120, max_z: -1912 }],
      note: '东环路与湾景一街之间的 96 m 绿带：东北网格与湾景网格的分隔带。',
    },
    {
      key: 'greenseam-north', name: '绿巷（北）', kind: '绿地', zoning: false,
      bounds: { min_x: 584, max_x: 680, min_z: -2232, max_z: -1768 },
      greenBelts: [{ min_x: 584, max_x: 680, min_z: -2232, max_z: -1768 }],
      note: '主街与东一街之间整条街区列留绿：西北住宅网格与河东商埠/东北网格的分隔带（宽 96 m），社区诊所设于巷内。',
    },
    {
      key: 'greenseam-south', name: '绿巷（南）', kind: '绿地', zoning: false,
      bounds: { min_x: 584, max_x: 680, min_z: -2792, max_z: -2472 },
      greenBelts: [{ min_x: 584, max_x: 680, min_z: -2792, max_z: -2472 }],
      note: '西南与东南住宅网格之间的分隔带（宽 96 m），北接中央绿廊、南接南环路绿缘。',
    },
  ],

  // 服务与市政建筑：align = 贴着某条路的一侧，坐标由脚本沿法向算出（半路宽 + 半进深 + 2 m），
  // 再用 validateCityPlan 打分挑告警最少的位置。绿廊内设施全部贴绿廊两缘街道内侧摆放。
  buildings: [
    { id: 'bld-elementary-west', prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（西）', kind: 'service',
      align: { road: 'street-z-2240', near: { x: 352, z: -2240 }, side: 'south' } },
    { id: 'bld-elementary-east', prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（东）', kind: 'service',
      align: { road: 'street-z-2464', near: { x: 800, z: -2464 }, side: 'north' } },
    { id: 'bld-high-school', prefab: 'HighSchool02', size: { x: 95.6, z: 63.6 }, label: '规划中学', kind: 'service',
      align: { road: 'street-z-2464', near: { x: 240, z: -2464 }, side: 'north' } },
    { id: 'bld-city-park', prefab: 'CityPark08', size: { x: 63.6, z: 63.6 }, label: '规划中央公园', kind: 'service',
      align: { road: 'street-z-2240', near: { x: 688, z: -2240 }, side: 'south' } },
    { id: 'bld-playground-central', prefab: 'Playground04', size: { x: 31.6, z: 31.6 }, label: '规划儿童活动场（绿廊）', kind: 'service',
      align: { road: 'street-z-2240', near: { x: 912, z: -2240 }, side: 'south' } },
    { id: 'bld-playground-west', prefab: 'Playground02', size: { x: 23.6, z: 31.6 }, label: '规划儿童活动场（西翼）', kind: 'service',
      align: { road: 'street-z-1440', near: { x: 352, z: -1440 }, side: 'north' } },
    { id: 'bld-clinic', prefab: 'MedicalClinic02', size: { x: 39.6, z: 39.6 }, label: '规划社区诊所', kind: 'service',
      align: { road: 'street-x-576', near: { x: 576, z: -2080 }, side: 'east' } },
    { id: 'bld-police', prefab: 'PoliceStation02', size: { x: 39.6, z: 39.6 }, label: '规划警察局', kind: 'service',
      align: { road: 'street-z-2240', near: { x: 240, z: -2240 }, side: 'south' } },
    { id: 'bld-fire', prefab: 'FireHouse02', size: { x: 23.6, z: 31.6 }, label: '规划消防站', kind: 'service',
      align: { road: 'street-z-2240', near: { x: 800, z: -2240 }, side: 'south' } },
    { id: 'bld-fire-industry', prefab: 'FireHouse02', size: { x: 23.6, z: 31.6 }, label: '规划工业园消防站', kind: 'service',
      align: { road: 'ind-z-952', near: { x: 1540, z: -952 }, side: 'north' } },
    { id: 'bld-pocket-park-south', prefab: 'PocketPark05', size: { x: 15.6, z: 15.6 }, label: '规划口袋公园（南）', kind: 'service',
      align: { road: 'street-z-2800', near: { x: 240, z: -2800 }, side: 'south' } },
    { id: 'bld-pocket-park-east', prefab: 'PocketPark07', size: { x: 31.6, z: 7.6 }, label: '规划口袋公园（东）', kind: 'service',
      align: { road: 'street-x-1024', near: { x: 1024, z: -2600 }, side: 'east' } },
    { id: 'bld-water-tower-north', prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, label: '规划水塔（城堡山西）', kind: 'utility',
      // 显式落点：城堡山西坡（实测 915.8 m，坡 2~4%），无需临路（WaterTower01 免路）。
      // 远离全部住宅网格（最近者 200 m 以外）；高地势还能白赚静水压。
      position: { x: 688, z: -1064 } },
    { id: 'bld-water-tower-south', prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, label: '规划水塔（城堡山东）', kind: 'utility',
      // 城堡山东坡（实测 908~911 m，坡 6~8%），与西塔分居山脊两侧互为备份，均远离住宅区。
      position: { x: 1024, z: -1424 } },
    { id: 'bld-transformer', prefab: 'TransformerStation01', size: { x: 47.6, z: 55.6 }, label: '规划变电站（河东工业园）', kind: 'utility',
      // 搬进工业园：贴工业北街南侧（需临路的 prefab），服务园区负荷；
      // 与大道之间隔风电路绿带，最近住宅网格在 500 m 以外。
      align: { road: 'ind-z-952', near: { x: 1432, z: -952 }, side: 'south' } },
    { id: 'bld-telecom', prefab: 'TelecomTower01', size: { x: 55.6, z: 55.6 }, label: '规划通信塔', kind: 'utility',
      align: { road: 'street-z-2240', near: { x: 1000, z: -2240 }, side: 'south' } },
    { id: 'bld-wind-1', prefab: 'WindTurbine01', size: { x: 23.6, z: 23.6 }, label: '规划风力发电机 1', kind: 'utility',
      align: { road: 'avenue', near: { x: 1360, z: -1250 }, side: 'east' } },
    { id: 'bld-wind-2', prefab: 'WindTurbine01', size: { x: 23.6, z: 23.6 }, label: '规划风力发电机 2', kind: 'utility',
      align: { road: 'avenue', near: { x: 1360, z: -1450 }, side: 'east' } },
    { id: 'bld-wind-3', prefab: 'WindTurbine01', size: { x: 23.6, z: 23.6 }, label: '规划风力发电机 3', kind: 'utility',
      align: { road: 'avenue', near: { x: 1360, z: -1600 }, side: 'east' } },
  ],

  // 人口口径：分区面积 ÷ 每户占地（平方米，实时目录实测），乘户均人口
  householdAreaM2: { 'NA Residential Low': 300, 'NA Residential Medium Row': 170, 'NA Residential Medium': 120 },
  peoplePerHousehold: 2.5,
  peoplePerHouseholdRange: [2.2, 2.8],
  targetPopulation: 10000,
};

// ---------------------------------------------------------------- 几何工具（与 generate-region-plan.mjs 同一套已验证机制）
const snap8 = value => Math.round(value / 8) * 8;
const snap4 = value => Math.round(value / 4) * 4;
const snapPoint = point => ({ x: snap8(point.x), z: snap8(point.z) });
const snapBuildingPoint = point => ({ x: snap4(point.x), z: snap4(point.z) });

const dedupPoints = points => points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.z !== points[index - 1].z);

// 先把控制点搬到 8 米格上，细分留到（本规划无吸附位移，但仍沿用「先吸附后细分」的顺序）
function roadPoints(road) {
  return dedupPoints(road.points.map(snapPoint));
}

// 细分并清掉过短残段：每段 ≤ 200−8 m，留一格余量
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
  const roads = TOWN.roads.map(road => {
    const spec = TOWN.streets[road.class];
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
      points: roadPoints(road),
    };
  });
  applySnaps(roads);
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

// 路网必须是单一连通分量：断口在图上看不出来，必须硬校验
function assertRoadNetworkConnected(roads) {
  const parent = roads.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const gap = polylineDistance(roads[i].points, roads[j].points);
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
    throw new Error(`路网不是单一连通分量（${components.size} 块）：${detail}`);
  }
  return components.size;
}

const SIDE_HINTS = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };
// 贴着某条路的一侧放建筑：沿法向偏移「半个路宽 + 占地一半 + 2 米」
function alignToRoad(road, near, side, size) {
  const hit = closestOnPolyline(near, road.points);
  const hint = SIDE_HINTS[side];
  if (!hint) throw new Error(`未知方位：${side}`);
  const sign = hit.nx * hint.x + hit.nz * hint.z >= 0 ? 1 : -1;
  const nx = hit.nx * sign, nz = hit.nz * sign;
  const extent = Math.abs(size.x * nx) + Math.abs(size.z * nz);
  const distance = road.width_m / 2 + extent / 2 + 2;
  return snapPoint({ x: hit.x + nx * distance, z: hit.z + nz * distance });
}

function shiftedNear(road, near, offset) {
  const hit = closestOnPolyline(near, road.points);
  return { x: near.x + hit.tx * offset, z: near.z + hit.tz * offset };
}

// 逐个建筑沿所在道路试位移，用真正的规划校验器打分，挑「告警最少、位移最小」的位置
function refinePlacements(buildings, roads, bounds) {
  const scoreOf = list => validateCityPlan({ utilities: [] }, { roads, buildings: list, zones: [] }, bounds)
    .issues.filter(issue => issue.layer === 'buildings').length;
  const offsets = [0, 24, -24, 48, -48, 72, -72, 96, -96, 128, -128, 160, -160];
  const result = buildings.map(building => ({ ...building }));
  let score = scoreOf(result);
  for (const building of result) {
    const spec = TOWN.buildings.find(entry => entry.id === building.id);
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

// 返回格子到最近道路「边缘」的距离；负数表示落在路面里
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

// 逐格判定「能划区」（进深窗口 [0,48] 自路面外缘，与引擎 BlockSystem 一致），
// 再把同类相邻格合并成长条矩形。zoning:false 的片区（公园/绿带）不参与。
function rasterizeZones(roads) {
  const segments = segmentList(roads);
  const zones = [];
  const stats = [];
  for (const district of TOWN.districts) {
    if (district.zoning === false) continue;
    const box = district.bounds;
    const cells = new Map();
    let candidate = 0, kept = 0;
    for (let x = box.min_x; x < box.max_x; x += CELL_SIZE) {
      for (let z = box.min_z; z < box.max_z; z += CELL_SIZE) {
        candidate += 1;
        const centerX = x + CELL_SIZE / 2, centerZ = z + CELL_SIZE / 2;
        const depth = depthAt(centerX, centerZ, segments);
        if (depth < 0 || depth > MAX_ZONING_DEPTH_M) continue;
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
      let open = new Map();
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

// 片区范围必须互不重叠：栅格化按片区各自扫描、不做跨片区去重，
// 重叠的格子会被两个片区各划一次，分区面积与人口直接虚增（图上看不出来，只能靠这条拦）。
for (let i = 0; i < TOWN.districts.length; i++) {
  for (let j = i + 1; j < TOWN.districts.length; j++) {
    const a = TOWN.districts[i].bounds, b = TOWN.districts[j].bounds;
    const overlapX = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x);
    const overlapZ = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z);
    if (overlapX > 0 && overlapZ > 0) {
      throw new Error(`片区范围重叠：${TOWN.districts[i].key} × ${TOWN.districts[j].key}`
        + `（${overlapX}×${overlapZ} m）— 重叠格子会被重复划区`);
    }
  }
}

const { zones, stats } = rasterizeZones(roads);

// 同一处地面不能被两块分区同时覆盖（上面那条只挡片区边界，这条兜住任何漏网的重叠）
for (let i = 0; i < zones.length; i++) {
  for (let j = i + 1; j < zones.length; j++) {
    const p = zones[i].polygon, q = zones[j].polygon;
    const overlapX = Math.min(Math.max(...p.map(v => v.x)), Math.max(...q.map(v => v.x)))
      - Math.max(Math.min(...p.map(v => v.x)), Math.min(...q.map(v => v.x)));
    const overlapZ = Math.min(Math.max(...p.map(v => v.z)), Math.max(...q.map(v => v.z)))
      - Math.max(Math.min(...p.map(v => v.z)), Math.min(...q.map(v => v.z)));
    if (overlapX > 0 && overlapZ > 0) throw new Error(`分区块重叠：${zones[i].id} × ${zones[j].id}`);
  }
}

const initialBuildings = TOWN.buildings.map((building, index) => {
  const roadId = building.align ? building.align.road : (building.roadside_of ?? null);
  const road = roadId ? roadById.get(roadId) : null;
  if (roadId && !road) throw new Error(`${building.id} 的临路目标不存在：${roadId}`);
  const position = building.position
    ? snapBuildingPoint(building.position)
    : alignToRoad(road, building.align.near, building.align.side, building.size);
  return {
    id: building.id,
    prefab: building.prefab,
    label: building.label,
    name: building.label,
    kind: building.kind ?? 'service',
    roadside_of: road?.id ?? null,
    planning_status: 'bound',
    construction_status: 'planned',
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
const plan = { roads, zones, buildings };

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
  const perHousehold = TOWN.householdAreaM2[kind];
  if (!perHousehold) continue;
  // 按分区类型汇总面积后取整（不是逐块取整，否则几百个小块会各自损失零头）；
  // 口径写在 accounting.household_rule 里，测试按同一条规则复算。
  householdByKind[kind] = Math.round(area / perHousehold);
  households += householdByKind[kind];
}
const residentialZoneArea = Object.entries(areaByKind).filter(([kind]) => TOWN.householdAreaM2[kind]).reduce((sum, [, area]) => sum + area, 0);
const commercialZoneArea = Object.entries(areaByKind).filter(([kind]) => kind.includes('Commercial')).reduce((sum, [, area]) => sum + area, 0);
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

// 离线自校验（无实时瓦片时校验器回落到 bounds 判定）
const offlineValidation = validateCityPlan({ utilities: [] }, plan, bounds);

const planId = computeCityPlanId(bounds, plan);
const people = Math.round(households * TOWN.peoplePerHousehold);

const document = {
  plan_id: planId,
  city: TOWN.cityName,
  name: TOWN.name,
  target_population: TOWN.targetPopulation,
  bounds,
  // 画布必须取正方形：底图是把正方形世界适配进画布（顶对齐），而交互页的初始取景
  // 按垂直居中反算——画布一旦不是正方形，打开页面就会聚焦到地图下方的空白区。
  render: { title: TOWN.title, width: 1800, height: 1800, view: 'surface', format: 'static_html' },
  water_cell_size_m: 32,
  terrain_cell_size_m: 64,
  golden_block: {
    curb_to_curb_m: GOLDEN_CURB_TO_CURB_M,
    widening_rules: {
      rule: '网格中间道路严禁拓宽（永久保持 16 m 生活支路，防止破坏 96 m 黄金进深与临街建筑）；仅迎宾大道（32 m）与外围环路具备拓宽属性',
      interior_allowed_to_widen: false,
      perimeter_allowed_to_widen: true,
    },
    axes: {
      // 镇网格：纵横两轴都是 96 m 黄金宽度（96×96 方形街区，美国小镇经典细格网）；
      // 中央绿廊是声明过的例外（−2240 → −2464 中心距 224，路缘 208 = 96 + 112 不划区）；
      // 南环路 → 湖滩街之间是南缘绿带 + 四车道湖滨大道（中心距 272，路缘 256 = 96 + 160 不划区）。
      town: {
        x: { exact_m: 96 },
        // green_gaps 的 from/to 按坐标升序写（from 更负），回归测试按 lines[i-1]→lines[i] 反查
        z: { exact_m: 96, green_gaps: [
          { from: GREEN_CORRIDOR.to_z, to: GREEN_CORRIDOR.from_z, unzoned_width_m: 112 },
          { from: -3072, to: -2800, unzoned_width_m: 160 },
        ] },
      },
      westwing: { z: { exact_m: 96 } },
      // 工业园 2×4：柱距 88（路缘 72，工业大地块不属黄金档）；行距 128/144 不均匀，不声明 z 轴
      industry: { x: { exact_m: 72 } },
    },
    cross_checks: [
      { pair: ['street-z-1664', 'avenue'], center_m: 120, curb_m: 96 },
      { pair: ['avenue', 'street-z-1904'], center_m: 120, curb_m: 96 },
      { pair: ['avenue', 'ind-x-1480'], center_m: 120, curb_m: 96 },
      { pair: ['street-z-2240', 'conn-corridor'], center_m: 112, curb_m: 92 },
      { pair: ['conn-corridor', 'street-z-2464'], center_m: 112, curb_m: 92 },
      { pair: ['street-z-2800', 'conn-south'], center_m: 80, curb_m: 60 },
    ],
    note: '中心线间距 = 96 + (W₁ + W₂) / 2，且必须落在全局 8 m 相位上；'
      + '镇区只用 Small↔Small(112) 与 Small↔Large(120) 两档。四车道 Medium Road 不与任何分区对开'
      + '（S↔M 的 116 不在 8 m 相位上），只走绿带正中的公园路形式：绿廊大道 / 湖滨大道（两条）。',
  },
  districts: TOWN.districts.map(district => ({
    key: district.key, name: district.name, kind: district.kind, bounds: district.bounds,
    zoning: district.zoning !== false,
    greenBelts: district.greenBelts ?? [],
    zone_area_m2: district.zoning === false ? 0 : zones.filter(zone => zone.district === district.key).reduce((sum, zone) => sum + zone.area_m2, 0),
    note: district.note,
  })),

  // 对外机动车出口：全镇唯一对外通道是高速立交匝道（全图唯一现成道路锚点）。
  // 这里声明网格与迎宾大道的两处主汇入口（沿大道相距 1008 m，互为冗余），
  // 大道北端再以 ≤8 m 容差接上匝道终点——回归测试按实时路网反查。
  access_points: [
    {
      id: 'access-avenue-west', district: 'town', label: '镇西汇入口（西环路 × 迎宾大道）',
      via: 'street-x-16', to: 'avenue', position: { x: 16, z: AVENUE_Z },
      note: '西翼与主网格西北片经西环路直上迎宾大道。',
    },
    {
      id: 'access-avenue-east', district: 'town', label: '镇东汇入口（东环路 × 迎宾大道）',
      via: 'street-x-1024', to: 'avenue', position: { x: 1024, z: AVENUE_Z },
      note: '主网格东南片经东环路直上迎宾大道；与西汇入口沿大道相距 1008 m。',
    },
    {
      id: 'access-industry', district: 'industry', label: '工业园汇入口（工业北街 × 迎宾大道）',
      via: 'ind-z-952', to: 'avenue', position: { x: 1360, z: -952 },
      note: '园区货运车流经工业北街直上迎宾大道、从匝道上高速，全程不穿镇；与镇东汇入口相距约 897 m。',
    },
  ],

  accounting: {
    target_population: TOWN.targetPopulation,
    households,
    people,
    peopleRange: [Math.round(households * TOWN.peoplePerHouseholdRange[0]), Math.round(households * TOWN.peoplePerHouseholdRange[1])],
    peoplePerHousehold: TOWN.peoplePerHousehold,
    household_area_m2: TOWN.householdAreaM2,
    household_rule: '按分区类型汇总可划区面积后 round(面积 ÷ 户均占地)，再乘每户人数；不是逐块取整',
    household_by_kind: householdByKind,
    zone_area_m2: areaByKind,
    residential_zone_area_m2: residentialZoneArea,
    commercial_zone_area_m2: commercialZoneArea,
    industrial_zone_area_m2: industrialZoneArea,
    zoning_fill: Object.fromEntries(stats.map(entry => [entry.district, { cells_zoned: entry.cells_zoned, cells_candidate: entry.cells_candidate, zones: entry.zones }])),
    road_count: roads.length,
    road_length_m: Math.round(roadLength),
    road_length_by_class_m: Object.fromEntries(Object.entries(roadLengthByClass).map(([key, value]) => [key, Math.round(value)])),
    road_segment_m: { min: Math.round(Math.min(...segmentLengths)), max: Math.round(Math.max(...segmentLengths)) },
    road_connected_components: roadComponentCount,
    // 以最终落盘几何重算（refinePlacements 的过程分是在道路吸附前算的，会高估，不能当结论）
    building_placement_warnings: offlineValidation.issues.filter(issue => issue.layer === 'buildings').length,
    offline_validation: { errors: offlineValidation.error_count, warnings: offlineValidation.warning_count },
    geometry_bbox: {
      min_x: snap8(Math.min(...allX)), min_z: snap8(Math.min(...allZ)),
      max_x: snap8(Math.max(...allX)), max_z: snap8(Math.max(...allZ)),
    },
  },
  basis: {
    city: '萨默斯维尔',
    theme: 'North American',
    surveyed_at: '2026-09-19',
    ramp_anchor: { x: 1019.8, z: -351.9, prefab: 'Medium Road Divided', note: '全图唯一现成道路锚点；迎宾大道起点 (1024,−352) 距其 4.2 m' },
    plain_height_m: 895.58,
    avenue_profile_m: [
      { at: '(1024,−352) 匝道端', h: 895.3 }, { at: '(1360,−1150) 鞍部', h: 895.8 },
      { at: '(1360,−1450) 山肩', h: 905.2 }, { at: '(1360,−1656) 山肩南端', h: 898.6 },
      { at: '(1248,−1784) 网格东北角', h: 896.2 },
    ],
    water_level_approx_m: 864,
    shoreline_note: '南水线 z ≈ −2950~−3000（x 830~1130 一带）；网格东南角为干坡（872~895 m），已整体留作湾滨绿带',
    purchased_tiles: '已购 40 格（x −935~2182，z −3428~1559）',
  },
  disclaimer: '本文件是只读规划草案：未运行任何施工预检（非 native preview）、未创建任何道路/分区/建筑、未改动模拟；'
    + '几何按「萨默斯维尔」存档 2026-09-19 的实时地形与水体勘测绘制，换存档需重新勘测并重绘。',
  plan,
};

const outputPath = process.argv[2] ?? path.join(repoRoot, 'plans', TOWN.fileName);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const deviation = Math.abs(people - TOWN.targetPopulation) / TOWN.targetPopulation;
const summary = [
  `人口：${households} 户 → 中位 ${people} 人（区间 ${document.accounting.peopleRange[0]}–${document.accounting.peopleRange[1]}，偏离目标 ${(deviation * 100).toFixed(1)}%）`,
  `户数组成：${Object.entries(householdByKind).map(([kind, value]) => `${kind} ${value}`).join('；')}`,
  `分区面积：住宅 ${(residentialZoneArea / 1e6).toFixed(2)} km²、商业 ${(commercialZoneArea / 1e6).toFixed(2)} km²、工业 ${(industrialZoneArea / 1e6).toFixed(2)} km²`,
  `划区填充：${stats.map(entry => `${entry.name} ${entry.cells_zoned}/${entry.cells_candidate} 格 → ${entry.zones} 块`).join('；')}`,
  `道路：${roads.length} 条 / ${(roadLength / 1000).toFixed(2)} km，单段 ${Math.round(Math.min(...segmentLengths))}–${Math.round(Math.max(...segmentLengths))} 米，连通分量 ${roadComponentCount}`,
  `建筑：${buildings.length} 栋；分区块：${zones.length} 个；放置告警 ${document.accounting.building_placement_warnings}；离线校验错误 ${offlineValidation.error_count} / 告警 ${offlineValidation.warning_count}`,
  `输出：${path.relative(repoRoot, outputPath)}，plan_id=${planId}`,
];
if (deviation > 0.1) summary.push(`⚠ 人口偏离目标超过 ±10%，请调整 kinds 密度矩形`);
console.log(JSON.stringify({ ok: true, output_path: path.resolve(outputPath), bounds, accounting: document.accounting, summary }, null, 2));
