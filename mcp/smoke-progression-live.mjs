import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'progression-live', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? { ok: false, error: { message: (result.content ?? []).map(x => x.text ?? '').join('\n') } };
};
const ok = (value, label) => { assert.equal(value.ok, true, `${label}: ${JSON.stringify(value)}`); return value.data; };

const status = ok(await call('get_game_status'), 'status');
assert.equal(status.bridge_version, '1.22.1'); assert.equal(status.city_loaded, true);
const tools = await client.listTools(); assert.equal(tools.tools.length, 342);

const initial = ok(await call('get_city_progression'), 'progression');
const milestones = ok(await call('list_milestones'), 'milestones');
const tree = ok(await call('list_development_tree', { limit: 500 }), 'development tree');
const unlocks = ok(await call('get_unlock_summary'), 'unlock summary');
const unlockPage = ok(await call('list_unlockable_prefabs', { state: 'all', limit: 20 }), 'unlock page');
const unlockedPage = ok(await call('list_unlockable_prefabs', { state: 'unlocked', limit: 20 }), 'unlocked page');
assert.ok(milestones.total > 0); assert.ok(tree.total > 0); assert.ok(unlocks.total > 0); assert.ok(unlockPage.items.length > 0);

const runningXp = await call('set_experience_points', { total_xp: initial.experience.total });
const runningPoints = await call('set_development_points', { points: initial.development_points });
assert.equal(runningXp.ok, false); assert.equal(runningXp.error.code, 'CITY_MUST_BE_PAUSED');
assert.equal(runningPoints.ok, false); assert.equal(runningPoints.error.code, 'CITY_MUST_BE_PAUSED');

ok(await call('set_simulation_speed', { speed: 'paused' }), 'pause');
let xpRoundTrip, pointsRoundTrip, purchaseResult, unlockResult, unlockAllResult;
try {
  xpRoundTrip = ok(await call('set_experience_points', { total_xp: initial.experience.total + 1 }), 'xp +1');
  assert.equal(ok(await call('get_city_progression'), 'read xp +1').experience.total, initial.experience.total + 1);
  ok(await call('set_experience_points', { total_xp: initial.experience.total }), 'restore xp');
  pointsRoundTrip = ok(await call('set_development_points', { points: initial.development_points + 1 }), 'points +1');
  assert.equal(ok(await call('get_city_progression'), 'read points +1').development_points, initial.development_points + 1);
  ok(await call('set_development_points', { points: initial.development_points }), 'restore points');

  const unlockedNode = tree.items.find(x => !x.locked);
  assert.ok(unlockedNode); purchaseResult = ok(await call('purchase_development_node', { node: unlockedNode.name }), 'idempotent node purchase');
  assert.equal(purchaseResult.already_unlocked, true);
  const unlockedPrefab = unlockedPage.items.find(x => !x.prefab_type.endsWith('.MilestonePrefab'));
  assert.ok(unlockedPrefab); unlockResult = ok(await call('unlock_prefab', { prefab: unlockedPrefab.name, prefab_type: unlockedPrefab.prefab_type }), 'idempotent prefab unlock');
  assert.equal(unlockResult.already_unlocked, true);

  unlockAllResult = ok(await call('unlock_all_progression', { confirm_irreversible: true }), 'native unlock all');
  assert.equal(unlockAllResult.unlock_all_dispatched, true);
  ok(await call('set_simulation_speed', { speed: 'normal' }), 'process unlock all');
  await new Promise(resolve => setTimeout(resolve, 800));
} finally {
  await call('set_simulation_speed', { speed: 'paused' });
  await call('set_experience_points', { total_xp: initial.experience.total });
  await call('set_development_points', { points: initial.development_points });
  await call('set_simulation_speed', { speed: 'normal' });
}

const final = ok(await call('get_city_progression'), 'final progression');
assert.equal(final.experience.total, initial.experience.total); assert.equal(final.development_points, initial.development_points);
console.log(JSON.stringify({ bridge_version: status.bridge_version, city: status.city_name, tools: tools.tools.length,
  milestone_count: milestones.total, achieved_milestone: initial.milestone.achieved_index, milestone_completed: initial.milestone.completed,
  development_node_count: tree.total, unlockable_prefab_count: unlocks.total, locked_prefab_count: unlocks.locked,
  owned_map_tiles: initial.map_tiles.owned, xp_round_trip: [xpRoundTrip.total_xp_before, xpRoundTrip.total_xp],
  points_round_trip: [pointsRoundTrip.points_before, pointsRoundTrip.points], node_purchase_branch: 'already_unlocked',
  prefab_unlock_branch: 'already_unlocked', unlock_all_dispatched: unlockAllResult.unlock_all_dispatched,
  restored_xp: final.experience.total, restored_points: final.development_points, final_paused: final.paused }, null, 2));
await client.close();
