// Sanity-check zoning that landed outside explicit plan rectangles: is it sector-consistent?
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const map = JSON.parse(fs.readFileSync('tools/scratch/_live-edge-map.json', 'utf8'));

const rects = plan.plan.zones.map(z => {
  const xs = z.polygon.map(q => q.x), zz = z.polygon.map(q => q.z);
  return { label: z.label, kind: z.kind, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zz), z1: Math.max(...zz) };
});
const zoneAt = (x, z) => rects.find(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ?? null;

const CX = -400, CZ = -1248;             // town centre (junction of the six radials)
const sectorOf = (x, z) => {
  let deg = Math.atan2(z - CZ, x - CX) * 180 / Math.PI;   // +x = 0, +z = 90
  deg = (deg + 360) % 360;
  let best = null, bestD = 1e9;
  for (const s of plan.zoning_model.sectors) {
    let d = Math.abs(deg - s.bisector_deg); d = Math.min(d, 360 - d);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
};
const KIND = { 'Industrial Manufacturing': 'industrial', 'Office High': 'office', 'Office Low': 'office',
  'EU Commercial High': 'commercial', 'EU Commercial Low': 'commercial',
  'EU Residential High': 'residential', 'EU Residential Medium': 'residential',
  'EU Residential Medium Row': 'residential', 'EU Residential Low': 'residential' };

const edgeIds = map.matched.map(m => m.id);
let bleed = 0, sectorOk = 0, sectorBad = 0, coreCount = 0;
const badSamples = [], hist = {};
const CORE = [[-40,-1248],[-220,-936],[-580,-936],[-760,-1248],[-580,-1560],[-220,-1560]];
function inCore(x, z) {
  let inside = false;
  for (let i = 0, j = CORE.length - 1; i < CORE.length; j = i++) {
    const [xi, zi] = CORE[i], [xj, zj] = CORE[j];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

for (let i = 0; i < edgeIds.length; i += 12) {
  const res = await queryGame('analyze_zoning_cells', { edge_ids: edgeIds.slice(i, i + 12), road_side: 'both', depth_cells: 6 }, { timeoutMs: 40000 });
  for (const c of res.data?.items ?? []) {
    const x = c.position?.x, z = c.position?.z;
    if (!Number.isFinite(x)) continue;
    const actual = c.zone ?? 'Unzoned';
    if (actual === 'Unzoned' || zoneAt(x, z)) continue;   // only cells outside explicit rectangles
    bleed++;
    hist[actual] = (hist[actual] || 0) + 1;
    if (inCore(x, z)) { coreCount++; sectorOk++; continue; }
    const s = sectorOf(x, z);
    if (s && KIND[actual] === s.kind) sectorOk++;
    else { sectorBad++; if (badSamples.length < 20) badSamples.push({ x: +x.toFixed(1), z: +z.toFixed(1), actual, sector: s?.key, sector_kind: s?.kind, state: c.state }); }
  }
}
console.log(`cells zoned OUTSIDE explicit plan rectangles: ${bleed}`);
console.log('  inside the central core hexagon (plan core = commercial/office):', coreCount);
console.log('  outside core, sector-kind CONSISTENT:', sectorOk - coreCount);
console.log('  outside core, sector-kind INCONSISTENT:', sectorBad);
console.log('\nzone histogram of the bleed:', JSON.stringify(hist, null, 1));
if (badSamples.length) { console.log('\ninconsistent samples:'); for (const b of badSamples) console.log(' ', JSON.stringify(b)); }
