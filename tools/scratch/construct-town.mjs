// 萨默斯维尔湖湾镇按图施工驱动器。
// 用法：
//   node tools/scratch/construct-town.mjs prepare   # 只编译批次（虚拟沙盒，不写入游戏）
//   node tools/scratch/construct-town.mjs run       # 逐批 preview_batch → commit_batch（永久写入）
//   node tools/scratch/construct-town.mjs run --resume  # 从进度文件续跑（已完成对象标记 built）
// 状态：tools/scratch/.sommerville-construction-progress.jsonl（每批一行）。
// 失败/未知结果立即停止并保持城市暂停；不换 request_id 重试。
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN_FILE = path.join(ROOT, 'plans/sommerville-town-plan.json');
const WORK_FILE = path.join(ROOT, 'artifacts/sommerville-construction-plan.json');
const PROGRESS_FILE = path.join(ROOT, 'tools/scratch/.sommerville-construction-progress.jsonl');

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

// 施工 schema 只接受字段白名单：投影掉规划标注字段（district/road_class/roadside_of…）。
// 哈希在投影后的对象上重算，与传给施工器的 plan 严格同源。
function projectPlan(doc) {
  const roads = doc.plan.roads.map(r => ({
    id: r.id, label: r.label, prefab: r.prefab, level: r.level ?? 'surface',
    width_m: r.width_m, points: r.points.map(p => ({ x: p.x, z: p.z })),
    construction_status: r.construction_status ?? 'planned',
    construction_order: r.construction_order,
    ...(r.depends_on ? { depends_on: r.depends_on } : {}),
  }));
  const buildings = doc.plan.buildings.map(b => {
    const isUtility = (b.kind === 'utility') || /WaterTower|WindTurbine|Transformer|Telecom/.test(b.prefab);
    return {
      id: b.id, label: b.label, prefab: b.prefab,
      kind: 'service', category: isUtility ? 'utility_facility' : 'auto',
      position: { x: b.position.x, z: b.position.z },
      rotation_degrees: b.rotation_degrees ?? 0,
      size_m: b.size_m,
      construction_status: b.construction_status ?? 'planned',
      ...(b.construction_order != null ? { construction_order: b.construction_order } : {}),
    };
  });
  const zones = doc.plan.zones.map(z => ({ id: z.id, kind: z.kind, polygon: z.polygon.map(p => ({ x: p.x, z: p.z })) }));
  return { roads, buildings, zones };
}

// 恢复模式：把进度文件里已提交的对象标记为 built（文档化续跑口径），重新编译出全新批次链。
const committedEntries = resume && existsSync(PROGRESS_FILE)
  ? (await readFile(PROGRESS_FILE, 'utf8')).trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l)).filter(e => e.phase === 'committed')
  : [];
const builtIds = new Set([
  ...committedEntries.flatMap(e => e.object_ids || []),
  ...committedEntries.map(e => (e.batch_id || '').replace(/-part-\d+$/, '')),
]);
if (builtIds.size) {
  for (const road of planDoc.plan.roads) if (builtIds.has(road.id)) road.construction_status = 'built';
  for (const building of planDoc.plan.buildings) if (builtIds.has(building.id)) building.construction_status = 'built';
  console.log(`[resume] ${builtIds.size} 个已提交对象标记 built：${[...builtIds].join(', ')}`);
}

const constructionPlan = projectPlan(planDoc);
const { computeCityPlanId } = await import(`file://${ROOT.replace(/\\/g, '/')}/mcp/planning-renderer.mjs`);
planDoc.plan_id = computeCityPlanId(planDoc.bounds, constructionPlan);
console.log(`施工 plan_id = ${planDoc.plan_id}`);

// 工作文档落盘（含标记后的 built 状态），保证 plan 与哈希同源。
await writeFile(WORK_FILE, JSON.stringify({ ...planDoc, plan: constructionPlan }, null, 2));

const transport = new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs'],
});
const client = new Client({ name: 'sommerville-constructor', version: '1.0.0' });
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

// 服务端 Zod 解析后的键序与本地不同，哈希无法本地复算：
// 先用占位 id 探测服务端算出的真实哈希，再用它正式调用（几何未变）。
async function resolvePlanId() {
  const probe = await call('prepare_city_plan_construction', {
    bounds: planDoc.bounds, plan: constructionPlan, approved_plan_id: 'cplan-0000000000000000',
  });
  const actual = probe.error?.details?.actual_plan_id
    || JSON.stringify(probe).match(/current structured plan (cplan-[a-f0-9]{16})/)?.[1];
  if (!actual) { console.error('无法从探测结果取得服务端哈希:', JSON.stringify(probe).slice(0, 1500)); process.exit(1); }
  console.log(`服务端哈希 = ${actual}`);
  return actual;
}

const PLAN_TAG = 'sommerville';

if (mode === 'prepare') {
  const actual = await resolvePlanId();
  const prep = await call('prepare_city_plan_construction', { ...baseArgs, approved_plan_id: actual });
  console.log(JSON.stringify(prep, null, 2));
  await transport.close();
  process.exit(0);
}

// ---- run 模式 ----
const actualPlanId = await resolvePlanId();
baseArgs.approved_plan_id = actualPlanId;
const prep = await call('prepare_city_plan_construction', baseArgs);
if (prep.isError || prep.raw) { console.error('prepare 失败:', JSON.stringify(prep).slice(0, 3000)); process.exit(1); }
const prepData = prep.data || prep;
console.log('prepare:', JSON.stringify({
  construction_ready: prepData.construction_ready,
  native_batch_count: prepData.native_batch_count,
  plan_id: prepData.plan_id,
}));
if (!prepData.construction_ready) { console.error('construction_ready=false，中止'); process.exit(1); }

// resume：标记 built 后全新编译，批次链从头开始但已建对象不再进批次。
let next = prepData.next_action;
let batchIndex = 0;
if (builtIds.size) console.log(`[resume] 全新批次链 ${prepData.native_batch_count} 批，从 ${next?.arguments?.batch_id} 开始`);

while (next) {
  batchIndex += 1;
  const previewArgs = { ...next.arguments, operation_timeout_ms: 60000 };
  const batchId = previewArgs.batch_id || `#${batchIndex}`;

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
  if (!commitArgs.max_cost) commitArgs.max_cost = Math.ceil((op.cost || 0) * 1.5) + 1000;
  const commit = await call('advance_city_plan_construction', commitArgs);
  const cm = commit.data || commit;
  const cState = cm.state || cm.status;
  const created = (pv.object_ids || []).map(id => ({ id }));
  console.log(`[commit ] 批次 ${batchId} state=${cState} created/verified=${created.length} next=${cm.next_action ? 'yes' : 'no'}`);
  if (cState !== 'completed' && cState !== 'completed_verified') {
    console.error('提交未完成，停止。完整返回：', JSON.stringify(commit).slice(0, 6000));
    process.exit(1);
  }
  await appendFile(PROGRESS_FILE, JSON.stringify({
    phase: 'committed', batch: batchIndex, batch_id: batchId, state: cState,
    object_ids: created.map ? created.map(o => o.id || o) : created,
    next_action: cm.next_action || null,
  }) + '\n');
  next = cm.next_action;
  if (!next) break;
  if (batchIndex >= maxBatches) { console.log(`--max=${maxBatches} 已达上限，暂停在下一批 (${next.arguments?.batch_id})`); break; }
}
console.log(`\n全部批次执行完毕：本次推进 ${batchIndex} 批。`);
await transport.close();
