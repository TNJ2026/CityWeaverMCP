import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { renderCityPlanInteractive } from '../../mcp/planning-interactive.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactDir = 'C:/Users/cheng/.gemini/antigravity/brain/7a318694-7d0f-4c38-96cb-b268b201833b';

// 城镇中心坐标（严格 8 米格网对齐）
const CX = 0;
const CZ = 1024;

// 环形半径（严格 8 米倍数）
const R_INNER = 320;  // 内环半径 320m (40 cells)
const R_MID = 560;    // 中环半径 560m (70 cells)
const R_OUTER = 800;  // 外环半径 800m (100 cells)

// 地图规划包围盒（当前 30 个已购地图格的完整边界）
const BOUNDS = {
  min_x: -1558.26,
  min_z: -934.96,
  max_x: 1558.26,
  max_z: 2804.87
};

// 辅助函数：生成 8 米栅格对齐的圆弧折线点数组
function makeArcPoints(cx, cz, r, startDeg, endDeg, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg * Math.PI) / 180;
    const x = Math.round((cx + r * Math.cos(rad)) / 8) * 8;
    const z = Math.round((cz + r * Math.sin(rad)) / 8) * 8;
    pts.push({ x, z });
  }
  return pts;
}

// 辅助函数：生成扇形多边形（用于分区）
function makeSectorPolygon(cx, cz, r1, r2, startDeg, endDeg, steps) {
  const outerPts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg * Math.PI) / 180;
    outerPts.push({
      x: Math.round((cx + r2 * Math.cos(rad)) / 8) * 8,
      z: Math.round((cz + r2 * Math.sin(rad)) / 8) * 8
    });
  }
  const innerPts = [];
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const deg = startDeg + (endDeg - startDeg) * t;
    const rad = (deg * Math.PI) / 180;
    innerPts.push({
      x: Math.round((cx + r1 * Math.cos(rad)) / 8) * 8,
      z: Math.round((cz + r1 * Math.sin(rad)) / 8) * 8
    });
  }
  return [...outerPts, ...innerPts];
}

