// 美瑞迪安圆形城镇按图施工驱动器（阶段二：公服设施与管网骨干落地）
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN_FILE = path.join(ROOT, 'plans/meridian-circular-town-plan.json');
const PROGRESS_FILE = path.join(ROOT, 'tools/scratch/.meridian-construction-progress.jsonl');

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const mode = process.argv[2] || 'prepare';
const resume = process.argv.includes('--resume');
const maxBatches = (() => {
  const i = process.argv.findIndex(a => a === '--max' || a.startsWith('--max='));
  if (i === -1) return Infinity;
  const token = process.argv[i];
  return token.includes('=') ? Number(token.split('=')[1]) : Number(process.argv[i + 1]);
})();

const planDoc = JSON.parse(await readFile(PLAN_FILE, 'utf8'));

// 恢复模式：标记已提交对象为 built
const committedEntries = resume && existsSync(PROGRESS_FILE)
  ? (await readFile(PROGRESS_FILE, 'utf8')).trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(e => e.phase === 'committed')
  : [];
const builtIds = new Set([
  ...committedEntries.flatMap(e => e.object_ids || []),
  ...committedEntries.map(e => (e.batch_id || '').replace(/-part-\d+$/, '')),
]);
if (builtIds.size) {
  for (const bld of (planDoc.plan.buildings || [])) if (builtIds.has(bld.id)) bld.construction_status = 'built';
  for (const util of (planDoc.plan.utilities || [])) if (builtIds.has(util.id)) util.construction_status = 'built';
  console.log(`[resume] ${builtIds.size} 个已提交对象标记 built`);
}

const constructionPlan = planDoc.plan;

const transport = new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs'],
});
const client = new Client({ name: 'meridian-constructor', version: '1.0.0' });
await client.connect(transport);

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content || []).map(c => c.text || '').join('\n');
  try { return JSON.parse(text); } catch { return { raw: text, isError: result.isError }; }
}

const baseArgs = {
  bounds: planDoc.bounds,
  plan: constructionPlan,
  approved_plan_id: planDoc.plan_id,
};

async function resolvePlanId() {
  const probe = await call('prepare_city_plan_construction', {
    bounds: planDoc.bounds, plan: constructionPlan, approved_plan_id: 'cplan-0000000000000000',
  });
  const actual = probe.error?.details?.actual_plan_id
    || (probe.error?.message && probe.error.message.match(/current structured plan (cplan-[a-f0-9]{16})/)?.[1])
    || JSON.stringify(probe).match(/current structured plan (cplan-[a-f0-9]{16})/)?.[1];
  if (!actual) {
    console.error('无法从探测结果取得服务端哈希:', JSON.stringify(probe).slice(0, 1500));
    process.exit(1);
  }
  console.log(`服务端哈希 = ${actual}`);
  return actual;
}

if (mode === 'prepare') {
  const actual = await resolvePlanId();
  const prep = await call('prepare_city_plan_construction', { ...baseArgs, approved_plan_id: actual });
  console.log('Prepare response:');
  const d = prep.data || prep;
  console.log(JSON.stringify({
    ok: prep.ok,
    construction_ready: d.construction_ready,
    native_batch_count: d.native_batch_count,
    building_batch_count: d.building_batch_count,
    utility_batch_count: d.utility_batch_count,
    next_batch: d.next_action?.arguments?.batch_id
  }, null, 2));
  await transport.close();
  process.exit(0);
}

// run 模式
const actualPlanId = await resolvePlanId();
baseArgs.approved_plan_id = actualPlanId;
const prep = await call('prepare_city_plan_construction', baseArgs);
if (prep.isError || prep.raw) {
  console.error('prepare 失败:', JSON.stringify(prep).slice(0, 3000));
  process.exit(1);
}
const prepData = prep.data || prep;
console.log('prepare 编译结果:', JSON.stringify({
  construction_ready: prepData.construction_ready,
  native_batch_count: prepData.native_batch_count,
  building_batches: prepData.building_batch_count,
  utility_batches: prepData.utility_batch_count,
  plan_id: prepData.plan_id,
}, null, 2));

if (!prepData.construction_ready) {
  console.error('construction_ready=false，中止');
  process.exit(1);
}

let next = prepData.next_action;
let batchIndex = 0;

while (next) {
  batchIndex += 1;
  const previewArgs = { ...next.arguments, operation_timeout_ms: 60000 };
  const batchId = previewArgs.batch_id || `#${batchIndex}`;

  console.log(`\n--------------------------------------------------`);
  console.log(`[Batch ${batchIndex}] 正在执行原生预览 preview_batch: ${batchId}...`);
  const preview = await call('advance_city_plan_construction', previewArgs);
  const pv = preview.data || preview;
  const op = pv.native_preview || pv.preview || {};
  const state = op.state || pv.state;
  console.log(`[preview] 批次 ${batchId} state=${state} cost=${op.cost ?? '?'} errors=${JSON.stringify(op.errors || [])}${(op.warnings || []).length ? ' warnings=' + JSON.stringify(op.warnings.slice(0, 2)) : ''}`);
  
  if (state !== 'preview_ready') {
    console.error('预览未就绪，停止。完整返回：', JSON.stringify(preview).slice(0, 6000));
    process.exit(1);
  }

  await appendFile(PROGRESS_FILE, JSON.stringify({
    phase: 'previewed', batch: batchIndex, batch_id: batchId, state, cost: op.cost,
    object_ids: pv.object_ids || [],
  }) + '\n');

  const commitArgs = { ...(pv.next_action || {}).arguments, operation_timeout_ms: 120000 };
  if (!commitArgs.max_cost) commitArgs.max_cost = Math.ceil((op.cost || 0) * 1.5) + 10000;

  console.log(`[Batch ${batchIndex}] 正在提交施工 commit_batch: ${batchId} (max_cost: ${commitArgs.max_cost})...`);
  const commit = await call('advance_city_plan_construction', commitArgs);
  const cm = commit.data || commit;
  const cState = cm.state || cm.status;
  const created = (pv.object_ids || []).map(id => ({ id }));
  console.log(`[commit ] 批次 ${batchId} state=${cState} verified=${created.length} next=${cm.next_action ? 'yes' : 'no'}`);
  
  if (cState !== 'completed' && cState !== 'completed_verified') {
    console.error('提交未完成，停止。完整返回：', JSON.stringify(commit).slice(0, 6000));
    process.exit(1);
  }

  await appendFile(PROGRESS_FILE, JSON.stringify({
    phase: 'committed', batch: batchIndex, batch_id: batchId, state: cState,
    object_ids: created.map ? created.map(o => o.id || o) : created,
    result_entities: cm.created_facility_ids || cm.created_road_ids || cm.result_entity_ids || [],
    next_action: cm.next_action || null,
  }) + '\n');

  next = cm.next_action;
  if (!next) break;
  if (batchIndex >= maxBatches) {
    console.log(`--max=${maxBatches} 已达上限，暂停在下一批 (${next.arguments?.batch_id})`);
    break;
  }
}

console.log(`\n==================================================`);
console.log(`施工进度推进完成：本次成功推进 ${batchIndex} 批。`);
await transport.close();
