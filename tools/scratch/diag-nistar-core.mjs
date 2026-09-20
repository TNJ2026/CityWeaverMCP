// 诊断核心区落位：打印最近候选街区、包围盒、失败原因
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const plan = JSON.parse(await readFile(path.join(ROOT, 'plans', 'nistar-star-city-plan.json'), 'utf8'));
const buildings = plan.plan.buildings;
const roads = plan.plan.roads;
const BOUNDS = plan.bounds;

const SX = 112, SZ = 224;
const xLines = new Set(); const zLines = new Set();
for (const r of roads) {
  for (const p of r.points) { xLines.add(p.x); zLines.add(p.z); }
}
const xs = [...xLines].sort((a, b) => a - b);
const zs = [...zLines].sort((a, b) => a - b);
console.log('x 线数量', xs.length, 'z 线数量', zs.length);
console.log('x 相邻间距样例', xs.slice(0, 8).map((v, i, a) => (i ? v - a[i - 1] : null)).filter(Boolean).slice(0, 6));
console.log('z 相邻间距样例', zs.slice(0, 8).map((v, i, a) => (i ? v - a[i - 1] : null)).filter(Boolean).slice(0, 6));

const targets = { 'core-park': [-336, 900], 'core-plaza': [-336, 900], 'core-clinic': [-336, 900] };
for (const id of ['core-park', 'core-plaza', 'core-clinic']) {
  const b = buildings.find((x) => x.id === id);
  console.log(id, b ? JSON.stringify({ prefab: b.prefab, size: b.size_m, reserved: b.reserved_size_m, pos: b.position, rot: b.rotation_degrees }) : '未落位');
}
