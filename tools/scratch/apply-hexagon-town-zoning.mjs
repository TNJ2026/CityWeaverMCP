// Apply hexagon-town zoning from the classified (edge,side) -> zone assignment plan.
//
//   node tools/scratch/apply-hexagon-town-zoning.mjs [--dry-run] [--limit N] [--chunk N]
//
// Reads tools/scratch/_zoning-plan.json produced by classify-hexagon-zoning.mjs.
// Pauses the city, previews + applies one atomic zoning transaction per chunk,
// then optionally resumes simulation speed.

import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
const has = n => argv.includes(`--${n}`);
const DRY = has('dry-run');
const LIMIT = Number(flag('limit', '0')) || Infinity;
const CHUNK = Number(flag('chunk', '48')) || 48;
const RESUME = !has('keep-paused');

const PLAN = path.resolve('tools/scratch/_zoning-plan.json');
const journalPath = path.resolve('artifacts', `hexagon-town-zoning-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
fs.mkdirSync(path.dirname(journalPath), { recursive: true });
const journal = fs.createWriteStream(journalPath, { flags: 'a' });
const note = (o) => { journal.write(JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); console.log(JSON.stringify(o)); };

let seq = 0;
const rid = (zone, side, i) =>
  (`hexzn_${zone}_${side}_${i}_${(seq++).toString(36)}_${Date.now().toString(36)}`)
    .replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 100);

async function pauseCity() {
  try { await queryGame('set_simulation_speed', { speed: 'paused' }); } catch (e) { console.error('pause failed:', e.code || e.message); }
}

async function waitZoning(opId, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const res = await queryGame('get_zoning_operation', { operation_id: opId }, { timeoutMs: 20000 });
    const st = res.data?.state;
    if (st === 'completed') return res.data;
    if (st === 'failed') throw Object.assign(new Error(`zoning operation failed: ${JSON.stringify(res.data.errors ?? res.data)}`), { code: 'ZONING_FAILED' });
    await new Promise(r => setTimeout(r, 300));
  }
  throw Object.assign(new Error('zoning operation timed out'), { code: 'ZONING_TIMEOUT' });
}

async function applyGroup(a, groupIndex) {
  const zone = a.zone, side = a.side;
  let cells = 0, chunks = 0, skipped = 0;
  for (let i = 0; i < a.edge_ids.length; i += CHUNK) {
    const edges = a.edge_ids.slice(i, i + CHUNK);
    const request_id = rid(zone.replace(/^EU /, '').replace(/[^A-Za-z0-9]+/g, ''), side, groupIndex);
    let preview;
    try {
      preview = await queryGame('preview_zoning', {
        request_id, edge_ids: edges, zone, road_side: side,
        depth_cells: 6, overwrite: true, include_occupied: false,
      }, { timeoutMs: 40000 });
    } catch (err) {
      if (err?.code === 'NO_ZONING_CHANGES') { skipped++; note({ op: 'skip', zone, side, edges: edges.length, reason: 'NO_ZONING_CHANGES' }); continue; }
      note({ op: 'preview_error', zone, side, edges: edges.length, code: err?.code, message: err?.message });
      throw err;
    }
    const d = preview.data ?? {};
    const n = d.changed_cell_count ?? 0;
    if (DRY) {
      note({ op: 'dry_preview', zone, side, edges: edges.length, would_change: n, operation_id: d.operation_id });
      try { await queryGame('cancel_zoning_preview', { operation_id: d.operation_id }); } catch { /* ignore */ }
      cells += n; chunks++;
      continue;
    }
    if (!d.can_commit) {
      note({ op: 'not_committable', zone, side, edges: edges.length, detail: d.errors ?? d });
      try { await queryGame('cancel_zoning_preview', { operation_id: d.operation_id }); } catch { /* ignore */ }
      continue;
    }
    await queryGame('apply_zoning', { operation_id: d.operation_id, request_id }, { timeoutMs: 40000 });
    await waitZoning(d.operation_id);
    note({ op: 'applied', zone, side, edges: edges.length, changed_cells: n, operation_id: d.operation_id });
    cells += n; chunks++;
  }
  return { cells, chunks, skipped };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const assignments = plan.assignments.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`mode=${DRY ? 'DRY-RUN (preview only)' : 'APPLY'} groups=${assignments.length} chunk=${CHUNK}`);
  console.log(`journal: ${journalPath}`);

  const before = (await queryGame('get_game_status', {})).data;
  console.log(`city=${before.city_name} paused=${before.paused}`);
  await pauseCity();

  let total = 0, groups = 0, totalChunks = 0, totalSkipped = 0;
  const failures = [];
  for (let gi = 0; gi < assignments.length; gi++) {
    const a = assignments[gi];
    try {
      const r = await applyGroup(a, gi);
      total += r.cells; groups++; totalChunks += r.chunks; totalSkipped += r.skipped;
      console.log(`[${gi + 1}/${assignments.length}] ${a.zone} ${a.side} edges=${a.edge_ids.length} -> ${r.cells} cells (${r.chunks} chunks${r.skipped ? `, ${r.skipped} skipped` : ''})`);
    } catch (err) {
      failures.push({ zone: a.zone, side: a.side, code: err?.code, message: err?.message });
      console.log(`[${gi + 1}/${assignments.length}] FAILED ${a.zone} ${a.side}: ${err?.code} ${err?.message}`);
    }
  }

  const after = (await queryGame('get_game_status', {})).data;
  if (RESUME) { try { await queryGame('set_simulation_speed', { speed: 'normal' }); } catch (e) { console.error('resume failed', e.code || e.message); } }
  note({ op: 'summary', mode: DRY ? 'dry-run' : 'apply', groups_done: groups, chunks: totalChunks, cells: total, skipped: totalSkipped, failures, money_before: before.money, money_after: after.money, resumed: RESUME });
  journal.end();
  console.log(`\n=== ${DRY ? 'DRY-RUN' : 'ZONING'} DONE === groups=${groups}/${assignments.length} chunks=${totalChunks} cells=${total} skipped=${totalSkipped} failures=${failures.length}`);
  if (failures.length) console.log('failures:', JSON.stringify(failures, null, 1));
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
