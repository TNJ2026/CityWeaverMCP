// Requires an explicitly supplied JSON placement, a paused test city and a
// freshly loaded bridge. Preview/cancel only: never permanently builds roads.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { queryGame } from './bridge-client.mjs';

if (!process.argv[2]) throw new Error('Usage: node smoke-intersection-prefab.mjs <placement.json>');
const placement = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const args = { ...placement, request_id: `stamp-smoke-${randomUUID()}` };
const call = async (tool, arguments_ = {}) => (await queryGame(tool, arguments_)).data;
const wait = async (id, desired) => {
  for (let i = 0; i < 100; i++) {
    const op = await call('get_road_operation', { operation_id: id });
    if (op.state === desired) return op;
    assert(!['failed', 'expired', 'outcome_unknown', 'completed', 'cancelled'].includes(op.state), JSON.stringify(op));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${desired}; inspect operation ${id}`);
};
assert.equal((await call('get_game_status')).paused, true, 'Pause the test city first');
const catalog = await call('list_intersection_prefabs', { search: args.intersection_prefab, limit: 100 });
const prefab = catalog.items.find(item => item.name === args.intersection_prefab);
assert(prefab && prefab.supported && !prefab.locked, 'Choose an unlocked supported exact prefab');
const before = await call('get_city_summary');
const countArgs = { category: 'roads', all_components: ['Game.Net.Edge'] };
const beforeCount = await call('count_entities', countArgs);
let id;
try {
  const preview = await call('preview_intersection_prefab', args);
  id = preview.operation_id;
  const op = await wait(id, 'preview_ready');
  assert.equal(op.can_commit, true);
  assert.deepEqual(op.errors, []);
  assert.equal((await call('preview_intersection_prefab', args)).operation_id, id);
  await assert.rejects(call('preview_intersection_prefab', { ...args, position: { ...args.position, x: args.position.x + 1 } }), { code: 'IDEMPOTENCY_CONFLICT' });
  if (op.cost > 0) await assert.rejects(call('build_road', { operation_id: id, request_id: `budget-${randomUUID()}`, max_cost: op.cost - 1 }), { code: 'COST_LIMIT' });
  await call('cancel_road_preview', { operation_id: id });
  await wait(id, 'cancelled');
  assert.equal((await call('get_city_summary')).money, before.money, 'Preview/cancel must not spend money');
  assert.deepEqual(await call('count_entities', countArgs), beforeCount, 'Preview/cancel must not create permanent roads');
  console.log(JSON.stringify({ passed: true, operation_id: id, prefab: prefab.name, preview_cost: op.cost }));
} finally {
  if (id) {
    const op = await call('get_road_operation', { operation_id: id });
    if (!['completed', 'cancelled', 'failed', 'expired', 'outcome_unknown'].includes(op.state)) {
      await call('cancel_road_preview', { operation_id: id });
      await wait(id, 'cancelled');
    }
  }
}
