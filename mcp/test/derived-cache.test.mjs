import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanningStore } from '../planning-store.mjs';
import { BoundedCache } from '../bounded-cache.mjs';
import { createPlanningRenderCache } from '../planning-render-cache.mjs';
import { createPrefabCatalog } from '../prefab-catalog-service.mjs';
import { proposeGridPlan, inspectPlanningDerivedCache } from '../planning-proposer.mjs';

test('bounded cache evicts least recently used entries by estimated bytes', () => {
  const c = new BoundedCache(10); c.set('a', 1, 5); c.set('b', 2, 5);
  c.get('a'); c.set('c', 3, 5);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1);
  c.set('huge', 4, 11); assert.equal(c.inspect().estimated_bytes, 10);
});
async function storeFor(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'derived-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new PlanningStore(root);
}
test('record cache isolates values, detects same-length tampering, never caches journals', async t => {
  const s = await storeFor(t), ref = await s.put('plan', { value: 1 });
  (await s.get(ref)).value = 2;
  assert.equal((await s.get(ref)).value, 1); assert.equal(s.records.inspect().hits, 1);
  await writeFile(s.location(ref), JSON.stringify({ schema_version: 1, kind: 'plan', data: { value: 3 } }));
  await assert.rejects(s.get(ref), { code: 'STORE_INTEGRITY_ERROR' });
  const journal = 'construction-' + 'a'.repeat(64);
  await s.save(journal, { value: 1 }); await s.get(journal);
  await s.save(journal, { value: 2 }); assert.equal((await s.get(journal)).value, 2);
});
test('render cache shares calls, isolates metadata, repairs missing or modified artifacts', async t => {
  const s = await storeFor(t); let calls = 0;
  const c = createPlanningRenderCache(s, async () => { calls++; return { html: '<html>test</html>', count: 1 }; });
  const args = [{ session_id: 'a' }, { roads: [] }, {}, true];
  const [a, b] = await Promise.all([c.renderArtifact(...args), c.renderArtifact(...args)]);
  assert.equal(calls, 1); a.count = 9; assert.equal(b.count, 1);
  await c.renderArtifact(...args); assert.equal(calls, 1);
  await writeFile(b.artifact_path, 'corrupted'); await c.renderArtifact(...args); assert.equal(calls, 2);
  await rm(b.artifact_path); await c.renderArtifact(...args); assert.equal(calls, 3);
  await c.renderArtifact(...[args[0], args[1], { zoom: 2 }, true]); assert.equal(calls, 4);
});
test('catalog defaults share cache without merging different filters', async () => {
  let calls = 0;
  const c = createPrefabCatalog(async tool => {
    if (tool !== 'get_game_status') calls++;
    return { meta: { session_id: 'a' }, data: tool === 'get_game_status' ? { city_loaded: true } : { items: [{ name: 'Road' }] } };
  });
  await c.query('list_road_prefabs', {});
  await c.query('list_road_prefabs', { search: '', offset: 0, limit: 50 }); assert.equal(calls, 1);
  await c.query('list_road_prefabs', { limit: 100 }); assert.equal(calls, 2);
});
test('derived indexes reuse equal layers but change with snapshot content', () => {
  const snapshot = { bounds: { min_x: 0, min_z: 0, max_x: 400, max_z: 400 }, roads: [], buildings: [], waters: [] };
  const before = inspectPlanningDerivedCache();
  const a = proposeGridPlan(snapshot, { columns: 1, rows: 1 });
  assert.deepEqual(proposeGridPlan(structuredClone(snapshot), { columns: 1, rows: 1 }), a);
  assert.ok(inspectPlanningDerivedCache().hits > before.hits);
  const misses = inspectPlanningDerivedCache().misses;
  snapshot.buildings.push({ position: { x: 50, z: 50 }, size_m: { x: 50, z: 50 } });
  proposeGridPlan(snapshot, { columns: 1, rows: 1 });
  assert.equal(inspectPlanningDerivedCache().misses, misses + 1);
});
