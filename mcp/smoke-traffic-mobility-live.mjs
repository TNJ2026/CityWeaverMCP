import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const c = new Client({ name: 'traffic-mobility-live', version: '1.12.0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  return r.structuredContent.data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = {};
try {
  await call('set_simulation_speed', { speed: 'normal' });
  await sleep(5000);
  const status = await call('get_game_status');
  assert.equal(status.bridge_version, '1.12.0');
  const vehicles = await call('list_vehicles', { limit: 500 });
  const travelers = await call('list_travelers', { limit: 500 });
  const moving = await call('list_vehicles', { state: 'moving', limit: 500 });
  const parked = await call('list_vehicles', { state: 'parked', limit: 500 });
  const stuck = await call('list_vehicles', { state: 'stuck', limit: 500 });
  const walking = await call('list_travelers', { mode: 'walking', limit: 500 });
  const riding = await call('list_travelers', { mode: 'riding', limit: 500 });
  const waiting = await call('list_travelers', { mode: 'waiting', limit: 500 });
  const traffic = await call('analyze_traffic_flow', { limit: 50 });
  const parking = await call('analyze_parking', { limit: 50 });
  const connections = await call('inspect_lane_connections', { limit: 1000 });
  report.reads = { vehicles: vehicles.total, moving: moving.total, parked: parked.total, stuck: stuck.total, travelers: travelers.total, walking: walking.total, riding: riding.total, waiting: waiting.total, traffic_roads: traffic.roads_with_vehicles, parking_lanes: parking.parking_lane_count, connection_lanes: connections.total };
  if (vehicles.items.length) {
    report.vehicle_detail = await call('get_vehicle', { vehicle_id: vehicles.items[0].entity_id });
    report.vehicle_path = await call('get_vehicle_path', { vehicle_id: vehicles.items[0].entity_id, limit: 1000 });
  }
  if (travelers.items.length) {
    report.traveler_detail = await call('get_traveler', { traveler_id: travelers.items[0].entity_id });
    report.traveler_path = await call('get_traveler_path', { traveler_id: travelers.items[0].entity_id, limit: 1000 });
  }
  await call('set_simulation_speed', { speed: 'paused' });
  const pathVehicle = vehicles.items.find(v => v.path_state);
  if (pathVehicle) report.vehicle_reroute = await call('request_vehicle_reroute', { vehicle_id: pathVehicle.entity_id });
  const targetVehicle = vehicles.items.find(v => v.path_state && v.target_id);
  if (targetVehicle) report.vehicle_retarget = await call('set_vehicle_target', { vehicle_id: targetVehicle.entity_id, target_id: targetVehicle.target_id });
  const speedVehicle = vehicles.items.find(v => typeof v.navigation_max_speed_mps === 'number' && v.navigation_max_speed_mps > 0);
  if (speedVehicle) {
    const original = speedVehicle.navigation_max_speed_mps;
    const changed = Math.max(0.1, original * 0.9);
    await call('set_vehicle_behavior', { vehicle_id: speedVehicle.entity_id, max_speed_mps: changed });
    const observed = await call('get_vehicle', { vehicle_id: speedVehicle.entity_id });
    assert(Math.abs(observed.navigation_max_speed_mps - changed) < 0.001);
    await call('set_vehicle_behavior', { vehicle_id: speedVehicle.entity_id, max_speed_mps: original });
    report.vehicle_speed_round_trip = [original, observed.navigation_max_speed_mps, original];
  }
  const behaviorCar = vehicles.items.find(v => v.vehicle_class === 'car');
  if (behaviorCar) {
    const originalFlags = String(behaviorCar.car_flags ?? '');
    const originalPrefer = originalFlags.includes('PreferPublicTransportLanes');
    const originalUse = originalFlags.includes('UsePublicTransportLanes');
    await call('set_vehicle_behavior', { vehicle_id: behaviorCar.entity_id, prefer_public_transport_lanes: !originalPrefer, use_public_transport_lanes: !originalUse });
    const toggled = await call('get_vehicle', { vehicle_id: behaviorCar.entity_id });
    assert.equal(String(toggled.car_flags).includes('PreferPublicTransportLanes'), !originalPrefer);
    assert.equal(String(toggled.car_flags).includes('UsePublicTransportLanes'), !originalUse);
    await call('set_vehicle_behavior', { vehicle_id: behaviorCar.entity_id, prefer_public_transport_lanes: originalPrefer, use_public_transport_lanes: originalUse });
    report.vehicle_lane_flags_round_trip = { original: originalFlags, toggled: toggled.car_flags, restored: true };
  }
  const movingVehicle = moving.items.find(v => v.speed_mps > .15);
  if (movingVehicle) {
    const beforeSpeed = movingVehicle.speed_mps;
    await call('set_vehicle_behavior', { vehicle_id: movingVehicle.entity_id, clear_velocity: true });
    const stoppedVehicle = await call('get_vehicle', { vehicle_id: movingVehicle.entity_id });
    assert(stoppedVehicle.speed_mps < .001);
    report.clear_velocity = { before_speed_mps: beforeSpeed, after_speed_mps: stoppedVehicle.speed_mps };
  }
  const pathTraveler = travelers.items.find(v => v.path_state);
  if (pathTraveler) report.traveler_reroute = await call('request_traveler_reroute', { traveler_id: pathTraveler.entity_id });
  const targetTraveler = travelers.items.find(v => v.path_state && v.target_id);
  if (targetTraveler) report.traveler_retarget = await call('set_traveler_target', { traveler_id: targetTraveler.entity_id, target_id: targetTraveler.target_id });
  const speedTraveler = travelers.items.find(v => typeof v.navigation_max_speed_mps === 'number' && v.navigation_max_speed_mps > 0);
  if (speedTraveler) {
    const original = speedTraveler.navigation_max_speed_mps;
    const changed = Math.max(0.1, original * 0.9);
    await call('set_traveler_speed', { traveler_id: speedTraveler.entity_id, max_speed_mps: changed });
    const observed = await call('get_traveler', { traveler_id: speedTraveler.entity_id });
    assert(Math.abs(observed.navigation_max_speed_mps - changed) < 0.001);
    await call('set_traveler_speed', { traveler_id: speedTraveler.entity_id, max_speed_mps: original });
    report.traveler_speed_round_trip = [original, observed.navigation_max_speed_mps, original];
  }
  const citizens = await call('list_citizens', { limit: 100 });
  const buildings = await call('query_buildings', { building_type: 'all', limit: 100 });
  if (citizens.items.length && buildings.items.length) {
    const citizen = citizens.items[0], destination = buildings.items.find(b => b.entity_id !== citizen.current_building_id) ?? buildings.items[0];
    const before = await call('list_citizen_trips', { citizen_id: citizen.entity_id });
    const hadSightseeing = before.queued.some(x => x.purpose === 'Sightseeing');
    if (!hadSightseeing) {
      report.trip_queue = await call('request_citizen_trip', { citizen_id: citizen.entity_id, target_id: destination.entity_id, purpose: 'Sightseeing', priority: 255 });
      const queued = await call('list_citizen_trips', { citizen_id: citizen.entity_id });
      assert(queued.queued.some(x => x.purpose === 'Sightseeing' && x.target_id === destination.entity_id));
      report.trip_cancel = await call('cancel_citizen_trips', { citizen_id: citizen.entity_id, purpose: 'Sightseeing' });
    }
  }
  report.manage_reroute = await call('manage_traffic', { action: 'reroute_stuck', limit: 100 });
  const parkedNow = await call('list_vehicles', { state: 'parked', limit: 10 });
  if (parkedNow.items.length) {
    const victim = parkedNow.items[0].entity_id;
    report.remove_vehicle = await call('remove_vehicle', { vehicle_id: victim });
    await call('set_simulation_speed', { speed: 'normal' }); await sleep(1000); await call('set_simulation_speed', { speed: 'paused' });
    const check = await c.callTool({ name: 'get_vehicle', arguments: { vehicle_id: victim } });
    assert.equal(check.isError, true);
  }
  const parkedBatch = await call('list_vehicles', { state: 'parked', limit: 10 });
  if (parkedBatch.items.length) report.manage_remove_parked = await call('manage_traffic', { action: 'remove_parked', limit: 1 });
  await call('set_simulation_speed', { speed: 'normal' });
  report.final_status = await call('get_game_status');
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await call('set_simulation_speed', { speed: 'normal' }); } catch {}
  await c.close();
}
