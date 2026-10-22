// 修正 plan.buildings[].category：施工编译器只接受
// building / city_service / transport_facility / utility_facility / auto；
// 本规划生成器曾把「服务种类」(water_pump、healthcare…) 误写进 category。
//
// 做法：实时查询四个建筑域目录（list_building_prefabs / list_city_service_prefabs /
// list_transport_facility_prefabs / list_utility_facility_prefabs），按 prefab 名反查归属域。
// 唯一命中 → 写该域；多域命中或未命中 → 保持 'auto'（交由编译器实时判定，多域命中时会明确报错）。
//
// 用法: node tools/scratch/fix-building-categories.mjs <plan.json> [--apply]

import { readFile, writeFile } from 'node:fs/promises';
import { queryGame } from '../../mcp/bridge-client.mjs';

const planPath = process.argv[2];
const apply = process.argv.includes('--apply');
if (!planPath) throw new Error('Usage: node tools/scratch/fix-building-categories.mjs <plan.json> [--apply]');

const DOMAINS = [
  ['building', 'list_building_prefabs', { kind: 'building' }],
  ['city_service', 'list_city_service_prefabs', { kind: 'all' }],
  ['transport_facility', 'list_transport_facility_prefabs', { kind: 'all' }],
  ['utility_facility', 'list_utility_facility_prefabs', { kind: 'all' }],
];

async function query(tool, args) {
  const res = await queryGame(tool, args);
  if (!res?.ok) throw new Error(`${tool} failed: ${res?.error?.code} ${res?.error?.message}`);
  return res.data;
}

const byName = new Map();
for (const [category, tool, extra] of DOMAINS) {
  let offset = 0, snapshotId, total = 0;
  for (;;) {
    const data = await query(tool, { search: '', unlocked_only: true, offset, limit: 100, ...extra, ...(snapshotId ? { snapshot_id: snapshotId } : {}) });
    for (const item of data.items ?? []) {
      total++;
      if (!byName.has(item.name)) byName.set(item.name, new Set());
      byName.get(item.name).add(category);
    }
    snapshotId = data.snapshot_id ?? snapshotId;
    if (data.next_offset == null) break;
    offset = data.next_offset;
  }
  console.log(`# ${category}: ${tool} → ${total} 项`);
}

const doc = JSON.parse(await readFile(planPath, 'utf8'));
const report = { distribution: {}, ambiguous: [], missing: [], changed: [] };
for (const b of doc.plan.buildings ?? []) {
  const hits = [...(byName.get(b.prefab) ?? [])];
  // 与编译器 resolveBuildingBinding 同口径：只有「非 building 的专用域」才算 specialized
  const specialized = hits.filter(h => h !== 'building');
  let category;
  if (specialized.length === 1) category = specialized[0];
  else if (specialized.length > 1) { category = 'auto'; report.ambiguous.push({ id: b.id, prefab: b.prefab, specialized }); }
  else if (hits.includes('building')) category = 'building';
  else { category = 'auto'; report.missing.push({ id: b.id, prefab: b.prefab }); }
  report.distribution[category] = (report.distribution[category] ?? 0) + 1;
  if (b.category !== category) report.changed.push({ id: b.id, prefab: b.prefab, from: b.category, to: category });
  b.category = category;
}

console.log(JSON.stringify({
  buildings: doc.plan.buildings.length,
  category_distribution: report.distribution,
  ambiguous: report.ambiguous,
  missing: report.missing,
  changed_count: report.changed.length,
  changed_sample: report.changed.slice(0, 10),
}, null, 2));

if (apply) {
  await writeFile(planPath, JSON.stringify(doc, null, 2), 'utf8');
  console.log(`written: ${planPath}`);
} else {
  console.log('(dry run; pass --apply to write)');
}
