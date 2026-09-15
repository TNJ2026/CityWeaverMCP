import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'city-services-transactions', version: '1' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return r.structuredContent ?? { ok: false, error: (r.content ?? []).map(x => x.text ?? '').join('\n') }; };
const terminal = new Set(['preview_ready', 'completed', 'failed', 'cancelled', 'expired', 'outcome_unknown']);
const wait = async id => {
  for (let i = 0; i < 300; i++) {
    const d = (await call('get_city_service_operation', { operation_id: id })).data;
    if (terminal.has(d.state)) return d;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('operation timeout');
};
const commit = async (state, requestId) => {
  const a = await call('apply_city_service_operation', { operation_id: state.operation_id, request_id: requestId, max_cost: 1000000000 });
  if (a.ok === false) return a;
  return wait(state.operation_id);
};
const previewCandidates = async (tool, base, candidates, prefix) => {
  for (let i = 0; i < candidates.length; i++) {
    const x = candidates[i], requestId = `${prefix}_${i}`;
    const args = { request_id: requestId, ...base, position: x.position, rotation_degrees: x.rotation_degrees ?? 0 };
    if (x.road_edge_id) args.road_edge_id = x.road_edge_id;
    if (x.snap_target_id) args.snap_target_id = x.snap_target_id;
    const p = await call(tool, args);
    if (p.ok === false) continue;
    const d = await wait(p.data.operation_id);
    if (d.state === 'preview_ready') return { state: d, requestId, candidate: x };
  }
  return null;
};
const removeFacility = async (id, suffix) => {
  const requestId = `css_delete_${suffix}`;
  const p = await call('preview_city_service_delete', { request_id: requestId, facility_id: id });
  if (p.ok === false) return p;
  const d = await wait(p.data.operation_id);
  return d.state === 'preview_ready' ? commit(d, requestId) : d;
};

await call('set_simulation_speed', { speed: 'paused' });
const baseline = (await call('list_city_service_facilities', { kind: 'all' })).data.total;
const kinds = ['healthcare','fire','police','education','garbage','deathcare','maintenance','park','post','parking','welfare','research','emergency'];
const results = [];
let movedOnce = false;
for (const kind of kinds) {
  const list = await call('list_city_service_prefabs', { kind, unlocked_only: true, offset: 0, limit: 100 });
  const candidatesPrefabs = [...(list.data?.items ?? [])].sort((a, b) => (a.lot_cells.width * a.lot_cells.depth) - (b.lot_cells.width * b.lot_cells.depth));
  let outcome = { kind, available: list.data?.total ?? 0 };
  for (const prefab of candidatesPrefabs.slice(0, 8)) {
    const plan = await call('plan_city_service_site', { building_prefab: prefab.name, near: { x: 0, z: 0 }, search_radius_m: 3000, road_side: 'either', candidate_count: 32 });
    if (plan.ok === false || !plan.data?.candidates?.length) continue;
    const preview = await previewCandidates('preview_city_service_placement', { building_prefab: prefab.name }, plan.data.candidates, `css_place_${kind}_${prefab.name}`);
    if (!preview) continue;
    const placed = await commit(preview.state, preview.requestId);
    const id = placed.result_entity_ids?.[0];
    if (placed.state !== 'completed' || !id) continue;
    const detail = await call('get_city_service_facility', { facility_id: id });
    outcome = { ...outcome, prefab: prefab.name, placed: placed.state, detail_kind: detail.data.kind, owned_vehicle_count: detail.data.owned_vehicle_count ?? null };
    let currentId = id;

    if (!movedOnce) {
      const alternatives = plan.data.candidates.filter(x => Math.hypot(x.position.x - preview.candidate.position.x, x.position.z - preview.candidate.position.z) > 80);
      const move = await previewCandidates('preview_city_service_move', { facility_id: currentId }, alternatives, `css_move_${kind}_${prefab.name}`);
      if (move) { const moved = await commit(move.state, move.requestId); outcome.moved = moved.state; currentId = moved.result_entity_ids?.[0] ?? currentId; movedOnce = moved.state === 'completed'; }
    }

    const deleted = await removeFacility(currentId, `${kind}_${prefab.name}`);
    outcome.deleted = deleted.state ?? deleted.data?.state;
    break;
  }
  console.log('KIND', JSON.stringify(outcome));
  results.push(outcome);
}
const finalCount = (await call('list_city_service_facilities', { kind: 'all' })).data.total;
await call('set_simulation_speed', { speed: 'normal' });
console.log('SUMMARY', JSON.stringify({ baseline, finalCount, movedOnce, results }));
await c.close();
