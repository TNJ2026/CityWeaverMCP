// 尼思五边形城规划回归：plans/nis-pentagon-city-plan.json
// 运行：node tools/tests/test-nis-pentagon-plan.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const doc = JSON.parse(await readFile(path.join(ROOT, 'plans', 'nis-pentagon-city-plan.json'), 'utf8'));
const { bounds, plan } = doc;

let pass = 0;
const fails = [];
const ok = (cond, msg) => { if (cond) pass += 1; else fails.push(msg); };
const finite = (v) => Number.isFinite(Number(v));
const snap8 = (v) => Math.round(v / 8) * 8;

// ---- 1. 文档级字段
ok(doc.city === '尼思', `city 应为尼思，实际 ${doc.city}`);
ok(/^cplan-[0-9a-f]{16}$/.test(doc.plan_id), `plan_id 形态异常 ${doc.plan_id}`);
ok(doc.render.width === doc.render.height, 'render 画布必须为正方形');
ok(doc.target_population === 20000, 'target_population 应为 20000');

// ---- 2. 人口落在目标区间
const acc = doc.accounting;
const [lo, hi] = acc.population_range;
ok(lo >= 17000 && hi <= 23000, `人口区间应落在 17k~23k，实际 ${lo}~${hi}`);
ok(acc.population_midpoint >= 18000 && acc.population_midpoint <= 22000, `人口中位数应在 18k~22k，实际 ${acc.population_midpoint}`);

// ---- 3. 人口可复算：分区多边形鞋带面积求和 = accounting
function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}
const areaByZone = new Map();
for (const z of plan.zones) {
  const A = shoelace(z.polygon);
  ok(Math.abs(A - z.area_m2) < Math.max(2, z.area_m2 * 0.001), `${z.id} 面积与多边形不符 ${A} vs ${z.area_m2}`);
  areaByZone.set(z.kind, (areaByZone.get(z.kind) ?? 0) + z.area_m2);
}
const HH_M2 = {
  'EU Residential Low': 300, 'EU Residential Medium Row': 170,
  'EU Residential Medium': 120, 'EU Residential Mixed': 100,
};
let hh = 0;
for (const [zone, area] of areaByZone) {
  const m2 = HH_M2[zone];
  if (m2) hh += Math.round(area / m2);
}
ok(hh === acc.households, `户数可复算不符 ${hh} vs ${acc.households}`);

// ---- 4. 几何有限性 + 8 m 对齐 + 唯一 id + 边界包含
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
    ok(p.x >= -1558.26 && p.x <= 934.96 && p.z >= -934.96 && p.z <= 2804.87, `${r.id} 超出已购地图格`);
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

// ---- 5. 五边形正五边形性：5 条边等长（≤1%）、顶点 8 对齐
const edges = plan.roads.filter((r) => r.id.startsWith('edge-'));
ok(edges.length === 5, `外环应为 5 段，实际 ${edges.length}`);
const lens = edges.map((r) => Math.hypot(r.points[1].x - r.points[0].x, r.points[1].z - r.points[0].z));
const lMean = lens.reduce((s, l) => s + l, 0) / lens.length;
for (let i = 0; i < 5; i += 1) ok(Math.abs(lens[i] - lMean) / lMean <= 0.01, `外环第 ${i + 1} 段边长偏差 >1%：${lens[i].toFixed(1)} vs ${lMean.toFixed(1)}`);
// 相邻边夹角 = 108°（内角）：入边方向（prev 起点→顶点）与出边方向（顶点→next）
const angleAt = (p, q) => Math.atan2(q.z - p.z, q.x - p.x);
for (let i = 0; i < 5; i += 1) {
  const cur = edges[i];
  const prevStart = edges[(i + 4) % 5].points[0];
  const v = cur.points[0]; const next = cur.points[1];
  const a1 = angleAt(v, prevStart);   // 顶点→入边起点
  const a2 = angleAt(v, next);        // 顶点→出边终点
  let d = Math.abs(a2 - a1) * 180 / Math.PI;
  d = Math.min(d, 360 - d);
  ok(Math.abs(d - 108) <= 1.5, `顶点 ${i} 内角 ${d.toFixed(1)}° 偏离 108° 超限`);
}

