// 只读生成器：把「街区级分区表」展开成 render_city_plan / city-plan-construction 可用的结构化规划 JSON。
// 不连接游戏、不写入城市；只输出 plans/ 下的规划文件并打印人口核算。
// 用法：node tools/scratch/generate-town-plan.mjs [输出路径]
//
// 布局表位于文件底部 TOWN 常量：改那里即可调人口密度与街区用途，
// 生成物是权威规划文件（纳入版本控制），脚本本身只做几何展开与核算。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- 布局定义
const TOWN = {
  fileName: 'egelin-plateau-town-plan.json',
  cityName: '埃格林',
  title: '埃格林｜高原镇 1 万人口规划（只读草案，未施工）',
  // 街区网格西南角：必须 8 米对齐
  anchor: { x: -2200, z: 504 },
  block: 96,
  // 街区用途码：L 低密住宅 / R 中密排屋 / M 中密住宅 / C 低密商业 / S 服务预留 / D 殡葬预留
  // 每行 20 个字符，第一行是最南侧那一排，向北递增
  rows: [
    'LLLLLLLLLLSSSSSSLLLL', // r0  z 504~600  主街南侧
    'RRRRRRRRRRCCCCCCRRRR', // r1  z 600~696  主街北侧（商业主街面）
    'RRRRRRRRRRRRRRRRRRRR', // r2  z 696~792
    'LLLLLLRRRRRRRRRRMMMM', // r3  z 792~888
    'LLLLLLLLLLLLLLLLLLLL', // r4  z 888~984
    'LLLLLLLLLLLLLLLLLLLL', // r5
    'LLLLLLLLLLLLLLLLLLLL', // r6
    'LLLLLLLLLLLLLLLLLLLL', // r7
    'LLLLLLLLLLLLLLLLLLLL', // r8
    'DLLLLLLLLLLLLLLLLLLL', // r9  z 1368~1464  北缘
  ],
  zoneByCode: {
    L: 'EU Residential Low',
    R: 'EU Residential Medium Row',
    M: 'EU Residential Medium',
    C: 'EU Commercial Low',
  },
  // 户数估算：沿街面宽 ÷ 每户面宽 × 0.9（扣路口与无法生长地块）
  // 低密 16 m/户、中密排屋 8 m/户；中密住宅按每街区约 50 户
  household: { L: 18, R: 36, M: 50 },
  peoplePerHousehold: 2.5,
  peoplePerHouseholdRange: [2.2, 2.8],
  streets: { internal: 'Small Road', arterial: 'Medium Road', internalWidth: 16, arterialWidth: 24 },
  // 主街所在行下标（z = anchor.z + row * block）与东缘接入列下标
  arterialRow: 1,
  arterialColumn: 20,
  // 产业与市政带：位于城镇网格南侧，自带一条东西向支路与一条接入支路
  belt: {
    roadZ: 328,
    roadFromX: -2696,
    roadToX: -1304,
    connectorX: -2000,
    buildingZ: 416,
  },
  // 服务预留街区（码 S）里的建筑；坐标由脚本按街区中心计算
  services: {
    S: [
      { column: 10, prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（西）' },
      { column: 11, prefab: 'ElementarySchool02', size: { x: 71.6, z: 47.6 }, label: '规划小学（东）' },
      { column: 12, prefab: 'MedicalClinic02', size: { x: 39.6, z: 39.6 }, label: '规划社区诊所' },
      { column: 13, prefab: 'FireHouse02', size: { x: 23.6, z: 31.6 }, label: '规划消防站' },
      { column: 14, prefab: 'PoliceStation02', size: { x: 39.6, z: 39.6 }, label: '规划警察分局' },
      { column: 15, prefab: 'CityPark08', size: { x: 63.6, z: 63.6 }, label: '规划中心公园' },
    ],
    D: [{ column: 0, prefab: 'Crematorium01', size: { x: 63.6, z: 79.6 }, label: '规划殡仪馆' }],
  },
  // 镇内独立设施（水塔 + 街区级小公园）：按街区坐标落到街区中心
  inTownUtilities: [
    { prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, column: 8, row: 6, label: '规划水塔（北）' },
  ],
  inTownParks: [
    { prefab: 'PocketPark05', size: { x: 15.6, z: 15.6 }, column: 3, row: 4, label: '口袋公园' },
    { prefab: 'Playground04', size: { x: 31.6, z: 31.6 }, column: 9, row: 5, label: '儿童活动场' },
    { prefab: 'PocketPark10', size: { x: 7.6, z: 47.6 }, column: 13, row: 6, label: '口袋公园' },
    { prefab: 'Playground02', size: { x: 23.6, z: 31.6 }, column: 5, row: 7, label: '儿童活动场' },
    { prefab: 'PocketPark07', size: { x: 31.6, z: 7.6 }, column: 11, row: 8, label: '口袋公园' },
    { prefab: 'Playground03', size: { x: 23.6, z: 23.6 }, column: 16, row: 9, label: '儿童活动场' },
  ],
  // 产业与市政带设施（沿带的 z 排列，避免与支路和彼此重叠）
  beltFacilities: [
    { prefab: 'SmallCoalPowerPlant01', size: { x: 111.6, z: 127.6 }, x: -2520, label: '规划小型燃煤电厂' },
    { prefab: 'Landfill01', size: { x: 135.6, z: 119.6 }, x: -2352, label: '规划垃圾填埋场' },
    { prefab: 'WastewaterTreatmentPlant01', size: { x: 95.6, z: 79.6 }, x: -2192, label: '规划污水处理厂' },
    { prefab: 'GroundwaterPumpingStation01', size: { x: 47.6, z: 47.6 }, x: -2064, label: '规划地下水抽水站' },
    { prefab: 'TransformerStation01', size: { x: 47.6, z: 55.6 }, x: -1952, label: '规划变电站' },
    { prefab: 'WindTurbine01', size: { x: 119.6, z: 119.6 }, x: -1784, label: '规划风力发电机（西）' },
    { prefab: 'WaterTower01', size: { x: 31.6, z: 31.6 }, x: -1696, label: '规划水塔（产业带）' },
    { prefab: 'WindTurbine01', size: { x: 119.6, z: 119.6 }, x: -1552, label: '规划风力发电机（东）' },
    { prefab: 'TelecomTower01', size: { x: 55.6, z: 55.6 }, x: -1400, label: '规划通信塔' },
  ],
  // 接入高速：网格东缘主街尽头 → 高速北向支线端点（坐标为实测端点，8 米对齐）
  highwayLink: {
    prefab: 'Medium Road',
    width: 24,
    points: [{ x: -280, z: 600 }, { x: -128, z: 600 }, { x: -128, z: 544 }],
    label: '主街—高速接入道',
  },
};

// ---------------------------------------------------------------- 几何工具
const snap8 = value => Math.round(value / 8) * 8;
const blockCenterX = (c) => TOWN.anchor.x + c * TOWN.block + TOWN.block / 2;
const blockCenterZ = (r) => TOWN.anchor.z + r * TOWN.block + TOWN.block / 2;

function buildRoads() {
  const { anchor, block, rows, streets, arterialRow, arterialColumn, belt, highwayLink } = TOWN;
  const columns = rows[0].length;
  const roadRows = rows.length;
  const roads = [];
  const widthOf = c => (c === arterialColumn ? streets.arterialWidth : streets.internalWidth);
  const prefabOf = c => (c === arterialColumn ? streets.arterial : streets.internal);
  const widthOfRow = r => (r === arterialRow ? streets.arterialWidth : streets.internalWidth);
  const prefabOfRow = r => (r === arterialRow ? streets.arterial : streets.internal);

  for (let column = 0; column <= columns; column++) {
    const x = anchor.x + column * block;
    roads.push({
      id: `st-v-${column}`,
      label: `纵向街 ${column}${column === arterialColumn ? '（东缘大道）' : ''}`,
      prefab: prefabOf(column),
      level: 'surface',
      width_m: widthOf(column),
      construction_status: 'planned',
      construction_order: column === arterialColumn ? 10 : 20,
      points: [{ x, z: anchor.z }, { x, z: anchor.z + roadRows * block }],
    });
  }
  for (let row = 0; row <= roadRows; row++) {
    const z = anchor.z + row * block;
    roads.push({
      id: `st-h-${row}`,
      label: `横向街 ${row}${row === arterialRow ? '（主街）' : ''}`,
      prefab: prefabOfRow(row),
      level: 'surface',
      width_m: widthOfRow(row),
      construction_status: 'planned',
      construction_order: row === arterialRow ? 11 : 21,
      points: [{ x: anchor.x, z }, { x: anchor.x + columns * block, z }],
    });
  }
  // 产业与市政带支路 + 接入支路
  roads.push({
    id: 'belt-road',
    label: '产业与市政带支路',
    prefab: streets.internal,
    level: 'surface',
    width_m: streets.internalWidth,
    construction_status: 'planned',
    construction_order: 30,
    points: [{ x: belt.roadFromX, z: belt.roadZ }, { x: belt.roadToX, z: belt.roadZ }],
  });
  roads.push({
    id: 'belt-connector',
    label: '产业带接入支路',
    prefab: streets.internal,
    level: 'surface',
    width_m: streets.internalWidth,
    construction_status: 'planned',
    construction_order: 31,
    points: [{ x: belt.connectorX, z: belt.roadZ }, { x: belt.connectorX, z: anchor.z }],
  });
  roads.push({
    id: 'arterial-highway-link',
    label: highwayLink.label,
    prefab: highwayLink.prefab,
    level: 'surface',
    width_m: highwayLink.width,
    construction_status: 'planned',
    construction_order: 5,
    points: highwayLink.points,
  });
  return roads;
}

function buildZones() {
  const { anchor, block, rows, zoneByCode } = TOWN;
  const inset = 8; // 沿街退让半个内部车道宽，避免分区压在路上
  const zones = [];
  rows.forEach((line, row) => {
    [...line].forEach((code, column) => {
      const zoneType = zoneByCode[code];
      if (!zoneType) return;
      const x0 = anchor.x + column * block + inset;
      const x1 = anchor.x + (column + 1) * block - inset;
      const z0 = anchor.z + row * block + inset;
      const z1 = anchor.z + (row + 1) * block - inset;
      zones.push({
        id: `blk-${column}-${row}`,
        kind: zoneType,
        polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }],
      });
    });
  });
  return zones;
}

