import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const plan = j.plan ?? j;
const zTarget = Number(process.argv[3] ?? -1248);
console.log('plan roads', (plan.roads ?? []).length);
for (const r of plan.roads ?? []) {
  const pts = r.points ?? [];
  if (pts.some(p => Math.abs(p.z - zTarget) < 0.001)) {
    console.log(r.id.padEnd(16), (r.role ?? '').padEnd(9), (r.prefab ?? '').padEnd(13),
      'order=' + String(r.construction_order ?? '').padEnd(4), 'deps=' + JSON.stringify(r.depends_on ?? []),
      pts.map(p => '(' + p.x + ',' + p.z + ')').join('->'));
  }
}