// ---- 6. 放射大道连接中心与五角
const radials = plan.roads.filter((r) => r.id.startsWith('radial-'));
ok(radials.length === 5, `放射大道应为 5 条，实际 ${radials.length}`);
for (const r of radials) {
  const a = r.points[0];
  ok(a.x === -312 && a.z === 1000, `${r.id} 起点不在中心`);
}
const edgeVerts = new Set(edges.flatMap((r) => r.points.map((p) => `${p.x},${p.z}`)));
for (const r of radials) {
  const e = r.points[r.points.length - 1];
  ok(edgeVerts.has(`${e.x},${e.z}`), `${r.id} 终点不在外环顶点上`);
}

// ---- 7. 同心内环：7 圈，法距递进落在 [112,128]
const CENTER = { x: -312, z: 1000 };
const rings = new Map();
for (const r of plan.roads) {
  const m = /^ring(\d+)-/.exec(r.id);
  if (m) rings.set(Number(m[1]), (rings.get(Number(m[1])) ?? 0) + 1);
}
ok(rings.size === 7, `内环应为 7 圈，实际 ${rings.size}`);
for (const [a, cnt] of rings) ok(cnt === 5, `内环 a=${a} 应为 5 段，实际 ${cnt}`);
const apothems = [...rings.keys()].sort((p, q) => p - q);
for (let i = 0; i + 1 < apothems.length; i += 1) {
  ok(apothems[i + 1] - apothems[i] >= 112 && apothems[i + 1] - apothems[i] <= 128, `环距 ${apothems[i]}→${apothems[i + 1]} 超出 [112,128]`);
}

// ---- 8. 路网单一连通分量（端点吸附 + 中途横穿均算连通，容差=半宽和+2）
function segDist(px, pz, a, b) {
  const vx = b.x - a.x; const vz = b.z - a.z;
  const len2 = vx * vx + vz * vz || 1;
  let t = ((px - a.x) * vx + (pz - a.z) * vz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * vx), pz - (a.z + t * vz));
}
function segMinDist(s1, s2) {
  const d = (p, a, b) => segDist(p.x, p.z, a, b);
  let best = Math.min(d(s1.a, s2.a, s2.b), d(s1.b, s2.a, s2.b), d(s2.a, s1.a, s1.b), d(s2.b, s1.a, s1.b));
  const ccw = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const inter = (p1, p2, p3, p4) => {
    const s1o = ccw(p1, p2, p3), s1t = ccw(p1, p2, p4), s2o = ccw(p3, p4, p1), s2t = ccw(p3, p4, p2);
    return ((s1o > 0) !== (s1t > 0)) && ((s2o > 0) !== (s2t > 0));
  };
  if (inter(s1.a, s1.b, s2.a, s2.b)) best = 0;
  return best;
}
const parent = new Map();
const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
for (const r of plan.roads) parent.set(r.id, r.id);
for (let i = 0; i < plan.roads.length; i += 1) {
  for (let j = i + 1; j < plan.roads.length; j += 1) {
    const A = plan.roads[i]; const B = plan.roads[j];
    const tol = (A.width_m + B.width_m) / 2 + 2;
    let done = false;
    for (let s1 = 0; s1 + 1 < A.points.length && !done; s1 += 1) {
      for (let s2 = 0; s2 + 1 < B.points.length; s2 += 1) {
        if (segMinDist({ a: A.points[s1], b: A.points[s1 + 1] }, { a: B.points[s2], b: B.points[s2 + 1] }) <= tol) {
          const ra = find(A.id); const rb = find(B.id);
          if (ra !== rb) parent.set(ra, rb);
          done = true; break;
        }
      }
    }
  }
}
const comps = new Set(plan.roads.map((r) => find(r.id)));
ok(comps.size === 1, `路网应单一连通分量，实际 ${comps.size} 个`);

// ---- 9. 净距不变量（planning-validator 同口径）
function corners(cx, cz, hx, hz) {
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([dx, dz]) => ({ x: cx + dx, z: cz + dz }));
}
const env = (pts) => ({
  min_x: Math.min(...pts.map((p) => p.x)), max_x: Math.max(...pts.map((p) => p.x)),
  min_z: Math.min(...pts.map((p) => p.z)), max_z: Math.max(...pts.map((p) => p.z)),
});
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
  const box = boxes.find((x) => x.id === b.id).box;
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