function buildBuildings() {
  const { block, rows, services, belt, beltFacilities, inTownUtilities, inTownParks } = TOWN;
  const buildings = [];
  const push = (prefab, label, x, z, size) => buildings.push({
    id: `bld-${buildings.length + 1}`,
    prefab,
    label,
    name: label,
    kind: 'service',
    planning_status: 'bound',
    construction_status: 'planned',
    construction_order: 50 + buildings.length,
    position: { x: snap8(x), z: snap8(z) },
    rotation_degrees: 0,
    size_m: size,
  });

  // 每类预留街区只落一次建筑：取该码第一次出现的行作为落位行
  const rowOfCode = {};
  rows.forEach((line, row) => [...line].forEach(code => { if (!(code in rowOfCode)) rowOfCode[code] = row; }));
  for (const [code, list] of Object.entries(services)) {
    if (!(code in rowOfCode)) continue;
    for (const item of list) push(item.prefab, item.label, blockCenterX(item.column), blockCenterZ(rowOfCode[code]), item.size);
  }
  for (const item of inTownUtilities) push(item.prefab, item.label, blockCenterX(item.column), blockCenterZ(item.row), item.size);
  for (const item of inTownParks) push(item.prefab, item.label, blockCenterX(item.column), blockCenterZ(item.row), item.size);
  for (const item of beltFacilities) push(item.prefab, item.label, item.x, belt.buildingZ, item.size);
  return buildings;
}

