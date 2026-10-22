// Move the remaining transformer station to the hexagon periphery and connect it to
// both the ring road (low voltage) and the high-voltage line entrance (high voltage).
//
//   site   : (-1021.7, -684.3) rotation 120 deg, on ring edge ...:48954:3  (outer side)
//   HV end : (-1374.687, -554.981)  -- eastern free end of the map's HV line
//
// Usage:
//   node tools/scratch/move-transformer-to-periphery.mjs --dry-run
//   node tools/scratch/move-transformer-to-periphery.mjs
//   node tools/scratch/move-transformer-to-periphery.mjs --skip-connect     (move only)
//
// The city is paused for the whole run and resumed at the end (unless --keep-paused).

import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const KEEP_PAUSED = argv.includes('--keep-paused');
const SKIP_CONNECT = argv.includes('--skip-connect');

const FACILITY_ID = 'fd537682d55349c282f74590a72dea69:362206:3';   // bld-010 TransformerStation01
const SITE = { x: -1021.7, z: -684.3, rotation_degrees: 120.0 };
const RING_EDGE = 'fd537682d55349c282f74590a72dea69:48954:3';
const HV_END = { x: -1374.687, z: -554.981 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_FLIGHT = new Set(['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building']);

async function call(tool, args, { retries = 8, backoffMs = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await queryGame(tool, args); }
    catch (e) {
      lastErr = e;
      if (String(e.code) !== 'TOOL_BUSY') throw e;
      await sleep(backoffMs * (i + 1));
    }
  }
  throw lastErr;
}

async function poll(api, opId) {
  let d = null;
  for (let i = 0; i < 500; i++) {
    d = (await call(api, { operation_id: opId }, { retries: 4 })).data;
    if (d.state && !IN_FLIGHT.has(d.state)) return d;
    await sleep(100);
  }
  return d;
}

async function hvEdgeCount() {
  const n = await call('list_utility_networks', { kind: 'all' });
  const items = n.data.items || [];
  return { total: items.length, hv: items.filter((e) => /high-voltage line/i.test(e.prefab)).length, items };
}

async function facility() {
  const r = await call('list_utility_facilities', { kind: 'all' });
  return (r.data.items || []).find((f) => f.facility_id === FACILITY_ID) ?? null;
}

const out = { at: new Date().toISOString(), facilityId: FACILITY_ID, site: SITE, hvEnd: HV_END };

