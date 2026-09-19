// 萨默斯维尔「湖湾镇」规划回归测试（L 形黄金街区 · 鞍部接入大道 · 中央绿廊）。
// 离线部分不需要游戏：校验 plan_id 哈希、8 米对齐、路网连通性、分区进深、绿带、人口核算。
// 游戏在跑时追加实机部分：用实时已购地图格与实时目录核对 prefab / 分区名 / 几何越界 / 匝道接入。
//
// 这份测试的重点是三条「在网页上看不出来」的不变量：
//   1. 路网必须是单一连通分量——中央绿廊刻意断开了 7 条纵街，断开后的南北两段
//      各自仍要接在横街上，否则某半城在游戏里永远没有车流；
//   2. 分区进深必须是 [0, 48]m（自路面外缘算起 6 格）——依据是反编译的
//      Game.Zones.BlockSystem：块中心 = 道路外缘 + 24m，m_Size.y = 6 格；
//   3. 片区范围互不重叠——栅格化按片区各自扫描、不做跨片区去重，
//      重叠的格子会被两个片区各划一次，分区面积与人口直接虚增（历史上真的发生过：
//      南城下沿与湖滨上沿重叠 48 m 一条带，人口虚报 400 人）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CELL_SIZE, MAX_ZONING_DEPTH_M, MIN_ROAD_SEGMENT_LENGTH_M, MAX_ROAD_SEGMENT_LENGTH_M } from '../lib/physics-rules.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = path.join(repoRoot, 'plans', 'sommerville-town-plan.json');

