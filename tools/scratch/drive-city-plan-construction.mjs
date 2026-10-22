// 驱动城市规划施工（官方执行器 + planning-store 持久日志），逐批 preview → commit。
//
// 使用与 MCP 完全相同的代码路径：createCityPlanConstructionWorkflow + createPlanningSession。
// 每批都严格按日志的 next_action 顺序执行；preview 未就绪即停止，不重试、不跳批。
// 日志可中断续跑：直接重跑同一 construction_id 即可从当前 next_action 继续。
//
// 用法:
//   node tools/scratch/drive-city-plan-construction.mjs <construction_id> [--limit N] [--dry-run] [--preview-only]

import { PlanningStore } from '../../mcp/planning-store.mjs';
import { createPlanningSession } from '../../mcp/planning-session.mjs';
import { createCityPlanConstructionWorkflow } from '../../mcp/city-plan-construction-workflow.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const constructionId = process.argv[2];
if (!constructionId?.startsWith('construction-')) throw new Error('Usage: node tools/scratch/drive-city-plan-construction.mjs <construction_id> [--limit N] [--dry-run] [--preview-only]');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;
const dryRun = process.argv.includes('--dry-run');
const previewOnly = process.argv.includes('--preview-only');

const store = new PlanningStore();
const workflow = createCityPlanConstructionWorkflow(queryGame);
const session = createPlanningSession({ store, queryGame, prepare: workflow.inspect, advance: workflow.advance });

const money = async () => {
  const res = await queryGame('get_city_economy', {});
  return res?.ok ? res.data.money : null;
};

let journal = await store.get(constructionId);
if (journal.recovery_required) {
  console.log(`RECOVERY_REQUIRED: ${JSON.stringify(journal.failure)}`);
  process.exit(2);
}

console.log(`construction ${constructionId}`);
console.log(`executor ${journal.executor_version} | plan ${journal.approved_plan_id} | session ${journal.session_id}`);
console.log(`state_version ${journal.state_version} | batches ${journal.compiled.batches.length}`);
console.log(`money before ${await money()}`);

if (dryRun) {
  const next = journal.next_action?.arguments;
  const order = journal.compiled.batches.map(b => b.batch_id);
  const at = next ? order.indexOf(next.batch_id) : -1;
  console.log(`next_action ${next ? `${next.action} ${next.batch_id} (index ${at})` : 'none'}`);
  console.log('remaining batches:');
  for (const b of journal.compiled.batches.slice(Math.max(0, at))) {
    const type = b.batch_type;
    const label = b.building_prefab ?? b.prefab_names?.[0] ?? '';
    console.log(`  ${b.batch_id.padEnd(28)} ${type.padEnd(9)} ${label}`);
  }
  process.exit(0);
}

let done = 0;
let spent = 0;
while (journal.next_action && done < limit) {
  const action = journal.next_action.arguments;
  let result;
  try {
    result = await session.advance({
      construction_id: constructionId,
      state_version: journal.state_version,
      action: action.action,
      batch_id: action.batch_id,
    });
  } catch (error) {
    console.log(`STOP  ${action.action} ${action.batch_id} → THROW ${error.code} ${error.message}`);
    process.exit(3);
  }

  const preview = result.native_preview ?? {};
  const cost = Number(preview.cost ?? 0);
  if (result.success) spent += action.action === 'commit_batch' ? cost : 0;
  console.log(
    `${result.success ? 'OK  ' : 'FAIL'} ${action.action.padEnd(12)} ${String(result.batch_id).padEnd(28)} ` +
    `type=${result.batch_type} state=${result.state} cost=${cost.toFixed(0)} ` +
    `warn=${(preview.warnings ?? []).length} err=${(preview.errors ?? []).length}` +
    (result.verified_road_ids ? ` roads+${result.verified_road_ids.length}` : '') +
    (result.verified_building_ids ? ` bldg+${result.verified_building_ids.length}` : '') +
    (result.recovery_required ? ' RECOVERY_REQUIRED' : '')
  );
  if ((preview.errors ?? []).length) console.log(`      errors: ${JSON.stringify(preview.errors).slice(0, 400)}`);
  if ((preview.warnings ?? []).length) console.log(`      warnings: ${JSON.stringify(preview.warnings).slice(0, 300)}`);

  if (!result.success) {
    console.log('stopping: preview not ready.');
    process.exit(4);
  }
  if (previewOnly && action.action === 'preview_batch') {
    console.log('stopping: --preview-only.');
    process.exit(0);
  }

  journal = await store.get(constructionId);
  done++;
  if (result.plan_complete) {
    console.log('PLAN COMPLETE');
    break;
  }
}

console.log(`done batches ${done} | committed cost ${spent.toFixed(0)} | money after ${await money()}`);
console.log(`next_action ${journal.next_action ? `${journal.next_action.arguments.action} ${journal.next_action.arguments.batch_id}` : 'none'}`);
