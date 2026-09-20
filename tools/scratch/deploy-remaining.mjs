// 美瑞迪安圆形城镇：部署剩余 19 栋公服设施与管网
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN_FILE = path.join(ROOT, 'plans/meridian-circular-town-plan.json');
const PROGRESS_FILE = path.join(ROOT, 'tools/scratch/.meridian-construction-progress.jsonl');

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const client = new Client({ name: 'deploy-remaining', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs']
}));

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content || []).map(c => c.text || '').join('\n');
  try { return JSON.parse(text); } catch { return { raw: text, isError: result.isError }; }
}

try {
  // 1. Ensure city is paused
  await call('set_simulation_speed', { speed: 'paused' });

  // 2. Load plan
  const planDoc = JSON.parse(await readFile(PLAN_FILE, 'utf8'));
  const builtBuildingIds = [
    'bld-city-hall',
    'bld-general-hospital',
    'bld-college',
    'bld-police-hq',
    'bld-central-park',
    'bld-substation-ne'
  ];

  // Mark roads and already built buildings as built
  for (const road of planDoc.plan.roads) {
    road.construction_status = 'built';
  }
  for (const bld of planDoc.plan.buildings) {
    if (builtBuildingIds.includes(bld.id)) {
      bld.construction_status = 'built';
    }
  }

  const remainingBuildings = planDoc.plan.buildings.filter(b => b.construction_status !== 'built');
  const remainingIds = remainingBuildings.map(b => b.id);
  console.log(`[Step 1] 开始为新会话重新吸附并绑定剩余 ${remainingIds.length} 栋建筑...`);

  const bindRes = await call('bind_city_plan_buildings', {
    bounds: planDoc.bounds,
    plan: planDoc.plan,
    building_ids: remainingIds,
    request_id: 'meridian-bind-rem-001',
    candidate_count: 12,
    max_preview_attempts: 6,
    search_radius_m: 400,
    continue_on_error: true,
    operation_timeout_ms: 60000
  });

  const bindData = bindRes.data || bindRes;
  const results = bindData.results || [];
  const boundCount = results.filter(r => r.state === 'bound').length;
  console.log(`[Step 1] 绑定完成：${boundCount} / ${results.length} 栋成功绑定`);
  for (const r of results) {
    if (r.state !== 'bound') {
      console.warn(`  - 警告: ${r.building_id} 绑定失败: ${r.error}`);
    }
  }

  const boundPlan = bindData.plan || planDoc.plan;
  planDoc.plan = boundPlan;
  await writeFile(PLAN_FILE, JSON.stringify(planDoc, null, 2), 'utf8');

  // 3. Prepare construction
  console.log(`\n[Step 2] 编译施工批次...`);
  // Probe actual hash
  const probe = await call('prepare_city_plan_construction', {
    bounds: planDoc.bounds,
    plan: planDoc.plan,
    approved_plan_id: 'cplan-0000000000000000'
  });
  const actualPlanId = probe.error?.details?.actual_plan_id
    || (probe.error?.message && probe.error.message.match(/current structured plan (cplan-[a-f0-9]{16})/)?.[1])
    || JSON.stringify(probe).match(/current structured plan (cplan-[a-f0-9]{16})/)?.[1];

  console.log(`当前计划哈希: ${actualPlanId}`);

  const prep = await call('prepare_city_plan_construction', {
    bounds: planDoc.bounds,
    plan: planDoc.plan,
    approved_plan_id: actualPlanId
  });

  const prepData = prep.data || prep;
  console.log(`编译成功: construction_ready=${prepData.construction_ready}, native_batch_count=${prepData.native_batch_count}`);

  if (!prepData.construction_ready) {
    console.error('construction_ready 为 false，停止：', JSON.stringify(prep).slice(0, 1500));
    process.exit(1);
  }

  // 4. Advance batches
  console.log(`\n[Step 3] 开始推进施工批次...`);
  let next = prepData.next_action;
  let batchIndex = 0;

  while (next) {
    batchIndex += 1;
    const previewArgs = { ...next.arguments, operation_timeout_ms: 60000 };
    const batchId = previewArgs.batch_id || `#${batchIndex}`;

    console.log(`\n[Batch ${batchIndex}] 原生预览: ${batchId}...`);
    const preview = await call('advance_city_plan_construction', previewArgs);
    const pv = preview.data || preview;
    const op = pv.native_preview || pv.preview || {};
    const state = op.state || pv.state;
    console.log(`  [preview] state=${state} cost=${op.cost ?? '?'}`);

    if (state !== 'preview_ready') {
      console.error('  预览失败，停止。详情：', JSON.stringify(preview).slice(0, 2000));
      break;
    }

    const commitArgs = { ...(pv.next_action || {}).arguments, operation_timeout_ms: 120000 };
    if (!commitArgs.max_cost) commitArgs.max_cost = Math.ceil((op.cost || 0) * 1.5) + 10000;

    console.log(`[Batch ${batchIndex}] 原生提交施工: ${batchId} (max_cost: ${commitArgs.max_cost})...`);
    const commit = await call('advance_city_plan_construction', commitArgs);
    const cm = commit.data || commit;
    const cState = cm.state || cm.status;
    console.log(`  [commit] state=${cState} next=${cm.next_action ? 'yes' : 'no'}`);

    if (cState !== 'completed' && cState !== 'completed_verified') {
      console.error('  提交未完成，停止。详情：', JSON.stringify(commit).slice(0, 2000));
      break;
    }

    await appendFile(PROGRESS_FILE, JSON.stringify({
      phase: 'committed',
      batch: batchIndex,
      batch_id: batchId,
      state: cState,
      object_ids: pv.object_ids || [batchId],
      result_entities: cm.created_facility_ids || cm.created_road_ids || cm.result_entity_ids || [],
      at: new Date().toISOString()
    }) + '\n');

    next = cm.next_action;
    if (!next) break;
  }

  console.log(`\n==================================================`);
  console.log(`本次施工推进完成，成功落成 ${batchIndex} 个批次！`);

} finally {
  await client.close();
}