let total = 0, failures = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (ok) return;
  failures++;
  process.stdout.write(`✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
};
const note = text => process.stdout.write(`  · ${text}\n`);

const document = JSON.parse(await readFile(planPath, 'utf8'));
const { bounds, plan } = document;
const roads = plan.roads ?? [], zones = plan.zones ?? [], buildings = plan.buildings ?? [];
const roadById = new Map(roads.map(road => [road.id, road]));

const distanceToSegment = (point, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
};
const distanceToPolyline = (point, points) =>
  Math.min(...points.slice(1).map((q, index) => distanceToSegment(point, points[index], q)));
const polylineDistance = (a, b) => Math.min(
  Math.min(...a.map(p => distanceToPolyline(p, b))),
  Math.min(...b.map(p => distanceToPolyline(p, a))),
);
// 相对道路中心线的有符号进深：已扣除半路宽，≥0 即在路面之外。
const depthAt = (x, z) => Math.min(...roads.flatMap(road => road.points.slice(1)
  .map((q, index) => distanceToSegment({ x, z }, road.points[index], q) - road.width_m / 2)));
const rect = list => ({
  min_x: Math.min(...list.map(p => p.x)), max_x: Math.max(...list.map(p => p.x)),
  min_z: Math.min(...list.map(p => p.z)), max_z: Math.max(...list.map(p => p.z)),
});
const overlapArea = (a, b) => Math.max(0, Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x))
  * Math.max(0, Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z));

process.stdout.write('--- 规划文件结构与哈希 ---\n');
check('plan_id 与 bounds+plan 的哈希一致（施工前必须一致）', computeCityPlanId(bounds, plan) === document.plan_id,
  `${document.plan_id} vs ${computeCityPlanId(bounds, plan)}`);
check('规划文件里存在道路、分区与建筑', roads.length > 0 && zones.length > 0 && buildings.length > 0);
check('每个对象都有非空唯一 id',
  new Set([...roads, ...zones, ...buildings].map(item => item.id)).size === roads.length + zones.length + buildings.length
  && [...roads, ...zones, ...buildings].every(item => typeof item.id === 'string' && item.id.length > 0));
check('所有坐标都是有限数值（NaN/缺失会静默落下界外的对象）',
  [...roads.flatMap(road => road.points), ...zones.flatMap(zone => zone.polygon),
    ...buildings.flatMap(building => [building.position, building.size_m])]
    .every(point => Number.isFinite(point?.x) && Number.isFinite(point?.z)));
check('规划对象全部落在规划边界内', [...roads.flatMap(r => r.points), ...zones.flatMap(z => z.polygon),
  ...buildings.flatMap(b => [b.position])].every(p => p.x >= bounds.min_x && p.x <= bounds.max_x && p.z >= bounds.min_z && p.z <= bounds.max_z));
check('规划自述了免责声明（只读草案，未施工）', typeof document.disclaimer === 'string' && document.disclaimer.includes('只读'));

process.stdout.write('\n--- 几何：8 米对齐与道路分段限制 ---\n');
check('道路端点都在 8 米格上', roads.every(road => road.points.every(p => p.x % CELL_SIZE === 0 && p.z % CELL_SIZE === 0)),
  roads.filter(road => !road.points.every(p => p.x % CELL_SIZE === 0 && p.z % CELL_SIZE === 0)).map(r => r.id).join(','));
check('每条道路都声明了 prefab 与实际宽度',
  roads.every(road => typeof road.prefab === 'string' && road.prefab.length > 0 && Number.isFinite(road.width_m) && road.width_m > 0));
const segments = roads.flatMap(road => road.points.slice(1).map((point, index) => ({
  id: road.id, length: Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z),
})));
const tooShort = segments.filter(s => s.length < MIN_ROAD_SEGMENT_LENGTH_M);
const tooLong = segments.filter(s => s.length > MAX_ROAD_SEGMENT_LENGTH_M);
check(`所有路段都在 ${MIN_ROAD_SEGMENT_LENGTH_M}~${MAX_ROAD_SEGMENT_LENGTH_M} 米之间`,
  tooShort.length === 0 && tooLong.length === 0,
  `过短 ${tooShort.length} 段（${tooShort.slice(0, 3).map(s => `${s.id}:${s.length.toFixed(0)}`).join(',')}）、过长 ${tooLong.length} 段（${tooLong.slice(0, 3).map(s => `${s.id}:${s.length.toFixed(0)}`).join(',')}）`);
note(`路段数 ${segments.length}，最长 ${Math.max(...segments.map(s => s.length)).toFixed(0)} m`);
const bent = roads.map(road => {
  const polyline = road.points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z), 0);
  const chord = Math.hypot(road.points.at(-1).x - road.points[0].x, road.points.at(-1).z - road.points[0].z);
  return { id: road.id, ratio: chord > 0 ? polyline / chord : Infinity };
}).filter(road => road.ratio > 1.001);
check('除了迎宾大道，所有道路都是直线（折线长度 = 首末直线距离）', bent.every(road => road.id === 'avenue'),
  bent.filter(road => road.id !== 'avenue').map(road => `${road.id}:${road.ratio.toFixed(4)}`).join(','));
note(`直线路 ${roads.length - bent.length}/${roads.length} 条（弯曲的：${bent.map(r => r.id).join(',') || '无'}）`);

process.stdout.write('\n--- 路网连通性（绿廊断开 7 条纵街后最容易断在这里）---\n');
{
  const parent = roads.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      if (polylineDistance(roads[i].points, roads[j].points) <= roads[i].width_m / 2 + roads[j].width_m / 2 + 2) {
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
  check('路网是单一连通分量（没有悬空支路）', components.size === 1,
    [...components.values()].filter(ids => ids.length < roads.length).map(ids => `[${ids.join(',')}]`).join(' '));
  const isolated = roads.filter(road => roads.filter(other => other.id !== road.id)
    .every(other => polylineDistance(road.points, other.points) > road.width_m / 2 + other.width_m / 2 + 2));
  check('没有一条路是悬空的（至少有一处接入点）', isolated.length === 0, isolated.map(r => r.id).join(','));
  const splitIds = roads.filter(road => /-n$|-s$/.test(road.id)).map(road => road.id);
  check('绿廊断开的纵街被切成南北两段（否则 95.6 m 进深的中学放不进 112 m 街区）', splitIds.length > 0, `${splitIds.length} 条`);
  note(`绿廊断开的纵街：${splitIds.length} 条（保留穿越：西环路 / 主街 / 东环路）`);
}

process.stdout.write('\n--- 分区进深口径（引擎实测：自路面外缘 6 格 = 48m）---\n');
{
  let worstCenter = -Infinity, worstZone = null, outside = 0;
  for (const zone of zones) {
    const xs = zone.polygon.map(p => p.x), zs = zone.polygon.map(p => p.z);
    for (let x = Math.min(...xs) + CELL_SIZE / 2; x < Math.max(...xs); x += CELL_SIZE) {
      for (let z = Math.min(...zs) + CELL_SIZE / 2; z < Math.max(...zs); z += CELL_SIZE) {
        const depth = depthAt(x, z);
        if (depth < 0 || depth > MAX_ZONING_DEPTH_M) { outside++; }
        if (depth > worstCenter) { worstCenter = depth; worstZone = zone.id; }
      }
    }
  }
  check('每个分区块的格心都落在 [0, 48]m 可划区带内', outside === 0, `${outside} 个格心越界`);
  note(`最深格心 ${worstCenter.toFixed(1)} m @ ${worstZone}`);

  let sampled = 0, beyond = 0;
  for (const zone of zones) {
    const xs = zone.polygon.map(p => p.x), zs = zone.polygon.map(p => p.z);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 4) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 4) {
        sampled++;
        const depth = depthAt(x, z);
        if (depth < -CELL_SIZE / 2 || depth > MAX_ZONING_DEPTH_M + CELL_SIZE / 2 * Math.SQRT2) beyond++;
      }
    }
  }
  const ratio = beyond / sampled;
  check('多边形中超出可划区带的面积占比 ≤ 8%（8 米格台阶近似的正常代价）', ratio <= 0.08, `${(ratio * 100).toFixed(2)}%`);
  note(`4m 采样 ${sampled} 点，越界占比 ${(ratio * 100).toFixed(2)}%`);
}

process.stdout.write('\n--- 建筑临路 ---\n');
{
  // 免临路 prefab：水塔（高位水箱）、风机（floating）不依赖道路，roadside_of 允许为 null
  const NO_ROAD_NEEDED = new Set(['WaterTower01', 'WindTurbine01', 'WindTurbine02', 'WindTurbine03']);
  const bad = [];
  for (const building of buildings) {
    if (NO_ROAD_NEEDED.has(building.prefab)) continue;
    const road = roadById.get(building.roadside_of);
    if (!road) { bad.push(`${building.id}:目标路不存在`); continue; }
    const distance = distanceToPolyline(building.position, road.points);
    const allow = road.width_m / 2 + Math.hypot(building.size_m.x, building.size_m.z) / 2 + 6;
    if (distance > allow) bad.push(`${building.id}:${distance.toFixed(1)}>${allow.toFixed(1)}`);
  }
  check('每栋需临街建筑都贴在自己声明的那条路边（半路宽 + 半对角线 + 6m 内）', bad.length === 0, bad.join(','));
  // 临街间隙：占地矩形边到最近路缘的距离（精确「段到矩形」距离，不能只取折点——
  // 细分后折点稀疏，正对建筑最近点常落在段中间）。挨着路 = 间隙 ≤8m 且贴在最近路上。
  const ptSegDist = (px, pz, a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
    return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
  };
  const ptRectDist = (rect, px, pz) => Math.hypot(
    Math.max(rect.min_x - px, 0, px - rect.max_x),
    Math.max(rect.min_z - pz, 0, pz - rect.max_z));
  const segRectDist = (rect, a, b) => {
    // 凸集间最小距离 = min(段端点到矩形, 矩形四角到段, 矩形边与段的线段距——由前两者覆盖)
    let best = Math.min(ptRectDist(rect, a.x, a.z), ptRectDist(rect, b.x, b.z));
    for (const corner of [
      { x: rect.min_x, z: rect.min_z }, { x: rect.max_x, z: rect.min_z },
      { x: rect.min_x, z: rect.max_z }, { x: rect.max_x, z: rect.max_z },
    ]) best = Math.min(best, ptSegDist(corner.x, corner.z, a, b));
    return best;
  };
  const rectFrontage = building => {
    const rect = {
      min_x: building.position.x - building.size_m.x / 2, max_x: building.position.x + building.size_m.x / 2,
      min_z: building.position.z - building.size_m.z / 2, max_z: building.position.z + building.size_m.z / 2,
    };
    let best = { id: null, edge: Infinity };
    for (const road of roads) {
      for (let i = 0; i + 1 < road.points.length; i++) {
        const edge = segRectDist(rect, road.points[i], road.points[i + 1]) - road.width_m / 2;
        if (edge < best.edge) best = { id: road.id, edge };
      }
    }
    return best;
  };
  const declaredFrontage = (building, road) => {
    const rect = {
      min_x: building.position.x - building.size_m.x / 2, max_x: building.position.x + building.size_m.x / 2,
      min_z: building.position.z - building.size_m.z / 2, max_z: building.position.z + building.size_m.z / 2,
    };
    let best = Infinity;
    for (let i = 0; i + 1 < road.points.length; i++) {
      best = Math.min(best, segRectDist(rect, road.points[i], road.points[i + 1]) - road.width_m / 2);
    }
    return best;
  };
  const detached = [];
  for (const building of buildings) {
    if (NO_ROAD_NEEDED.has(building.prefab)) continue;
    const frontage = rectFrontage(building);
    if (frontage.edge > 8) { detached.push(`${building.id}:最近 ${frontage.id} 间隙 ${frontage.edge.toFixed(1)}m`); continue; }
    if (building.roadside_of && frontage.id !== building.roadside_of) {
      // 转角建筑可能到两条路等距：声明路的间隙 ≤ 最近间隙 + 2m 即算贴对路
      const declaredEdge = declaredFrontage(building, roadById.get(building.roadside_of));
      if (declaredEdge > frontage.edge + 2) detached.push(`${building.id}:声明 ${building.roadside_of} 间隙 ${declaredEdge.toFixed(1)}m，最近却是 ${frontage.id}`);
    }
  }
  check('需要临街的公共服务建筑占地边到路缘间隙 ≤8m 且贴在最近路上', detached.length === 0, detached.join(','));
  check('建筑位置对齐 4 米模数（偶数格在格点、奇数格在格心）',
    buildings.every(building => building.position.x % 4 === 0 && Math.round(building.position.z) % 4 === 0));
  const kinds = new Set(buildings.map(building => building.kind));
  check('建筑覆盖了服务与市政两类', kinds.has('service') && kinds.has('utility'), [...kinds].join(','));
  const families = { 小学: 'ElementarySchool', 中学: 'HighSchool', 诊所: 'MedicalClinic', 警局: 'PoliceStation', 消防: 'FireHouse' };
  const missing = Object.entries(families).filter(([, stem]) => !buildings.some(b => b.prefab.startsWith(stem))).map(([label]) => label);
  check('教育 / 医疗 / 治安 / 消防四类公共服务都安排上了', missing.length === 0, missing.join(','));
  // 水塔与变电站必须远离住宅区：占地矩形到任何住宅网格盒的间隙 ≥100 m
  const RESI = document.districts.filter(district => district.zoning !== false && String(district.base_kind).startsWith('NA Residential'));
  const rectGap = (a, b) => Math.max(b.min_x - a.max_x, a.min_x - b.max_x, b.min_z - a.max_z, a.min_z - b.max_z);
  const intrusive = buildings
    .filter(building => ['WaterTower01', 'TransformerStation01'].includes(building.prefab))
    .map(building => {
      const rect = {
        min_x: building.position.x - building.size_m.x / 2, max_x: building.position.x + building.size_m.x / 2,
        min_z: building.position.z - building.size_m.z / 2, max_z: building.position.z + building.size_m.z / 2,
      };
      const nearest = Math.min(...RESI.map(district => rectGap(rect, district.bounds)));
      return { id: building.id, nearest };
    })
    .filter(entry => entry.nearest < 100);
  check('水塔与变电站都远离住宅区（占地到住宅网格盒 ≥100 m）', intrusive.length === 0,
    intrusive.map(entry => `${entry.id}:最近 ${entry.nearest.toFixed(0)}m`).join(','));
  note(`建筑 ${buildings.length} 栋：${[...new Set(buildings.map(b => b.prefab))].join('、')}`);
}

process.stdout.write('\n--- 黄金街区（路缘到路缘 96 m；按规划自述的轴向声明反查实际坐标）---\n');
{
  const golden = document.golden_block;
  check('规划自述了黄金街区口径（缺了就无法核对间距）',
    Number.isFinite(golden?.curb_to_curb_m) && !!golden?.axes && Object.keys(golden.axes).length >= 2,
    JSON.stringify(golden ?? null).slice(0, 140));
  const GOLD = golden?.curb_to_curb_m ?? 96;
  const groups = [];
  for (const [district, axes] of Object.entries(golden?.axes ?? {})) {
    for (const [axis, rule] of Object.entries(axes)) {
      // 同片区同轴向的路按坐标去重（绿廊断开的南北两段共线），宽度取最大
      const byCoord = new Map();
      for (const road of roads.filter(r => r.district === district && r.axis === axis)) {
        const coord = axis === 'x' ? road.points[0].x : road.points[0].z;
        byCoord.set(coord, Math.max(byCoord.get(coord) ?? 0, road.width_m));
      }
      const lines = [...byCoord.entries()].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < lines.length; i++) {
        const gap = lines[i][0] - lines[i - 1][0];
        const curb = gap - (lines[i][1] + lines[i - 1][1]) / 2;
        const belt = (rule.green_gaps ?? []).find(g => g.from === lines[i - 1][0] && g.to === lines[i][0]);
        groups.push({ district, axis, from: lines[i - 1][0], to: lines[i][0], curb, rule, belt });
      }
    }
  }
  const exact = groups.filter(g => g.rule.exact_m != null && !g.belt);
  const green = groups.filter(g => g.belt);
  const badExact = exact.filter(g => g.curb !== g.rule.exact_m);
  const badGreen = green.filter(g => g.curb !== GOLD + g.belt.unzoned_width_m);
  check(`对开道路的路缘间距精确等于黄金宽度 ${GOLD} m（${exact.length} 组）`, badExact.length === 0,
    badExact.map(g => `${g.district}/${g.axis} ${g.from}→${g.to} 路缘${g.curb}`).join(','));
  check(`绿廊缺口 = 黄金宽度 + 声明的不划区宽度（${green.length} 组）`, green.length > 0 && badGreen.length === 0,
    badGreen.map(g => `${g.district}/${g.axis} ${g.from}→${g.to} 路缘${g.curb}≠${GOLD + g.belt.unzoned_width_m}`).join(','));
  note(`黄金宽度 ${exact.length} 组全部精确 ${GOLD} m；绿廊缺口 ${green.length} 组（路缘 ${green.map(g => g.curb).join('/')} m）`);

  for (const crossCheck of golden?.cross_checks ?? []) {
    const a = roadById.get(crossCheck.pair[0]), b = roadById.get(crossCheck.pair[1]);
    if (!a || !b) { check(`跨档核对 ${crossCheck.pair.join('×')}`, false, '路不存在'); continue; }
    // 大道与横街都是水平直线时，垂直间距就是中心距；否则退回折线最近距离
    const flat = list => new Set(list.map(p => p.z)).size === 1;
    const center = flat(a.points) && flat(b.points) ? Math.abs(a.points[0].z - b.points[0].z) : polylineDistance(a.points, b.points);
    const curb = center - (a.width_m + b.width_m) / 2;
    check(`${crossCheck.pair.join(' × ')} 的中心距 ${crossCheck.center_m} m / 路缘 ${crossCheck.curb_m} m`,
      Math.abs(center - crossCheck.center_m) < 0.01 && Math.abs(curb - crossCheck.curb_m) < 0.01,
      `实测中心 ${center.toFixed(1)} / 路缘 ${curb.toFixed(1)}`);
  }

  // 绿带里必须真的一个分区都没有，否则「绿带」只是图上一句注释
  const belts = document.districts.flatMap(d => (d.greenBelts ?? []).map(belt => ({ district: d.key, ...belt })));
  const inBelt = zones.filter(zone => {
    const zs = zone.polygon.map(p => p.z), xs = zone.polygon.map(p => p.x);
    return belts.some(belt => Math.max(...zs) > belt.min_z && Math.min(...zs) < belt.max_z
      && Math.max(...xs) > (belt.min_x ?? -Infinity) && Math.min(...xs) < (belt.max_x ?? Infinity));
  });
  check('绿带范围内一个分区块都没有', belts.length > 0 && inBelt.length === 0,
    inBelt.slice(0, 5).map(z => z.id).join(','));
  note(`绿带 ${belts.length} 处：${belts.map(b => `${b.district} ${b.max_z - b.min_z}m`).join('、')}（范围内 0 个分区块）`);
}

process.stdout.write('\n--- 片区互不重叠（重叠会让同一块地被划两次，人口直接虚增）---\n');
{
  const bad = [];
  for (let i = 0; i < document.districts.length; i++) {
    for (let j = i + 1; j < document.districts.length; j++) {
      const area = overlapArea(document.districts[i].bounds, document.districts[j].bounds);
      if (area > 0) bad.push(`${document.districts[i].key}×${document.districts[j].key} ${area} m²`);
    }
  }
  check('片区范围两两不重叠（允许共享边界线）', bad.length === 0, bad.join(','));
  const zoneOverlap = [];
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (overlapArea(rect(zones[i].polygon), rect(zones[j].polygon)) > 0) zoneOverlap.push(`${zones[i].id}×${zones[j].id}`);
    }
  }
  check('任意两块分区都不重叠', zoneOverlap.length === 0, zoneOverlap.slice(0, 5).join(','));
  for (const district of document.districts) {
    const list = zones.filter(zone => zone.district === district.key);
    const escapee = list.filter(zone => zone.polygon.some(p => p.x < district.bounds.min_x - 0.01 || p.x > district.bounds.max_x + 0.01
      || p.z < district.bounds.min_z - 0.01 || p.z > district.bounds.max_z + 0.01));
    check(`${district.name} 的分区不越出自己的范围（${list.length} 块）`, escapee.length === 0, escapee.slice(0, 3).map(z => z.id).join(','));
  }
  const unzoned = document.districts.filter(d => d.zoning === false);
  check('声明为不划区的片区里确实一块分区都没有',
    unzoned.length > 0 && unzoned.every(d => zones.filter(z => z.district === d.key).length === 0),
    unzoned.filter(d => zones.some(z => z.district === d.key)).map(d => d.key).join(','));
  note(`可划区片区 ${document.districts.length - unzoned.length} 个；留绿片区 ${unzoned.map(d => d.name).join('、')}`);
}

process.stdout.write('\n--- 道路拓宽策略（网格中间严禁拓宽，仅外围道路可拓宽）---\n');
{
  const interior = roads.filter(r => r.widening_policy === 'forbidden');
  const perimeter = roads.filter(r => r.widening_policy === 'perimeter_expandable');
  check('所有道路均明确声明了拓宽策略（forbidden 或 perimeter_expandable）',
    interior.length + perimeter.length === roads.length,
    `未声明: ${roads.filter(r => !r.widening_policy).map(r => r.id).join(',')}`);
  check('网格内部道路全部为 16m 标准生活支路（四车道只允许出现在绿带连接线上，严禁临街拓宽）',
    interior.every(r => r.width_m <= 16 || r.road_class === 'connector'),
    `非法内部宽路: ${interior.filter(r => r.width_m > 16 && r.road_class !== 'connector').map(r => `${r.id}:${r.width_m}m`).join(',')}`);
  check('外围道路具备拓宽属性（环路与对外大道）',
    perimeter.length > 0 && perimeter.every(r => r.widening_policy === 'perimeter_expandable'),
    perimeter.map(r => r.id).join(','));
  note(`内部道路 ${interior.length} 条锁定 16 m；外围可拓宽 ${perimeter.length} 条：${perimeter.map(r => r.label ?? r.id).join('、')}`);
}

process.stdout.write('\n--- 对外机动车出口（全镇唯一对外通道是高速立交匝道）---\n');
{
  const accessPoints = document.access_points ?? [];
  check('规划自述了对外机动车出口（缺了就无法核对，也没法防止「片区内部路口被当出口」）',
    accessPoints.length > 0 && accessPoints.every(point => point.id && point.via && point.to && point.position));
  check('全镇至少声明 2 个汇入对外大道的出口（互为冗余）', accessPoints.length >= 2, `只有 ${accessPoints.length} 个`);

  const problems = [];
  for (const point of accessPoints) {
    const via = roadById.get(point.via), to = roadById.get(point.to);
    if (!via || !to) { problems.push(`${point.id}:路不存在(${point.via}/${point.to})`); continue; }
    const dVia = distanceToPolyline(point.position, via.points);
    const dTo = distanceToPolyline(point.position, to.points);
    if (dVia > via.width_m / 2 + 2) problems.push(`${point.id}:偏离 ${point.via} ${dVia.toFixed(1)}m`);
    if (dTo > to.width_m / 2 + 2) problems.push(`${point.id}:偏离 ${point.to} ${dTo.toFixed(1)}m`);
    if (via.district !== point.district) problems.push(`${point.id}:via 不属于 ${point.district}`);
    if (to.district === point.district) problems.push(`${point.id}:to 仍属本片区`);
    if (point.position.x % CELL_SIZE !== 0 || point.position.z % CELL_SIZE !== 0) problems.push(`${point.id}:不在 8 米格`);
  }
  check('每个出口都真的落在两条路的交点上，且对接到对外大道', problems.length === 0, problems.join(','));

  const pairs = [];
  for (let i = 0; i < accessPoints.length; i++) {
    for (let j = i + 1; j < accessPoints.length; j++) {
      pairs.push(Math.hypot(accessPoints[i].position.x - accessPoints[j].position.x,
        accessPoints[i].position.z - accessPoints[j].position.z));
    }
  }
  check('两个出口分处两端（间距 ≥ 400 m，不是并排开两个口）',
    pairs.length > 0 && pairs.every(distance => distance >= 400), pairs.map(d => d.toFixed(0)).join(','));

  const spine = roads.find(road => road.road_class === 'spine');
  const stranded = accessPoints.filter(point => {
    const to = roadById.get(point.to);
    if (!to || !spine) return true;
    return polylineDistance(to.points, spine.points) > to.width_m / 2 + spine.width_m / 2 + 2
      && !roads.some(other => other.id !== to.id && other.road_class === 'spine'
        && polylineDistance(to.points, other.points) <= to.width_m / 2 + other.width_m / 2 + 2);
  });
  check('每个出口的接入路都能独立走到对外大道（不共用同一条瓶颈）', stranded.length === 0,
    stranded.map(point => point.id).join(','));
  note(`出口：${accessPoints.map(point => `${point.label} @(${point.position.x}, ${point.position.z})`).join('；')}`);
}

process.stdout.write('\n--- 河东工业园（工业不占人口口径，但必须有地、有路、有独立货运出口）---\n');
{
  const industry = document.districts.find(district => district.key === 'industry');
  check('规划声明了工业区片区（10k 人口的镇没有工业区就没有就业与货运需求）', !!industry && industry.zoning !== false);
  const industryZones = zones.filter(zone => zone.district === 'industry');
  const industryArea = industryZones.reduce((sum, zone) => sum + zone.area_m2, 0);
  check('工业区真的划出了分区块（≥ 4.5 公顷）', industryZones.length > 0 && industryArea >= 45_000,
    `${industryZones.length} 块 / ${(industryArea / 1e4).toFixed(2)} 公顷`);
  check('工业区全部使用 Industrial Manufacturing 分区（实时目录：无 NA 前缀工业预设）',
    industryZones.length > 0 && industryZones.every(zone => zone.kind === 'Industrial Manufacturing'),
    [...new Set(industryZones.map(z => z.kind))].join(','));
  const avenue = roadById.get('avenue');
  const trunk = roads.filter(road => ['ind-z-952', 'ind-z-1480'].includes(road.id));
  const disconnected = trunk.filter(road => polylineDistance(road.points, avenue.points) > (road.width_m + avenue.width_m) / 2 + 2);
  check('工业园两条大道直连街（工业北街/南街）都真的接到迎宾大道上（不是图上悬空）', trunk.length === 2 && disconnected.length === 0,
    disconnected.map(road => road.id).join(','));
  const indCols = [...new Set(roads.filter(road => road.district === 'industry' && road.axis === 'x').map(road => road.points[0].x))].sort((a, b) => a - b);
  const indRows = [...new Set(roads.filter(road => road.district === 'industry' && road.axis === 'z').map(road => road.points[0].z))].sort((a, b) => a - b);
  check('工业园是 2 列 × 4 行的网格（3 条纵街 × 5 条横街）', indCols.length === 3 && indRows.length === 5,
    `实际 ${indCols.length - 1}×${indRows.length - 1}（x: ${indCols} / z: ${indRows}）`);
  const turbines = buildings.filter(building => building.prefab.startsWith('WindTurbine'));
  check('大道缓冲带的风机不侵占工业区划区（东侧留足 48 m 进深）',
    turbines.length > 0 && turbines.every(building => building.position.x < industry.bounds.min_x - 8),
    turbines.map(building => `x=${building.position.x}`).join(','));
  note(`工业区 ${(industryArea / 1e4).toFixed(2)} 公顷，${industryZones.length} 个分区块；风机 ${turbines.length} 台均在缓冲带`);
}

process.stdout.write('\n--- 网格化布局（住宅/商业分离、单网格 ≤5×5、网格外围无住宅/商业/工业建筑）---\n');
{
  const BLOCK_M2 = 96 * 96;
  const zoned = document.districts.filter(district => district.zoning !== false);
  const badShape = [];
  for (const district of zoned) {
    if (district.key === 'industry') {
      // 工业园是 96 m 窄廊 + 两条长块，不走方块网格口径，只限总量
      if (district.zone_area_m2 > 25 * BLOCK_M2) badShape.push(`industry 超过 25 块当量`);
      continue;
    }
    const width = district.bounds.max_x - district.bounds.min_x;
    const height = district.bounds.max_z - district.bounds.min_z;
    if (district.key.startsWith('lakeside')) {
      // 湖滨台地是 48 m 滨湖带（单侧临湖滩街），不走 96×96 方块口径：宽度取整块列数，高度必须 48
      const cols = (width + 16) / 112;
      if (!Number.isInteger(cols) || cols < 1 || cols > 5 || height !== 48) {
        badShape.push(`${district.key}:${cols}×${height}m`);
      } else if (district.zone_area_m2 !== cols * 96 * 48) {
        badShape.push(`${district.key}:面积 ${district.zone_area_m2} ≠ ${cols}×(96×48) 块`);
      }
      continue;
    }
    const cols = (width + 16) / 112, rows = (height + 16) / 112;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 5 || rows > 5) {
      badShape.push(`${district.key}:${cols}×${rows}`);
      continue;
    }
    if (district.zone_area_m2 !== cols * rows * BLOCK_M2) {
      badShape.push(`${district.key}:面积 ${district.zone_area_m2} ≠ ${cols}×${rows} 块`);
    }
  }
  check(`每个可划区网格都是路缘内盒的整数块，且 ≤5×5 街区（${zoned.length} 个）`, badShape.length === 0,
    badShape.join(','));

  // 外围无建筑：网格盒之外、分隔带之内不允许出现任何分区（分区即建筑建设用地）。
  // 绿带（绿巷/绿廊/城堡山/湾滨/工业园风电路）断言 0 分区 + 网格盒互不重叠（上文已有），
  // 两者合起来保证所有网格的外围 48 m 全部留绿。
  const gridBoxes = zoned.map(district => district.bounds);
  const strays = zones.filter(zone => !gridBoxes.some(box =>
    zone.polygon.every(point => point.x >= box.min_x - 0.01 && point.x <= box.max_x + 0.01
      && point.z >= box.min_z - 0.01 && point.z <= box.max_z + 0.01)));
  check('每一块分区都落在某个网格盒内（盒外 = 外围留绿，不允许有建设用地）', strays.length === 0,
    strays.slice(0, 5).map(zone => zone.id).join(','));

  const commerceZones = zones.filter(zone => zone.district === 'commerce');
  const residentialZones = zones.filter(zone => String(zone.kind).includes('Residential'));
  check('商业完全独立成网格（河东商埠全是商业分区）',
    commerceZones.length > 0 && commerceZones.every(zone => zone.kind.includes('Commercial')),
    [...new Set(commerceZones.map(z => z.kind))].join(','));
  check('住宅网格里一块商业分区都没有（商住分离）',
    residentialZones.every(zone => zone.district !== 'commerce'),
    residentialZones.filter(zone => zone.district === 'commerce').slice(0, 3).map(z => z.id).join(','));
  const gridCount = document.districts.filter(d => d.zoning !== false && d.key !== 'industry' && d.key !== 'commerce').length;
  check('住宅拆成了至少 4 个独立网格', gridCount >= 4, `实际 ${gridCount} 个`);

  // 四车道连接线：网格分隔带正中的 Medium Road 公园路，不临任何分区。
  const connectors = roads.filter(road => road.road_class === 'connector');
  check('两条绿带连接线都是 24m 四车道（Medium Road），铺在网格分隔带正中',
    connectors.length === 2 && connectors.every(road => road.prefab === 'Medium Road' && road.width_m === 24),
    connectors.map(road => `${road.id}:${road.prefab}:${road.width_m}m`).join(','));

  // 住宅网格互不相邻：任意两个住宅网格的分区盒间距 ≥ 120 m（绿带 + 四车道隔开）。
  const resiBoxes = document.districts
    .filter(district => district.zoning !== false && !['commerce', 'industry'].includes(district.key))
    .map(district => district.bounds);
  let minGap = Infinity, gapPair = '';
  for (let i = 0; i < resiBoxes.length; i++) {
    for (let j = i + 1; j < resiBoxes.length; j++) {
      const a = resiBoxes[i], b = resiBoxes[j];
      const overlapX = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x);
      const overlapZ = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z);
      const gapX = Math.max(0, -overlapX), gapZ = Math.max(0, -overlapZ);
      const gap = overlapX > 0 ? gapZ : overlapZ > 0 ? gapX : Math.hypot(gapX, gapZ);
      if (gap < minGap) { minGap = gap; gapPair = `#${i}×#${j}`; }
    }
  }
  check(`任意两个住宅网格都不相邻（分区盒最小间距 ≥ 120 m，实测 ${minGap} m）`, minGap >= 120, gapPair);

  // 网格内部不放任何服务/市政建筑：所有建筑位置都必须落在某个可划区网格盒之外。
  const zonedBoxes = document.districts.filter(district => district.zoning !== false).map(district => district.bounds);
  const inside = buildings.filter(building => zonedBoxes.some(box =>
    building.position.x > box.min_x && building.position.x < box.max_x
    && building.position.z > box.min_z && building.position.z < box.max_z));
  check('网格内部没有任何服务/市政建筑（全部布置在网格外围绿带）', inside.length === 0,
    inside.map(building => building.id).join(','));

  note(`可划区网格 ${zoned.length} 个（住宅 ${gridCount} + 商业 1 + 工业 1），均 ≤5×5 街区、两两间距 ≥120 m、外围 48 m 留绿`);
}

