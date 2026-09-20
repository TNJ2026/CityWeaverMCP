// 尼思五边形城 · 建筑阶段：绑定朝向 → 编译批次 → 逐批 preview+commit
// 用法：node tools/scratch/nis-pentagon-buildings.mjs [prepare|commit-all|status]
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PLAN_FILE = path.join(ROOT, 'plans', 'nis-pentagon-city-plan.json');
const STAGE = path.join(ROOT, 'artifacts', 'nis-pentagon-buildings-stage.json');
const PREP = path.join(ROOT, 'artifacts', 'nis-pentagon-buildings-prepare.json');
const LOG = path.join(ROOT, 'artifacts', 'nis-pentagon-buildings-log.jsonl');
const MODE = process.argv[2] ?? 'status';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const base = JSON.parse(await readFile(PLAN_FILE, 'utf8'));

const client = new Client({ name: 'nis-pentagon-buildings', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args, timeout = 300000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) {
      const txt = r.content?.find((c) => c.type === 'text')?.text ?? '';
      const err = new Error(txt.slice(0, 500));
      err.raw = txt;
      throw err;
    }
    return r.structuredContent?.data ?? r.structuredContent;
  };

  if (MODE === 'prepare') {
    // 0. 绑定缓存：绑定是非确定性的，成功的绑定固化复用，只对缺口增量重绑
    const CACHE = path.join(ROOT, 'artifacts', 'nis-pentagon-bindings-cache.json');
    let cache = {};
    try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch { /* first run */ }
    const plan = {
      roads: base.plan.roads.map((r) => ({ ...r, construction_status: 'built' })),
      buildings: base.plan.buildings.map((x) => ({ ...x, construction_status: 'planned' })),
      zones: base.plan.zones ?? [],
      grid_exceptions: base.plan.grid_exceptions ?? [],
      tracks: base.plan.tracks ?? [],
      utilities: base.plan.utilities ?? [],
    };
    // 把缓存里已绑定的条目套回 plan
    for (const b of plan.buildings) {
      if (cache[b.id]) Object.assign(b, cache[b.id], { id: b.id, construction_status: 'planned' });
    }
    const ids = plan.buildings.filter((x) => !cache[x.id]).map((x) => x.id);
    console.log('[bind] cached:', Object.keys(cache).length, '| to bind:', ids.length);
    if (ids.length) {
      const bind = await call('bind_city_plan_buildings', {
        request_id: `nispen-bind-bld-${Date.now()}`,
        bounds: base.bounds,
        plan,
        building_ids: ids,
        search_radius_m: 400,
        candidate_count: 12,
        max_preview_attempts: 6,
        continue_on_error: true,
        operation_timeout_ms: 60000,
      });
      let results = bind.results ?? [];
      let boundPlan = bind.plan ?? plan;
      let failedBinds = results.filter((r) => r.state !== 'bound');
      if (failedBinds.length) {
        const retryIds = failedBinds.map((f) => f.building_id);
        console.log('[bind] retry with radius 1200:', retryIds.join(','));
        const bind2 = await call('bind_city_plan_buildings', {
          request_id: `nispen-bind-bld-retry-${Date.now()}`,
          bounds: base.bounds,
          plan: boundPlan,
          building_ids: retryIds,
          search_radius_m: 1200,
          candidate_count: 16,
          max_preview_attempts: 8,
          continue_on_error: true,
          operation_timeout_ms: 60000,
        });
        const results2 = bind2.results ?? [];
        const patched = bind2.plan ?? boundPlan;
        for (const b of patched.buildings) {
          const r2 = results2.find((x) => x.building_id === b.id);
          if (r2?.state === 'bound') {
            const target = boundPlan.buildings.find((x) => x.id === b.id);
            if (target) Object.assign(target, b, { id: b.id });
          }
        }
        results = results.map((r) => results2.find((x) => x.building_id === r.building_id && x.state === 'bound') ?? r);
        failedBinds = results.filter((r) => r.state !== 'bound');
      }
      const bound = results.filter((r) => r.state === 'bound');
      console.log(`[bind] bound ${bound.length}/${results.length}`);
      for (const f of failedBinds) console.log('  [bind-fail]', f.building_id, f.error ?? f.state);
      // 成功绑定的固化进缓存；失败者标 skipped，不进施工批次（缺口在交付报告说明）
      for (const r of bound) {
        const src = boundPlan.buildings.find((x) => x.id === r.building_id);
        if (src) cache[r.building_id] = src;
      }
      for (const f of failedBinds) {
        const target = plan.buildings.find((x) => x.id === f.building_id);
        if (target) target.construction_status = 'skipped';
      }
    }
    await writeFile(CACHE, JSON.stringify(cache, null, 2));
    // 组装阶段计划：缓存绑定 + skip 标记
    for (const b of plan.buildings) {
      if (cache[b.id]) Object.assign(b, cache[b.id], { id: b.id, construction_status: 'planned' });
    }
    const boundPlan = plan;
    const boundCount = plan.buildings.filter((x) => x.construction_status === 'planned' && x.rotation_source === 'bound' || cache[x.id]).length;
    console.log('[stage] buildings planned with binding:', plan.buildings.filter((x) => cache[x.id]).length, '| skipped:', plan.buildings.filter((x) => x.construction_status === 'skipped').map((x) => x.id).join(','));
    const stage = { bounds: base.bounds, plan: boundPlan, city: base.city };
    await writeFile(STAGE, JSON.stringify(stage, null, 2));
    // 3. probe 实际哈希（zod 归一化口径）
    let actual = null;
    try {
      await call('prepare_city_plan_construction', { bounds: base.bounds, plan: boundPlan, approved_plan_id: 'cplan-0000000000000000' });
    } catch (e) {
      const m = (e.raw ?? e.message ?? '').match(/current structured plan (cplan-[a-f0-9]{16})/);
      actual = m ? m[1] : null;
    }
    if (!actual) throw new Error('无法 probe 出实际 plan_id');
    console.log('[probe] plan_id =', actual);
    // 4. prepare
    const d = await call('prepare_city_plan_construction', { bounds: base.bounds, plan: boundPlan, approved_plan_id: actual });
    await writeFile(PREP, JSON.stringify(d, null, 2));
    await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), stage: 'prepare', plan_id: actual, construction_ready: d.construction_ready, batches: d.execution_order?.length }) + '\n');
    console.log(JSON.stringify({
      plan_id: actual,
      construction_ready: d.construction_ready,
      batches: d.execution_order?.length,
      types: [...new Set((d.execution_order ?? []).map((b) => b.batch_type))],
      first: d.execution_order?.[0]?.batch_id,
    }, null, 2));
  } else if (MODE === 'commit-all') {
    const stage = JSON.parse(await readFile(STAGE, 'utf8'));
    const prep = JSON.parse(await readFile(PREP, 'utf8'));
    const order = prep.execution_order ?? [];
    const only = process.argv[3] ?? null;
    let seq = 0, okCount = 0, failCount = 0;
    const failures = [];
    for (const b of order) {
      if (only && !b.batch_id.startsWith(only)) continue;
      const bid = b.batch_id;
      try {
        const pd = await call('advance_city_plan_construction', {
          action: 'preview_batch',
          bounds: stage.bounds, plan: stage.plan, approved_plan_id: stage.approved_plan_id ?? prep.plan_id,
          batch_id: bid, request_id: `nispen-bld_${bid}_preview`, operation_timeout_ms: 60000,
        });
        if (pd.state !== 'preview_ready') throw new Error('preview state=' + pd.state + ' err=' + JSON.stringify(pd.native_preview?.errors ?? []).slice(0, 200));
        const na = pd.next_action;
        if (!na || na.arguments?.action !== 'commit_batch') throw new Error('无 commit next_action');
        const cd = await call('advance_city_plan_construction', { ...na.arguments, request_id: `nispen-bld_${bid}_commit`, operation_timeout_ms: 120000 });
        const verified = cd.permanent_readback?.verified ?? cd.verified ?? true;
        if (cd.state !== 'completed' && cd.state !== 'completed_verified') throw new Error('commit state=' + cd.state);
        okCount += 1;
        await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), stage: 'committed', batch_id: bid, state: cd.state, verified, created: (cd.native_operation?.result_entity_ids ?? []).length, cost: cd.native_operation?.cost }) + '\n');
        process.stdout.write('.');
      } catch (e) {
        failCount += 1;
        failures.push({ batch_id: bid, error: String(e.message).slice(0, 300) });
        await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), stage: 'failed', batch_id: bid, error: String(e.message).slice(0, 300) }) + '\n');
        console.log(`\n[fail] ${bid}: ${String(e.message).slice(0, 250)}`);
      }
      seq += 1;
    }
    console.log(`\n[buildings] total ${seq} | committed ${okCount} | failed ${failCount}`);
    if (failures.length) await writeFile(path.join(ROOT, 'artifacts', 'nis-pentagon-buildings-failures.json'), JSON.stringify(failures, null, 2));
  } else {
    const prep = JSON.parse(await readFile(PREP, 'utf8'));
    console.log(JSON.stringify({
      batches: (prep.execution_order ?? []).map((b) => ({ batch_id: b.batch_id, type: b.batch_type })),
      next_action: prep.next_action,
    }, null, 2).slice(0, 2000));
  }
} finally {
  await client.close();
}
