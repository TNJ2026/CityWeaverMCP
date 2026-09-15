import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const client = new Client({ name: 'district-live-smoke', version: '1.0.0' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(name, args = {}, allowError = false) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError && !allowError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return r.structuredContent || r;
}
async function waitOperation(id, wanted, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await call('get_district_operation', { operation_id: id });
    if (wanted.includes(r.data.state)) return r.data;
    if (['failed', 'expired', 'cancelled', 'outcome_unknown'].includes(r.data.state)) throw new Error(`operation ${id}: ${r.data.state}/${r.data.error}`);
    await sleep(150);
  }
  throw new Error(`operation ${id} timed out`);
}

await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
let districtId;
const report = {};
try {
  await call('set_simulation_speed', { speed: 'paused' });
  const before = await call('list_districts'); report.initialDistricts = before.data.total;
  const invalid = await call('preview_district_create', { request_id: 'district_invalid_self_cross', boundary: [{x:-700,z:-700},{x:-500,z:-500},{x:-700,z:-500},{x:-500,z:-700}] }, true);
  assert(invalid.isError === true || invalid.ok === false); report.selfIntersectionRejected = true;

  const create = await call('preview_district_create', { request_id: 'district_smoke_create_130', name: 'MCP District Smoke', boundary: [{x:-500,z:-500},{x:-340,z:-500},{x:-340,z:-340},{x:-500,z:-340}] });
  await waitOperation(create.data.operation_id, ['preview_ready']);
  await call('apply_district_operation', { operation_id: create.data.operation_id, request_id: 'district_smoke_create_130' });
  const created = await waitOperation(create.data.operation_id, ['completed']); districtId = created.result_district_id; assert(districtId); report.created = districtId;

  await sleep(300);
  const detail = await call('get_district', { district_id: districtId }); assert.equal(detail.data.custom_name, 'MCP District Smoke'); assert.equal(detail.data.point_count, 4);
  const found = await call('find_district_at', { x:-420, z:-420 }); assert.equal(found.data.district.district_id, districtId); report.pointLookup = true;
  const coverage = await call('get_district_coverage', { district_id: districtId, limit: 20 }); report.coverageMembers = coverage.data.member_count;

  const boundary = await call('preview_district_boundary', { request_id: 'district_smoke_boundary_130', district_id: districtId, boundary: [{x:-520,z:-520},{x:-320,z:-520},{x:-300,z:-400},{x:-400,z:-300},{x:-520,z:-340}] });
  assert.equal(boundary.data.state, 'preview_ready'); await call('apply_district_operation', { operation_id: boundary.data.operation_id, request_id: 'district_smoke_boundary_130' }); await sleep(500);
  const reshaped = await call('get_district', { district_id: districtId }); assert.equal(reshaped.data.point_count, 5); assert(Math.abs(reshaped.data.surface_area_m2 - 39800) < 10); report.boundaryArea = reshaped.data.surface_area_m2;

  const policies = await call('list_district_policies', { district_id: districtId }); assert(policies.data.items.length >= 5); report.policyCount = policies.data.items.length;
  const testPolicy = policies.data.items.find(x => !x.locked && !x.slider);
  if (testPolicy) { await call('set_district_policy', { district_id: districtId, policy: testPolicy.name, active: true }); await sleep(250); let current = await call('list_district_policies', { district_id: districtId }); assert.equal(current.data.items.find(x=>x.name===testPolicy.name).active, true); await call('set_district_policy', { district_id: districtId, policy: testPolicy.name, active: false }); report.policyRoundTrip = testPolicy.name; }

  const services = await call('query_entities', { category:'buildings', all_components:['Game.Areas.ServiceDistrict'], limit:1 });
  if (services.data.items.length) { const serviceId=services.data.items[0].entity_id; const original=await call('get_service_districts',{service_id:serviceId}); await call('set_service_districts',{service_id:serviceId,district_ids:[districtId]}); const assigned=await call('get_service_districts',{service_id:serviceId}); assert.deepEqual(assigned.data.district_ids,[districtId]); await call('set_service_districts',{service_id:serviceId,district_ids:original.data.district_ids}); report.serviceCoverageRoundTrip=serviceId; }

  const cancel = await call('preview_district_create', { request_id:'district_smoke_cancel_130', boundary:[{x:-800,z:-800},{x:-720,z:-800},{x:-720,z:-720},{x:-800,z:-720}] }); await waitOperation(cancel.data.operation_id,['preview_ready']); await call('cancel_district_preview',{operation_id:cancel.data.operation_id}); await waitOperation(cancel.data.operation_id,['cancelled']); report.cancelledPreview=true;

  const del = await call('preview_district_delete', { request_id:'district_smoke_delete_130', district_id:districtId }); assert.equal(del.data.state,'preview_ready'); const deleted=await call('apply_district_operation',{operation_id:del.data.operation_id,request_id:'district_smoke_delete_130'}); assert.equal(deleted.data.state,'completed'); await sleep(500);
  const after=await call('list_districts'); assert(!after.data.items.some(x=>x.district_id===districtId)); report.deleted=true;
  await call('set_simulation_speed', { speed:'normal' });
  console.log(JSON.stringify({ok:true,report},null,2));
} catch (e) {
  try { if (districtId) { const d=await call('preview_district_delete',{request_id:'district_smoke_cleanup_130',district_id:districtId}); await call('apply_district_operation',{operation_id:d.data.operation_id,request_id:'district_smoke_cleanup_130'}); } } catch {}
  console.error(e.stack || e); process.exitCode=1;
} finally { await client.close(); }