// ---------------------------------------------------------------- 核算
function account(plan) {
  const { rows, block, household, peoplePerHousehold, peoplePerHouseholdRange } = TOWN;
  const counts = {};
  rows.forEach(line => [...line].forEach(code => { counts[code] = (counts[code] ?? 0) + 1; }));
  const households = Object.entries(household).reduce((sum, [code, perBlock]) => sum + (counts[code] ?? 0) * perBlock, 0);
  const residentialBlocks = ['L', 'R', 'M'].reduce((sum, code) => sum + (counts[code] ?? 0), 0);
  const zoneAreaM2 = residentialBlocks * Math.pow(block - 16, 2);
  const columns = rows[0].length;
  return {
    counts,
    residentialBlocks,
    households,
    people: Math.round(households * peoplePerHousehold),
    peopleRange: [Math.round(households * peoplePerHouseholdRange[0]), Math.round(households * peoplePerHouseholdRange[1])],
    residentialZoneAreaM2: zoneAreaM2,
    townAreaM2: columns * block * rows.length * block,
    grid: { columns, rows: rows.length, anchor: TOWN.anchor, blockM: block },
  };
}

// ---------------------------------------------------------------- 主流程
const outputPath = process.argv[2] ?? path.join(repoRoot, 'plans', TOWN.fileName);
const plan = { roads: buildRoads(), zones: buildZones(), buildings: buildBuildings() };
const stats = account(plan);

