import { PlanningStore } from '../../mcp/planning-store.mjs';
const store = new PlanningStore();
const j = await store.get(process.argv[2]);
console.log('history len', j.history?.length);
const states = {};
for (const h of j.history ?? []) states[h.state] = (states[h.state] ?? 0) + 1;
console.log('history states', JSON.stringify(states));
console.log('sample', JSON.stringify(j.history?.[0]).slice(0, 300));
console.log('last', JSON.stringify(j.history?.[j.history.length - 1]).slice(0, 300));
