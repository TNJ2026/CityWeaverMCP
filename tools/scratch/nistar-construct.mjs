// 尼思五角星城 · 按图施工驱动器（阶段推进，逐批原生预览 + 提交 + 永久回读）
// 用法：
//   node tools/scratch/nistar-construct.mjs prepare-roads   # 道路阶段：渲染 + 建立虚拟沙盒批次
//   node tools/scratch/nistar-construct.mjs preview <batch_id>
//   node tools/scratch/nistar-construct.mjs commit  <batch_id>
//   node tools/scratch/nistar-construct.mjs status          # 打印当前阶段状态
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');
const PLAN = path.join(ROOT, 'plans', 'nistar-star-city-plan.json');
const A = (f) => path.join(ROOT, 'artifacts', f);
const STAGE = A('nistar-roads-stage.json');
const LOG = A('nistar-construction.jsonl');

const cmd = process.argv[2] ?? 'status';
const batchId = process.argv[3];

const base = JSON.parse(await readFile(PLAN, 'utf8'));

// 道路阶段计划：只含道路；建筑与分区等道路永久回读后再进入下一个批准周期
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

const client = new Client({ name: 'nistar-construction', version: '1.0' });
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
    const prep = JSON.parse(await readFile(A('nistar-roads-prepare.json'), 'utf8'));
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
        request_id: `nistar_scan_${b.batch_id}_20260920`,
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
      await writeFile(A('nistar-roads-scan.json'), JSON.stringify(rows, null, 2));
    }
    const ok = rows.filter((r) => r.state === 'preview_ready');
    const bad = rows.filter((r) => r.state !== 'preview_ready');
    console.log(JSON.stringify({ total: rows.length, ok: ok.length, failed: bad.length, total_cost: ok.reduce((s, r) => s + (r.cost ?? 0), 0), failed_ids: bad.map((r) => `${r.batch_id}(${r.tool_code ?? r.state})`) }, null, 2));
  } else if (cmd === 'prepare-roads') {
    const plan = roadsStagePlan();
    const renderArgs = {
      bounds: base.bounds,
      render: { ...base.render, title: '尼思｜五角星城·道路骨架施工阶段' },
      water_cell_size_m: base.water_cell_size_m,
      terrain_cell_size_m: base.terrain_cell_size_m,
      plan,
    };
    const rr = await call('render_city_plan', renderArgs);
    const html = rr.content?.find((x) => x.type === 'resource' && x.resource?.mimeType === 'text/html')?.resource?.text;
    if (html) await writeFile(A('nistar-roads-stage.html'), html);
    const rid = rr.structuredContent?.data?.plan_id ?? rr.structuredContent?.plan_id;
    console.log('[render] plan_id =', rid, '| validation issues =', rr.structuredContent?.data?.validation?.issue_count);

    const stage = { bounds: base.bounds, plan, approved_plan_id: rid, city: base.city };
    await writeFile(STAGE, JSON.stringify(stage, null, 2));

    const pr = await call('prepare_city_plan_construction', stage);
    const d = pr.structuredContent?.data ?? pr.structuredContent ?? {};
    await writeFile(A('nistar-roads-prepare.json'), JSON.stringify(d, null, 2));
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
        request_id: `nistar_${batchId}_preview_20260920`,
        operation_timeout_ms: 60000,
      };
    } else {
      const prev = JSON.parse(await readFile(A(`nistar-roads-${batchId}-preview.json`), 'utf8'));
      const na = prev.data?.next_action ?? prev.next_action;
      if (!na || na.arguments?.action !== 'commit_batch') throw new Error(`批次 ${batchId} 没有可提交的 commit next_action: ${JSON.stringify(na).slice(0, 800)}`);
      args = { ...na.arguments, request_id: `nistar_${batchId}_commit_20260920`, operation_timeout_ms: 60000 };
    }
    const r = await call('advance_city_plan_construction', args);
    const d = r.structuredContent?.data ?? r.structuredContent ?? {};
    await writeFile(A(`nistar-roads-${batchId}-${cmd}.json`), JSON.stringify(d, null, 2));
    await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), cmd, batch_id: batchId, result: d }) + '\n');
    console.log(JSON.stringify({
      batch_id: batchId,
      state: d.state ?? d.batch_state,
      cost: d.cost ?? d.actual_cost,
      created: d.created_road_ids?.length ?? d.created_object_ids?.length,
      next_action: d.next_action,
      warnings: d.warnings, errors: d.errors, error: d.error,
    }, null, 2));
  } else {
    const stage = JSON.parse(await readFile(STAGE, 'utf8'));
    const prep = JSON.parse(await readFile(A('nistar-roads-prepare.json'), 'utf8'));
    console.log(JSON.stringify({
      plan_id: stage.approved_plan_id,
      batches: (prep.batches ?? []).map((b) => ({ batch_id: b.batch_id, type: b.type, n: (b.object_ids ?? []).length, state: b.state })),
      next_action: prep.next_action,
    }, null, 2));
  }
} finally {
  await client.close();
}
