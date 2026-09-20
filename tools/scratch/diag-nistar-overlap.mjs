// 诊断：列出与道路相交的规划建筑包围盒 + 相交道路线段（复刻 planning-validator 的判定）
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const plan = JSON.parse(await readFile(path.join(ROOT, 'plans', 'nistar-star-city-plan.json'), 'utf8'));

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function boxOf(b) {
  const hx = Math.max(0.5, Math.max(finite(b.reserved_size_m?.x), finite(b.size_m?.x)) / 2);
  const hz = Math.max(0.5, Math.max(finite(b.reserved_size_m?.z), finite(b.size_m?.z)) / 2);
  return { min_x: b.position.x - hx, max_x: b.position.x + hx, min_z: b.position.z - hz, max_z: b.position.z + hz, hx, hz };
}

// 线段 vs 轴对齐矩形（矩形按 halfRoad 外扩）
function segHitsBox(p0, p1, box, pad) {
  const min_x = box.min_x - pad, max_x = box.max_x + pad;
  const min_z = box.min_z - pad, max_z = box.max_z + pad;
  let t0 = 0, t1 = 1;
  const dx = p1.x - p0.x, dz = p1.z - p0.z;
  for (const [o, d, lo, hi] of [[p0.x, dx, min_x, max_x], [p0.z, dz, min_z, max_z]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

const roads = plan.plan.roads;
const rows = [];
for (const b of plan.plan.buildings) {
  const box = boxOf(b);
  for (const r of roads) {
    const pad = Math.max(0, finite(r.width_m || 8)) / 2;
    for (let i = 0; i + 1 < r.points.length; i += 1) {
      if (segHitsBox(r.points[i], r.points[i + 1], box, pad)) {
        rows.push({ id: b.id, prefab: b.prefab, box: `${box.min_x.toFixed(0)}..${box.max_x.toFixed(0)} / ${box.min_z.toFixed(0)}..${box.max_z.toFixed(0)}`, half: `${box.hx.toFixed(0)}x${box.hz.toFixed(0)}`, road: r.id, w: r.width_m, seg: `${JSON.stringify(r.points[i])}→${JSON.stringify(r.points[i + 1])}` });
        break;
      }
    }
  }
}
console.log('road-overlap rows:', rows.length);
for (const r of rows) console.log(`${r.id.padEnd(42)} box[${r.box}] half=${r.half} road=${r.road}(w${r.w}) ${r.seg}`);

// 建筑互叠
const boxes = plan.plan.buildings.map((b) => ({ b, box: boxOf(b) }));
const pairs = [];
for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
  const A = boxes[i].box, B = boxes[j].box;
  if (A.min_x < B.max_x && A.max_x > B.min_x && A.min_z < B.max_z && A.max_z > B.min_z) {
    pairs.push(`${boxes[i].b.id} <-> ${boxes[j].b.id}`);
  }
}
console.log('\nbuilding-overlap pairs:', pairs.length);
for (const p of pairs) console.log(' ', p);
