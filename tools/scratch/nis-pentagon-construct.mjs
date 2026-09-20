// 尼思五边形城 · 按图施工驱动器（阶段推进，逐批原生预览 + 提交 + 永久回读）
// 用法：
//   node tools/scratch/nis-pentagon-construct.mjs prepare-roads   # 道路阶段：渲染 + 建立虚拟沙盒批次
//   node tools/scratch/nis-pentagon-construct.mjs scan [prefix]   # 只读预检：逐批 preview 后取消
//   node tools/scratch/nis-pentagon-construct.mjs preview <batch_id>
//   node tools/scratch/nis-pentagon-construct.mjs commit  <batch_id>
//   node tools/scratch/nis-pentagon-construct.mjs commit-all      # 顺序提交全部未完成批次
//   node tools/scratch/nis-pentagon-construct.mjs status          # 打印当前阶段状态
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const PLAN = path.join(ROOT, 'plans', 'nis-pentagon-city-plan.json');
const A = (f) => path.join(ROOT, 'artifacts', f);
const STAGE = A('nis-pentagon-stage.json');
const LOG = A('nis-pentagon-construction.jsonl');
const REQ = (s) => `nispent_${s}_20260920`;

const cmd = process.argv[2] ?? 'status';
const batchId = process.argv[3];

const base = JSON.parse(await readFile(PLAN, 'utf8'));

// 道路阶段计划：只含道路；分区与建筑等道路永久回读后再进入下一个批准周期
function roadsStagePlan() {
  return {
    roads: base.plan.roads.map((r) => ({ ...r, construction_status: 'planned' })),
    buildings: [],
    zones: [],
    grid_exceptions: [],
    tracks: [],
    utilities: [],
  };
}

