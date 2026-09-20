// 佩奇代尔 · 正五边形城 分阶段施工驱动器
// 用法：
//   node tools/scratch/peiqi-pentagon-construct.mjs pause
//   node tools/scratch/peiqi-pentagon-construct.mjs prepare roads
//   node tools/scratch/peiqi-pentagon-construct.mjs scan    roads [prefix]
//   node tools/scratch/peiqi-pentagon-construct.mjs commit  roads [prefix]     # 串行 preview+commit，可重复运行（已提交的批次自动跳过）
//   node tools/scratch/peiqi-pentagon-construct.mjs bind                        # 原生绑定 47 栋建筑到精确 road_edge_id
//   node tools/scratch/peiqi-pentagon-construct.mjs prepare buildings
//   node tools/scratch/peiqi-pentagon-construct.mjs commit  buildings [prefix]
//   node tools/scratch/peiqi-pentagon-construct.mjs prepare utilities
//   node tools/scratch/peiqi-pentagon-construct.mjs commit  utilities [prefix]
//   node tools/scratch/peiqi-pentagon-construct.mjs status
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const A = (f) => path.join(ROOT, 'artifacts', f);
const LOG = A('peiqi-pentagon-construction.jsonl');
const BASE_PLAN = path.join(ROOT, 'plans', 'peiqi-pentagon-city-plan.json');
const BOUND_PLAN = path.join(ROOT, 'plans', 'peiqi-pentagon-city-plan.bound.json');
const REQ = (s) => `peiqipent_${s}_20260920`;

const cmd = process.argv[2] ?? 'status';
const stage = process.argv[3] ?? 'roads';
const only = process.argv[4];
const stageFile = (s) => A(`peiqi-${s}-stage.json`);
const prepFile = (s) => A(`peiqi-${s}-prepare.json`);

const base = JSON.parse(await readFile(existsSync(BOUND_PLAN) && ['buildings', 'utilities'].includes(stage) ? BOUND_PLAN : BASE_PLAN, 'utf8'));

// 分阶段计划：每一阶段单独渲染、单独批准，plan_id 独立。
function stagePlan(name) {
  const plan = structuredClone(base.plan);
  plan.zones = [];
  plan.tracks = [];
  if (name === 'roads') {
    plan.buildings = [];
    plan.utilities = [];
  } else if (name === 'buildings') {
    for (const road of plan.roads) road.construction_status = 'completed';
    for (const grid of plan.grids) grid.construction_status = 'completed';
    plan.utilities = [];
  } else if (name === 'utilities') {
    for (const road of plan.roads) road.construction_status = 'completed';
    for (const grid of plan.grids) grid.construction_status = 'completed';
    for (const building of plan.buildings) building.construction_status = 'completed';
  }
  return plan;
}