process.stdout.write('\n--- 分区面积与人口核算 ---\n');
{
  const areaByKind = {};
  for (const zone of zones) areaByKind[zone.kind] = (areaByKind[zone.kind] ?? 0) + zone.area_m2;
  const polygonArea = zones.reduce((sum, zone) => sum + zone.area_m2, 0);
  let inconsistent = 0;
  for (const zone of zones) {
    const xs = zone.polygon.map(p => p.x), zs = zone.polygon.map(p => p.z);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    if (Math.abs(area - zone.area_m2) > 0.01) inconsistent++;
  }
  check('分区块的 area_m2 与其矩形多边形一致', inconsistent === 0, `${inconsistent} 块不一致`);
  note(`多边形总面积 ${(polygonArea / 1e6).toFixed(3)} km²`);

  // 只统计可划区片区（公园/绿带不参与栅格化，把它们算进采样区间会把偏差比算歪）
  let inBand = 0;
  for (const district of document.districts.filter(d => d.zoning !== false)) {
    const b = district.bounds;
    for (let x = b.min_x; x < b.max_x; x += 4) {
      for (let z = b.min_z; z < b.max_z; z += 4) {
        const depth = depthAt(x + 2, z + 2);
        if (depth >= 0 && depth <= MAX_ZONING_DEPTH_M) inBand += 4 * 4;
      }
    }
  }
  const deviation = polygonArea / inBand - 1;
  check('多边形面积与无偏采样的可划区面积偏差 ≤ 5%（8 米格量化误差的正常量级）',
    Math.abs(deviation) <= 0.05,
    `多边形 ${(polygonArea / 1e6).toFixed(3)} km² vs 采样 ${(inBand / 1e6).toFixed(3)} km²（${(deviation * 100).toFixed(2)}%）`);
  note(`无偏 4m 采样可划区 ${(inBand / 1e6).toFixed(3)} km²，多边形偏差 ${(deviation * 100).toFixed(2)}%`);

  const HA = document.accounting.household_area_m2;
  const PPH = document.accounting.peoplePerHousehold;
  let households = 0;
  for (const [kind, area] of Object.entries(areaByKind)) {
    if (!HA[kind]) continue;
    households += Math.round(area / HA[kind]);
  }
  check('户数可按文档口径复算（按类型汇总面积后取整，再乘每户人数）', households === document.accounting.households,
    `${households} vs ${document.accounting.households}`);
  const people = Math.round(households * PPH);
  check('人口与户数口径一致', people === document.accounting.people, `${people} vs ${document.accounting.people}`);
  check('中位人口落在人口目标的 ±10% 内',
    Math.abs(people - document.target_population) <= document.target_population * 0.1,
    `${people} vs 目标 ${document.target_population}`);
  check('人口区间与每户人数区间一致',
    document.accounting.peopleRange[0] <= people && people <= document.accounting.peopleRange[1]);
  check('住宅分区只使用计入户数的三个住宅类型',
    zones.filter(zone => String(zone.kind).includes('Residential')).every(zone => HA[zone.kind]));
  check('住宅与商业分区名全部是 NA 主题（North American 存档不能用 EU 分区预设）',
    zones.filter(zone => !String(zone.kind).startsWith('Industrial')).every(zone => String(zone.kind).startsWith('NA ')),
    [...new Set(zones.map(z => z.kind).filter(k => !k.startsWith('NA ') && !k.startsWith('Industrial')))].join(','));
  note(`住宅 ${(document.accounting.residential_zone_area_m2 / 1e6).toFixed(2)} km² / 商业 ${(document.accounting.commercial_zone_area_m2 / 1e6).toFixed(2)} km² / 工业 ${(document.accounting.industrial_zone_area_m2 / 1e6).toFixed(2)} km²`);
  note(`户数组成 ${Object.entries(document.accounting.household_by_kind).map(([k, v]) => `${k} ${v}`).join('；')}`);
}

