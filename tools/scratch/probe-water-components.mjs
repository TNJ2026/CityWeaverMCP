#!/usr/bin/env node
// Discover the native component names and enum members we need for water-service acceptance:
// the consumer component, its flag enum, and the building road-edge field.
import { queryGame } from '../../mcp/bridge-client.mjs';

const all = [];
for (let offset = 0; ; ) {
  const r = await queryGame('list_component_types', { limit: 100, offset });
  const items = r.data?.items ?? [];
  all.push(...items);
  if (r.data?.next_offset == null || !items.length) break;
  offset = r.data.next_offset;
}
console.log(`component types: ${all.length}`);

for (const t of all) {
  if (/water|sewage/i.test(t.name)) console.log(`  ${t.name}  kind=${t.kind ?? ''}  fields=${(t.fields ?? []).length}`);
}

console.log('\n--- schema for candidates ---');
for (const name of all.filter((t) => /water/i.test(t.name)).map((t) => t.name)) {
  const s = await queryGame('get_component_schema', { component: name }).catch((e) => ({ err: e }));
  console.log(`\n== ${name}`);
  console.log(JSON.stringify(s.data ?? s.err?.message ?? s, null, 2).slice(0, 2200));
}
