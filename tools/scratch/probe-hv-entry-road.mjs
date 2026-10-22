// Probe: find live roads near the high-voltage line's eastern free end,
// so we can site the transformer station where both road and HV line are reachable.
//
// Usage: node tools/scratch/probe-hv-entry-road.mjs

import { queryGame } from '../../mcp/bridge-client.mjs';

const CUBIC = 24; // samples per bezier

function bezier(c, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * c.a.x + b * c.b.x + cc * c.c.x + d * c.d.x,
    z: a * c.a.z + b * c.b.z + cc * c.c.z + d * c.d.z,
  };
}

function sampleCurve(curve) {
  if (!curve) return [];
  const pts = [];
  for (let i = 0; i <= CUBIC; i++) pts.push(bezier(curve, i / CUBIC));
  return pts;
}

function distToPolyline(px, pz, pts) {
  let best = Infinity, bp = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1];
    const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - A.x) * dx + (pz - A.z) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = A.x + t * dx, cz = A.z + t * dz;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < best) { best = d; bp = { x: cx, z: cz, t, A, B }; }
  }
  return { d: best, bp };
}

// 1) HV line edges -> find free ends
const net = await queryGame('list_utility_networks', { kind: 'all' });
const edges = (net.data.items || []).filter((e) => /high-voltage line/i.test(e.prefab));
const deg = new Map();
const nodePos = new Map();
for (const e of edges) {
  deg.set(e.start_node_id, (deg.get(e.start_node_id) || 0) + 1);
  deg.set(e.end_node_id, (deg.get(e.end_node_id) || 0) + 1);
  nodePos.set(e.start_node_id, e.start);
  nodePos.set(e.end_node_id, e.end);
}
const freeEnds = [...deg.entries()].filter(([, d]) => d === 1).map(([id]) => ({ id, ...nodePos.get(id) }));
console.log('=== HV line free ends ===');
for (const f of freeEnds) console.log(' ', f.id, '(' + f.x.toFixed(1) + ', ' + f.z.toFixed(1) + ')');

// The eastern free end = max x
const east = freeEnds.sort((a, b) => b.x - a.x)[0];
console.log('\ntarget HV entry point (eastern free end):', '(' + east.x.toFixed(1) + ', ' + east.z.toFixed(1) + ')');

// 2) live roads in a window around it
const R = 700;
const bounds = {
  min_x: Math.floor(east.x - R), max_x: Math.ceil(east.x + R),
  min_z: Math.floor(east.z - R), max_z: Math.ceil(east.z + R),
};
const snap = await queryGame('get_planning_map_snapshot', { bounds, include_roads: true, max_features_per_layer: 4000 });
const roads = snap.data.roads || [];
console.log('\nroads in window', JSON.stringify(bounds), '->', roads.length);

const ranked = [];
for (const r of roads) {
  const pts = sampleCurve(r.curve);
  if (!pts.length) continue;
  const { d, bp } = distToPolyline(east.x, east.z, pts);
  ranked.push({ d, bp, id: r.id, prefab: r.prefab || r.name, status: r.status, width_m: r.width_m });
}
ranked.sort((a, b) => a.d - b.d);
console.log('\n=== nearest live roads to the HV entry point ===');
for (const r of ranked.slice(0, 12)) {
  console.log('  d=' + r.d.toFixed(1).padStart(7) + 'm  ' + String(r.id).padEnd(44) + String(r.prefab).padEnd(14) +
    ' ' + String(r.status).padEnd(9) + ' w=' + r.width_m + '  nearest pt (' + r.bp.x.toFixed(1) + ', ' + r.bp.z.toFixed(1) + ')');
}

// 3) also: which roads are pre-existing (not part of our hexagon plan)?
const fs = await import('node:fs');
const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const map = JSON.parse(fs.readFileSync('tools/scratch/_live-edge-map.json', 'utf8'));
const ours = new Set(map.matched.map((m) => m.id));
console.log('\n=== nearest roads flagged: ours(town) vs pre-existing ===');
for (const r of ranked.slice(0, 12)) {
  console.log('  d=' + r.d.toFixed(1).padStart(7) + 'm  ' + (ours.has(r.id) ? 'TOWN' : 'PRE-EXISTING') + '  ' + r.id + ' [' + r.prefab + ']');
}

// 4) terrain sample along the gap
const line = [];
for (let i = 0; i <= 6; i++) {
  const t = i / 6;
  line.push({ x: +(east.x + (ranked[0].bp.x - east.x) * t).toFixed(1), z: +(east.z + (ranked[0].bp.z - east.z) * t).toFixed(1) });
}
const terr = await queryGame('sample_terrain', { points: line });
console.log('\n=== terrain along HV entry -> nearest road ===');
console.log(JSON.stringify(terr.data ?? terr).slice(0, 1200));

// 5) electricity demand / supply snapshot
const ov = await queryGame('get_city_management_overview', {});
const d = ov.data;
console.log('\npopulation', d.population?.population, '| money', d.economy?.money);
console.log('overview keys:', Object.keys(d).join(', '));
for (const k of Object.keys(d)) {
  if (/electric|power|utility|service|city/i.test(k)) console.log('  ', k, '=', JSON.stringify(d[k]).slice(0, 500));
}
