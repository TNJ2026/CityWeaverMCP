// 抓取工作流实际发出的原生调用参数，定位与「直连 preview」的差异。
import { PlanningStore } from '../../mcp/planning-store.mjs';
import { createPlanningSession } from '../../mcp/planning-session.mjs';
import { createCityPlanConstructionWorkflow } from '../../mcp/city-plan-construction-workflow.mjs';
import { queryGame as realQueryGame } from '../../mcp/bridge-client.mjs';

const logged = [];
const queryGame = async (tool, args = {}, opts) => {
  if (/preview_road|build_road|set_simulation_speed|list_road_prefabs/.test(tool)) {
    logged.push({ tool, args: JSON.parse(JSON.stringify(args)) });
  }
  const r = await realQueryGame(tool, args, opts);
  if (/preview_road|build_road/.test(tool)) {
    logged[logged.length - 1].result = JSON.stringify(r.data?.state ?? '') + ' ' + JSON.stringify(r.data?.errors ?? '');
  }
  return r;
};

const constructionId = process.argv[2];
const store = new PlanningStore();
const workflow = createCityPlanConstructionWorkflow(queryGame);
const session = createPlanningSession({ store, queryGame, prepare: workflow.inspect, advance: workflow.advance });

const j = await store.get(constructionId);
console.log('next_action', JSON.stringify(j.next_action));
console.log('state_version', j.state_version);

try {
  const result = await session.advance({
    construction_id: constructionId,
    state_version: j.state_version,
    action: j.next_action.arguments.action,
    batch_id: j.next_action.arguments.batch_id,
  });
  console.log('RESULT success=' + result.success, 'state=' + result.state, 'errors=' + JSON.stringify(result.native_preview?.errors ?? []));
} catch (e) {
  console.log('THROW', e.code, e.message);
}

console.log('--- 原生调用记录 ---');
for (const l of logged) console.log(l.tool, JSON.stringify(l.args), '=>', l.result ?? '');