const xs = plan.roads.flatMap(road => road.points.map(point => point.x)).concat(plan.buildings.map(b => b.position.x));
const zs = plan.roads.flatMap(road => road.points.map(point => point.z)).concat(plan.buildings.map(b => b.position.z));
const roadLength = plan.roads.reduce((sum, road) => {
  let length = 0;
  for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i].x - road.points[i - 1].x, road.points[i].z - road.points[i - 1].z);
  return sum + length;
}, 0);

const bounds = { min_x: -2712, min_z: 312, max_x: -112, max_z: 1480 };
// plan_id 与 render_city_plan / prepare_city_plan_construction 使用同一哈希算法
const planId = computeCityPlanId(bounds, plan);

const document = {
  plan_id: planId,
  city: TOWN.cityName,
  name: '高原镇',
  target_population: 10000,
  bounds,
  render: { title: TOWN.title, width: 2200, height: 1400, view: 'surface', format: 'static_html' },
  water_cell_size_m: 24,
  terrain_cell_size_m: 64,
  accounting: {
    ...stats,
    peoplePerHousehold: TOWN.peoplePerHousehold,
    road_length_m: Math.round(roadLength),
    geometry_bbox: { min_x: snap8(Math.min(...xs)), min_z: snap8(Math.min(...zs)), max_x: snap8(Math.max(...xs)), max_z: snap8(Math.max(...zs)) },
  },
  plan,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const rowsText = [
  `街区用途计数: ${Object.entries(stats.counts).map(([code, n]) => `${code}=${n}`).join(' ')}`,
  `住宅街区 ${stats.residentialBlocks} 个（低密 ${stats.counts.L ?? 0} / 中密排屋 ${stats.counts.R ?? 0} / 中密 ${stats.counts.M ?? 0}）`,
  `住宅分区面积 ${(stats.residentialZoneAreaM2 / 1e6).toFixed(2)} km²，城镇网格尺度 ${stats.grid.columns}×${stats.grid.rows} 街区（${(stats.townAreaM2 / 1e6).toFixed(2)} km²）`,
  `规划道路 ${plan.roads.length} 条 / 总长 ${(roadLength / 1000).toFixed(2)} km`,
  `规划建筑 ${plan.buildings.length} 栋，分区多边形 ${plan.zones.length} 个`,
  `户数 ${stats.households} → 人口中位 ${stats.people}（区间 ${stats.peopleRange[0]}–${stats.peopleRange[1]}，按 ${TOWN.peoplePerHouseholdRange.join('–')} 人/户）`,
  `输出: ${path.relative(repoRoot, outputPath)}`,
];
console.log(JSON.stringify({ ok: true, output_path: path.resolve(outputPath), accounting: document.accounting, summary: rowsText }, null, 2));
