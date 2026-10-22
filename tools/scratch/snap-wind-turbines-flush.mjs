#!/usr/bin/env node
// Snap the relocated small wind turbines flush against the ring road.
//
// Why: the generic roadside planner reserves the wind turbine's full 63.6 m rotor footprint
// (half extent 31.8 m), so it parks the turbine 31.8 + 16 = 48 m from the road centreline.
// The turbine's actual lot is 2x2 cells (half depth 8 m), so that leaves a 24 m air gap and the
// low-voltage grid - whose native layer is "Road, PowerlineLow" - never reaches the building.
// Result: no road edge, 0 kW. Moving it inward to lot-half-depth + road-half-width (8 + 16 = 24 m)
// puts the lot frontage flush with the road edge; the turbine then connects and runs at capacity.
//
// Usage: node tools/scratch/snap-wind-turbines-flush.mjs [--dry-run] [--flush 24]
import { queryGame } from '../../mcp/bridge-client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = has('--dry-run');
const FLUSH = Number(val('--flush') ?? 24);

const TURBINES = [
  { planId: 'bld-007', label: '小型风机 1', entity: 'fd537682d55349c282f74590a72dea69:361576:5', rotation: -119.998695 },
  { planId: 'bld-008', label: '小型风机 2', entity: 'fd537682d55349c282f74590a72dea69:361829:3', rotation: 120.0 },
];

const bez = (c, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
    z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
  };
};

const plan = JSON.parse((await import('node:fs')).readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8'));
const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const live = new Map((snap.data.roads || []).map((r) => [r.id, r]));

const IN_FLIGHT = ['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building'];
async function poll(opId, terminal = null) {
  let d = null;
  for (let i = 0; i < 300; i++) {
    d = (await queryGame('get_building_operation', { operation_id: opId })).data;
    if (terminal ? terminal.includes(d.state) : d.state && !IN_FLIGHT.includes(d.state)) break;
    await sleep(100);
  }
  return d;
}
async function retryBusy(fn, label, tries = 25) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      if (e.code === 'TOOL_BUSY' && i < tries - 1) { await sleep(500); continue; }
      console.log(`   ${label} ERR ${e.code}: ${String(e.message).slice(0, 200)}`); return null;
    }
  }
  return null;
}

for (const t of TURBINES) {
  console.log(`\n=== ${t.planId} ${t.label}`);
  await sleep(900);
  const fac = (await queryGame('list_utility_facilities', { kind: 'power_plant' })).data.items
    .find((f) => f.facility_id === t.entity);
  const P = fac?.position;
  if (!P) { console.log('   facility not found'); continue; }

  // resolve the nearest ring (Large Road) edge geometrically - road_edge_id may still be unresolved
  let roadEdgeId = fac?.road_edge_id;
  if (!roadEdgeId || !live.has(roadEdgeId)) {
    let best = null;
    for (const r of live.values()) {
      if (!/large/i.test(r.prefab)) continue;
      const pts = Array.from({ length: 33 }, (_, i) => bez(r.curve, i / 32));
      for (const q of pts) {
        const dd = Math.hypot(q.x - P.x, q.z - P.z);
        if (!best || dd < best.d) best = { d: dd, id: r.id, edge: r, pt: q };
      }
    }
    if (!best) { console.log('   no ring edge found'); continue; }
    roadEdgeId = best.id;
  }
  const edge = live.get(roadEdgeId);
  if (!edge) { console.log('   road edge not in live snapshot:', roadEdgeId); continue; }

  const pts = Array.from({ length: 65 }, (_, i) => bez(edge.curve, i / 64));
  let N = pts[0];
  for (const q of pts) if (Math.hypot(q.x - P.x, q.z - P.z) < Math.hypot(N.x - P.x, N.z - P.z)) N = q;
  const dx = P.x - N.x, dz = P.z - N.z;
  const len = Math.hypot(dx, dz);
  const u = { x: dx / len, z: dz / len };
  const target = { x: N.x + u.x * FLUSH, z: N.z + u.z * FLUSH };
  console.log(`   now (${P.x.toFixed(2)}, ${P.z.toFixed(2)})  nearest road point (${N.x.toFixed(2)}, ${N.z.toFixed(2)})  gap ${len.toFixed(1)} m`);
  console.log(`   target (${target.x.toFixed(2)}, ${target.z.toFixed(2)})  = road + ${FLUSH} m outward  road_edge_id ${roadEdgeId}`);

  const requestId = `wind-flush-${t.planId}-${Date.now()}`;
  const q = await retryBusy(() => queryGame('preview_building_move', {
    request_id: requestId, building_id: t.entity,
    position: { x: target.x, z: target.z }, rotation_degrees: t.rotation, road_edge_id: roadEdgeId,
  }), 'PREVIEW');
  if (!q) continue;
  const opId = q.data.operation_id;
  const d = await poll(opId);
  console.log(`   preview state=${d.state} cost=${d.cost} errors=${JSON.stringify(d.errors ?? d.error ?? []).slice(0, 240)}`);
  if (d.state !== 'preview_ready') { await queryGame('cancel_building_preview', { operation_id: opId }).catch(() => {}); continue; }
  if (DRY) { await queryGame('cancel_building_preview', { operation_id: opId }); console.log('   (dry-run: cancelled)'); continue; }

  const applied = await retryBusy(() => queryGame('apply_building_operation', {
    operation_id: opId, request_id: requestId, max_cost: Number(d.cost ?? 0) + 1000,
  }), 'APPLY');
  if (!applied) continue;
  const done = await poll(opId, ['completed', 'failed']);
  console.log(`   COMMIT state=${done.state} errors=${JSON.stringify(done.errors ?? done.error ?? []).slice(0, 200)}`);
}
