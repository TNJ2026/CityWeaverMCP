// 五角星城规划回归：plans/nistar-star-city-plan.json
// 运行：node tools/tests/test-nistar-star-plan.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const doc = JSON.parse(await readFile(path.join(ROOT, 'plans', 'nistar-star-city-plan.json'), 'utf8'));
const { bounds, plan } = doc;

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass += 1; else fails.push(msg); };
const finite = (v) => Number.isFinite(Number(v));
const snap8 = (v) => Math.round(v / 8) * 8;

// ---- 1. 文档级字段
ok(doc.city === '尼思', `city 应为尼思，实际 ${doc.city}`);
ok(/^cplan-[0-9a-f]{16}$/.test(doc.plan_id), `plan_id 形态异常 ${doc.plan_id}`);
ok(doc.render.width === doc.render.height, 'render 画布必须为正方形（非正方形会聚焦到空白）');
ok(doc.target_population === 20000, 'target_population 应为 20000');

// ---- 2. 人口落在目标区间
const acc = doc.accounting;
const [lo, hi] = acc.population_range;
ok(lo >= 17000 && hi <= 23000, `人口区间应落在 17k~23k，实际 ${lo}~${hi}`);
ok(acc.population_midpoint >= 18000 && acc.population_midpoint <= 22000, `人口中位数应在 18k~22k，实际 ${acc.population_midpoint}`);

// ---- 3. 几何有限性 + 8 m 栅格对齐 + 唯一 id
const ids = new Set();
const dup = [];
for (const [layer, items] of [['roads', plan.roads], ['buildings', plan.buildings], ['zones', plan.zones]]) {
  for (const it of items) {
    if (ids.has(it.id)) dup.push(`${layer}/${it.id}`);
    ids.add(it.id);
  }
}
ok(dup.length === 0, `id 重复：${dup.join(', ')}`);

for (const r of plan.roads) {
  ok(r.points.length >= 2, `${r.id} 少于 2 个点`);
  for (const p of r.points) {
    ok(finite(p.x) && finite(p.z), `${r.id} 含非有限坐标`);
    ok(snap8(p.x) === p.x && snap8(p.z) === p.z, `${r.id} 坐标未对齐 8 m 栅格`);
    ok(p.x >= bounds.min_x && p.x <= bounds.max_x && p.z >= bounds.min_z && p.z <= bounds.max_z, `${r.id} 越出已购区域`);
  }
}
for (const b of plan.buildings) {
  ok(finite(b.position.x) && finite(b.position.z), `${b.id} 含非有限坐标`);
  ok(snap8(b.position.x) === b.position.x && snap8(b.position.z) === b.position.z, `${b.id} 未对齐 8 m 栅格`);
  const hx = b.reserved_size_m.x / 2; const hz = b.reserved_size_m.z / 2;
  ok(b.position.x - hx >= bounds.min_x && b.position.x + hx <= bounds.max_x, `${b.id} x 向越界`);
  ok(b.position.z - hz >= bounds.min_z && b.position.z + hz <= bounds.max_z, `${b.id} z 向越界`);
}
for (const z of plan.zones) {
  ok(z.polygon.length >= 3, `${z.id} 多边形顶点不足`);
  for (const p of z.polygon) {
    ok(finite(p.x) && finite(p.z), `${z.id} 含非有限坐标`);
    ok(p.x >= bounds.min_x && p.x <= bounds.max_x && p.z >= bounds.min_z && p.z <= bounds.max_z, `${z.id} 越界`);
  }
}

