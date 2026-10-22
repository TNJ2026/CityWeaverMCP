// 把已批准的规划写入 planning-store，产出 plan_ref（供 prepare_city_plan_construction 使用）。
// 存储模块的 put('plan', {bounds, plan}) 会按内容哈希生成不可变引用，与 render_city_plan 的记录同构。
//
// 用法: node tools/scratch/put-plan-ref.mjs <plan.json>

import { readFile } from 'node:fs/promises';
import { PlanningStore } from '../../mcp/planning-store.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const planPath = process.argv[2];
if (!planPath) throw new Error('Usage: node tools/scratch/put-plan-ref.mjs <plan.json>');

const doc = JSON.parse(await readFile(planPath, 'utf8'));
const planId = computeCityPlanId(doc.bounds, doc.plan);

// planning-session.resolve() 要求记录为 { bounds, plan, plan_id, session_id }，
// 且 session_id 必须等于当前游戏会话（null 会跳过校验）。
const status = await queryGame('get_game_status', {});
const sessionId = status?.meta?.session_id ?? null;

const store = new PlanningStore();
const ref = await store.put('plan', { bounds: doc.bounds, plan: doc.plan, plan_id: planId, session_id: sessionId });

const roads = doc.plan.roads ?? [];
const grids = doc.plan.grids ?? [];
const buildings = doc.plan.buildings ?? [];
const sum = (list) => list.reduce((total, item) => total + (item.max_cost ?? 0), 0);

console.log(JSON.stringify({
  plan_ref: ref,
  session_id: sessionId,
  plan_id_from_plan: doc.plan_id,
  plan_id_recomputed: planId,
  plan_id_match: planId === doc.plan_id,
  counts: { roads: roads.length, grids: grids.length, buildings: buildings.length, grid_exceptions: (doc.plan.grid_exceptions ?? []).length },
  declared_max_cost_total: { total: sum(roads) + sum(grids) + sum(buildings), roads: sum(roads), grids: sum(grids), buildings: sum(buildings) },
}, null, 2));
