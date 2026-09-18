// 埃格林「三区规划」回归测试（西丘住宅 · 路口商业 · 油场工业）。
// 离线部分不需要游戏：校验 plan_id 哈希、8 米对齐、路网连通性、分区进深口径、人口核算。
// 游戏在跑时追加实机部分：用实时已购地图格与实时目录核对 prefab / 分区名 / 几何越界。
//
// 这份测试的重点是两条「图上看不出来」的不变量：
//   1. 路网必须是单一连通分量——任何一条路若两端都没落到别的路上，
//      整条路看着接上了，实际谁都不连，那片分区在游戏里永远没有车流。
//      历史上住宅支路是正弦扰动的曲线，端点会与环路错开十几米，正是这条抓住的；
//      现在支路已全部改为直线（端点直接落在标称坐标上），这条检查仍拦得住新加的手滑路。
//   2. 分区进深必须是 [0, 48]m（自路面外缘算起 6 格）——依据是反编译的
//      Game.Zones.BlockSystem：块中心 = 道路外缘 + 24m，m_Size.y = 6 格。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CELL_SIZE, MAX_ZONING_DEPTH_M, MIN_ROAD_SEGMENT_LENGTH_M, MAX_ROAD_SEGMENT_LENGTH_M } from '../lib/physics-rules.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = path.join(repoRoot, 'plans', 'egelin-region-plan.json');

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
check('所有道路都是直线（折线长度 = 首末直线距离，弯曲比 1.000）', bent.length === 0,
  bent.map(road => `${road.id}:${road.ratio.toFixed(4)}`).join(','));
note(`直线路 ${roads.length - bent.length}/${roads.length} 条`);

process.stdout.write('\n--- 路网连通性（直路端点最容易断在这里）---\n');
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
  // 单点接入就够（被别的路横穿也算接上），只有整条路谁都不挨着才是真的悬空。
  const isolated = roads.filter(road => roads.filter(other => other.id !== road.id)
    .every(other => polylineDistance(road.points, other.points) > road.width_m / 2 + other.width_m / 2 + 2));
  check('没有一条路是悬空的（至少有一处接入点）', isolated.length === 0, isolated.map(r => r.id).join(','));
  const bothEndsConnected = roads.filter(road => {
    const ends = [road.points[0], road.points[road.points.length - 1]];
    return ends.filter(point => roads.filter(other => other.id !== road.id)
      .some(other => distanceToPolyline(point, other.points) <= road.width_m / 2 + other.width_m / 2 + 2)).length === 2;
  });
  note(`两端都接入其它道路的 ${bothEndsConnected.length}/${roads.length} 条（其余靠尽端路或中途横穿接入）`);
}

process.stdout.write('\n--- 分区进深口径（引擎实测：自路面外缘 6 格 = 48m）---\n');
{
  // 1) 每个分区块的格心必须在 [0, 48] 内——这是生成器保证的口径。
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
  // 2) 多边形是 8 米格的台阶近似，边角必然比带略宽；只要越界面积占比很小即可。
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
  const bad = [];
  for (const building of buildings) {
    const road = roadById.get(building.roadside_of);
    if (!road) { bad.push(`${building.id}:目标路不存在`); continue; }
    const distance = distanceToPolyline(building.position, road.points);
    const allow = road.width_m / 2 + Math.hypot(building.size_m.x, building.size_m.z) / 2 + 6;
    if (distance > allow) bad.push(`${building.id}:${distance.toFixed(1)}>${allow.toFixed(1)}`);
  }
  check('每栋建筑都贴在自己声明的那条路边（半路宽 + 半对角线 + 6m 内）', bad.length === 0, bad.join(','));
  check('建筑位置都在 8 米格上', buildings.every(building => building.position.x % CELL_SIZE === 0 && building.position.z % CELL_SIZE === 0));
}