try {
  const before = await facility();
  const netBefore = await hvEdgeCount();
  console.log('=== before ===');
  console.log('  facility at (' + before.position.x.toFixed(1) + ', ' + before.position.z.toFixed(1) + ') road=' + before.road_edge_id);
  console.log('  utility network edges: total=' + netBefore.total + ' hv=' + netBefore.hv);
  out.before = { position: before.position, road_edge_id: before.road_edge_id, hv_edges: netBefore.hv, total_edges: netBefore.total };

  await call('set_simulation_speed', { speed: 'paused' });
  await sleep(600);
  const st = (await call('get_game_status', {})).data;
  console.log('  paused:', st.paused, '| money:', st.money);

  // ---- 1. relocate -------------------------------------------------------
  console.log('\n=== 1. relocate transformer to (' + SITE.x + ', ' + SITE.z + ') rot=' + SITE.rotation_degrees + ' ===');
  const moveRid = 'transform-move-' + Date.now();
  const mq = await call('preview_utility_facility_move', {
    request_id: moveRid, facility_id: FACILITY_ID,
    position: { x: SITE.x, z: SITE.z }, rotation_degrees: SITE.rotation_degrees, road_edge_id: RING_EDGE,
  });
  const moveOp = mq.data.operation_id;
  const md = await poll('get_utility_facility_operation', moveOp);
  console.log('  preview:', md.state, '| cost:', md.cost, '| errors:', JSON.stringify(md.errors ?? []), '| warnings:', JSON.stringify(md.warnings ?? []));
  out.movePreview = { state: md.state, cost: md.cost, errors: md.errors ?? [] };

  if (md.state !== 'preview_ready') {
    console.log('  !! move preview not ready — aborting');
    await call('cancel_utility_facility_preview', { operation_id: moveOp }).catch(() => {});
    if (!KEEP_PAUSED) await call('set_simulation_speed', { speed: 'normal' });
    process.exit(1);
  }
  if (DRY) {
    await call('cancel_utility_facility_preview', { operation_id: moveOp }).catch(() => {});
    console.log('  (dry-run) move preview ok, cancelled');
  } else {
    await call('apply_utility_facility_operation', { operation_id: moveOp, request_id: moveRid, max_cost: Math.max(Number(md.cost ?? 0), 0) + 1000 });
    const done = await poll('get_utility_facility_operation', moveOp);
    console.log('  commit:', done.state, '| errors:', JSON.stringify(done.errors ?? []));
    out.moveCommit = { state: done.state, cost: done.cost ?? md.cost, errors: done.errors ?? [] };
    if (done.state !== 'completed') {
      console.log('  !! move did not complete');
      if (!KEEP_PAUSED) await call('set_simulation_speed', { speed: 'normal' });
      process.exit(1);
    }
    const after = await facility();
    console.log('  now at (' + after.position.x.toFixed(1) + ', ' + after.position.z.toFixed(1) + ') road=' + after.road_edge_id);
    out.afterMove = { position: after.position, road_edge_id: after.road_edge_id };
  }

  // ---- 2. connect high voltage -----------------------------------------
  if (!SKIP_CONNECT && !DRY) {
    console.log('\n=== 2. connect high_voltage port to the HV line ===');
    const cRid = 'transform-hv-' + Date.now();
    const res = await call('connect_utility_facility', {
      request_id: cRid, facility_id: FACILITY_ID, connection: 'high_voltage',
      utility_prefab: 'High-voltage Line', search_radius_m: 900, routing: 'direct',
      max_preview_attempts: 8, operation_timeout_ms: 60000, max_cost: 500000,
    });
    const d = res.data ?? res;
    console.log(JSON.stringify(d).slice(0, 2500));
    out.hvConnect = d;
  }

  if (DRY) {
    console.log('\n(dry-run) done — nothing committed');
    if (!KEEP_PAUSED) await call('set_simulation_speed', { speed: 'normal' });
    process.exit(0);
  }

  const netAfter = await hvEdgeCount();
  console.log('\n=== after ===');
  console.log('  utility network edges: total=' + netAfter.total + ' hv=' + netAfter.hv + '  (was hv=' + netBefore.hv + ')');
  out.after = { hv_edges: netAfter.hv, total_edges: netAfter.total };

  const f = await facility();
  console.log('  facility at (' + f.position.x.toFixed(1) + ', ' + f.position.z.toFixed(1) + ') road=' + f.road_edge_id);
  const ports = await call('list_utility_connection_points', { facility_id: FACILITY_ID, connection: 'auto' });
  console.log('  ports:');
  for (const p of ports.data.items || []) {
    console.log('    ' + String(p.connection).padEnd(14) + String(p.layers).padEnd(26) +
      ' edges=' + p.connected_edge_count + ' ext=' + p.externally_connected +
      ' (' + p.position.x.toFixed(1) + ', ' + p.position.z.toFixed(1) + ')');
  }
  out.ports = (ports.data.items || []).map((p) => ({ connection: p.connection, layers: p.layers, edges: p.connected_edge_count, external: p.externally_connected, position: p.position }));

  if (!KEEP_PAUSED) {
    await call('set_simulation_speed', { speed: 'normal' });
    await sleep(400);
    console.log('\nsimulation resumed: paused =', (await call('get_game_status', {})).data.paused);
  }

  fs.writeFileSync(path.resolve('tools/scratch', '_transformer-relocation.json'), JSON.stringify(out, null, 2));
  console.log('record written: tools/scratch/_transformer-relocation.json');
} catch (e) {
  console.error('FATAL', e.code ?? '', e.message ?? e);
  for (const k of ['details', 'data', 'cause']) if (e[k]) console.error('  ', k, JSON.stringify(e[k]).slice(0, 800));
  try { await queryGame('set_simulation_speed', { speed: 'normal' }); } catch { /* ignore */ }
  process.exit(1);
}
