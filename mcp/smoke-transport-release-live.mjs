import { queryGame } from './bridge-client.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function q(tool, args = {}) { return (await queryGame(tool, args)).data; }
async function wait(tool, operationId, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const operation = await q(tool, { operation_id: operationId });
    if (['preview_ready', 'completed', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(operation.state)) return operation;
    await sleep(100);
  }
  throw new Error('operation timeout');
}

let depotId = null;
let lineId = null;
const report = {};
try {
  await q('set_simulation_speed', { speed: 'paused' });
  const facilityBefore = (await q('list_transport_facilities')).total;
  const lineBefore = (await q('list_transport_lines')).total;

  const plan = await q('plan_transport_facility_site', {
    building_prefab: 'BusDepot01', near: { x: 0, z: 0 }, search_radius_m: 3000, candidate_count: 32
  });
  for (const candidate of plan.candidates) {
    const request = `transport_release_depot_${candidate.index}_${Date.now()}`;
    const preview = await q('preview_transport_facility_placement', {
      request_id: request, building_prefab: 'BusDepot01', position: candidate.position,
      rotation_degrees: candidate.rotation_degrees, road_edge_id: candidate.road_edge_id
    });
    const ready = await wait('get_transport_facility_operation', preview.operation_id);
    if (ready.state !== 'preview_ready') continue;
    await q('apply_transport_facility_operation', { operation_id: preview.operation_id, request_id: request, max_cost: 1000000000 });
    const done = await wait('get_transport_facility_operation', preview.operation_id);
    if (done.state === 'completed') depotId = done.result_entity_ids?.[0] || null;
    if (depotId) break;
  }
  if (!depotId) throw new Error('no valid BusDepot01 placement candidate');
  report.depot_id = depotId;

  const stops = (await q('list_transport_stops', { transport_type: 'Bus', passenger_only: true })).items;
  const selections = [stops.map(stop => stop.stop_id), ...stops.slice(1).map((_, index) => [stops[0].stop_id, stops[index + 1].stop_id])];
  for (let index = 0; index < selections.length && !lineId; index++) {
    const request = `transport_release_line_${index}_${Date.now()}`;
    const preview = await q('preview_transport_line', {
      request_id: request, line_prefab: 'Bus Line', stop_ids: selections[index], name: 'MCP Release Live'
    });
    const ready = await wait('get_transport_line_operation', preview.operation_id);
    if (ready.state !== 'preview_ready') continue;
    await q('apply_transport_line_operation', { operation_id: preview.operation_id, request_id: request });
    const done = await wait('get_transport_line_operation', preview.operation_id);
    if (done.state === 'completed') lineId = done.result_line_id;
  }
  if (!lineId) throw new Error('no connected Bus Line route');
  report.line_id = lineId;
  await q('set_transport_line_vehicle_count', { line_id: lineId, vehicle_count: 8 });
  await q('request_transport_line_vehicle', { line_id: lineId, priority: 1 });
  await q('set_simulation_speed', { speed: 'fastest' });

  let line;
  for (let index = 0; index < 30; index++) {
    await sleep(2000);
    line = await q('get_transport_line', { line_id: lineId });
    if (line.vehicles?.length) break;
  }
  report.observed_vehicle_count = line?.vehicles?.length || 0;
  if (line?.vehicles?.length) {
    const vehicleId = line.vehicles[0].vehicle_id;
    await q('set_simulation_speed', { speed: 'paused' });
    report.release = await q('release_transport_line_vehicle', { line_id: lineId, vehicle_id: vehicleId });
  } else {
    report.release = { tested: false, reason: 'No bus was dispatched within 60 seconds at fastest simulation speed.' };
  }

  await q('set_simulation_speed', { speed: 'paused' });
  const lineRequest = `transport_release_line_cleanup_${Date.now()}`;
  const linePreview = await q('preview_transport_line_delete', { request_id: lineRequest, line_id: lineId });
  if ((await wait('get_transport_line_operation', linePreview.operation_id)).state === 'preview_ready') {
    await q('apply_transport_line_operation', { operation_id: linePreview.operation_id, request_id: lineRequest });
    await wait('get_transport_line_operation', linePreview.operation_id);
    lineId = null;
  }
  const depotRequest = `transport_release_depot_cleanup_${Date.now()}`;
  const depotPreview = await q('preview_transport_facility_delete', { request_id: depotRequest, facility_id: depotId });
  if ((await wait('get_transport_facility_operation', depotPreview.operation_id)).state === 'preview_ready') {
    await q('apply_transport_facility_operation', { operation_id: depotPreview.operation_id, request_id: depotRequest, max_cost: 1000000000 });
    await wait('get_transport_facility_operation', depotPreview.operation_id);
    depotId = null;
  }
  report.cleanup = {
    lines_restored: (await q('list_transport_lines')).total === lineBefore,
    facilities_restored: (await q('list_transport_facilities')).total === facilityBefore
  };
  console.log(JSON.stringify({ ok: true, report }, null, 2));
} finally {
  try { await q('set_simulation_speed', { speed: 'paused' }); } catch {}
  if (lineId) {
    try {
      const request = `transport_release_line_finally_${Date.now()}`;
      const preview = await q('preview_transport_line_delete', { request_id: request, line_id: lineId });
      if ((await wait('get_transport_line_operation', preview.operation_id)).state === 'preview_ready') {
        await q('apply_transport_line_operation', { operation_id: preview.operation_id, request_id: request });
        await wait('get_transport_line_operation', preview.operation_id);
      }
    } catch {}
  }
  if (depotId) {
    try {
      const request = `transport_release_depot_finally_${Date.now()}`;
      const preview = await q('preview_transport_facility_delete', { request_id: request, facility_id: depotId });
      if ((await wait('get_transport_facility_operation', preview.operation_id)).state === 'preview_ready') {
        await q('apply_transport_facility_operation', { operation_id: preview.operation_id, request_id: request, max_cost: 1000000000 });
        await wait('get_transport_facility_operation', preview.operation_id);
      }
    } catch {}
  }
  try { await q('set_simulation_speed', { speed: 'normal' }); } catch {}
}