process.stdout.write('\n--- 黄金街区（路缘到路缘 96 m；按规划自述的轴向声明反查实际坐标）---\n');
{
  const golden = document.golden_block;
  check('规划自述了黄金街区口径（缺了就无法核对间距）',
    Number.isFinite(golden?.curb_to_curb_m) && !!golden?.axes && Object.keys(golden.axes).length === 3,
    JSON.stringify(golden ?? null).slice(0, 140));
  const GOLD = golden?.curb_to_curb_m ?? 96;
  const groups = [];
  for (const [district, axes] of Object.entries(golden?.axes ?? {})) {
    for (const [axis, rule] of Object.entries(axes)) {
      // 同片区同轴向的路按坐标去重（能源支路与厂区主街共线），宽度取最大
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
  const ranged = groups.filter(g => g.rule.range_m && !g.belt);
  const badExact = exact.filter(g => g.curb !== g.rule.exact_m);
  const badGreen = green.filter(g => g.curb !== GOLD + g.belt.unzoned_width_m);
  const badRange = ranged.filter(g => g.curb < g.rule.range_m[0] || g.curb > g.rule.range_m[1]);
  check(`对开道路的路缘间距精确等于黄金宽度 ${GOLD} m（${exact.length} 组）`, badExact.length === 0,
    badExact.map(g => `${g.district}/${g.axis} ${g.from}→${g.to} 路缘${g.curb}`).join(','));
  check(`绿带缺口 = 黄金宽度 + 声明的不划区宽度（${green.length} 组）`, badGreen.length === 0,
    badGreen.map(g => `${g.district}/${g.axis} ${g.from}→${g.to} 路缘${g.curb}≠${GOLD + g.belt.unzoned_width_m}`).join(','));
  check(`街区长边落在建议区间内（${ranged.length} 组）`, badRange.length === 0,
    badRange.map(g => `${g.district}/${g.axis} ${g.from}→${g.to} 路缘${g.curb}∉[${g.rule.range_m}]`).join(','));
  for (const [district, range] of Object.entries(golden?.collector_pitch_m ?? {})) {
    const xs = roads.filter(r => r.district === district && r.road_class === 'collector')
      .map(r => r.points[0].x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, index) => x - xs[index]);
    check(`${district} 集散路平行间距落在 doc 建议的 ${range[0]}–${range[1]} m`,
      gaps.length > 0 && gaps.every(g => g >= range[0] && g <= range[1]), gaps.join(','));
    note(`${district} 集散路间距 ${gaps.join(' / ')} m（doc §5 建议 ${range[0]}–${range[1]} m）`);
  }
  note(`黄金宽度 ${exact.length} 组全部精确 ${GOLD} m；街区长边 ${ranged.length} 组落在区间内；绿带缺口 ${green.length} 组`);
  // 绿带里必须真的一个分区都没有，否则「绿带」只是图上一句注释
  const belts = document.districts.flatMap(d => (d.greenBelts ?? []).map(belt => ({ district: d.key, ...belt })));
  const inBelt = zones.filter(zone => {
    const zs = zone.polygon.map(p => p.z), xs = zone.polygon.map(p => p.x);
    return belts.some(belt => Math.max(...zs) > belt.min_z && Math.min(...zs) < belt.max_z
      && Math.max(...xs) > (belt.min_x ?? -Infinity) && Math.min(...xs) < (belt.max_x ?? Infinity));
  });
  check('绿带范围内一个分区块都没有', belts.length > 0 && inBelt.length === 0,
    inBelt.slice(0, 5).map(z => z.id).join(','));
  note(`绿带 ${belts.length} 处，宽度 ${belts.map(b => b.max_z - b.min_z).join('/')} m（范围内 0 个分区块）`);
}

process.stdout.write('\n--- 三区相互独立 ---\n');
{
  for (const district of document.districts) {
    const list = zones.filter(zone => zone.district === district.key);
    const escapee = list.filter(zone => zone.polygon.some(p => p.x < district.bounds.min_x - 0.01 || p.x > district.bounds.max_x + 0.01
      || p.z < district.bounds.min_z - 0.01 || p.z > district.bounds.max_z + 0.01));
    check(`${district.name} 的分区不越出自己的范围（${list.length} 块）`, escapee.length === 0, escapee.slice(0, 3).map(z => z.id).join(','));
  }
  for (let i = 0; i < document.districts.length; i++) {
    for (let j = i + 1; j < document.districts.length; j++) {
      const a = document.districts[i].bounds, b = document.districts[j].bounds;
      const dx = Math.max(0, Math.max(a.min_x - b.max_x, b.min_x - a.max_x));
      const dz = Math.max(0, Math.max(a.min_z - b.max_z, b.min_z - a.max_z));
      const gap = Math.hypot(dx, dz);
      check(`${document.districts[i].name} 与 ${document.districts[j].name} 之间留有间隔（≥120m，避免两侧分区贴成一片）`, gap >= 120, `${gap.toFixed(0)}m`);
    }
  }
}

process.stdout.write('\n--- 对外机动车出口（doc §2：每个普通组团优先 2 个机动车出口）---\n');
{
  const accessPoints = document.access_points ?? [];
  check('规划自述了对外机动车出口（缺了就无法核对，也没法防止「片区内部路口被当出口」）',
    accessPoints.length > 0 && accessPoints.every(point => point.id && point.via && point.to && point.position));
  const residential = accessPoints.filter(point => point.district === 'residential');
  check('住宅区至少声明 2 个对外机动车出口', residential.length >= 2, `只有 ${residential.length} 个`);

  const problems = [];
  for (const point of accessPoints) {
    const via = roadById.get(point.via), to = roadById.get(point.to);
    if (!via || !to) { problems.push(`${point.id}:路不存在(${point.via}/${point.to})`); continue; }
    // 出口坐标必须真的落在两条路的折线上，不能只是"图上看起来在这".
    const dVia = distanceToPolyline(point.position, via.points);
    const dTo = distanceToPolyline(point.position, to.points);
    if (dVia > via.width_m / 2 + 2) problems.push(`${point.id}:偏离 ${point.via} ${dVia.toFixed(1)}m`);
    if (dTo > to.width_m / 2 + 2) problems.push(`${point.id}:偏离 ${point.to} ${dTo.toFixed(1)}m`);
    // via 是本片区的路，to 必须是**别的片区**的路——否则等于把片区内部路口当成对外出口。
    if (via.district !== point.district) problems.push(`${point.id}:via 不属于 ${point.district}`);
    if (to.district === point.district) problems.push(`${point.id}:to 仍属本片区`);
    if (point.position.x % CELL_SIZE !== 0 || point.position.z % CELL_SIZE !== 0) problems.push(`${point.id}:不在 8 米格`);
  }
  check('每个出口都真的落在两条路的交点上，且对接到别的片区', problems.length === 0, problems.join(','));

  const pairs = [];
  for (let i = 0; i < residential.length; i++) {
    for (let j = i + 1; j < residential.length; j++) {
      pairs.push({
        a: residential[i].id, b: residential[j].id,
        distance: Math.hypot(residential[i].position.x - residential[j].position.x, residential[i].position.z - residential[j].position.z),
      });
    }
  }
  check('住宅区两个出口分处两端（间距 ≥ 400 m，不是并排开两个口）',
    pairs.length > 0 && pairs.every(pair => pair.distance >= 400),
    pairs.map(pair => `${pair.a}↔${pair.b} ${pair.distance.toFixed(0)}m`).join(','));

  // 每个出口的接入路上必须能独立走到城市主干道（三区大道），不能"两个口共用同一条瓶颈".
  const trunk = roads.find(road => road.road_class === 'spine' && road.district === 'commercial');
  const stranded = accessPoints.filter(point => {
    const to = roadById.get(point.to);
    if (!to || !trunk) return true;
    return polylineDistance(to.points, trunk.points) > to.width_m / 2 + trunk.width_m / 2 + 2
      && !roads.some(other => other.id !== to.id && other.road_class === 'spine'
        && polylineDistance(to.points, other.points) <= to.width_m / 2 + other.width_m / 2 + 2);
  });
  check('每个出口的接入路都能独立走到城市主干道（不共用同一条瓶颈）', stranded.length === 0,
    stranded.map(point => point.id).join(','));

  note(`住宅区出口：${residential.map(point => `${point.label} @(${point.position.x}, ${point.position.z})`).join('；')}`);
  // 覆盖性：报告而不是断言。住宅路网是正交网格，实际行驶距离用曼哈顿距离近似
  // （直线距离会低估北出口——西北角虽然欧氏距离离南出口更近，沿路却要绕 2.2 km）。
  const resBounds = document.districts.find(district => district.key === 'residential')?.bounds;
  if (resBounds) {
    const corners = [
      { x: resBounds.min_x, z: resBounds.min_z }, { x: resBounds.max_x, z: resBounds.min_z },
      { x: resBounds.min_x, z: resBounds.max_z }, { x: resBounds.max_x, z: resBounds.max_z },
    ];
    const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
    const reach = points => Math.max(...corners.map(corner =>
      Math.min(...points.map(point => manhattan(corner, point.position)))));
    const southOnly = residential.filter(point => point.to === 'trunk-avenue');
    note(`住宅最远角到最近出口 沿路约 ${reach(residential).toFixed(0)} m`
      + `（只有南出口时约 ${reach(southOnly).toFixed(0)} m，改善 ${((1 - reach(residential) / reach(southOnly)) * 100).toFixed(0)}%）`);
    for (const corner of corners) {
      note(`  角 (${corner.x}, ${corner.z}) → 最近出口 ${Math.min(...residential.map(p => manhattan(corner, p.position)))} m`
        + `（只有南出口 ${Math.min(...southOnly.map(p => manhattan(corner, p.position)))} m）`);
    }
  }
}

process.stdout.write('\n--- 分区面积与人口核算 ---\n');
{
  const areaByKind = {};
  for (const zone of zones) areaByKind[zone.kind] = (areaByKind[zone.kind] ?? 0) + zone.area_m2;
  const polygonArea = zones.reduce((sum, zone) => sum + zone.area_m2, 0);
  for (const zone of zones) {
    const xs = zone.polygon.map(p => p.x), zs = zone.polygon.map(p => p.z);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    if (Math.abs(area - zone.area_m2) > 0.01) { check(`${zone.id} 的 area_m2 与多边形一致`, false, `${area} vs ${zone.area_m2}`); break; }
  }
  check('分区块的 area_m2 与其矩形多边形一致', true);
  note(`多边形总面积 ${(polygonArea / 1e6).toFixed(3)} km²`);

  // 8 米格只能以「格心是否落在带内」近似可划区带，必然带 ±半格量化误差。
  // 这里用 4 米无偏采样（点在带内才算）估真实可划区面积，两者偏差必须很小，
  // 否则说明栅格化窗口取错了（例如把上限收到 44m 以下会漏掉一整圈贴路格子）。
  // 道路全部改为直线后分块更大更规整，合并进矩形的边界格占比升高，
  // 偏差由 ~1% 升到 ~4%（单格所代表的 8/48 ≈ 17% 仍是上界），属正常量化误差。
  let sampled = 0, inBand = 0;
  for (const district of document.districts) {
    const b = district.bounds;
    for (let x = b.min_x; x < b.max_x; x += 4) {
      for (let z = b.min_z; z < b.max_z; z += 4) {
        sampled += 4 * 4;
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

  // 全城唯一的高速接入点：主干道起点必须落在现状路网的吸附容差内。
  // 这里不写死高速坐标，改用实时查询出来的现状道路折线来量，换存档也不会失效。
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
  const trunk = roadById.get('trunk-avenue');
  let nearest = Infinity;
  for (const segment of existing) {
    for (let index = 1; index < segment.length; index++) nearest = Math.min(nearest, distanceToSegment(trunk.points[0], segment[index - 1], segment[index]));
  }
  check('主干道起点落在现状道路的 8 米吸附容差内（全城唯一的高速接入点）', nearest <= 8, `最近现状路 ${nearest.toFixed(1)}m`);
  note(`现状道路折线 ${existing.length} 条，主干道起点距最近现状路 ${nearest.toFixed(1)} m`);
}

process.stdout.write(failures > 0 ? `\n${failures} 项失败（共 ${total} 项）\n` : `\n全部通过（共 ${total} 项）\n`);
if (failures > 0) process.exitCode = 1;
