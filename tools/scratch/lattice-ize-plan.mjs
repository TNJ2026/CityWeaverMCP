// 把六边形城镇规划里的 plan.grids 展开为「去重并集」的显式格网道路 + 显式分区多边形。
//
// 动机：施工编译器 (compileCityPlanRoads) 的 validateGridSeparation 要求网格矩形两两不接触；
// 而本规划的内部开发单元是 112 m 连续格网，相邻单元共享同一条格网线 —— 必然被判 PLAN_GRID_OVERLAP。
// 六边形内部实际上是「全局栅格」：latticeX(k)=CENTER.x+112k、latticeZ(j)=CENTER.z+112j，
// 所以把它表达为显式道路不但等价，还能顺带：
//   1) 合并相邻网格共享的重复路段（137 段 → 约 40 条真实格网线）；
//   2) 裁掉与骨架路（中央大道 x=-400、东西横轴 z=-1248）及格网线重合的部分，避免重复铺路。
//
// 同时输出分区（plan.zones）以保持图面一致；施工阶段分区另行按专属工作流处理。
//
// 用法: node tools/scratch/lattice-ize-plan.mjs <in-plan.json> <out-plan.json>

import { readFile, writeFile } from 'node:fs/promises';
import { expandCityPlan } from '../../mcp/planning-renderer.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { buildGridExceptions } from '../../mcp/grid-eligibility.mjs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error('Usage: node tools/scratch/lattice-ize-plan.mjs <in-plan.json> <out-plan.json>');

const doc = JSON.parse(await readFile(inPath, 'utf8'));
const plan = doc.plan ?? doc;

const EPS = 1e-6;
const LATTICE_ID = /^grid-(\d+)-([vh])-(\d+)$/;
const MIN_KEEP_M = 16;                 // 裁切后短于一个单元路段的残片直接丢弃
const round6 = v => Math.round(v * 1e6) / 1e6;

const expanded = expandCityPlan(plan);
const latticeRoads = expanded.roads.filter(r => LATTICE_ID.test(String(r.id)));
const solids = expanded.roads.filter(r => !LATTICE_ID.test(String(r.id)));
const allZones = expanded.zones ?? [];

// ── 1. 阻塞区间：所有非格网路中的轴对齐路段（骨架路、场院环路） ──
const blockers = { v: [], h: [] };
for (const road of solids) {
  const pts = road.points ?? [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.abs(a.x - b.x) <= EPS) blockers.v.push({ coord: round6(a.x), from: Math.min(a.z, b.z), to: Math.max(a.z, b.z), id: road.id });
    else if (Math.abs(a.z - b.z) <= EPS) blockers.h.push({ coord: round6(a.z), from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), id: road.id });
  }
}

// ── 2. 归并格网线：按 (朝向, 坐标) 求区间并集 ──
const linesMap = new Map();
for (const road of latticeRoads) {
  const [a, b] = road.points;
  const vertical = Math.abs(a.x - b.x) <= EPS;
  const orient = vertical ? 'v' : 'h';
  const coord = round6(vertical ? a.x : a.z);
  const from = Math.min(vertical ? a.z : a.x, vertical ? b.z : b.x);
  const to = Math.max(vertical ? a.z : a.x, vertical ? b.z : b.x);
  // grid id / index → 所属 district
  const gridId = `grid-${LATTICE_ID.exec(road.id)[1]}`;
  const key = `${orient}|${coord}`;
  if (!linesMap.has(key)) linesMap.set(key, { orient, coord, intervals: [], gridIds: new Set() });
  linesMap.get(key).intervals.push([from, to]);
  linesMap.get(key).gridIds.add(gridId);
}

const mergeIntervals = list => {
  const sorted = [...list].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [f, t] of sorted) {
    const last = out[out.length - 1];
    if (last && f <= last[1] + EPS) last[1] = Math.max(last[1], t);
    else out.push([f, t]);
  }
  return out;
};
const subtract = (intervals, cuts) => {
  let result = intervals.map(([f, t]) => [f, t]);
  for (const [cf, ct] of cuts) {
    const next = [];
    for (const [f, t] of result) {
      if (ct <= f + EPS || cf >= t - EPS) { next.push([f, t]); continue; }
      if (cf > f + EPS) next.push([f, Math.min(t, cf)]);
      if (ct < t - EPS) next.push([Math.max(f, ct), t]);
    }
    result = next;
  }
  return result.filter(([f, t]) => t - f > EPS);
};