const client = new Client({ name: 'nis-pentagon-construction', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));

  const call = async (name, args, timeout = 300000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) {
      const txt = r.content?.find((c) => c.type === 'text')?.text ?? '';
      let code = null;
      try { code = JSON.parse(txt)?.error?.code ?? null; } catch { /* ignore */ }
      const err = new Error(`${code ?? 'TOOL_ERROR'}: ${txt.slice(0, 500)}`);
      err.toolCode = code;
      throw err;
    }
    return r;
  };

  // 只读预检扫描：逐批 preview，记录费用/错误后取消预览，不产生任何永久变化
  if (cmd === 'scan') {
    const prep = JSON.parse(await readFile(A('nis-pentagon-roads-prepare.json'), 'utf8'));
    const stage = JSON.parse(await readFile(STAGE, 'utf8'));
    const order = prep.execution_order ?? [];
    const only = process.argv[3]; // 可选：只扫某个前缀
    const rows = [];
    for (const b of order) {
      if (only && !b.batch_id.startsWith(only)) continue;
      const args = {
        action: 'preview_batch',
        bounds: stage.bounds, plan: stage.plan,
        approved_plan_id: stage.approved_plan_id,
        batch_id: b.batch_id,
        request_id: REQ(`scan_${b.batch_id}`),
        operation_timeout_ms: 60000,
      };
      let row = { batch_id: b.batch_id, label: b.label, prefab: (b.prefab_names ?? []).join('/'), objects: b.object_ids };
      try {
        const r = await call('advance_city_plan_construction', args);
        const d = r.structuredContent?.data ?? {};
        row = { ...row, state: d.state, cost: d.native_preview?.cost ?? null, errors: d.native_preview?.errors ?? [], warnings: d.native_preview?.warnings ?? [] };
        const ca = d.cancel_action;
        if (ca) { try { await call(ca.tool, ca.arguments); row.cancelled = true; } catch (e) { row.cancel_error = String(e).slice(0, 200); } }
      } catch (e) {
        row = { ...row, state: 'preview_failed', tool_code: e.toolCode ?? null, error: String(e.message).slice(0, 300) };
      }
      rows.push(row);
      console.log(`${row.batch_id}: ${row.state} cost=${row.cost ?? '-'} ${row.tool_code ?? ''} ${(row.errors ?? []).join(';')}`);
      await writeFile(A('nis-pentagon-roads-scan.json'), JSON.stringify(rows, null, 2));
    }
    const ok = rows.filter((r) => r.state === 'preview_ready');
    const bad = rows.filter((r) => r.state !== 'preview_ready');
    console.log(JSON.stringify({ total: rows.length, ok: ok.length, failed: bad.length, total_cost: ok.reduce((s, r) => s + (r.cost ?? 0), 0), failed_ids: bad.map((r) => `${r.batch_id}(${r.tool_code ?? r.state})`) }, null, 2));
  } else if (cmd === 'prepare-roads') {
    const plan = roadsStagePlan();
    const renderArgs = {
      bounds: base.bounds,
      render: { ...base.render, title: '尼思｜正五边形城·道路骨架施工阶段' },
      water_cell_size_m: base.water_cell_size_m,
      terrain_cell_size_m: base.terrain_cell_size_m,
      plan,
    };
    const rr = await call('render_city_plan', renderArgs);
    const html = rr.content?.find((x) => x.type === 'resource' && x.resource?.mimeType === 'text/html')?.resource?.text;
    if (html) await writeFile(A('nis-pentagon-roads-stage.html'), html);
    const rid = rr.structuredContent?.data?.plan_id ?? rr.structuredContent?.plan_id;
    console.log('[render] plan_id =', rid, '| validation issues =', rr.structuredContent?.data?.validation?.issue_count);

    const stage = { bounds: base.bounds, plan, approved_plan_id: rid, city: base.city };
    await writeFile(STAGE, JSON.stringify(stage, null, 2));

    const pr = await call('prepare_city_plan_construction', stage);
    const d = pr.structuredContent?.data ?? pr.structuredContent ?? {};
    await writeFile(A('nis-pentagon-roads-prepare.json'), JSON.stringify(d, null, 2));
    await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd, plan_id: rid, prepare: d }) + '\n');
    console.log(JSON.stringify({
      plan_id: rid,
      construction_ready: d.construction_ready,
      session_id: d.session_id,
      batch_count: d.batches?.length ?? d.batch_count,
      batches: (d.batches ?? []).map((b) => ({
        batch_id: b.batch_id, type: b.type, objects: (b.object_ids ?? b.objects ?? []).length,
        est_cost: b.estimated_cost ?? b.max_cost ?? null,
      })),
      next_action: d.next_action,
      issues: d.issues?.slice?.(0, 10) ?? d.validation?.issues?.slice?.(0, 10),
    }, null, 2));
  } else if (cmd === 'resume-roads') {
    // 重载城市后续建：把已提交完成的批次对应道路标记 built → 重渲染 → 重新 prepare
    const lines = (await readFile(LOG, 'utf8')).trim().split('\n');
    const builtIds = new Set();
    for (const l of lines) {
      let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.cmd === 'commit-all' && j.result && (j.result.commit_state === 'completed' || j.result.commit_state === 'completed_verified')) {
        builtIds.add(j.batch_id);
      }
    }
    console.log('[resume] built batches:', builtIds.size);
    const plan = roadsStagePlan();
    for (const r of plan.roads) if (builtIds.has(r.id)) r.construction_status = 'built';
    const renderArgs = {
      bounds: base.bounds,
      render: { ...base.render, title: '尼思｜正五边形城·道路骨架施工阶段（续）' },
      water_cell_size_m: base.water_cell_size_m,
      terrain_cell_size_m: base.terrain_cell_size_m,
      plan,
    };
    const rr = await call('render_city_plan', renderArgs);
    const rid = rr.structuredContent?.data?.plan_id ?? rr.structuredContent?.plan_id;
    console.log('[render] plan_id =', rid, '| validation issues =', rr.structuredContent?.data?.validation?.issue_count);
    const stage = { bounds: base.bounds, plan, approved_plan_id: rid, city: base.city };
    await writeFile(STAGE, JSON.stringify(stage, null, 2));
    const pr = await call('prepare_city_plan_construction', stage);
    const d = pr.structuredContent?.data ?? pr.structuredContent ?? {};
    await writeFile(A('nis-pentagon-roads-prepare.json'), JSON.stringify(d, null, 2));
    await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd, plan_id: rid, built: [...builtIds], prepare: { construction_ready: d.construction_ready, batch_count: d.execution_order?.length } }) + '\n');
    console.log(JSON.stringify({
      plan_id: rid,
      construction_ready: d.construction_ready,
      session_id: d.session_id,
      remaining_batches: d.execution_order?.length,
      first_batch: d.execution_order?.[0]?.batch_id,
    }, null, 2));
  } else if (cmd === 'preview' || cmd === 'commit') {
    if (!batchId) throw new Error('需要 batch_id');
    const stage = JSON.parse(await readFile(STAGE, 'utf8'));
    let args;
    if (cmd === 'preview') {
      args = {
        action: 'preview_batch',
        bounds: stage.bounds,
        plan: stage.plan,
        approved_plan_id: stage.approved_plan_id,
        batch_id: batchId,
        request_id: REQ(`${batchId}_preview`),
        operation_timeout_ms: 60000,
      };
    } else {
      const prev = JSON.parse(await readFile(A(`nis-pentagon-roads-${batchId}-preview.json`), 'utf8'));
      const na = prev.data?.next_action ?? prev.next_action;
      if (!na || na.arguments?.action !== 'commit_batch') throw new Error(`批次 ${batchId} 没有可提交的 commit next_action: ${JSON.stringify(na).slice(0, 800)}`);
      args = { ...na.arguments, request_id: REQ(`${batchId}_commit`), operation_timeout_ms: 120000 };
    }
    const r = await call('advance_city_plan_construction', args);
    const d = r.structuredContent?.data ?? r.structuredContent ?? {};
    await writeFile(A(`nis-pentagon-roads-${batchId}-${cmd}.json`), JSON.stringify(d, null, 2));
    await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd, batch_id: batchId, result: d }) + '\n');
    console.log(JSON.stringify({
      batch_id: batchId,
      state: d.state ?? d.batch_state,
      cost: d.cost ?? d.actual_cost,
      created: d.created_road_ids?.length ?? d.created_object_ids?.length,
      next_action: d.next_action,
      warnings: d.warnings, errors: d.errors, error: d.error,
    }, null, 2));
  } else if (cmd === 'commit-all') {
    // 顺序提交全部未完成批次：每批 preview → commit，逐批落盘与日志
    const prep = JSON.parse(await readFile(A('nis-pentagon-roads-prepare.json'), 'utf8'));
    const order = prep.execution_order ?? [];
    const only = process.argv[3];
    const results = [];
    for (const b of order) {
      if (only && !b.batch_id.startsWith(only)) continue;
      const bid = b.batch_id;
      const stage = JSON.parse(await readFile(STAGE, 'utf8'));
      let out = { batch_id: bid };
      try {
        const pr = await call('advance_city_plan_construction', {
          action: 'preview_batch',
          bounds: stage.bounds, plan: stage.plan, approved_plan_id: stage.approved_plan_id,
          batch_id: bid, request_id: REQ(`${bid}_preview`), operation_timeout_ms: 60000,
        });
        const pd = pr.structuredContent?.data ?? {};
        await writeFile(A(`nis-pentagon-roads-${bid}-preview.json`), JSON.stringify(pd, null, 2));
        out.state = pd.state; out.cost = pd.native_preview?.cost ?? null;
        out.errors = pd.native_preview?.errors ?? [];
        if (pd.state !== 'preview_ready') {
          out.error = pd.native_preview?.error ?? pd.error ?? `state=${pd.state}`;
          results.push(out);
          console.log(`${bid}: PREVIEW FAIL ${JSON.stringify(out.errors)}`);
          await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd: 'commit-all', batch_id: bid, result: out }) + '\n');
          continue;
        }
        const na = pd.next_action;
        if (!na || na.arguments?.action !== 'commit_batch') throw new Error('无 commit next_action');
        const cr = await call('advance_city_plan_construction', { ...na.arguments, request_id: REQ(`${bid}_commit`), operation_timeout_ms: 120000 });
        const cd = cr.structuredContent?.data ?? {};
        await writeFile(A(`nis-pentagon-roads-${bid}-commit.json`), JSON.stringify(cd, null, 2));
        out.commit_state = cd.state;
        out.created = cd.created_road_ids?.length ?? cd.created_object_ids?.length ?? 0;
        out.verified = cd.readback?.verified ?? cd.verified;
        results.push(out);
        console.log(`${bid}: committed created=${out.created} state=${out.commit_state}`);
        await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd: 'commit-all', batch_id: bid, result: out }) + '\n');
      } catch (e) {
        out.error = String(e.message).slice(0, 300);
        out.tool_code = e.toolCode ?? null;
        results.push(out);
        console.log(`${bid}: ERROR ${out.error}`);
        await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd: 'commit-all', batch_id: bid, result: out }) + '\n');
      }
    }
    const committed = results.filter((r) => r.commit_state === 'completed' || r.commit_state === 'completed_verified');
    const failed = results.filter((r) => !r.commit_state || (r.commit_state !== 'completed' && r.commit_state !== 'completed_verified'));
    console.log(JSON.stringify({ total: results.length, committed: committed.length, failed: failed.length, failed_ids: failed.map((f) => f.batch_id), total_created: results.reduce((s, r) => s + (r.created ?? 0), 0) }, null, 2));
  } else {
    const stage = JSON.parse(await readFile(STAGE, 'utf8'));
    const prep = JSON.parse(await readFile(A('nis-pentagon-roads-prepare.json'), 'utf8'));
    console.log(JSON.stringify({
      plan_id: stage.approved_plan_id,
      batches: (prep.batches ?? []).map((b) => ({ batch_id: b.batch_id, type: b.type, n: (b.object_ids ?? []).length, state: b.state })),
      next_action: prep.next_action,
    }, null, 2));
  }
} finally {
  await client.close();
}
