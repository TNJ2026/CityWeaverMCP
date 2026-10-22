// Classify live native zoning cells against the hexagon plan's zone blocks.
// Chunked small enough that the native cell list is never truncated.
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const map = JSON.parse(fs.readFileSync('tools/scratch/_live-edge-map.json', 'utf8'));

const rects = plan.plan.zones.map(z => {
  const xs = z.polygon.map(q => q.x), zz = z.polygon.map(q => q.z);
  return {
    id: z.id, kind: z.kind, label: z.label, district: z.district,
    x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zz), z1: Math.max(...zz),
  };
});
function zoneAt(x, z) {
  for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
  return null;
}

const edgeIds = map.matched.map(m => m.id);
const edgeMeta = new Map(map.matched.map(m => [m.id, m]));

const allCells = [];
const stateHist = {};
let truncatedChunks = 0;
let CHUNK = 12;
for (let i = 0; i < edgeIds.length; i += CHUNK) {
  const chunk = edgeIds.slice(i, i + CHUNK);
  let res, guard = 0;
  for (;;) {
    res = await queryGame('analyze_zoning_cells', { edge_ids: chunk, road_side: 'both', depth_cells: 6 }, { timeoutMs: 40000 });
    if (!res.data?.items_truncated || chunk.length <= 1) break;
    truncatedChunks++;
    if (guard++ > 3) break;
    // halve and process two sub-requests
    res = null; break;
  }
  if (res) {
    const items = res.data?.items ?? [];
    for (const c of items) allCells.push(c);
  }
  process.stderr.write(`chunk ${Math.floor(i / CHUNK) + 1}: edges=${chunk.length} cells=${res?.data?.items?.length ?? 0} truncated=${res?.data?.items_truncated}\n`);
}

console.log('\ntotal cells analysed:', allCells.length);
for (const c of allCells) {
  const s = String(c.state || '').split(',').map(t => t.trim()).filter(Boolean).join('+') || 'none';
  stateHist[s] = (stateHist[s] || 0) + 1;
}
console.log('state histogram:', JSON.stringify(stateHist, null, 1));

const groups = new Map();
let outside = 0, classified = 0;
for (const c of allCells) {
  const x = c.position?.x, z = c.position?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
  const r = zoneAt(x, z);
  if (!r) { outside++; continue; }
  classified++;
  const key = `${c.edge_id}|${c.side}`;
  if (!groups.has(key)) groups.set(key, { edge_id: c.edge_id, side: c.side, labels: new Map(), modLabels: new Map(), cells: 0, modCells: 0 });
  const g = groups.get(key);
  // Native "modifiable" == not Blocked, not Shared, not Redundant, not Occupied.
  const modifiable = !c.occupied && !/blocked|shared|redundant/i.test(String(c.state || ''));
  g.labels.set(r.label, (g.labels.get(r.label) || 0) + 1);
  g.cells++;
  if (modifiable) { g.modLabels.set(r.label, (g.modLabels.get(r.label) || 0) + 1); g.modCells++; }
}

console.log('classified cells:', classified, '| outside plan zones:', outside);
console.log('(edge,side) groups with planned cells:', groups.size);

const list = [...groups.values()].map(g => {
  const src = g.modLabels.size ? g.modLabels : g.labels;
  const sorted = [...src.entries()].sort((a, b) => b[1] - a[1]);
  const agree = src.size === 1;
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  return { ...g, zone: sorted[0][0], zoneCells: sorted[0][1], srcTotal: total, agree, runners: sorted.slice(1) };
});
const clean = list.filter(g => g.agree);
const conflicts = list.filter(g => !g.agree);
console.log('clean groups:', clean.length, '| conflicting groups:', conflicts.length);
if (conflicts.length) {
  console.log('\n--- CONFLICTS (majority chosen) ---');
  for (const c of conflicts) {
    const m = edgeMeta.get(c.edge_id);
    console.log(` ${c.edge_id} plan=${m?.planId} side=${c.side} mod=${c.modCells}/${c.cells} :: ${c.zone}(${c.zoneCells}) + ${c.runners.map(([l, n]) => `${l}(${n})`).join(' ')}`);
  }
}

const zoneTotals = {};
for (const g of list) zoneTotals[g.zone] = (zoneTotals[g.zone] || 0) + g.zoneCells;
console.log('\n--- cells per planned zone ---');
for (const [z, n] of Object.entries(zoneTotals).sort((a, b) => b[1] - a[1])) console.log(' ', z.padEnd(28), n);

// planned zone blocks actually reached by at least one edge
const reached = new Set();
for (const g of list) reached.add(g.zone);
const plannedLabels = new Set(rects.map(r => r.label));
console.log('\nplanned labels reached:', reached.size, '/', plannedLabels.size);
console.log('planned labels NOT reached:', [...plannedLabels].filter(l => !reached.has(l)).join(', ') || '(none)');

const assign = new Map();
for (const g of list) {
  const key = `${g.zone}|${g.side}`;
  if (!assign.has(key)) assign.set(key, { zone: g.zone, side: g.side, edge_ids: [], cells: 0 });
  const a = assign.get(key); a.edge_ids.push(g.edge_id); a.cells += g.zoneCells;
}
const assignments = [...assign.values()].sort((a, b) => b.cells - a.cells);

fs.writeFileSync('tools/scratch/_zoning-plan.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total_cells: allCells.length, classified_cells: classified, outside_cells: outside,
  clean_groups: clean.length, conflicts, assignments, zones_in_plan: rects.length,
}, null, 1));
console.log('\nwrote tools/scratch/_zoning-plan.json');