const log = async (entry) => appendFile(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

// 已提交批次（用于断点续跑）
async function committedBatches() {
  if (!existsSync(LOG)) return new Set();
  const done = new Set();
  for (const line of (await readFile(LOG, 'utf8')).trim().split('\n')) {
    if (!line) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    if (entry.cmd !== 'commit') continue;
    const state = entry.result?.state ?? entry.result?.commit_state;
    if (state === 'completed' || state === 'completed_verified') done.add(`${entry.stage}:${entry.batch_id}`);
  }
  return done;
}

const client = new Client({ name: 'peiqi-pentagon-construction', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));

  const call = async (name, args, timeout = 300000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) {
      const txt = r.content?.find((c) => c.type === 'text')?.text ?? '';
      let code = null;
      try { code = JSON.parse(txt)?.error?.code ?? null; } catch { /* ignore */ }
      const error = new Error(`${code ?? 'TOOL_ERROR'}: ${txt.slice(0, 600)}`);
      error.toolCode = code;
      throw error;
    }
    return r;
  };
  const data = (r) => r.structuredContent?.data ?? r.structuredContent ?? {};

  if (cmd === 'pause') {
    const r = await call('set_simulation_speed', { speed: 'paused' });
    console.log(JSON.stringify(data(r)));
  } else if (cmd === 'prepare') {
    await call('set_simulation_speed', { speed: 'paused' });
    const plan = stagePlan(stage);
    const renderArgs = {
      bounds: base.bounds,
      render: { ...(base.render ?? {}), title: `佩奇代尔｜正五边形城 · ${stage} 阶段` },
      water_cell_size_m: base.water_cell_size_m ?? 8,
      terrain_cell_size_m: base.terrain_cell_size_m ?? 64,
      plan,
    };
    const rr = await call('render_city_plan', renderArgs, 600000);
    const html = rr.content?.find((x) => x.type === 'resource' && x.resource?.mimeType === 'text/html')?.resource?.text;
    if (html) await writeFile(A(`peiqi-${stage}-stage.html`), html);
    const rd = data(rr);
    console.log('[render] plan_id =', rd.plan_id, '| issues =', rd.validation?.issue_count, '| errors =', rd.validation?.error_count);
    if (rd.validation?.error_count) console.log(JSON.stringify(rd.validation.issues?.slice(0, 8), null, 1));

    const doc = { bounds: base.bounds, plan, approved_plan_id: rd.plan_id, city: base.city, stage };
    await writeFile(stageFile(stage), JSON.stringify(doc, null, 2));
    const pr = await call('prepare_city_plan_construction', doc, 600000);
    const pd = data(pr);
    await writeFile(prepFile(stage), JSON.stringify(pd, null, 2));
    await log({ cmd, stage, plan_id: rd.plan_id, ready: pd.construction_ready, batches: pd.execution_order?.length ?? pd.batches?.length });
    console.log(JSON.stringify({
      plan_id: rd.plan_id,
      construction_ready: pd.construction_ready,
      session_id: pd.session_id,
      batch_count: (pd.execution_order ?? pd.batches ?? []).length,
      by_type: (pd.execution_order ?? pd.batches ?? []).reduce((acc, b) => { acc[b.batch_type] = (acc[b.batch_type] ?? 0) + 1; return acc; }, {}),
      first_batch: (pd.execution_order ?? pd.batches ?? [])[0]?.batch_id,
      issues: (pd.issues ?? pd.validation?.issues ?? []).slice(0, 10),
    }, null, 2));
  } else if (cmd === 'scan') {
    const doc = JSON.parse(await readFile(stageFile(stage), 'utf8'));
    const prep = JSON.parse(await readFile(prepFile(stage), 'utf8'));
    const rows = [];
    for (const b of prep.execution_order ?? []) {
      if (only && !b.batch_id.startsWith(only)) continue;
      const row = { stage, batch_id: b.batch_id, type: b.batch_type, label: b.label };
      try {
        const r = await call('advance_city_plan_construction', {
          action: 'preview_batch', bounds: doc.bounds, plan: doc.plan, approved_plan_id: doc.approved_plan_id,
          batch_id: b.batch_id, request_id: REQ(`scan_${b.batch_id}`), operation_timeout_ms: 120000,
        });
        const d = data(r);
        Object.assign(row, { state: d.state, cost: d.native_preview?.cost ?? d.cost ?? null, errors: d.native_preview?.errors ?? d.errors ?? [], warnings: (d.native_preview?.warnings ?? d.warnings ?? []).slice(0, 3) });
        const ca = d.cancel_action;
        if (ca) { try { await call(ca.tool, ca.arguments); row.cancelled = true; } catch (e) { row.cancel_error = String(e.message).slice(0, 160); } }
      } catch (e) {
        Object.assign(row, { state: 'preview_failed', tool_code: e.toolCode ?? null, error: String(e.message).slice(0, 300) });
      }
      rows.push(row);
      console.log(`${row.batch_id}: ${row.state} ${row.cost != null ? `cost=${row.cost}` : ''} ${row.tool_code ?? ''} ${(row.errors ?? []).join(';').slice(0, 160)}`);
      await writeFile(A(`peiqi-${stage}-scan.json`), JSON.stringify(rows, null, 2));
    }
    const ok = rows.filter((r) => r.state === 'preview_ready');
    console.log(JSON.stringify({
      total: rows.length, ready: ok.length, failed: rows.length - ok.length,
      total_cost: ok.reduce((s, r) => s + (r.cost ?? 0), 0),
      failed_ids: rows.filter((r) => r.state !== 'preview_ready').map((r) => `${r.batch_id}(${r.tool_code ?? r.state})`),
    }, null, 2));
  } else if (cmd === 'commit') {
    await call('set_simulation_speed', { speed: 'paused' });
    const doc = JSON.parse(await readFile(stageFile(stage), 'utf8'));
    const prep = JSON.parse(await readFile(prepFile(stage), 'utf8'));
    const done = await committedBatches();
    const results = [];
    for (const b of prep.execution_order ?? []) {
      if (only && !b.batch_id.startsWith(only)) continue;
      if (done.has(`${stage}:${b.batch_id}`)) { results.push({ batch_id: b.batch_id, skipped: true }); continue; }
      const out = { stage, batch_id: b.batch_id, type: b.batch_type };
      try {
        const pr = await call('advance_city_plan_construction', {
          action: 'preview_batch', bounds: doc.bounds, plan: doc.plan, approved_plan_id: doc.approved_plan_id,
          batch_id: b.batch_id, request_id: REQ(`${b.batch_id}_preview`), operation_timeout_ms: 120000,
        });
        const pd = data(pr);
        out.state = pd.state;
        out.cost = pd.native_preview?.cost ?? pd.cost ?? null;
        out.errors = pd.native_preview?.errors ?? pd.errors ?? [];
        if (pd.state !== 'preview_ready') {
          out.error = pd.native_preview?.error ?? pd.error ?? `state=${pd.state}`;
          results.push(out);
          await log({ cmd, ...out });
          console.log(`${b.batch_id}: PREVIEW ${pd.state} ${JSON.stringify(out.errors).slice(0, 300)}`);
          continue;
        }
        const na = pd.next_action;
        if (!na?.arguments) throw new Error(`无 commit next_action: ${JSON.stringify(na).slice(0, 300)}`);
        const cr = await call('advance_city_plan_construction', { ...na.arguments, request_id: REQ(`${b.batch_id}_commit`), operation_timeout_ms: 180000 });
        const cd = data(cr);
        out.result = { state: cd.state, cost: cd.cost ?? cd.actual_cost ?? null, created: (cd.created_road_ids ?? cd.created_object_ids ?? []).length, verified: cd.readback?.verified ?? cd.verified ?? null, warnings: (cd.warnings ?? []).slice(0, 3) };
        results.push(out);
        await log({ cmd, ...out });
        console.log(`${b.batch_id}: ${out.result.state} created=${out.result.created} cost=${out.result.cost}`);
      } catch (e) {
        out.error = String(e.message).slice(0, 400);
        out.tool_code = e.toolCode ?? null;
        results.push(out);
        await log({ cmd, ...out });
        console.log(`${b.batch_id}: ERROR ${out.tool_code ?? ''} ${out.error}`);
      }
    }
    const ok = results.filter((r) => r.skipped || ['completed', 'completed_verified'].includes(r.result?.state));
    const bad = results.filter((r) => !ok.includes(r));
    console.log(JSON.stringify({
      stage, total: results.length, ok: ok.length, failed: bad.length,
      created: results.reduce((s, r) => s + (r.result?.created ?? 0), 0),
      spent: results.reduce((s, r) => s + (r.result?.cost ?? 0), 0),
      failed_ids: bad.map((r) => `${r.batch_id}(${r.tool_code ?? r.state ?? r.error?.slice(0, 60)})`),
    }, null, 2));
  } else if (cmd === 'bind') {
    await call('set_simulation_speed', { speed: 'paused' });
    const full = JSON.parse(await readFile(BASE_PLAN, 'utf8'));
    const plan = structuredClone(full.plan);
    // 网格与骨架已建成：绑定阶段只处理建筑，其余标记完成以避免重复编译
    for (const road of plan.roads) road.construction_status = 'completed';
    for (const grid of plan.grids) grid.construction_status = 'completed';
    plan.utilities = [];
    plan.zones = [];
    plan.tracks = [];
    const r = await call('bind_city_plan_buildings', {
      request_id: REQ('bind_buildings'),
      bounds: full.bounds,
      plan,
      search_radius_m: 256,
      road_side: 'either',
      candidate_count: 8,
      max_preview_attempts: 8,
      operation_timeout_ms: 120000,
      continue_on_error: true,
    }, 900000);
    const d = data(r);
    const bound = d.plan ?? d;
    await writeFile(A('peiqi-buildings-bind.json'), JSON.stringify(d, null, 2));
    if (bound?.buildings) {
      await writeFile(BOUND_PLAN, JSON.stringify({ ...full, plan: { ...plan, ...bound, buildings: bound.buildings } }, null, 2));
    }
    await log({ cmd, bound: d.bound_count ?? d.bound?.length ?? null, failed: d.failed_count ?? null });
    console.log(JSON.stringify({
      bound: d.bound_count ?? d.bound?.length ?? null,
      failed: d.failed_count ?? d.failed?.length ?? null,
      keys: Object.keys(d).slice(0, 20),
      buildings: (bound?.buildings ?? plan.buildings).map((b) => ({ id: b.id, label: b.label, status: b.placement_status, road_edge_id: b.road_edge_id ?? null, rot: b.rotation_degrees })),
    }, null, 2).slice(0, 6000));
  } else {
    const out = {};
    for (const s of ['roads', 'buildings', 'utilities']) {
      const f = stageFile(s);
      if (!existsSync(f)) continue;
      const doc = JSON.parse(await readFile(f, 'utf8'));
      const prep = existsSync(prepFile(s)) ? JSON.parse(await readFile(prepFile(s), 'utf8')) : {};
      out[s] = { plan_id: doc.approved_plan_id, batch_count: (prep.execution_order ?? []).length, ready: prep.construction_ready };
    }
    out.committed = [...(await committedBatches())].length;
    console.log(JSON.stringify(out, null, 2));
  }
} finally {
  await client.close();
}