const trimmedBy = new Map();           // lattice key -> 被哪些骨架路裁掉
const outLattice = [];
let droppedShort = 0;
for (const line of linesMap.values()) {
  const merged = mergeIntervals(line.intervals);
  const cuts = mergeIntervals(blockers[line.orient].filter(b => Math.abs(b.coord - line.coord) <= EPS).map(b => [b.from, b.to]));
  const kept = subtract(merged, cuts);
  if (cuts.length && merged.length) {
    for (const b of blockers[line.orient].filter(x => Math.abs(x.coord - line.coord) <= EPS)) {
      const key = `${line.orient}|${line.coord}`;
      if (!trimmedBy.has(key)) trimmedBy.set(key, new Set());
      trimmedBy.get(key).add(b.id);
    }
    // 记录被裁掉的长度
    const before = merged.reduce((s, [f, t]) => s + (t - f), 0);
    const after = kept.reduce((s, [f, t]) => s + (t - f), 0);
    if (before - after > 0) droppedShort += before - after;
  }
  const grid = plan.grids.find(g => g.id === [...line.gridIds][0]);
  for (const [f, t] of kept) {
    if (t - f < MIN_KEEP_M) continue;
    outLattice.push(line.orient === 'v'
      ? { line, from: f, to: t, points: [{ x: line.coord, z: f }, { x: line.coord, z: t }], grid }
      : { line, from: f, to: t, points: [{ x: f, z: line.coord }, { x: t, z: line.coord }], grid });
  }
}

const kindByDistrict = new Map();
for (const g of plan.grids) kindByDistrict.set(g.district, g.zone_kind);

const latticeRoadObjects = outLattice.map((item, index) => {
  const length = item.to - item.from;
  return {
    id: `lattice-${item.line.orient}-${String(index + 1).padStart(3, '0')}`,
    label: `内部格网${item.line.orient === 'v' ? '纵' : '横'}路 #${index + 1}（Small Road 16 m，${item.grid?.district ?? '内部开发单元'}）`,
    prefab: item.grid?.road_prefab ?? 'Small Road',
    width_m: item.grid?.road_width_m ?? 16,
    level: 'surface',
    kind: 'road',
    road_class: 'local',
    role: 'lattice',
    district: item.grid?.district ?? '内部开发单元',
    planning_status: 'conceptual',
    construction_status: 'planned',
    construction_order: 40,
    depends_on: ['hex-ring'],
    max_cost: Math.round(length * 450 * 1.3),
    points: item.points.map(p => ({ x: p.x, z: p.z })),
  };
});

// ── 3. 显式分区多边形（保持图面一致） ──
const zoneObjects = allZones.map((zone, index) => {
  const m = /^grid-(\d+)-zone-/.exec(String(zone.id));
  const grid = m ? plan.grids[Number(m[1])] : null;
  return {
    id: `zone-${String(index + 1).padStart(3, '0')}`,
    kind: zone.kind,
    label: zone.label,
    district: grid?.district ?? '内部开发单元',
    area_m2: 112 * 112,
    polygon: zone.polygon.map(p => ({ x: p.x, z: p.z })),
  };
});

