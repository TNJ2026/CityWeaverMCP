#!/usr/bin/env node
// Move the three small wind turbines from the far-east wind belt to the hexagon's outer
// periphery, roadside on the ring road (hex-ring / "Large Road"), so they gain road access.
//
// Usage:
//   node tools/scratch/move-windfarm-to-ring.mjs --dry-run        # preview only, cancel at the end
//   node tools/scratch/move-windfarm-to-ring.mjs                  # preview + commit
//   node tools/scratch/move-windfarm-to-ring.mjs --only bld-008   # single turbine
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = has('--dry-run');
const ONLY = val('--only');

const PLAN_PATH = 'plans/peiqi-hexagon-town-bound.json';
const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6); // 776 m to the hexagon edge midpoints

// live entity id per plan building, resolved by matching the facility position
const TURBINES = [
  { planId: 'bld-007', label: '小型风机 1', x: 634.0, z: -658.8, entity: 'fd537682d55349c282f74590a72dea69:361576:5', anchorDeg: 30 },
  { planId: 'bld-008', label: '小型风机 2', x: 694.4, z: -587.8, entity: 'fd537682d55349c282f74590a72dea69:361829:3', anchorDeg: 150 },
  { planId: 'bld-009', label: '小型风机 3', x: 681.6, z: -715.8, entity: 'fd537682d55349c282f74590a72dea69:362016:3', anchorDeg: 270 },
];

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const snap = await queryGame('get_planning_map_snapshot', {
  bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000,
});
const ringIds = new Set((snap.data.roads || []).filter((r) => /large/i.test(r.prefab)).map((r) => r.id));
console.log(`ring (Large Road) live edges: ${ringIds.size}   mode: ${DRY ? 'DRY-RUN (preview only)' : 'COMMIT'}\n`);

const IN_FLIGHT = ['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building'];

async function pollBuilding(opId, terminal = null) {
  let d = null;
  for (let i = 0; i < 300; i++) {
    const r = await queryGame('get_building_operation', { operation_id: opId });
    d = r.data;
    if (terminal) { if (terminal.includes(d.state)) break; }
    else if (d.state && !IN_FLIGHT.includes(d.state)) break;
    await sleep(100);
  }
  return d;
}

// The native tool pipeline is single-threaded: retry while a previous move is still settling.
async function withBusyRetry(fn, label, tries = 25) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.code === 'TOOL_BUSY' && i < tries - 1) { await sleep(500); continue; }
      console.log(`   ${label} ERR ${e.code}: ${String(e.message).slice(0, 220)}`);
      return null;
    }
  }
  return null;
}

async function pickSite(deg) {
  const a = (deg * Math.PI) / 180;
  const near = { x: +(CENTRE.x + (R_EDGE + 60) * Math.cos(a)).toFixed(1), z: +(CENTRE.z + (R_EDGE + 60) * Math.sin(a)).toFixed(1) };
  const r = await withBusyRetry(
    () => queryGame('plan_building_site', { building_prefab: 'WindTurbine02', near, search_radius_m: 180, candidate_count: 10 }),
    'SITE',
  );
  if (!r) return null;
  const good = (r.data.candidates || [])
    .filter((c) => ringIds.has(c.road_edge_id) && !c.approximate_collision)
    .filter((c) => Math.hypot(c.position.x - CENTRE.x, c.position.z - CENTRE.z) > R_EDGE)   // outer side only
    .sort((x, y) => Math.hypot(x.position.x - CENTRE.x, x.position.z - CENTRE.z) - Math.hypot(y.position.x - CENTRE.x, y.position.z - CENTRE.z));
  return good[0] ?? null;
}

const results = [];
for (const t of TURBINES) {
  if (ONLY && t.planId !== ONLY) continue;
  console.log(`=== ${t.planId} ${t.label}  now (${t.x}, ${t.z})  -> anchor ${t.anchorDeg}deg`);
  await sleep(900); // let the previous native operation fully settle before touching the tool pipeline again
  const site = await pickSite(t.anchorDeg);
  if (!site) { console.log('   NO SITE FOUND\n'); results.push({ ...t, state: 'no_site' }); continue; }
  const rNew = Math.hypot(site.position.x - CENTRE.x, site.position.z - CENTRE.z);
  console.log(
    `   target (${site.position.x.toFixed(2)}, ${site.position.z.toFixed(2)}) rot=${site.rotation_degrees.toFixed(2)} ` +
    `r=${rNew.toFixed(1)} m side=${site.road_side} road=${site.road_prefab}`,
  );
  console.log(`   road_edge_id ${site.road_edge_id}`);

  const requestId = `wind-move-${t.planId}-${Date.now()}`;
  const q = await withBusyRetry(
    () => queryGame('preview_building_move', {
      request_id: requestId, building_id: t.entity,
      position: { x: site.position.x, z: site.position.z },
      rotation_degrees: site.rotation_degrees,
      road_edge_id: site.road_edge_id,
    }),
    'PREVIEW',
  );
  if (!q) { results.push({ ...t, state: 'preview_error' }); console.log(''); continue; }
  const opId = q.data.operation_id;
  const d = await pollBuilding(opId);
  const errs = d.errors ?? d.error ?? [];
  console.log(`   preview state=${d.state} cost=${d.cost} can_commit=${d.can_commit} errors=${JSON.stringify(errs).slice(0, 300)}`);

  if (d.state !== 'preview_ready') {
    await queryGame('cancel_building_preview', { operation_id: opId }).catch(() => {});
    results.push({ ...t, state: d.state, errors: errs, target: site.position });
    console.log('');
    continue;
  }

  if (DRY) {
    await queryGame('cancel_building_preview', { operation_id: opId });
    console.log('   (dry-run: preview cancelled)\n');
    results.push({ ...t, state: 'preview_ready (cancelled)', target: site.position, rotation: site.rotation_degrees, road_edge_id: site.road_edge_id, cost: d.cost });
    continue;
  }

  const maxCost = Math.max(Number(d.cost ?? 0), 0) + 1000;
  const applied = await withBusyRetry(
    () => queryGame('apply_building_operation', { operation_id: opId, request_id: requestId, max_cost: maxCost }),
    'APPLY',
  );
  if (!applied) { results.push({ ...t, state: 'apply_error', target: site.position }); console.log(''); continue; }
  const done = await pollBuilding(opId, ['completed', 'failed']);
  console.log(`   COMMIT state=${done.state} errors=${JSON.stringify(done.errors ?? done.error ?? []).slice(0, 260)} result_ids=${JSON.stringify(done.result_ids ?? done.building_ids ?? []).slice(0, 120)}`);
  results.push({
    ...t, state: done.state, target: site.position, rotation: site.rotation_degrees,
    road_edge_id: site.road_edge_id, cost: done.cost ?? d.cost, result_ids: done.result_ids ?? done.building_ids ?? [],
  });
  console.log('');
}

console.log('=== summary ===');
for (const r of results) console.log(' ', r.planId, r.label, '->', r.state, r.target ? `(${r.target.x.toFixed(1)}, ${r.target.z.toFixed(1)})` : '');

writeFileSync('tools/scratch/_windfarm-move-result.json', JSON.stringify({ at: new Date().toISOString(), dryRun: DRY, results }, null, 2));
console.log('\nwritten tools/scratch/_windfarm-move-result.json');
