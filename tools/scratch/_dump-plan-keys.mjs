import { readFileSync } from 'node:fs';
const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const p = JSON.parse(raw);
const plan = p.plan;
console.log('plan keys:');
for (const [k, v] of Object.entries(plan)) {
  console.log(`  ${k} : ${Array.isArray(v) ? `array(${v.length})` : typeof v}`);
}
const bs = plan.buildings ?? [];
console.log(`\nbuildings: ${bs.length}`);
const hit = bs.filter((b) => /water|tower|pump|sewage|reservoir/i.test(JSON.stringify(b)));
console.log(`\n--- water-ish (${hit.length}) ---`);
for (const b of hit) {
  console.log(`  ${b.id} | ${b.prefab} | ${b.label ?? b.name ?? ''} | (${b.position?.x}, ${b.position?.z}) rot=${b.rotation_degrees} | road=${b.road_edge_id ?? '-'}`);
}
console.log('\n--- sample building ---');
console.log(JSON.stringify(bs[0], null, 2));
