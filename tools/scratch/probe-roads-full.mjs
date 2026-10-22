import { queryGame } from '../../mcp/bridge-client.mjs';
const bounds = JSON.parse(process.argv[2]);
const res = await queryGame('get_planning_map_snapshot', {
  bounds, include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false,
  max_features_per_layer: 5000,
});
const d = res.data ?? {};
const roads = d.roads ?? [];
console.log('roads', roads.length, 'truncated', d.truncated);
const rows = [];
for (const r of roads) {
  const c = r.curve ?? {};
  const a = c.a ?? {}, dd = c.d ?? {};
  const x1 = Math.round(a.x), z1 = Math.round(a.z), x2 = Math.round(dd.x), z2 = Math.round(dd.z);
  // 归一化：以坐标字典序排序两端，便于发现重复
  const key = [x1, z1, x2, z2].join(',') < [x2, z2, x1, z1].join(',') ? [x1, z1, x2, z2].join(',') : [x2, z2, x1, z1].join(',');
  rows.push({ key, prefab: r.prefab, id: r.id, span: '(' + x1 + ',' + z1 + ')->(' + x2 + ',' + z2 + ')', ab: JSON.stringify(c.a) + ' ' + JSON.stringify(c.d) });
}
rows.sort((p, q) => p.span.localeCompare(q.span));
const byKey = new Map();
for (const r of rows) { if (!byKey.has(r.key)) byKey.set(r.key, []); byKey.get(r.key).push(r); }
let dupCount = 0;
for (const r of rows) {
  const dup = byKey.get(r.key).length > 1 ? '  <== DUP x' + byKey.get(r.key).length : '';
  if (dup) dupCount++;
  console.log(r.span.padEnd(30), r.prefab.padEnd(38), dup);
}
console.log('--- 重复跨度条目数:', dupCount);
