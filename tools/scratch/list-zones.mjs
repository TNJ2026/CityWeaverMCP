import { queryGame } from '../../mcp/bridge-client.mjs';
const r = await queryGame('list_zone_types', { search: '', unlocked_only: false, offset: 0, limit: 200 });
const items = r.data?.items ?? [];
const byArea = {};
for (const i of items) { const k = (i.area_type ?? i.category ?? '?') + '|locked=' + i.locked; (byArea[k] ??= []).push(i.name); }
for (const [k, v] of Object.entries(byArea)) { console.log('== ' + k); for (const n of v) console.log('   ' + n); }
console.log('总数', items.length);
