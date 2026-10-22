#!/usr/bin/env node
// Walk the whole hexagon ring road and collect every OUTER-side roadside candidate for
// WaterTower01, so we can pick three well-separated periphery sites.
//
// Usage: node tools/scratch/find-water-tower-ring-sites.mjs
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);

const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6); // 776

// hexagon vertices (from the plan geometry)
const V = plan.geometry.hexagon.vertices.map((v) => ({ x: v.x, z: v.z }));
console.log('hexagon vertices:', V.map((v) => `(${v.x}, ${v.z})`).join('  '));

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const roads = snap.data?.roads ?? [];
const ringIds = new Set(roads.filter((r) => /large/i.test(r.prefab)).map((r) => r.id));
console.log(`live road edges ${roads.length}; ring (Large Road) ${ringIds.size}`);

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};

// sample each ring edge finely so we can measure the true road-centreline gap of a candidate
const ringPts = [];
for (const r of roads) {
  if (!ringIds.has(r.id)) continue;
  for (let i = 0; i <= 24; i++) ringPts.push(bez(r.curve, i / 24));
}
console.log(`ring sample points: ${ringPts.length}`);

const gapToRing = (p) => {
  let best = Infinity;
  for (const q of ringPts) {
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < best) best = d;
  }
  return best;
};
const distC = (p) => Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);

const ANCHORS = [];
for (let e = 0; e < 6; e++) {
  const A = V[e], B = V[(e + 1) % V.length];
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const nx = mx - CENTRE.x, nz = mz - CENTRE.z;
  const nl = Math.hypot(nx, nz);
  for (let t = 0.14; t <= 0.87; t += 0.12) {
    const base = { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
    ANCHORS.push({
      edge: e,
      t: +t.toFixed(2),
      bearing: +(((Math.atan2(base.z - CENTRE.z, base.x - CENTRE.x) * 180) / Math.PI).toFixed(1)),
      anchor: { x: +(base.x + (nx / nl) * 60).toFixed(1), z: +(base.z + (nz / nl) * 60).toFixed(1) },
    });
  }
}
console.log(`anchors: ${ANCHORS.length}\n`);

const viable = [];
const all = [];
for (const a of ANCHORS) {
  let cs = [];
  for (const mode of ['road_edge', 'auto', 'roadside']) {
    try {
      const r = await queryGame('plan_utility_facility_site', {
        building_prefab: 'WaterTower01', near: a.anchor, mode,
        search_radius_m: 140, road_side: 'either', candidate_count: 8,
      });
      cs = r.data?.candidates ?? [];
      if (cs.length) { a.mode = mode; break; }
    } catch (e) {
      console.log(`anchor e${a.edge} t${a.t} mode=${mode} ERR ${e.code}: ${String(e.message).slice(0, 140)}`);
    }
    await sleep(120);
  }
  for (const c of cs) {
    const dC = distC(c.position);
    const onRing = ringIds.has(c.road_edge_id);
    const gap = gapToRing(c.position);
    const rec = {
      edge: a.edge, t: a.t, bearing: a.bearing, mode: a.mode ?? 'auto',
      position: c.position, rotation_degrees: c.rotation_degrees,
      road_edge_id: c.road_edge_id, road_prefab: c.road_prefab, road_side: c.road_side,
      collision: c.approximate_collision, dCentre: +dC.toFixed(1), gap: +gap.toFixed(1),
      onRing,
    };
    all.push(rec);
    if (onRing && dC > R_EDGE && !c.approximate_collision) viable.push(rec);
  }
  await sleep(150);
}

console.log(`candidates total ${all.length}, viable ${viable.length}\n`);
viable.sort((a, b) => b.dCentre - a.dCentre);
console.log('=== viable (on ring, outside, no collision) — sorted outermost first ===');
for (const v of viable) {
  console.log(
    `  e${v.edge} t${v.t} bearing=${String(v.bearing).padStart(6)}deg  (${v.position.x.toFixed(1)}, ${v.position.z.toFixed(1)})` +
      `  rot=${Number(v.rotation_degrees).toFixed(1)}  r=${v.dCentre}  gap=${v.gap}m  side=${v.road_side}  ${v.road_edge_id}`,
  );
}

writeFileSync('tools/scratch/_water-tower-ring-candidates.json', JSON.stringify({
  centre: CENTRE, rEdge: R_EDGE, ringEdgeCount: ringIds.size, viable, all,
}, null, 2));
console.log('\nwritten tools/scratch/_water-tower-ring-candidates.json');
