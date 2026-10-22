// Demolish the extra transformer stations, keeping exactly one per user instruction.
//
// Kept  : bld-010 变电站 1  TransformerStation01  (-92, -516.25)
// Delete: bld-011 变电站 2  TransformerStation01  (-652, -516.25)
//         bld-012 配电站 1  TransformerStation02  (311.27, -992.53)
//         bld-013 配电站 2  TransformerStation02  (176.87, -759.73)
//
// Usage:
//   node tools/scratch/demolish-extra-substations.mjs --dry-run
//   node tools/scratch/demolish-extra-substations.mjs
//
// The city is paused for the whole run and resumed at the end (unless --keep-paused).

import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const KEEP_PAUSED = argv.includes('--keep-paused');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_FLIGHT = new Set(['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building']);

// Plan id -> live facility position (from the planning data, verified live).
const TARGETS = [
  { planId: 'bld-011', label: '变电站 2', prefab: 'TransformerStation01', x: -652, z: -516.25, keep: false },
  { planId: 'bld-012', label: '配电站 1', prefab: 'TransformerStation02', x: 311.271423, z: -992.526367, keep: false },
  { planId: 'bld-013', label: '配电站 2', prefab: 'TransformerStation02', x: 176.8715, z: -759.7265, keep: false },
  { planId: 'bld-010', label: '变电站 1', prefab: 'TransformerStation01', x: -92.00002, z: -516.25, keep: true },
];

async function call(tool, args, { retries = 8, backoffMs = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await queryGame(tool, args);
    } catch (e) {
      lastErr = e;
      if (String(e.code) !== 'TOOL_BUSY') throw e;
      await sleep(backoffMs * (i + 1));
    }
  }
  throw lastErr;
}

async function pollBuilding(opId) {
  let d = null;
  for (let i = 0; i < 400; i++) {
    d = (await call('get_building_operation', { operation_id: opId }, { retries: 4 })).data;
    if (d.state && !IN_FLIGHT.has(d.state)) return d;
    await sleep(90);
  }
  return d;
}

async function listTransformers() {
  const r = await call('list_utility_facilities', { kind: 'all' });
  const items = r.data.items ?? [];
  return items.filter((f) => /Transformer/i.test(f.prefab));
}

const results = [];

try {
  const before = await listTransformers();
  console.log('=== live transformer facilities before ===');
  for (const f of before) {
    console.log(' ' + f.facility_id.padEnd(46) + ' ' + f.prefab.padEnd(22) + ' (' + f.position.x.toFixed(1) + ', ' + f.position.z.toFixed(1) + ')');
  }

  // Map plan ids -> live facility ids by position (tolerance 1 m).
  for (const t of TARGETS) {
    const f = before.find((x) => Math.hypot(x.position.x - t.x, x.position.z - t.z) < 1);
    t.facilityId = f ? f.facility_id : null;
    t.matchedPrefab = f ? f.prefab : null;
  }
  const unmatched = TARGETS.filter((t) => !t.facilityId);
  if (unmatched.length) {
    console.log('\n!! could not match live facilities for: ' + unmatched.map((t) => t.planId).join(', '));
    process.exit(1);
  }

  await call('set_simulation_speed', { speed: 'paused' });
  await sleep(600);
  const st = (await call('get_game_status', {})).data;
  console.log('\ncity paused for demolition: ' + (st.paused === true));

  for (const t of TARGETS.filter((x) => !x.keep)) {
    if (ONLY && t.planId !== ONLY) continue;
    console.log('\n=== ' + t.planId + ' ' + t.label + ' [' + t.matchedPrefab + '] ' + t.facilityId);
    const requestId = 'sub-demol-' + t.planId + '-' + Date.now();
    const q = await call('preview_building_demolition', { request_id: requestId, building_id: t.facilityId });
    const opId = q.data.operation_id;
    const d = await pollBuilding(opId);

    console.log('   preview: ' + d.state + ' | cost = ' + d.cost + ' | errors = ' + JSON.stringify(d.errors ?? []) + ' | warnings = ' + JSON.stringify(d.warnings ?? []));
    for (const k of Object.keys(d)) {
      if (/depend|child|attach|area|upgrade|refund|result|entity/i.test(k)) {
        console.log('   field ' + k + ' = ' + JSON.stringify(d[k]).slice(0, 300));
      }
    }

    if (d.state !== 'preview_ready') {
      console.log('   !! not preview_ready, skipping');
      results.push({ planId: t.planId, label: t.label, prefab: t.matchedPrefab, entity: t.facilityId, state: d.state, cost: d.cost, error: JSON.stringify(d.errors ?? d.error ?? null) });
      await call('cancel_building_preview', { operation_id: opId }).catch(() => {});
      continue;
    }

    if (DRY) {
      console.log('   (dry-run) preview ok, cancelling');
      await call('cancel_building_preview', { operation_id: opId }).catch(() => {});
      results.push({ planId: t.planId, label: t.label, prefab: t.matchedPrefab, entity: t.facilityId, state: 'preview_ready (dry-run)', cost: d.cost });
      continue;
    }

    const maxCost = Math.max(Number(d.cost ?? 0), 0) + 1000;
    await call('apply_building_operation', { operation_id: opId, request_id: requestId, max_cost: maxCost });
    const done = await pollBuilding(opId);
    console.log('   commit: ' + done.state + ' | errors = ' + JSON.stringify(done.errors ?? []));
    for (const k of Object.keys(done)) {
      if (/permanent|result|entity|refund/i.test(k)) console.log('   field ' + k + ' = ' + JSON.stringify(done[k]).slice(0, 300));
    }
    results.push({
      planId: t.planId, label: t.label, prefab: t.matchedPrefab, entity: t.facilityId,
      position: { x: t.x, z: t.z }, state: done.state, cost: done.cost ?? d.cost,
      refund: done.refund ?? null, errors: done.errors ?? [],
    });
  }

  if (!KEEP_PAUSED && !DRY) {
    await call('set_simulation_speed', { speed: 'normal' });
    await sleep(400);
    const st2 = (await call('get_game_status', {})).data;
    console.log('\nsimulation resumed: paused = ' + st2.paused);
  }

  console.log('\n=== summary ===');
  for (const r of results) console.log(' ' + r.planId + ' ' + r.label + ' -> ' + r.state + ' cost ' + r.cost);

  if (!DRY) {
    const out = path.resolve('tools/scratch', '_substation-demolition.json');
    fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), kept: TARGETS.find((t) => t.keep), demolished: results }, null, 2));
    console.log('record written: ' + out);
  }
} catch (e) {
  console.error('FATAL ' + (e.code ?? '') + ' ' + (e.message ?? e));
  try { await queryGame('set_simulation_speed', { speed: 'normal' }); } catch { /* ignore */ }
  process.exit(1);
}
