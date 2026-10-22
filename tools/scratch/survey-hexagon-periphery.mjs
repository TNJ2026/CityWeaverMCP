#!/usr/bin/env node
// Survey the hexagon's outer periphery: where does the ring road actually run, what is the
// outer boundary radius, and which prefab footprint does a WaterTower01 occupy.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);

const CENTRE = { x: -400, z: -1248 };
const R_VERT = 896;
const R_EDGE = 896 * Math.cos(Math.PI / 6); // 776

// --- plan-side geometry for the three towers
for (const id of ['bld-003', 'bld-004', 'bld-005']) {
  const b = plan.plan.buildings.find((x) => x.id === id);
  console.log(
    `${id} ${b.prefab} size_m=${JSON.stringify(b.size_m)} reserved=${JSON.stringify(b.reserved_size_m)} ` +
      `rot=${b.rotation_degrees} road=${b.road_edge_id} side=${b.road_side} order=${b.construction_order}`,
  );
}

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const roads = snap.data?.roads ?? [];
console.log(`\nlive road edges in bounds: ${roads.length}`);

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};

const prefabs = {};
for (const r of roads) prefabs[r.prefab] = (prefabs[r.prefab] ?? 0) + 1;
console.log('road prefabs:');
for (const [k, v] of Object.entries(prefabs).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

// which edges are farthest from the centre?
const far = [];
for (const r of roads) {
  let minR = Infinity, maxR = 0, n = null, mid = null;
  for (let i = 0; i <= 32; i++) {
    const q = bez(r.curve, i / 32);
    const d = Math.hypot(q.x - CENTRE.x, q.z - CENTRE.z);
    if (d < minR) { minR = d; n = q; }
    if (d > maxR) { maxR = d; mid = q; }
  }
  far.push({ r, minR, maxR, mid });
}
far.sort((a, b) => b.maxR - a.maxR);
console.log('\n--- 14 edges with the largest max-radius ---');
for (const f of far.slice(0, 14)) {
  console.log(
    `  ${f.r.id}  ${f.r.prefab}  minR=${f.minR.toFixed(0)} maxR=${f.maxR.toFixed(0)}  ` +
      `farPoint=(${f.mid.x.toFixed(1)}, ${f.mid.z.toFixed(1)})`,
  );
}

console.log('\n--- nearest road edge to each of the 6 hexagon edge-midpoints (outer side) ---');
for (const deg of [30, 90, 150, 210, 270, 330]) {
  const a = (deg * Math.PI) / 180;
  const anchor = { x: CENTRE.x + R_EDGE * Math.cos(a), z: CENTRE.z + R_EDGE * Math.sin(a) };
  let best = null;
  for (const f of far) {
    const d = Math.hypot(f.mid.x - anchor.x, f.mid.z - anchor.z);
    if (!best || d < best.d) best = { d, f };
  }
  console.log(
    `  ${String(deg).padStart(3)}deg anchor=(${anchor.x.toFixed(1)}, ${anchor.z.toFixed(1)})  ` +
      `-> ${best.f.r.id} ${best.f.r.prefab} maxR=${best.f.maxR.toFixed(0)} centreDist=${best.d.toFixed(1)}`,
  );
}
