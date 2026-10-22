// Reconcile the plan's 70 buildings against live service + utility facilities.
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const b = plan.bounds;
const inPlan = (x, z) => x >= b.min_x && x <= b.max_x && z >= b.min_z && z <= b.max_z;

const want = {};
for (const x of plan.plan.buildings) {
  const k = x.prefab ?? x.building_prefab ?? '?';
  want[k] = (want[k] || 0) + 1;
}
console.log('=== plan building prefabs (70) ===');
for (const [k, n] of Object.entries(want).sort()) console.log(' ', String(n).padStart(2), k);

const svc = (await queryGame('list_city_service_facilities', { kind: 'all' }, { timeoutMs: 40000 })).data;
const svcItems = (svc?.items ?? []).filter(f => inPlan(f.position?.x ?? 0, f.position?.z ?? 0));
const util = (await queryGame('list_utility_facilities', {}, { timeoutMs: 40000 })).data;
const utilItems = (util?.items ?? []).filter(f => inPlan(f.position?.x ?? 0, f.position?.z ?? 0));

console.log('\n=== live in-town facilities, by prefab ===');
const live = {};
for (const f of [...svcItems, ...utilItems]) {
  const k = f.prefab ?? f.name ?? '?';
  live[k] = (live[k] || 0) + 1;
}
for (const [k, n] of Object.entries(live).sort()) console.log(' ', String(n).padStart(2), k);

console.log('\n=== reconciliation (plan vs live, by prefab family) ===');
const norm = (s) => String(s).replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '').toLowerCase();
const liveByNorm = {};
for (const [k, n] of Object.entries(live)) liveByNorm[norm(k)] = (liveByNorm[norm(k)] || 0) + n;
const wantByNorm = {};
for (const [k, n] of Object.entries(want)) wantByNorm[norm(k)] = (wantByNorm[norm(k)] || 0) + n;
let missTotal = 0;
for (const [k, n] of Object.entries(wantByNorm).sort()) {
  const got = liveByNorm[k] ?? 0;
  const ok = got >= n ? 'OK  ' : 'MISS';
  if (got < n) missTotal += n - got;
  console.log(` ${ok} planned=${n} live=${got}  ${k}`);
}
const extraKeys = Object.keys(liveByNorm).filter(k => !(k in wantByNorm));
console.log('\nlive prefabs not in the plan (pre-existing / upgraded):', extraKeys.join(', ') || '(none)');
console.log('total planned buildings missing live:', missTotal);
console.log('service facilities in town:', svcItems.length, '| utility facilities in town:', utilItems.length);

console.log('\n=== service coverage at town centre (-400,-1248), r=1200 ===');
const cov = (await queryGame('analyze_service_coverage', { position: { x: -400, z: -1248 }, kind: 'all', radius_m: 1200, facility_limit: 64 }, { timeoutMs: 40000 })).data;
console.log(JSON.stringify({
  in_range: cov?.residential_buildings_in_range, total_res: cov?.total_residential_buildings,
  share: cov?.residential_building_share, households: cov?.households_in_range,
  uncovered_res: cov?.uncovered_residential_buildings, existing_facilities_in_range: cov?.existing_facilities_in_range,
  nearest_m: cov?.nearest_existing_facility_distance_m,
}, null, 1));
