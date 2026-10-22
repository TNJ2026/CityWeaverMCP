import { PlanningStore } from '../../mcp/planning-store.mjs';
const store = new PlanningStore();
const j = await store.get(process.argv[2]);
const ids = process.argv.slice(3);
for (const b of j.compiled.batches) {
  if (ids.length && !ids.includes(b.batch_id)) continue;
  console.log('=== ' + b.batch_id + ' | ' + b.batch_type + ' | tool=' + (b.native_tool ?? b.preview));
  console.log(JSON.stringify(b.native_args, null, 2));
}
