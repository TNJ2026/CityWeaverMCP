import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanningStore, contentHash, compactResult } from '../planning-store.mjs';
import { createPlanningSession } from '../planning-session.mjs';
import { computeCityPlanId, renderCityPlan } from '../planning-renderer.mjs';
import { readToolMedia } from '../tool-media.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'planning-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new PlanningStore(root);
}
test('immutable records survive a new process instance, reject tampering and path traversal', async t => {
  const store = await fixture(t);
  const ref = await store.put('plan', { a: 1, b: { x: 2 } });
  assert.equal(ref, await store.put('plan', { b: { x: 2 }, a: 1 }));
  assert.deepEqual(await new PlanningStore(store.root).get(ref), { a: 1, b: { x: 2 } });
  assert.throws(() => store.location('../secret'), { code: 'INVALID_REFERENCE' });
  await writeFile(store.location(ref), JSON.stringify({ schema_version: 1, kind: 'plan', data: { a: 9 } }));
  await assert.rejects(store.get(ref), { code: 'STORE_INTEGRITY_ERROR' });
});
test('HTML content is unchanged on disk; paged reads do not expand nested data', async t => {
  const store = await fixture(t);
  const html = '<html><svg>精确几何</svg></html>';
  const artifact = await store.artifact(html);
  assert.equal(await readFile(artifact.artifact_path, 'utf8'), html);
  assert.equal(artifact.byte_size, Buffer.byteLength(html));
  assert.equal((await readToolMedia({ structuredContent: { data: artifact } })).toString('utf8'), html);
  await assert.rejects(readToolMedia({ structuredContent: { data: { ...artifact, sha256: 'wrong' } } }), /integrity/);
  const ref = await store.put('evidence', { plan: { roads: [{ id: 'a', points: Array(100).fill({ x: 1 }) }] } });
  assert.deepEqual((await store.read(ref)).data.plan, { type: 'object', fields: ['roads'] });
  assert.equal((await store.read(ref, ['plan', 'roads', '0'])).data.points.count, 100);
});
const bounds = { min_x: -500, min_z: -500, max_x: 500, max_z: 500 };
const plan = { roads: [{ id: 'a', prefab: 'Road', level: 'surface', width_m: 16, points: [{ x: 0, z: 0 }, { x: 100, z: 0 }] }] };
function harness(store) {
  let session = 'session-a', calls = 0, reject = false;
  const planId = computeCityPlanId(bounds, plan);
  const next = { tool: 'advance_city_plan_construction', arguments: { action: 'preview_batch', batch_id: 'a', bounds, plan, approved_plan_id: planId, expected_session_id: session, request_id: 'preview_request' } };
  const dependencies = {
    store,
    queryGame: async () => ({ meta: { session_id: session }, data: { city_loaded: true } }),
    prepare: async args => { assert.equal(args.compiled_plan.plan_id, planId); return { session_id: session, plan_id: planId, construction_ready: true, next_action: next }; },
    advance: async args => {
      calls++;
      assert.equal(args.operation_timeout_ms, 20000);
      if (reject) throw Object.assign(new Error('bridge lost after dispatch'), { code: 'BRIDGE_TIMEOUT' });
      return { state: args.action === 'preview_batch' ? 'preview_ready' : 'completed_verified', native_operation: { operation_id: 'a'.repeat(32) }, next_action: args.action === 'preview_batch' ? { tool: next.tool, arguments: { ...next.arguments, action: 'commit_batch', operation_id: 'a'.repeat(32), max_cost: 50 } } : null };
    },
  };
  return { api: () => createPlanningSession(dependencies), calls: () => calls, setSession: s => { session = s; }, fail: () => { reject = true; }, planId };
}
test('handle transitions persist and retry exactly once, stale/cross-session calls cannot write', async t => {
  const store = await fixture(t), h = harness(store);
  const prepared = await h.api().prepare({ bounds, plan, approved_plan_id: h.planId });
  assert.equal(prepared.next_action.arguments.plan, undefined);
  const previewArgs = prepared.next_action.arguments;
  const preview = await h.api().advance(previewArgs);
  assert.equal(preview.state_version, 1);
  const replay = await h.api().advance(previewArgs);
  assert.equal(replay.state, 'preview_ready'); assert.equal(h.calls(), 1);
  await assert.rejects(h.api().advance({ ...previewArgs, batch_id: 'other' }), { code: 'STALE_CONSTRUCTION_STATE' });
  await assert.rejects(h.api().advance({ ...preview.next_action.arguments, max_cost: 51 }), { code: 'COST_LIMIT' });
  const completed = await h.api().advance(preview.next_action.arguments);
  assert.equal(completed.next_action, null); assert.equal(h.calls(), 2);
  const resumed = await h.api().prepare({ bounds, plan, approved_plan_id: h.planId });
  assert.equal(resumed.state, 'completed_verified'); assert.equal(resumed.state_version, 2);
  h.setSession('different');
  await assert.rejects(h.api().advance(preview.next_action.arguments), { code: 'CITY_SESSION_CHANGED' });
  assert.equal(h.calls(), 2);
});
test('unknown native outcome remains blocked across restart, journal retains stable request', async t => {
  const store = await fixture(t), h = harness(store);
  const prepared = await h.api().prepare({ bounds, plan, approved_plan_id: h.planId });
  h.fail();
  await assert.rejects(h.api().advance(prepared.next_action.arguments), { code: 'BRIDGE_TIMEOUT' });
  await assert.rejects(h.api().advance(prepared.next_action.arguments), { code: 'CONSTRUCTION_RECOVERY_REQUIRED' });
  assert.equal(h.calls(), 1);
  assert.equal((await store.get(prepared.construction_id)).in_flight.arguments.request_id, 'preview_request');
});
test('cross-instance writer exclusion does not silently remove another writer lock', async t => {
  const store = await fixture(t);
  await store.locked(async () => {
    await assert.rejects(new PlanningStore(store.root).locked(() => assert.fail('must not enter')), { code: 'CONSTRUCTION_BUSY' });
  });
  await store.locked(async () => {});
});
test('summary preserves outcome and verification evidence without full geometry', () => {
  const full = { state: 'completed_readback_incomplete', recovery_required: true, permanent_readback: { verified: false, missing_ids: ['x'] }, errors: ['failed'], plan: { roads: Array(1000).fill(plan.roads[0]) } };
  const summary = compactResult(full);
  assert.equal(summary.recovery_required, true); assert.equal(summary.permanent_readback.verified, false);
  assert.deepEqual(summary.errors, ['failed']);
  assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 100);
  assert.equal(compactResult({ counts: { roads: 4 } }).counts.roads, 4);
  assert.deepEqual(compactResult({ virtual_sandbox: { state: 'invalid', errors: ['overlap'], nodes: Array(100).fill(1) } }).virtual_sandbox.errors, ['overlap']);
});
