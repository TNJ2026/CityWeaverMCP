// Verify the applied hexagon-town zoning against the plan.
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const map = JSON.parse(fs.readFileSync('tools/scratch/_live-edge-map.json', 'utf8'));

const rects = plan.plan.zones.map(z => {
  const xs = z.polygon.map(q => q.x), zz = z.polygon.map(q => q.z);
  return { id: z.id, label: z.label, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zz), z1: Math.max(...zz) };
});
const zoneAt = (x, z) => rects.find(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ?? null;

// 1. roads intact
const snap = await queryGame('get_planning_map_snapshot', { bounds: plan.bounds, include_roads: true, max_features_per_layer: 1500 });
const liveRoads = snap.data?.roads ?? [];
console.log(`roads in bounds: ${liveRoads.length} (expected ${map.matched.length} hexagon + 2 highway)`);
const byPrefab = {}; for (const r of liveRoads) byPrefab[r.prefab] = (byPrefab[r.prefab] || 0) + 1;
console.log('road prefabs:', JSON.stringify(byPrefab));

// 2. buildings intact
const buildings = (await queryGame('get_city_buildings', { limit: 2000, offset: 0 }, { timeoutMs: 30000 }).catch(() => ({ data: {} }))).data;
const bList = buildings?.items ?? buildings?.buildings ?? [];
console.log(`city buildings listed: ${Array.isArray(bList) ? bList.length : 'n/a'} (plan built 70 service buildings)`);

// 3. zoning read-back
const edgeIds = map.matched.map(m => m.id);
const CHUNK = 12;
let match = 0, mismatch = 0, plannedBlank = 0, unplannedZoned = 0, blankBlank = 0;
const perLabel = {};
const bad = [];
for (let i = 0; i < edgeIds.length; i += CHUNK) {
  const res = await queryGame('analyze_zoning_cells', { edge_ids: edgeIds.slice(i, i + CHUNK), road_side: 'both', depth_cells: 6 }, { timeoutMs: 40000 });
  for (const c of res.data?.items ?? []) {
    const x = c.position?.x, z = c.position?.z;
    if (!Number.isFinite(x)) continue;
    const r = zoneAt(x, z);
    const actual = c.zone ?? 'Unzoned';
    const planned = r?.label ?? null;
    if (planned && actual === planned) { match++; perLabel[planned] = (perLabel[planned] || 0) + 1; }
    else if (planned && actual === 'Unzoned') plannedBlank++;
    else if (planned && actual !== planned) { mismatch++; if (bad.length < 25) bad.push({ x, z, planned, actual, state: c.state, edge: c.edge_id, side: c.side }); }
    else if (!planned && actual !== 'Unzoned') { unplannedZoned++; if (bad.length < 25) bad.push({ x, z, planned: '(outside plan)', actual, state: c.state }); }
    else blankBlank++;
  }
}
console.log('\n--- zoning read-back ---');
console.log('cells matching plan   :', match);
console.log('planned but unzoned   :', plannedBlank, '(non-modifiable: blocked/shared/occupied)');
console.log('planned but WRONG zone:', mismatch);
console.log('zoned outside plan    :', unplannedZoned);
console.log('blank & unplanned     :', blankBlank);
console.log('\n--- matching cells per planned zone ---');
for (const [l, n] of Object.entries(perLabel).sort((a, b) => b[1] - a[1])) console.log(' ', l.padEnd(28), n);
if (bad.length) { console.log('\n--- samples needing attention ---'); for (const b of bad) console.log(' ', JSON.stringify(b)); }