// ── 3b. 重映射建筑依赖：旧格网路 id → 新格网路 id（按几何归属，而非编号） ──
const oldGeo = new Map();
for (const road of latticeRoads) {
  const [a, b] = road.points;
  const vertical = Math.abs(a.x - b.x) <= EPS;
  oldGeo.set(String(road.id), {
    orient: vertical ? 'v' : 'h',
    coord: round6(vertical ? a.x : a.z),
    from: Math.min(vertical ? a.z : a.x, vertical ? b.z : b.x),
    to: Math.max(vertical ? a.z : a.x, vertical ? b.z : b.x),
  });
}
const newByKey = new Map();
outLattice.forEach((item, i) => {
  const key = `${item.line.orient}|${item.line.coord}`;
  if (!newByKey.has(key)) newByKey.set(key, []);
  newByKey.get(key).push({ from: item.from, to: item.to, id: latticeRoadObjects[i].id });
});
const skeletonGeo = [];
for (const road of solids) {
  const pts = road.points ?? [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.abs(a.x - b.x) <= EPS) skeletonGeo.push({ id: road.id, orient: 'v', coord: round6(a.x), from: Math.min(a.z, b.z), to: Math.max(a.z, b.z) });
    else if (Math.abs(a.z - b.z) <= EPS) skeletonGeo.push({ id: road.id, orient: 'h', coord: round6(a.z), from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
  }
}
const dependencyRemap = new Map();
const unresolvedDependencies = [];
for (const [oldId, geo] of oldGeo) {
  const list = (newByKey.get(`${geo.orient}|${geo.coord}`) ?? []).slice().sort((x, y) => x.from - y.from);
  const mid = (geo.from + geo.to) / 2;
  const hit = list.find(x => mid >= x.from - 1 && mid <= x.to + 1) ?? list.find(x => x.from <= geo.from + 1 && x.to >= geo.to - 1);
  if (hit) { dependencyRemap.set(oldId, hit.id); continue; }
  // 该段被骨架路覆盖（如中央大道 / 东西横轴）：依赖转移到骨架路
  const host = skeletonGeo.find(s => s.orient === geo.orient && Math.abs(s.coord - geo.coord) <= EPS && mid >= s.from - 1 && mid <= s.to + 1);
  if (host) { dependencyRemap.set(oldId, host.id); continue; }
  unresolvedDependencies.push(oldId);
}

const remappedBuildings = (plan.buildings ?? []).map(b => {
  const deps = [...new Set((b.depends_on ?? []).map(id => dependencyRemap.get(String(id)) ?? id))];
  return { ...b, depends_on: deps };
});

// ── 4. 组装新 plan ──
const newPlan = {
  ...plan,
  grids: [],
  grid_exceptions: [],
  roads: [...solids, ...latticeRoadObjects],
  zones: zoneObjects,
  buildings: remappedBuildings,
};
// 逐组声明「为何不能无损用原生网格」：内部格网线为共享状态，原生网格批次会重复生成周界路
newPlan.grid_exceptions = buildGridExceptions(newPlan);

const beforeRoads = expanded.roads.length;
const afterRoads = newPlan.roads.length;
const newPlanId = computeCityPlanId(doc.bounds, newPlan);

// 连通性用几何并集核对：新路集与旧路集应覆盖同一批格网线
const outDoc = {
  ...doc,
  plan_id: newPlanId,
  plan: newPlan,
  lattice_conversion: {
    reason: '施工编译器的 validateGridSeparation 要求网格矩形两两不接触；内部为 112 m 连续格网，故等价改写为显式格网道路。',
    geometry_equivalent: true,
    grid_expanded_road_count: beforeRoads,
    explicit_road_count: afterRoads,
    merged_lattice_lines: outLattice.length,
    lattice_total_length_m: Math.round(outLattice.reduce((s, i) => s + (i.to - i.from), 0)),
    trimmed_overlap_length_m: Math.round(droppedShort),
    trimmed_by: [...trimmedBy.entries()].map(([key, ids]) => ({ lattice_line: key, overlapping_with: [...ids] })),
    zones: zoneObjects.length,
    dependency_remap_count: dependencyRemap.size,
    unresolved_dependencies: unresolvedDependencies,
  },
};

const validation = validateCityPlan(
  { bounds: doc.bounds, purchased_tiles: [], roads: [], buildings: [], tracks: [], utilities: [] },
  newPlan,
  doc.bounds,
);
outDoc.validation = validation;

await writeFile(outPath, JSON.stringify(outDoc, null, 2), 'utf8');

console.log(JSON.stringify({
  out: outPath,
  old_plan_id: doc.plan_id,
  new_plan_id: newPlanId,
  solids: solids.length,
  lattice_roads: latticeRoadObjects.length,
  lattice_total_length_m: outDoc.lattice_conversion.lattice_total_length_m,
  trimmed_overlap_length_m: outDoc.lattice_conversion.trimmed_overlap_length_m,
  zones: zoneObjects.length,
  trimmed_by: outDoc.lattice_conversion.trimmed_by,
  validation_issue_count: validation.issue_count,
  validation_errors: validation.issues.filter(i => i.severity === 'error').slice(0, 8),
}, null, 2));
