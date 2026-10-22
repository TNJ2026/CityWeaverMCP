import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plan = j.plan ?? j;
const roads = plan.roads ?? [];
const targetX = Number(process.argv[3] ?? 160);
console.log('total roads', roads.length);
for (const r of roads) {
  const pts = r.points ?? [];
  const xs = pts.map(p => p.x);
  if (xs.some(x => Math.abs(x - targetX) < 0.001)) {
    console.log(r.id + ' | ' + r.role + ' | ' + (r.prefab ?? '') + ' | ' + pts.map(p => '(' + p.x + ',' + p.z + ')').join(' -> '));
  }
}
