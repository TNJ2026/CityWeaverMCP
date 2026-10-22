// 本地复现 prepare_city_plan_construction 的完整 inspect 流程，用于定位 MCP 返回 INTERNAL_ERROR 的真实异常。
//
// 用法: node tools/scratch/repro-prepare.mjs <plan.json>

import { readFile } from 'node:fs/promises';
import { createCityPlanConstructionWorkflow } from '../../mcp/city-plan-construction-workflow.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const planPath = process.argv[2];
const doc = JSON.parse(await readFile(planPath, 'utf8'));

const workflow = createCityPlanConstructionWorkflow(queryGame);
try {
  const result = await workflow.inspect({ bounds: doc.bounds, plan: doc.plan, approved_plan_id: doc.plan_id });
  console.log(JSON.stringify({
    ok: true,
    state: result.state,
    plan_id: result.plan_id,
    construction_ready: result.construction_ready,
    road_count: result.road_count,
    native_batch_count: result.native_batch_count,
    building_batch_count: result.building_batch_count,
    virtual_sandbox: result.virtual_sandbox,
    next_action: result.next_action,
  }, null, 2));
} catch (error) {
  console.log('THROW', error.constructor?.name, error.code, error.message);
  console.log((error.stack ?? '').split('\n').slice(0, 12).join('\n'));
}
