// Find a periphery site for the remaining transformer station:
//  - outside the hexagon (outer side of the ring road)
//  - on a ring-road edge (so the low-voltage grid connects to the road)
//  - clear of collisions (a wind turbine already sits NW at (-1064.8, -799.5))
//  - as close as reasonable to the high-voltage line's eastern free end (-1374.7, -555)
//
// Usage: node tools/scratch/find-transformer-periphery-site.mjs

import { queryGame } from '../../mcp/bridge-client.mjs';

const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6);      // ring edge midpoint radius = 776
const HV_END = { x: -1374.687, z: -554.981 };

// Ring NW edge: (-848,-472) -> (-1296,-1248). Walk it and probe outward.
const A = { x: -848, z: -472 }, B = { x: -1296, z: -1248 };
const len = Math.hypot(B.x - A.x, B.z - A.z);
const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len;
const out = { x: -uz, z: ux };                    // one of the two normals
// make sure it points away from the hexagon centre
const mid = { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
if ((mid.x + out.x * 10 - CENTRE.x) ** 2 + (mid.z + out.z * 10 - CENTRE.z) ** 2 <
    (mid.x - CENTRE.x) ** 2 + (mid.z - CENTRE.z) ** 2) { out.x = -out.x; out.z = -out.z; }
console.log('ring NW edge length', len.toFixed(1), 'outward normal', out.x.toFixed(3), out.z.toFixed(3));

// live ring edges (Large Road within the window)
const snap = await queryGame('get_planning_map_snapshot', {
  bounds: { min_x: -1500, max_x: -800, min_z: -1400, max_z: -400 },
  include_roads: true, max_features_per_layer: 4000,
});
const ringIds = new Set((snap.data.roads || []).filter((r) => /large road/i.test(r.prefab)).map((r) => r.id));
console.log('large-road edges in window:', ringIds.size);

const results = [];
for (let t = 0.12; t <= 1.0; t += 0.11) {
  const base = { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
  const anchor = { x: +(base.x + out.x * 55).toFixed(1), z: +(base.z + out.z * 55).toFixed(1) };
  let r;
  try {
    r = await queryGame('plan_building_site', {
      building_prefab: 'TransformerStation01', near: anchor, search_radius_m: 140, candidate_count: 8,
    });
  } catch (e) {
    console.log('t=' + t.toFixed(2), 'anchor', anchor, 'ERR', e.code, String(e.message).slice(0, 120));
    continue;
  }
  const cs = r.data.candidates || [];
  const good = cs.filter((c) => ringIds.has(c.road_edge_id));
  console.log('\nt=' + t.toFixed(2), 'anchor(' + anchor.x + ',' + anchor.z + ')  candidates=' + cs.length + '  onRing=' + good.length);
  for (const c of cs.slice(0, 6)) {
    const dCentre = Math.hypot(c.position.x - CENTRE.x, c.position.z - CENTRE.z);
    const dHv = Math.hypot(c.position.x - HV_END.x, c.position.z - HV_END.z);
    const outside = dCentre > R_EDGE;
    const onRing = ringIds.has(c.road_edge_id);
    console.log('   (' + c.position.x.toFixed(1) + ',' + c.position.z.toFixed(1) + ')' +
      ' rot=' + Number(c.rotation_degrees).toFixed(1) +
      ' outside=' + (outside ? 'Y' : 'N') + ' onRing=' + (onRing ? 'Y' : 'N') +
      ' coll=' + c.approximate_collision + ' dCentre=' + dCentre.toFixed(0) + ' dHV=' + dHv.toFixed(0) +
      ' side=' + c.road_side + ' [' + c.road_prefab + ']');
    if (outside && onRing && !c.approximate_collision) {
      results.push({ t, ...c, dCentre, dHv });
    }
  }
}

results.sort((a, b) => a.dHv - b.dHv);
console.log('\n=== viable sites (outside + on ring + no collision), sorted by distance to HV entry ===');
for (const s of results) {
  console.log('  (' + s.position.x.toFixed(1) + ',' + s.position.z.toFixed(1) + ') rot=' + Number(s.rotation_degrees).toFixed(1) +
    ' dCentre=' + s.dCentre.toFixed(0) + ' dHV=' + s.dHv.toFixed(0) + ' side=' + s.road_side + ' road=' + s.road_edge_id);
}
if (!results.length) console.log('  (none)');
const fs = await import('node:fs');
fs.writeFileSync('tools/scratch/_transformer-site-candidates.json', JSON.stringify({ hvEnd: HV_END, centre: CENTRE, R_EDGE, viable: results }, null, 2));
console.log('\nwritten tools/scratch/_transformer-site-candidates.json');
