import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const client = new Client({ name: 'transport-facility-live', version: '1.14.0' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function call(name, args = {}, allowError = false) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError && !allowError) throw new Error(`${name}: ${result.content?.[0]?.text}`);
  return result.structuredContent || result;
}
async function wait(operationId) {
  for (let i = 0; i < 250; i++) {
    const operation = (await call('get_transport_facility_operation', { operation_id: operationId })).data;
    if (['preview_ready', 'completed', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(operation.state)) return operation;
    await sleep(100);
  }
  throw new Error('facility operation timeout');
}

await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))]
}));

let facilityId = null;
const report = {};
try {
  assert.equal((await client.listTools()).tools.length, 342);
  assert.equal((await call('get_game_status')).data.bridge_version, '1.22.1');
  await call('set_simulation_speed', { speed: 'paused' });
  const before = (await call('list_transport_facilities')).data.total;
  const plan = (await call('plan_transport_facility_site', {
    building_prefab: 'BusStation02', near: { x: 0, z: 0 }, search_radius_m: 3000, candidate_count: 16
  })).data;
  assert(plan.candidates.length > 0, 'no BusStation02 candidate');

  for (const candidate of plan.candidates) {
    const request = `transport_facility_place_${candidate.index}_${Date.now()}`;
    const preview = (await call('preview_transport_facility_placement', {
      request_id: request,
      building_prefab: 'BusStation02',
      position: candidate.position,
      rotation_degrees: candidate.rotation_degrees,
      road_edge_id: candidate.road_edge_id
    })).data;
    const ready = await wait(preview.operation_id);
    if (ready.state !== 'preview_ready') continue;
    await call('apply_transport_facility_operation', {
      operation_id: preview.operation_id, request_id: request, max_cost: 1000000000
    });
    const done = await wait(preview.operation_id);
    if (done.state === 'completed' && done.result_entity_ids?.length) facilityId = done.result_entity_ids[0];
    if (facilityId) break;
  }
  assert(facilityId, 'all BusStation02 placement candidates failed native validation');
  const facility = (await call('get_transport_facility', { facility_id: facilityId })).data;
  report.created = { facility_id: facilityId, prefab: facility.prefab_name, position: facility.position };

  await call('set_transport_facility_name', { facility_id: facilityId, name: 'MCP Facility Live' });
  assert.equal((await call('get_transport_facility', { facility_id: facilityId })).data.name, 'MCP Facility Live');
  await call('set_transport_facility_name', { facility_id: facilityId, name: '' });

  await call('set_transport_facility_active', { facility_id: facilityId, active: false });
  assert.equal((await call('get_transport_facility', { facility_id: facilityId })).data.active, false);
  await call('set_transport_facility_active', { facility_id: facilityId, active: true });
  assert.equal((await call('get_transport_facility', { facility_id: facilityId })).data.active, true);

  const policies = (await call('list_transport_facility_policies', { facility_id: facilityId })).data;
  const upgrades = (await call('list_transport_facility_upgrades', { facility_id: facilityId })).data;
  report.controls = {
    name: true, active: true,
    policyCount: policies.items?.length || 0,
    upgradeCount: upgrades.compatible_upgrade_count
  };
  if (policies.items?.length) {
    const policy = policies.items[0];
    const args = { facility_id: facilityId, policy: policy.name, active: policy.active };
    if (policy.slider && Number.isFinite(policy.adjustment)) args.adjustment = policy.adjustment;
    await call('set_transport_facility_policy', args);
    report.controls.policyWrite = true;
  }
  const upgrade = upgrades.items?.find(item => !item.locked && item.installed_count === 0);
  if (upgrade) {
    const request = `transport_facility_upgrade_${Date.now()}`;
    const preview = (await call('preview_transport_facility_upgrade', {
      request_id: request, facility_id: facilityId, upgrade_prefab: upgrade.name
    })).data;
    const ready = await wait(preview.operation_id);
    assert.equal(ready.state, 'preview_ready');
    await call('apply_transport_facility_operation', {
      operation_id: preview.operation_id, request_id: request, max_cost: 1000000000
    });
    assert.equal((await wait(preview.operation_id)).state, 'completed');
    const installed = (await call('list_transport_facility_upgrades', { facility_id: facilityId })).data;
    assert(installed.installed_upgrade_ids?.length > 0);
    const installedUpgradeId = installed.installed_upgrade_ids[0];
    const removeRequest = `transport_facility_upgrade_remove_${Date.now()}`;
    const removePreview = (await call('preview_transport_facility_upgrade_removal', {
      request_id: removeRequest, installed_upgrade_id: installedUpgradeId
    })).data;
    assert.equal((await wait(removePreview.operation_id)).state, 'preview_ready');
    await call('apply_transport_facility_operation', {
      operation_id: removePreview.operation_id, request_id: removeRequest, max_cost: 1000000000
    });
    assert.equal((await wait(removePreview.operation_id)).state, 'completed');
    assert.equal((await call('list_transport_facility_upgrades', { facility_id: facilityId })).data.installed_upgrade_count, 0);
    report.upgradeCycle = { prefab: upgrade.name, installed: true, removed: true };
    await call('set_simulation_speed', { speed: 'normal' });
    await sleep(3000);
    await call('set_simulation_speed', { speed: 'paused' });
  }

  const request = `transport_facility_delete_${Date.now()}`;
  const preview = (await call('preview_transport_facility_delete', { request_id: request, facility_id: facilityId })).data;
  assert.equal((await wait(preview.operation_id)).state, 'preview_ready');
  await call('apply_transport_facility_operation', {
    operation_id: preview.operation_id, request_id: request, max_cost: 1000000000
  });
  assert.equal((await wait(preview.operation_id)).state, 'completed');
  facilityId = null;
  assert.equal((await call('list_transport_facilities')).data.total, before);
  report.cleanup = true;
  console.log(JSON.stringify({ ok: true, report }, null, 2));
} finally {
  if (facilityId) {
    try {
      const request = `transport_facility_cleanup_${Date.now()}`;
      const preview = (await call('preview_transport_facility_delete', { request_id: request, facility_id: facilityId })).data;
      if ((await wait(preview.operation_id)).state === 'preview_ready') {
        await call('apply_transport_facility_operation', { operation_id: preview.operation_id, request_id: request, max_cost: 1000000000 });
        await wait(preview.operation_id);
      }
    } catch {}
  }
  try { await call('set_simulation_speed', { speed: 'normal' }); } catch {}
  await client.close();
}