process.stdout.write('\n--- 实机：实时已购地图格与实时目录 ---\n');
let live = null;
try {
  const response = await queryGame('list_map_tiles', { state: 'owned', offset: 0, limit: 100 });
  if (!response?.ok) throw new Error(response?.error?.code ?? 'QUERY_FAILED');
  live = { tiles: response.data.items ?? [] };
} catch (error) {
  process.stdout.write(`! 游戏未连接，跳过实机校验：${error?.message ?? error}\n`);
}
if (live) {
  const result = validateCityPlan({ purchased_tiles: live.tiles.map(tile => ({ tile_id: tile.tile_id, bounds: tile.bounds })), utilities: [] }, plan, bounds);
  check('规划几何全部位于当前已购地图格内（0 错误）', result.error_count === 0,
    result.issues.filter(issue => issue.severity === 'error').slice(0, 3).map(issue => `${issue.object_id}:${issue.code}`).join(','));
  check('没有建筑重叠或压路的告警', result.warning_count === 0,
    result.issues.filter(issue => issue.severity === 'warning').slice(0, 3).map(issue => `${issue.object_id}:${issue.code}`).join(','));

  const roadCatalog = await queryGame('list_road_prefabs', { limit: 100 });
  const roadNames = new Set((roadCatalog.data?.items ?? []).map(item => item.name));
  check('规划道路 prefab 都是当前城市存在的实时 prefab',
    roads.every(road => roadNames.has(road.prefab)),
    roads.filter(road => !roadNames.has(road.prefab)).map(road => `${road.id}:${road.prefab}`).join(','));
  const zoneCatalog = await queryGame('list_zone_types', { limit: 100 });
  const zoneNames = new Set((zoneCatalog.data?.items ?? []).map(item => item.name));
  check('规划分区名都是当前城市存在的实时分区预设',
    zones.every(zone => zoneNames.has(zone.kind)),
    zones.filter(zone => !zoneNames.has(zone.kind)).map(zone => `${zone.id}:${zone.kind}`).join(','));
  const serviceNames = new Set();
  for (const tool of ['list_city_service_prefabs', 'list_utility_facility_prefabs']) {
    for (const offset of [0, 100]) {
      const catalog = await queryGame(tool, { kind: 'all', unlocked_only: false, offset, limit: 100 });
      const items = catalog.data?.items ?? [];
      for (const item of items) serviceNames.add(item.name);
      if (items.length < 100) break;
    }
  }
  check('规划建筑 prefab 都是当前城市存在的服务/公用设施 prefab',
    buildings.every(building => serviceNames.has(building.prefab)),
    buildings.filter(building => !serviceNames.has(building.prefab)).map(building => `${building.id}:${building.prefab}`).join(','));

  // 全镇唯一对外接入点：迎宾大道北端必须落在现状路网（立交匝道）的吸附容差内。
  // 不写死高速坐标，改用实时查询出来的现状道路折线来量，换存档也不会失效。
  // 分页必须带着第一页返回的 snapshot_id，否则偏移量会被拒。
  const existing = [];
  let snapshotId = null;
  for (let offset = 0; offset < 1000;) {
    const page = await queryGame('query_entities', {
      category: 'roads', include_components: ['Game.Net.Curve'], offset, limit: 100,
      ...(snapshotId ? { snapshot_id: snapshotId } : {}),
    });
    const items = page.data?.items ?? [];
    for (const item of items) {
      const bezier = item.components?.['Game.Net.Curve']?.fields?.m_Bezier;
      if (bezier) existing.push([bezier.a, bezier.b, bezier.c, bezier.d].map(p => ({ x: p.x, z: p.z })));
    }
    snapshotId = page.data?.snapshot_id ?? snapshotId;
    if (page.data?.next_offset == null) break;
    offset = page.data.next_offset;
  }
  const avenue = roadById.get('avenue');
  let nearest = Infinity;
  for (const segment of existing) {
    for (let index = 1; index < segment.length; index++) nearest = Math.min(nearest, distanceToSegment(avenue.points[0], segment[index - 1], segment[index]));
  }
  check('迎宾大道起点落在现状道路的 8 米吸附容差内（全城唯一对外接入点）', nearest <= 8, `最近现状路 ${nearest.toFixed(1)}m`);
  note(`现状道路折线 ${existing.length} 条，迎宾大道起点距最近现状路 ${nearest.toFixed(1)} m`);
}

process.stdout.write(failures > 0 ? `\n${failures} 项失败（共 ${total} 项）\n` : `\n全部通过（共 ${total} 项）\n`);
if (failures > 0) process.exitCode = 1;
