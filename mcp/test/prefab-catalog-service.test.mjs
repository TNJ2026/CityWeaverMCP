import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefabCatalog, prefabCatalogFor } from '../prefab-catalog-service.mjs';
const env = (items, session = 'a', extra = {}) => ({ ok: true, meta: { session_id: session }, data: { items, ...extra } });

test('fresh service starts cold; observed bridge loss clears the previous session', async () => {
  let unavailable = false, catalogs = 0;
  const raw = async tool => {
    if (unavailable) throw Object.assign(new Error('game closed'), { code: 'GAME_UNAVAILABLE' });
    if (tool === 'list_road_prefabs') { catalogs++; return env([{ name: 'Road' }]); }
    return env([]);
  };
  const first = createPrefabCatalog(raw);
  await first.query('get_game_status'); await first.getRoad('Road');
  const restarted = createPrefabCatalog(raw);
  assert.equal(restarted.inspect().entries, 0);
  await restarted.getRoad('Road'); assert.equal(catalogs, 2);
  unavailable = true;
  await assert.rejects(first.query('get_game_status'), { code: 'GAME_UNAVAILABLE' });
  assert.equal(first.inspect().session_id, null); assert.equal(first.inspect().entries, 0);
});

test('shared service merges concurrent queries, clones rows, expires filtered and locked observations', async () => {
  let calls = 0, time = 0;
  const raw = async tool => tool === 'get_game_status' ? env([], 'a') : (calls++, env([{ name: 'Road', width_m: 16, locked: false }]));
  assert.equal(prefabCatalogFor(raw), prefabCatalogFor(raw));
  const catalog = createPrefabCatalog(raw, { now: () => time });
  await catalog.query('get_game_status');
  const [a, b] = await Promise.all([catalog.query('list_road_prefabs'), catalog.query('list_road_prefabs')]);
  assert.equal(calls, 1); a.data.items[0].width_m = 999;
  assert.equal(b.data.items[0].width_m, 16);
  assert.equal((await catalog.query('list_road_prefabs')).data.items[0].width_m, 16);
  time = 30001; await catalog.query('list_road_prefabs'); assert.equal(calls, 2);
  await catalog.query('list_road_prefabs', { unlocked_only: true });
  time += 5001; await catalog.query('list_road_prefabs', { unlocked_only: true }); assert.equal(calls, 4);
});
test('late query cannot repopulate cache after a session switch or forced refresh', async () => {
  let release;
  const catalog = createPrefabCatalog(async tool => tool === 'get_game_status' ? env([], 'a') : new Promise(resolve => { release = resolve; }));
  await catalog.query('get_game_status');
  const old = catalog.query('list_road_prefabs');
  catalog.invalidateSession('b'); release(env([{ name: 'old' }], 'a'));
  await assert.rejects(old, { code: 'CATALOG_CHANGED_DURING_QUERY' });
  assert.equal(catalog.inspect().session_id, 'b'); assert.equal(catalog.inspect().entries, 0);
});
test('negative cache requires complete successful results and expires', async () => {
  let calls = 0, time = 0, truncated = true;
  const catalog = createPrefabCatalog(async tool => tool === 'get_game_status' ? env([]) : (calls++, env([], 'a', { truncated })), { now: () => time });
  await catalog.query('get_game_status');
  await catalog.query('list_road_prefabs'); await catalog.query('list_road_prefabs'); assert.equal(calls, 2);
  truncated = false; await catalog.query('list_road_prefabs'); await catalog.query('list_road_prefabs'); assert.equal(calls, 3);
  time = 5001; await catalog.query('list_road_prefabs'); assert.equal(calls, 4);
});
test('exact lookup follows pagination, distinguishes locked rows and rejects incomplete absence', async () => {
  const catalog = createPrefabCatalog(async (tool, args) => tool === 'get_game_status' ? env([]) : args.offset === 0 ? env([{ name: 'Other' }], 'a', { next_offset: 1, total: 2 }) : env([{ name: 'Road', locked: true }], 'a', { total: 2 }));
  const row = await catalog.getRoad('Road'); assert.equal(row.locked, true);
  const broken = createPrefabCatalog(async tool => tool === 'get_game_status' ? env([]) : env([], 'a', { truncated: true }));
  await assert.rejects(broken.getRoad('Absent'), { code: 'INCOMPLETE_CATALOG' });
});
test('instance edits do not invalidate prefab definitions, configuration and unlock edits do', async () => {
  const catalog = createPrefabCatalog(async tool => tool === 'list_road_prefabs' ? env([{ name: 'Road' }]) : env([]));
  await catalog.query('get_game_status'); await catalog.query('list_road_prefabs');
  await catalog.query('build_road'); assert.equal(catalog.inspect().entries, 1);
  await catalog.query('set_city_configuration'); assert.equal(catalog.inspect().entries, 0);
  await catalog.query('list_road_prefabs'); await catalog.query('unlock_prefab'); assert.equal(catalog.inspect().entries, 0);
});
test('asset geometry changes stop reuse; transport errors never become negative cache entries', async () => {
  let width = 16, time = 0, fail = false;
  const catalog = createPrefabCatalog(async tool => {
    if (tool === 'get_game_status') return env([]);
    if (fail) throw new Error('timeout');
    return env([{ name: 'Road', width_m: width }]);
  }, { now: () => time });
  await catalog.query('get_game_status'); await catalog.getRoad('Road');
  width = 24; time = 30001;
  await assert.rejects(catalog.getRoad('Road'), { code: 'CATALOG_GEOMETRY_CHANGED' });
  assert.equal(catalog.inspect().entries, 0);
  fail = true; await assert.rejects(catalog.getRoad('Road'), /timeout/); assert.equal(catalog.inspect().entries, 0);
});
