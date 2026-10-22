// 找出尚未施工的规划道路中，哪些端点会落到「同向重复边节点」（会导致 GAME_REJECTED_ROAD）。
import { PlanningStore } from '../../mcp/planning-store.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const constructionId = process.argv[2];
const store = new PlanningStore();
const j = await store.get(constructionId);
const next = j.next_action?.arguments;
const order = j.compiled.batches.map(b => b.batch_id);
const at = next ? order.indexOf(next.batch_id) : order.length;
const remainingBatches = j.compiled.batches.slice(at);
console.log('next_action', next ? next.action + ' ' + next.batch_id : 'none', '| index', at, '/', order.length);
console.log('remaining batches', remainingBatches.length, '| 类型分布', JSON.stringify(remainingBatches.reduce((a, b) => (a[b.batch_type] = (a[b.batch_type] ?? 0) + 1, a), {})));

const snap = await queryGame('get_planning_map_snapshot', {
  bounds: { min_x: -1360, min_z: -2200, max_x: 560, max_z: -300 },
  include_roads: true, include_buildings: true, include_tracks: false, include_utilities: false, max_features_per_layer: 5000,
});
const roads = snap.data?.roads ?? [];
const buildings = snap.data?.buildings ?? [];
console.log('in-game roads', roads.length, 'buildings', buildings.length);

const key = (x, z) => Math.round(x) + ',' + Math.round(z);
const adj = new Map();
for (const r of roads) {
  const c = r.curve ?? {}; const a = c.a, d = c.d;
  if (!a || !d) continue;
  const ka = key(a.x, a.z), kd = key(d.x, d.z);
  if (!adj.has(ka)) adj.set(ka, new Map());
  if (!adj.has(kd)) adj.set(kd, new Map());
  adj.get(ka).set(kd, (adj.get(ka).get(kd) ?? 0) + 1);
  adj.get(kd).set(ka, (adj.get(kd).get(ka) ?? 0) + 1);
}
const poisoned = new Map();
for (const [k, m] of adj) {
  const dups = [...m.entries()].filter(([, c]) => c > 1);
  if (dups.length) poisoned.set(k, dups);
}
console.log('重复边节点数:', poisoned.size);
for (const [k, dups] of poisoned) console.log('   POISON', k, JSON.stringify(dups));

// 剩余批次里，road 类批次的端点
let hits = 0;
for (const b of remainingBatches) {
  if (b.batch_type === 'building' || b.batch_type === 'utility') continue;
  const na = b.native_args ?? {};
  const pts = na.points ?? [na.start, na.end].filter(Boolean);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    if (!p) continue;
    const k = key(p.x, p.z);
    if (poisoned.has(k)) { console.log('⚠ ' + b.batch_id + ' endpoint (' + p.x + ',' + p.z + ') => POISONED'); hits++; }
  }
}
console.log('受影响批次:', hits);
