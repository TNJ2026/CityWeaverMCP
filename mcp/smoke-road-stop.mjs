// Explicit test placement only. Never commits or modifies routes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { queryGame } from './bridge-client.mjs';

if (!process.argv[2]) throw new Error('Usage: node smoke-road-stop.mjs <placement.json> (paused city required)');
const args = { ...JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, '')), request_id: `stop-smoke-${randomUUID()}` };
const call = async (tool, arguments_ = {}) => (await queryGame(tool, arguments_)).data;
const terminal = ['completed', 'cancelled', 'failed', 'expired', 'outcome_unknown'];
const wait = async (id, wanted) => {
  for (let i = 0; i < 100; i++) {
    const op = await call('get_road_stop_operation', { operation_id: id });
    if (op.state === wanted) return op;
    assert(!terminal.includes(op.state), JSON.stringify(op));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: inspect operation ${id}`);
};
assert.equal((await call('get_game_status')).paused, true);
const catalog = await call('list_road_stop_prefabs', { search: args.stop_prefab });
const prefab = catalog.items.find(p => p.name === args.stop_prefab);
assert(prefab && !prefab.locked, 'Choose a discovered unlocked road-stop prefab');
const filter = { transport_type: prefab.transport_type };
// Optional third argument: a known road WITHOUT tram tracks, for the negative compatibility check.
if (prefab.transport_type === 'Tram' && process.argv[3]) {
  await assert.rejects(call('plan_road_stop_site', { stop_prefab: args.stop_prefab, road_edge_id: process.argv[3], edge_parameter: .5, road_side: args.road_side }), { code: 'TRAM_TRACK_REQUIRED' });
}
const before = await call('list_transport_stops', filter);
const money = (await call('get_city_summary')).money;
let id;
try {
  id = (await call('preview_road_stop_placement', args)).operation_id;
  const op = await wait(id, 'preview_ready');
  assert.equal(op.can_commit, true);
  assert.deepEqual(op.errors, []);
  assert.deepEqual(op.warnings, []);
  assert.equal(op.transport_type, prefab.transport_type);
  assert.equal((await call('preview_road_stop_placement', args)).operation_id, id);
  await assert.rejects(call('preview_road_stop_placement', { ...args, road_side: args.road_side === 'left' ? 'right' : 'left' }), { code: 'IDEMPOTENCY_CONFLICT' });
  if (op.cost > 0) await assert.rejects(call('apply_road_stop_operation', { operation_id: id, request_id: `budget-${randomUUID()}`, max_cost: op.cost - 1 }), { code: 'COST_LIMIT' });
  await call('cancel_road_stop_preview', { operation_id: id });
  await wait(id, 'cancelled');
  assert.equal((await call('get_city_summary')).money, money);
  assert.deepEqual((await call('list_transport_stops', filter)).items.map(s => s.stop_id).sort(), before.items.map(s => s.stop_id).sort());
  console.log(JSON.stringify({ passed: true, operation_id: id, cost: op.cost, permanently_built: false }));
} finally {
  if (id) {
    const op = await call('get_road_stop_operation', { operation_id: id });
    if (!terminal.includes(op.state)) await call('cancel_road_stop_preview', { operation_id: id });
  }
}
