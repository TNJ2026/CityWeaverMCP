import { PlanningStore } from '../../mcp/planning-store.mjs';
const store = new PlanningStore();
const j = await store.get(process.argv[2]);
console.log('state_version', j.state_version);
console.log('next_action', JSON.stringify(j.next_action));
console.log('in_flight', JSON.stringify(j.in_flight));
console.log('last_result', JSON.stringify(j.last_result)?.slice(0, 800));
console.log('recovery_required', j.recovery_required, JSON.stringify(j.failure ?? null).slice(0, 400));
console.log('batches', j.compiled?.batches?.length);
