import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'city-service-upgrade-cycle', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? { ok: false, error: (result.content ?? []).map(x => x.text ?? '').join('\n') };
};
const terminal = new Set(['preview_ready', 'completed', 'failed', 'cancelled', 'expired', 'outcome_unknown']);
const runId = Date.now().toString(36);
const wait = async operationId => {
  for (let i = 0; i < 300; i++) {
    const response = await call('get_city_service_operation', { operation_id: operationId });
    if (!response.ok) throw new Error(JSON.stringify(response));
    if (terminal.has(response.data.state)) return response.data;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`operation timeout: ${operationId}`);
};
const previewReady = async (tool, args) => {
  const preview = await call(tool, args);
  if (!preview.ok) return null;
  const state = await wait(preview.data.operation_id);
  return state.state === 'preview_ready' ? state : null;
};
const commit = async (state, requestId) => {
  const applied = await call('apply_city_service_operation', {
    operation_id: state.operation_id,
    request_id: requestId,
    max_cost: 1_000_000_000
  });
  if (!applied.ok) throw new Error(JSON.stringify(applied));
  return wait(state.operation_id);
};

await call('set_simulation_speed', { speed: 'paused' });
const baseline = (await call('list_city_service_facilities', { kind: 'all' })).data.total;
let facilityId;
try {
  const plan = await call('plan_city_service_site', {
    building_prefab: 'FireHouse01',
    near: { x: 0, z: 0 },
    search_radius_m: 3000,
    road_side: 'either',
    candidate_count: 32
  });
  if (!plan.ok || !plan.data?.candidates?.length) throw new Error(`no placement candidates: ${JSON.stringify(plan)}`);

  let placed;
  for (let i = 0; i < plan.data.candidates.length; i++) {
    const candidate = plan.data.candidates[i];
    const requestId = `css_upgrade_cycle_${runId}_place_${i}`;
    const args = {
      request_id: requestId,
      building_prefab: 'FireHouse01',
      position: candidate.position,
      rotation_degrees: candidate.rotation_degrees ?? 0
    };
    if (candidate.road_edge_id) args.road_edge_id = candidate.road_edge_id;
    if (candidate.snap_target_id) args.snap_target_id = candidate.snap_target_id;
    const ready = await previewReady('preview_city_service_placement', args);
    if (!ready) continue;
    const result = await commit(ready, requestId);
    if (result.state === 'completed' && result.result_entity_ids?.[0]) { placed = result; break; }
  }
  if (!placed) throw new Error('all FireHouse02 candidates rejected');
  facilityId = placed.result_entity_ids[0];

  const upgrades = await call('list_building_upgrades', { building_id: facilityId });
  const candidateUpgrade = (upgrades.data?.items ?? []).find(item => !item.locked && item.installed_count === 0);
  if (!candidateUpgrade) throw new Error(`no compatible unlocked upgrade: ${JSON.stringify(upgrades)}`);

  const installRequest = `css_upgrade_cycle_${runId}_install`;
  const installReady = await previewReady('preview_city_service_upgrade', {
    request_id: installRequest,
    facility_id: facilityId,
    upgrade_prefab: candidateUpgrade.name
  });
  if (!installReady) throw new Error(`upgrade preview rejected: ${candidateUpgrade.name}`);
  const installed = await commit(installReady, installRequest);
  const upgradeId = installed.result_entity_ids?.[0];
  if (installed.state !== 'completed' || !upgradeId) throw new Error(`upgrade install failed: ${JSON.stringify(installed)}`);

  const removeRequest = `css_upgrade_cycle_${runId}_remove`;
  const removeReady = await previewReady('preview_city_service_upgrade_removal', {
    request_id: removeRequest,
    upgrade_id: upgradeId
  });
  if (!removeReady) throw new Error('upgrade removal preview rejected');
  const removed = await commit(removeReady, removeRequest);
  if (removed.state !== 'completed') throw new Error(`upgrade removal failed: ${JSON.stringify(removed)}`);

  console.log('UPGRADE_CYCLE', JSON.stringify({ baseline, prefab: 'FireHouse01', facilityId, upgrade: candidateUpgrade.name, installed: installed.state, removed: removed.state }));
} finally {
  if (facilityId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const requestId = `css_upgrade_cycle_${runId}_delete_${attempt}`;
      const ready = await previewReady('preview_city_service_delete', { request_id: requestId, facility_id: facilityId });
      if (ready) {
        const deleted = await commit(ready, requestId);
        console.log('CLEANUP', JSON.stringify({ facilityId, state: deleted.state, attempt }));
        if (deleted.state === 'completed') break;
      }
    }
  }
  const finalCount = (await call('list_city_service_facilities', { kind: 'all' })).data.total;
  await call('set_simulation_speed', { speed: 'normal' });
  console.log('FINAL', JSON.stringify({ baseline, finalCount }));
  await client.close();
}