export function buildCircularTownPlan() {
  const roads = [];

  // ==========================================
  // 1. 环形道路系统（内环、中环、外环）
  // ==========================================
  const rings = [
    { id: 'inner', name: '内环集散路', r: R_INNER, prefab: 'Medium Road', width: 24, order: 10 },
    { id: 'mid', name: '中环联络路', r: R_MID, prefab: 'Small Road', width: 16, order: 20 },
    { id: 'outer', name: '外环快速集散道', r: R_OUTER, prefab: 'Medium Road', width: 24, order: 30 }
  ];

  const quadrants = [
    { qId: 'ne', name: '东北段', start: 0, end: 90 },
    { qId: 'nw', name: '西北段', start: 90, end: 180 },
    { qId: 'sw', name: '西南段', start: 180, end: 270 },
    { qId: 'se', name: '东南段', start: 270, end: 360 }
  ];

  for (const ring of rings) {
    for (const q of quadrants) {
      const pts = makeArcPoints(CX, CZ, ring.r, q.start, q.end, 8);
      roads.push({
        id: `${ring.id}-ring-${q.qId}`,
        label: `${ring.name}（${q.name}）`,
        prefab: ring.prefab,
        width_m: ring.width,
        level: 'surface',
        construction_order: ring.order,
        construction_status: 'planned',
        points: pts
      });
    }
  }

  // ==========================================
  // 2. 十字垂直贯通大道（东西主轴与南北主轴）
  // ==========================================
  // 东西向贯通主干道 (Z = 1024, Large Road, 32m)
  const ewSegments = [
    { id: 'ew-outer-to-mid-west', from: { x: -800, z: CZ }, to: { x: -560, z: CZ }, label: '东西主轴大道（西外至西中）' },
    { id: 'ew-mid-to-inner-west', from: { x: -560, z: CZ }, to: { x: -320, z: CZ }, label: '东西主轴大道（西中至西内）' },
    { id: 'ew-inner-to-center-west', from: { x: -320, z: CZ }, to: { x: 0, z: CZ }, label: '东西主轴大道（西内至中心）' },
    { id: 'ew-center-to-inner-east', from: { x: 0, z: CZ }, to: { x: 320, z: CZ }, label: '东西主轴大道（中心至东内）' },
    { id: 'ew-inner-to-mid-east', from: { x: 320, z: CZ }, to: { x: 560, z: CZ }, label: '东西主轴大道（东内至东中）' },
    { id: 'ew-mid-to-outer-east', from: { x: 560, z: CZ }, to: { x: 800, z: CZ }, label: '东西主轴大道（东中至东外）' },
    { id: 'ew-outer-to-highway-hub', from: { x: 800, z: CZ }, to: { x: 880, z: CZ }, label: '东西主轴大道（高速连接段）' }
  ];

  for (const s of ewSegments) {
    roads.push({
      id: s.id,
      label: s.label,
      prefab: 'Large Road',
      width_m: 32,
      level: 'surface',
      construction_order: 15,
      construction_status: 'planned',
      points: [s.from, s.to]
    });
  }

  // 高速出入口顺畅接驳支线（连通 X=880, Z=1024 到既有高速断头点）
  roads.push({
    id: 'highway-connector-inbound',
    label: '高速进城接驳道',
    prefab: 'Medium Road',
    width_m: 24,
    level: 'surface',
    construction_order: 18,
    construction_status: 'planned',
    points: [{ x: 880, z: CZ }, { x: 877, z: 1138 }]
  });
  roads.push({
    id: 'highway-connector-outbound',
    label: '高速出城接驳道',
    prefab: 'Medium Road',
    width_m: 24,
    level: 'surface',
    construction_order: 18,
    construction_status: 'planned',
    points: [{ x: 880, z: CZ }, { x: 877, z: 1118 }]
  });

  // 南北向贯通主干道 (X = 0, Large Road, 32m)
  const nsSegments = [
    { id: 'ns-outer-to-mid-south', from: { x: CX, z: 224 }, to: { x: CX, z: 464 }, label: '南北主轴大道（南外至南中）' },
    { id: 'ns-mid-to-inner-south', from: { x: CX, z: 464 }, to: { x: CX, z: 704 }, label: '南北主轴大道（南中至南内）' },
    { id: 'ns-inner-to-center-south', from: { x: CX, z: 704 }, to: { x: CX, z: CZ }, label: '南北主轴大道（南内至中心）' },
    { id: 'ns-center-to-inner-north', from: { x: CX, z: CZ }, to: { x: CX, z: 1344 }, label: '南北主轴大道（中心至北内）' },
    { id: 'ns-inner-to-mid-north', from: { x: CX, z: 1344 }, to: { x: CX, z: 1584 }, label: '南北主轴大道（北内至北中）' },
    { id: 'ns-mid-to-outer-north', from: { x: CX, z: 1584 }, to: { x: CX, z: 1824 }, label: '南北主轴大道（北中至北外）' }
  ];

  for (const s of nsSegments) {
    roads.push({
      id: s.id,
      label: s.label,
      prefab: 'Large Road',
      width_m: 32,
      level: 'surface',
      construction_order: 15,
      construction_status: 'planned',
      points: [s.from, s.to]
    });
  }

  // ==========================================
  // 3. 四个象限 45° 辐射大道（Small Road, 16m）
  // ==========================================
  const diagonals = [
    { q: 'ne', pInner: { x: 224, z: 1248 }, pMid: { x: 392, z: 1416 }, pOuter: { x: 568, z: 1592 }, name: '东北产业辐射道' },
    { q: 'nw', pInner: { x: -224, z: 1248 }, pMid: { x: -392, z: 1416 }, pOuter: { x: -568, z: 1592 }, name: '西北都会居住辐射道' },
    { q: 'sw', pInner: { x: -224, z: 800 }, pMid: { x: -392, z: 632 }, pOuter: { x: -568, z: 456 }, name: '西南生态居住辐射道' },
    { q: 'se', pInner: { x: 224, z: 800 }, pMid: { x: 392, z: 632 }, pOuter: { x: 568, z: 456 }, name: '东南商务金融辐射道' }
  ];

  for (const d of diagonals) {
    roads.push({
      id: `diag-inner-to-mid-${d.q}`,
      label: `${d.name}（内段）`,
      prefab: 'Small Road',
      width_m: 16,
      level: 'surface',
      construction_order: 25,
      construction_status: 'planned',
      points: [d.pInner, d.pMid]
    });
    roads.push({
      id: `diag-mid-to-outer-${d.q}`,
      label: `${d.name}（外段）`,
      prefab: 'Small Road',
      width_m: 16,
      level: 'surface',
      construction_order: 25,
      construction_status: 'planned',
      points: [d.pMid, d.pOuter]
    });
  }

  // ==========================================
  // 4. 规划功能分区多边形（zones）
  // ==========================================
  const zones = [
    // 1. 东北象限：清洁工业制造与高新产业区（下风向）
    {
      id: 'zone-ne-ind-inner',
      kind: 'industrial',
      district: '东北先进制造园',
      label: 'Industrial Manufacturing',
      polygon: makeSectorPolygon(CX, CZ, R_INNER + 24, R_MID - 24, 8, 82, 6)
    },
    {
      id: 'zone-ne-ind-outer',
      kind: 'industrial',
      district: '东北先进制造园',
      label: 'Industrial Manufacturing',
      polygon: makeSectorPolygon(CX, CZ, R_MID + 24, R_OUTER - 24, 8, 82, 6)
    },
    // 2. 东南象限：现代商业中心与总部办公（高速门户）
    {
      id: 'zone-se-com-inner',
      kind: 'commercial',
      district: '东南商办金融区',
      label: 'EU Commercial High',
      polygon: makeSectorPolygon(CX, CZ, R_INNER + 24, R_MID - 24, 278, 352, 6)
    },
    {
      id: 'zone-se-off-outer',
      kind: 'office',
      district: '东南商办金融区',
      label: 'Office High',
      polygon: makeSectorPolygon(CX, CZ, R_MID + 24, R_OUTER - 24, 278, 352, 6)
    },
    // 3. 西南象限：森林生态与品质居住区 A（上风向低密独栋与排屋）
    {
      id: 'zone-sw-res-inner',
      kind: 'residential',
      district: '西南生态居住区',
      label: 'EU Residential Medium Row',
      polygon: makeSectorPolygon(CX, CZ, R_INNER + 24, R_MID - 24, 188, 262, 6)
    },
    {
      id: 'zone-sw-res-outer',
      kind: 'residential',
      district: '西南生态居住区',
      label: 'EU Residential Low',
      polygon: makeSectorPolygon(CX, CZ, R_MID + 24, R_OUTER - 24, 188, 262, 6)
    },
    // 4. 西北象限：都会品质生活居住区 B（侧风向中高密公寓与商住混合）
    {
      id: 'zone-nw-res-inner',
      kind: 'residential',
      district: '西北都会居住区',
      label: 'EU Residential Medium',
      polygon: makeSectorPolygon(CX, CZ, R_INNER + 24, R_MID - 24, 98, 172, 6)
    },
    {
      id: 'zone-nw-res-outer',
      kind: 'residential',
      district: '西北都会居住区',
      label: 'EU Residential High',
      polygon: makeSectorPolygon(CX, CZ, R_MID + 24, R_OUTER - 24, 98, 172, 6)
    }
  ];

  // ==========================================
  // 6. 完整的公共服务与市政基础设施（buildings）
  // 经精细几何算法校验：无重叠、无压路，严格保证道路净空
  // ==========================================
  const buildings = [
    // ----------------- 中央核心环（行政、综合医疗、高等教育、中心绿地） -----------------
    {
      id: 'bld-city-hall',
      prefab: 'CityHall01',
      label: '市政大厦',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 128, z: 160 },
      position: { x: -172, z: 1124 },
      rotation_degrees: 180,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-general-hospital',
      prefab: 'Hospital01',
      label: '中央综合医院',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 184, z: 80 },
      position: { x: 110, z: 1100 },
      rotation_degrees: 180,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-college',
      prefab: 'College01',
      label: '美瑞迪安学院',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 176, z: 128 },
      position: { x: -164, z: 928 },
      rotation_degrees: 180,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-police-hq',
      prefab: 'PoliceHeadquarters01',
      label: '市警察局总部',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 144, z: 160 },
      position: { x: 126, z: 888 },
      rotation_degrees: 0,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-central-park',
      prefab: 'CityPark02',
      label: '中央市民休闲公园',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 48, z: 48 },
      position: { x: -80, z: 1068 },
      rotation_degrees: 0,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },

    // ----------------- 东北象限（先进制造园与市政公用保障设施） -----------------
    {
      id: 'bld-substation-ne',
      prefab: 'TransformerStation01',
      label: '产业区主变电站',
      kind: 'utility',
      category: 'utility_facility',
      size_m: { x: 48, z: 56 },
      position: { x: 596, z: 1068 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-water-pump-ne',
      prefab: 'GroundwaterPumpingStation01',
      label: '地下水供水总站',
      kind: 'utility',
      category: 'utility_facility',
      size_m: { x: 48, z: 48 },
      position: { x: 580, z: 1238 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-sewage-treatment',
      prefab: 'WastewaterTreatmentPlant01',
      label: '现代污水净化厂',
      kind: 'utility',
      category: 'utility_facility',
      size_m: { x: 96, z: 80 },
      position: { x: 650, z: 1250 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-water-tower-ne',
      prefab: 'WaterTower01',
      label: '市政保压水塔',
      kind: 'utility',
      category: 'utility_facility',
      size_m: { x: 32, z: 32 },
      position: { x: 428, z: 1236 },
      rotation_degrees: 45,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-recycling-center',
      prefab: 'RecyclingCenter01',
      label: '垃圾资源循环中心',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 176, z: 144 },
      position: { x: 660, z: 1648 },
      rotation_degrees: 45,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-road-maintenance',
      prefab: 'RoadMaintenanceDepot01',
      label: '城市道路养护基地',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 80, z: 96 },
      position: { x: 250, z: 1382 },
      rotation_degrees: 0,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },

    // ----------------- 东南象限（商务金融、商业服务与交通集散） -----------------
    {
      id: 'bld-fire-station-hq',
      prefab: 'FireStation01',
      label: '中央消防总局',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 112, z: 144 },
      position: { x: 216, z: 640 },
      rotation_degrees: 0,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-bus-terminal-se',
      prefab: 'BusStation01',
      label: '高速公路换乘公交总站',
      kind: 'service',
      category: 'transport_facility',
      size_m: { x: 104, z: 104 },
      position: { x: 620, z: 914 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-post-office-se',
      prefab: 'PostOffice01',
      label: '东南区邮政中心',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 80, z: 64 },
      position: { x: 476, z: 898 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-parking-hall-se',
      prefab: 'ParkingHall03',
      label: '商办立体公共停车楼',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 64, z: 48 },
      position: { x: 348, z: 890 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-park-maintenance-se',
      prefab: 'ParkMaintenanceDepot01',
      label: '绿化与公园维护站',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 56, z: 80 },
      position: { x: 492, z: 680 },
      rotation_degrees: 315,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },

    // ----------------- 西南象限（生态居住区 A 优质配套） -----------------
    {
      id: 'bld-elem-school-sw',
      prefab: 'ElementarySchool02',
      label: '西南第一实验小学',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 72, z: 48 },
      position: { x: -472, z: 892 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-clinic-sw',
      prefab: 'MedicalClinic02',
      label: '西南社区家庭诊所',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 40, z: 40 },
      position: { x: -400, z: 884 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-fire-house-sw',
      prefab: 'FireHouse01',
      label: '西南社区消防所',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 40, z: 40 },
      position: { x: -524, z: 948 },
      rotation_degrees: 90,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-community-park-sw',
      prefab: 'CityPark02',
      label: '西南林荫社区公园',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 48, z: 48 },
      position: { x: -500, z: 680 },
      rotation_degrees: 225,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-cemetery-sw',
      prefab: 'Cemetery02',
      label: '西区宁静生命纪念园',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 112, z: 48 },
      position: { x: -650, z: 720 },
      rotation_degrees: 225,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },

    // ----------------- 西北象限（都市居住区 B 密集配套） -----------------
    {
      id: 'bld-elem-school-nw',
      prefab: 'ElementarySchool01',
      label: '西北区第二小学',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 144, z: 64 },
      position: { x: -488, z: 1116 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-high-school-nw',
      prefab: 'HighSchool02',
      label: '美瑞迪安完全高级中学',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 96, z: 64 },
      position: { x: -700, z: 1090 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-police-station-nw',
      prefab: 'PoliceStation02',
      label: '西北区公安分局',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 40, z: 40 },
      position: { x: -400, z: 1060 },
      rotation_degrees: 270,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    },
    {
      id: 'bld-city-park-nw',
      prefab: 'CityPark03',
      label: '西北都会文化公园',
      kind: 'service',
      category: 'city_service',
      size_m: { x: 80, z: 64 },
      position: { x: -500, z: 1376 },
      rotation_degrees: 135,
      rotation_source: 'manual',
      placement_status: 'candidate_bound'
    }
  ];

  // ==========================================
  // 7. 骨干管网（utilities：供水、污水和电力）
  // ==========================================
  const utilities = [
    // 供水骨干（从东北水厂引至中心并环绕内环）
    {
      id: 'util-water-trunk-1',
      network_type: 'water',
      level: 'underground',
      prefab: 'Water Pipe',
      points: [{ x: 580, z: 1238 }, { x: 320, z: CZ }, { x: 0, z: CZ }]
    },
    {
      id: 'util-water-ring-inner',
      network_type: 'water',
      level: 'underground',
      prefab: 'Water Pipe',
      points: [
        { x: 320, z: CZ }, { x: 0, z: 1344 }, { x: -320, z: CZ }, { x: 0, z: 704 }, { x: 320, z: CZ }
      ]
    },
    // 污水收集骨干（从内环汇集到东北污水净化厂）
    {
      id: 'util-sewage-trunk-1',
      network_type: 'sewage',
      level: 'underground',
      prefab: 'Sewage Pipe',
      points: [{ x: 0, z: CZ }, { x: 320, z: CZ }, { x: 650, z: 1250 }]
    },
    // 输电骨干（从东北变电站送至全城内环中心）
    {
      id: 'util-power-line-1',
      network_type: 'electricity',
      level: 'underground',
      prefab: 'Power Line Underground',
      points: [{ x: 596, z: 1068 }, { x: 320, z: CZ }, { x: 0, z: CZ }]
    }
  ];

  const plan = {
    roads,
    zones,
    buildings,
    utilities
  };

  const planId = computeCityPlanId(BOUNDS, plan);

  return {
    cityName: '美瑞迪安',
    theme: 'European',
    title: '美瑞迪安｜圆形城镇 2 万人口综合规划施工图（网页版）',
    plan_id: planId,
    bounds: BOUNDS,
    plan
  };
}