// ---- 4. 净距不变量（与 planning-validator 同口径：轴对齐包围盒 + 道路半宽外扩）
function corners(cx, cz, hx, hz) {
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([dx, dz]) => ({ x: cx + dx, z: cz + dz }));
}
const env = (pts) => {
  const xs = pts.map((p) => p.x); const zs = pts.map((p) => p.z);
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
};
function segHitsBox(p0, p1, box, pad) {
  const lo = { x: box.min_x - pad, z: box.min_z - pad };
  const hi = { x: box.max_x + pad, z: box.max_z + pad };
  let t0 = 0; let t1 = 1;
  for (const [o, d, a, b] of [[p0.x, p1.x - p0.x, lo.x, hi.x], [p0.z, p1.z - p0.z, lo.z, hi.z]]) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return false; continue; }
    let s = (a - o) / d; let e = (b - o) / d;
    if (s > e) { const t = s; s = e; e = t; }
    t0 = Math.max(t0, s); t1 = Math.min(t1, e);
    if (t0 > t1) return false;
  }
  return true;
}
const boxes = plan.buildings.map((b) => ({
  id: b.id,
  box: env(corners(b.position.x, b.position.z, b.reserved_size_m.x / 2, b.reserved_size_m.z / 2)),
}));
const roadHits = [];
for (const b of plan.buildings) {
  const hx = b.reserved_size_m.x / 2; const hz = b.reserved_size_m.z / 2;
  const box = { min_x: b.position.x - hx, max_x: b.position.x + hx, min_z: b.position.z - hz, max_z: b.position.z + hz };
  for (const r of plan.roads) {
    const pad = Math.max(0, r.width_m || 8) / 2;
    for (let i = 0; i + 1 < r.points.length; i += 1) {
      if (segHitsBox(r.points[i], r.points[i + 1], box, pad)) { roadHits.push(`${b.id} × ${r.id}`); break; }
    }
  }
}
ok(roadHits.length === 0, `建筑占地压到规划道路：${roadHits.join('; ')}`);

const bldgHits = [];
for (let i = 0; i < boxes.length; i += 1) {
  for (let j = i + 1; j < boxes.length; j += 1) {
    const A = boxes[i].box; const B = boxes[j].box;
    if (A.min_x < B.max_x && A.max_x > B.min_x && A.min_z < B.max_z && A.max_z > B.min_z) bldgHits.push(`${boxes[i].id} × ${boxes[j].id}`);
  }
}
ok(bldgHits.length === 0, `建筑预留互叠：${bldgHits.join('; ')}`);

// ---- 5. 朝向按规划指南保持未解析
ok(plan.buildings.every((b) => b.rotation_degrees == null), '施工图阶段建筑朝向必须保持未解析（由 bind_city_plan_buildings 绑定）');
ok(plan.buildings.every((b) => b.rotation_source === 'unresolved'), '施工图阶段 rotation_source 必须为 unresolved');
ok(plan.buildings.every((b) => b.placement_status === 'conceptual'), '施工图阶段 placement_status 必须为 conceptual');

// ---- 6. 服务完整性：各类公共服务与市政至少有 1 处
const prefabs = new Set(plan.buildings.map((b) => b.prefab));
const required = {
  小学: 'ElementarySchool02', 高中: 'HighSchool01', 大学: 'College01',
  医院: 'Hospital01', 诊所: 'MedicalClinic02',
  消防: 'FireHouse01', 消防总局: 'FireStation01',
  警务: 'PoliceStation02', 警察总局: 'PoliceHeadquarters01',
  殡葬: 'Cemetery01', 火葬: 'Crematorium01',
  垃圾填埋: 'Landfill01', 回收: 'RecyclingCenter01',
  供水: 'GroundwaterPumpingStation01', 污水: 'WastewaterTreatmentPlant01',
  发电: 'GasPowerPlant01', 变电: 'TransformerStation01',
  通信: 'TelecomTower01', 道路维护: 'RoadMaintenanceDepot01',
  公园: 'CityPark02', 泳池: 'CommunityPool01', 游乐场: 'Playground01',
};
for (const [label, prefab] of Object.entries(required)) ok(prefabs.has(prefab), `缺少${label}（${prefab}）`);

// ---- 7. 片区与分区
const districts = new Set(doc.districts.map((d) => d.id));
const zoneDistricts = new Set(plan.zones.map((z) => z.district).filter(Boolean));
for (const d of zoneDistricts) ok(districts.has(d), `分区引用了未登记的片区 ${d}`);
ok(plan.zones.some((z) => /industrial/i.test(z.kind)), '缺少工业分区');
ok(plan.zones.some((z) => /office/i.test(z.kind)), '缺少办公分区');
ok(plan.zones.some((z) => /commercial/i.test(z.kind)), '缺少商业分区');
ok(plan.zones.filter((z) => /residential/i.test(z.kind)).length >= 100, '住宅分区数量过少');

// ---- 8. 对外接入
ok(doc.access_points.length >= 1, '缺少对外接入点声明');

console.log(`断言 ${pass + fails.length} 项，通过 ${pass}，失败 ${fails.length}`);
for (const f of fails) console.error(`  FAIL ${f}`);
if (fails.length) process.exit(1);
console.log('OK：五角星城规划几何与口径自洽。');