// ---- 10. 分区两两不重叠（bbox 预筛 + 采样点复核）
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.z > pt.z) !== (b.z > pt.z)) {
      const t = (pt.z - a.z) / (b.z - a.z);
      if (pt.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}
const zoneBoxes = plan.zones.map((z) => ({ z, box: env(z.polygon) }));
const zoneOverlaps = [];
outer:
for (let i = 0; i < zoneBoxes.length; i += 1) {
  for (let j = i + 1; j < zoneBoxes.length; j += 1) {
    const A = zoneBoxes[i]; const B = zoneBoxes[j];
    if (!(A.box.min_x < B.box.max_x && A.box.max_x > B.box.min_x && A.box.min_z < B.box.max_z && A.box.max_z > B.box.min_z)) continue;
    const x0 = Math.max(A.box.min_x, B.box.min_x); const x1 = Math.min(A.box.max_x, B.box.max_x);
    const z0 = Math.max(A.box.min_z, B.box.min_z); const z1 = Math.min(A.box.max_z, B.box.max_z);
    for (let sx = x0 + 4; sx < x1; sx += 8) {
      for (let sz = z0 + 4; sz < z1; sz += 8) {
        if (pointInPoly({ x: sx, z: sz }, A.z.polygon) && pointInPoly({ x: sx, z: sz }, B.z.polygon)) {
          zoneOverlaps.push(`${A.z.id} × ${B.z.id}`); continue outer;
        }
      }
    }
  }
}
ok(zoneOverlaps.length === 0, `分区两两重叠：${zoneOverlaps.join('; ')}`);

// ---- 11. 朝向保持未解析 + 状态字段
ok(plan.buildings.every((b) => b.rotation_degrees == null), '施工图阶段建筑朝向必须保持未解析');
ok(plan.buildings.every((b) => b.rotation_source === 'unresolved'), 'rotation_source 必须为 unresolved');
ok(plan.buildings.every((b) => b.placement_status === 'conceptual'), 'placement_status 必须为 conceptual');

// ---- 12. 服务完整性
const prefabs = new Set(plan.buildings.map((b) => b.prefab));
const required = {
  小学: 'ElementarySchool02', 高中: 'HighSchool02', 大学: 'College01',
  医院: 'Hospital01', 诊所: 'MedicalClinic02',
  消防: 'FireHouse01', 消防总局: 'FireStation01',
  警务: 'PoliceStation02', 警察总局: 'PoliceHeadquarters01',
  殡葬: 'Cemetery01', 火葬: 'Crematorium01',
  垃圾填埋: 'Landfill01', 回收: 'RecyclingCenter01',
  供水: 'GroundwaterPumpingStation01', 污水: 'WastewaterTreatmentPlant01',
  发电: 'SmallCoalPowerPlant01', 变电: 'TransformerStation01',
  通信: 'TelecomTower01', 道路维护: 'RoadMaintenanceDepot01',
  公园: 'CityPark02', 泳池: 'CommunityPool01', 游乐场: 'Playground01',
  邮政: 'PostOffice02', 福利: 'WelfareOffice01', 预警: 'EarlyDisasterWarningSystem01',
  停车: 'ParkingLot01', 风电: 'WindTurbine01',
};
for (const [label, prefab] of Object.entries(required)) ok(prefabs.has(prefab), `缺少${label}（${prefab}）`);

// ---- 13. 工业办公商业住宅分区齐备
ok(plan.zones.some((z) => /Industrial/i.test(z.kind)), '缺少工业分区');
ok(plan.zones.some((z) => /Office/i.test(z.kind)), '缺少办公分区');
ok(plan.zones.some((z) => /Commercial/i.test(z.kind)), '缺少商业分区');
ok(plan.zones.filter((z) => /Residential/i.test(z.kind)).length >= 50, '住宅分区数量过少');

// ---- 14. 对外接入 + 唯一既有建筑核查口径
ok(doc.access_points.length >= 1, '缺少对外接入点声明');
const conn = plan.roads.find((r) => r.id === 'highway-connector');
ok(!!conn, '缺少高速连接道');
ok(conn.points[conn.points.length - 1].x === 144 && conn.points[conn.points.length - 1].z === 2696, '高速连接道端点应锚定 (144,2696)');

console.log(`断言 ${pass + fails.length} 项，通过 ${pass}，失败 ${fails.length}`);
for (const f of fails) console.error(`  FAIL ${f}`);
if (fails.length) process.exit(1);
console.log('OK：五边形城规划几何与口径自洽。');