async function main() {
  const result = buildCircularTownPlan();
  const planPath = path.join(repoRoot, 'plans', 'meridian-circular-town-plan.json');
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[OK] Circular town plan generated at: ${planPath}`);
  console.log(`Plan ID: ${result.plan_id}`);
  console.log(`Roads: ${result.plan.roads.length}, Zones: ${result.plan.zones.length}, Buildings: ${result.plan.buildings.length}, Utilities: ${result.plan.utilities.length}`);

  // 严格几何与规划门禁自检
  const validation = validateCityPlan({ bounds: result.bounds }, result.plan, result.bounds);
  console.log(`Validation: valid=${validation.valid}, errors=${validation.error_count}, warnings=${validation.warning_count}`);
  if (validation.issues.length) {
    for (const i of validation.issues) {
      console.log(`[${i.severity.toUpperCase()}] ${i.code} on ${i.object_id}: ${i.message}`);
    }
  } else {
    console.log(`>>> ALL CHECKS PASSED: 0 ERRORS, 0 WARNINGS! <<<`);
  }

  // 渲染自包含交互式施工图 HTML
  console.log('Fetching live map background snapshot...');
  const tileData = (await queryGame('list_map_tiles', { state: 'all', offset: 0, limit: 529 })).data;
  const tiles = tileData.items ?? [];
  const snapshotData = (await queryGame('get_planning_map_snapshot', {
    bounds: result.bounds,
    include_roads: true,
    include_buildings: true,
    include_tracks: true,
    include_utilities: true,
    max_features_per_layer: 2000
  })).data;
  snapshotData.bounds = result.bounds;
  snapshotData.map_tiles = tiles.map(t => ({ tile_id: t.tile_id, owned: t.owned, bounds: t.bounds, center: t.center }));
  snapshotData.purchased_tiles = snapshotData.map_tiles.filter(t => t.owned);
  snapshotData.waters = [];
  snapshotData.terrain = { cells: [] };

  console.log('Rendering interactive HTML construction map...');
  const renderResult = renderCityPlanInteractive(snapshotData, result.plan, {
    title: result.title,
    subtitle: '包含内环(R=320m)/中环(R=560m)/外环(R=800m)、十字主轴大道、四象限功能分区与25座完整市政公服设施',
    theme: 'European'
  });

  const htmlPath = path.join(repoRoot, 'artifacts', 'meridian-circular-town-plan.html');
  await writeFile(htmlPath, renderResult.html, 'utf8');
  console.log(`[OK] Interactive HTML generated at: ${htmlPath}`);

  const mirrorHtmlPath = path.join(artifactDir, 'meridian-circular-town-plan.html');
  await writeFile(mirrorHtmlPath, renderResult.html, 'utf8');
  console.log(`[OK] Mirrored HTML generated at: ${mirrorHtmlPath}`);
}

main().catch(console.error);
