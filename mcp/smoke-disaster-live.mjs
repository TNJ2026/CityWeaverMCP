import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { queryGame, BridgeError } from './bridge-client.mjs';

const artifact = new URL('../artifacts/disaster-live-1.18.0.log', import.meta.url);
const log = [];
const record = (name, value) => { log.push({ name, at: new Date().toISOString(), value }); return value; };
const call = async (name, args = {}) => record(name, await queryGame(name, args));
const data = result => result.data;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const runId = Date.now().toString();

let lightningId;
let hailId;
let tornadoId;
const extraIds = [];
try {
  const status = data(await call('get_game_status'));
  assert.equal(status.bridge_version, '1.21.2');
  assert.equal(status.city_loaded, true);
  const prefabs = data(await call('list_disaster_prefabs'));
  assert.equal(prefabs.total, 8);
  for (const name of ['Building Collapse', 'Building Fire', 'Flood', 'Forest Fire', 'Hail Storm', 'Lightning Strike', 'Tornado', 'Tsunami']) assert(prefabs.items.some(item => item.name === name));
  assert.equal(data(await call('get_disaster_prefab', { prefab: 'Tornado' })).concurrent_limit, 1);
  await call('get_disaster_readiness');
  await call('set_simulation_speed', { speed: 'paused' });

  const cancelled = data(await call('preview_disaster', { request_id: `disaster-cancel-${runId}`, prefab: 'Hail Storm', x: 6200, z: 6200, phenomenon_radius: 80, hotspot_radius: 60, duration_seconds: 30 }));
  assert.equal(cancelled.state, 'preview_ready');
  assert.equal(data(await call('cancel_disaster_preview', { operation_id: cancelled.operation_id })).state, 'cancelled');

  const lightningRequest = `disaster-lightning-${runId}`;
  const lightning = data(await call('preview_disaster', { request_id: lightningRequest, prefab: 'Lightning Strike', x: -4043, z: -1936, phenomenon_radius: 100, hotspot_radius: 70, initial_intensity: 0.25, warning_seconds: 0, duration_seconds: 30 }));
  const lightningApplied = data(await call('apply_disaster_operation', { operation_id: lightning.operation_id, request_id: lightningRequest }));
  assert.equal(lightningApplied.state, 'completed');
  lightningId = lightningApplied.result_disaster_id;
  assert(lightningId);
  await call('get_disaster_operation', { operation_id: lightning.operation_id });
  await call('set_simulation_speed', { speed: 'fastest' });
  await wait(1800);
  await call('set_simulation_speed', { speed: 'paused' });
  const lightningState = data(await call('get_active_disaster', { disaster_id: lightningId }));
  assert.equal(lightningState.prefab, 'Lightning Strike');
  assert(lightningState.intensity > 0);
  await call('get_disaster_impacts', { disaster_id: lightningId, limit: 20 });
  const updated = data(await call('update_disaster', { disaster_id: lightningId, x: -4000, z: -1900, phenomenon_radius: 120, hotspot_radius: 60, intensity: 0.5, remaining_seconds: 20 }));
  assert.equal(updated.phenomenon_radius, 120);
  assert.equal(updated.intensity, 0.5);
  await call('clear_disaster_effects', { disaster_id: lightningId, include_damage: false });
  await call('stop_disaster', { disaster_id: lightningId });
  lightningId = undefined;

  const buildings = data(await call('query_buildings', { building_type: 'all', offset: 0, limit: 100 }));
  const target = buildings.items.find(item => item.prefab_name.startsWith('Ruins')) ?? buildings.items[0];
  assert(target?.entity_id);
  const hailRequest = `disaster-hail-${runId}`;
  const hail = data(await call('preview_disaster', { request_id: hailRequest, prefab: 'Hail Storm', target_id: target.entity_id, phenomenon_radius: 80, hotspot_radius: 60, initial_intensity: 1, duration_seconds: 30 }));
  const hailApplied = data(await call('apply_disaster_operation', { operation_id: hail.operation_id, request_id: hailRequest }));
  hailId = hailApplied.result_disaster_id;
  await call('set_simulation_speed', { speed: 'fastest' });
  await wait(1800);
  await call('set_simulation_speed', { speed: 'paused' });
  const hailState = data(await call('get_active_disaster', { disaster_id: hailId }));
  assert.equal(hailState.prefab, 'Hail Storm');
  assert(hailState.impacts.in_danger >= 1);
  await call('clear_disaster_effects', { disaster_id: hailId, include_damage: true });
  await call('stop_disaster', { disaster_id: hailId });
  hailId = undefined;

  const fireRequest = `disaster-building-fire-${runId}`;
  const fire = data(await call('preview_disaster', { request_id: fireRequest, prefab: 'Building Fire', target_id: target.entity_id }));
  const fireApplied = data(await call('apply_disaster_operation', { operation_id: fire.operation_id, request_id: fireRequest }));
  extraIds.push(fireApplied.result_disaster_id);
  await call('set_simulation_speed', { speed: 'fastest' }); await wait(1200); await call('set_simulation_speed', { speed: 'paused' });
  const fireState = data(await call('get_active_disaster', { disaster_id: fireApplied.result_disaster_id }));
  assert.equal(fireState.family, 'fire');
  await call('clear_disaster_effects', { disaster_id: fireApplied.result_disaster_id, include_damage: true });
  await call('stop_disaster', { disaster_id: fireApplied.result_disaster_id }); extraIds.pop();

  const trees = data(await call('list_landscape_objects', { kind: 'tree', x: 0, z: 0, radius_m: 20000, offset: 0, limit: 10 }));
  assert(trees.items[0]?.object_id);
  const forestRequest = `disaster-forest-fire-${runId}`;
  const forest = data(await call('preview_disaster', { request_id: forestRequest, prefab: 'Forest Fire', target_id: trees.items[0].object_id }));
  const forestApplied = data(await call('apply_disaster_operation', { operation_id: forest.operation_id, request_id: forestRequest }));
  extraIds.push(forestApplied.result_disaster_id);
  await call('set_simulation_speed', { speed: 'fastest' }); await wait(1200); await call('set_simulation_speed', { speed: 'paused' });
  assert.equal(data(await call('get_active_disaster', { disaster_id: forestApplied.result_disaster_id })).family, 'fire');
  await call('clear_disaster_effects', { disaster_id: forestApplied.result_disaster_id, include_damage: true });
  await call('stop_disaster', { disaster_id: forestApplied.result_disaster_id }); extraIds.pop();

  const collapseRequest = `disaster-collapse-${runId}`;
  const collapse = data(await call('preview_disaster', { request_id: collapseRequest, prefab: 'Building Collapse', target_id: target.entity_id }));
  const collapseApplied = data(await call('apply_disaster_operation', { operation_id: collapse.operation_id, request_id: collapseRequest }));
  extraIds.push(collapseApplied.result_disaster_id);
  await call('set_simulation_speed', { speed: 'normal' }); await wait(700); await call('set_simulation_speed', { speed: 'paused' });
  const collapseState = data(await call('get_active_disaster', { disaster_id: collapseApplied.result_disaster_id }));
  assert.equal(collapseState.family, 'destruction');
  await call('clear_disaster_effects', { disaster_id: collapseApplied.result_disaster_id, include_damage: true });
  await call('stop_disaster', { disaster_id: collapseApplied.result_disaster_id }); extraIds.pop();

  for (const prefab of ['Flood', 'Tsunami']) {
    const waterRequest = `disaster-${prefab.toLowerCase()}-${runId}`;
    const water = data(await call('preview_disaster', { request_id: waterRequest, prefab }));
    const waterApplied = data(await call('apply_disaster_operation', { operation_id: water.operation_id, request_id: waterRequest }));
    extraIds.push(waterApplied.result_disaster_id);
    await call('set_simulation_speed', { speed: 'normal' }); await wait(500); await call('set_simulation_speed', { speed: 'paused' });
    const waterState = data(await call('get_active_disaster', { disaster_id: waterApplied.result_disaster_id }));
    assert.equal(waterState.family, 'water_level');
    await call('update_disaster', { disaster_id: waterApplied.result_disaster_id, intensity: 0, max_intensity: 0.1, danger_height: 476, direction_x: 1, direction_z: 0, remaining_seconds: 5 });
    await call('clear_disaster_effects', { disaster_id: waterApplied.result_disaster_id, include_damage: true });
    await call('stop_disaster', { disaster_id: waterApplied.result_disaster_id }); extraIds.pop();
  }

  const tornadoRequest = `disaster-tornado-${runId}`;
  const tornado = data(await call('preview_disaster', { request_id: tornadoRequest, prefab: 'Tornado', x: 6500, z: 6500, phenomenon_radius: 100, hotspot_radius: 30, initial_intensity: 1, warning_seconds: 0, duration_seconds: 60 }));
  const tornadoApplied = data(await call('apply_disaster_operation', { operation_id: tornado.operation_id, request_id: tornadoRequest }));
  tornadoId = tornadoApplied.result_disaster_id;
  let concurrentRejected = false;
  try { await queryGame('preview_disaster', { request_id: `disaster-tornado-second-${runId}`, prefab: 'Tornado', x: 6400, z: 6400, duration_seconds: 30 }); }
  catch (error) { concurrentRejected = error instanceof BridgeError && error.code === 'DISASTER_CONCURRENT_LIMIT'; record('tornado_concurrent_limit', { code: error.code, message: error.message }); }
  assert.equal(concurrentRejected, true);
  await call('set_simulation_speed', { speed: 'fastest' });
  await wait(1800);
  await call('set_simulation_speed', { speed: 'paused' });
  const tornadoState = data(await call('get_active_disaster', { disaster_id: tornadoId }));
  assert.equal(tornadoState.prefab, 'Tornado');
  await call('get_disaster_impacts', { disaster_id: tornadoId, limit: 100 });
  await call('clear_disaster_effects', { disaster_id: tornadoId, include_damage: true });
  await call('stop_disaster', { disaster_id: tornadoId });
  tornadoId = undefined;
  assert.equal(data(await call('list_active_disasters')).total, 0);
  await call('set_simulation_speed', { speed: 'normal' });
  record('result', { pass: true, tool_count: 318, prefabs: prefabs.items.length });
} catch (error) {
  record('result', { pass: false, name: error.name, code: error.code, message: error.message, stack: error.stack });
  try { if (lightningId) { await queryGame('clear_disaster_effects', { disaster_id: lightningId, include_damage: true }); await queryGame('stop_disaster', { disaster_id: lightningId }); } } catch {}
  try { if (hailId) { await queryGame('clear_disaster_effects', { disaster_id: hailId, include_damage: true }); await queryGame('stop_disaster', { disaster_id: hailId }); } } catch {}
  try { if (tornadoId) { await queryGame('clear_disaster_effects', { disaster_id: tornadoId, include_damage: true }); await queryGame('stop_disaster', { disaster_id: tornadoId }); } } catch {}
  for (const id of extraIds) { try { await queryGame('clear_disaster_effects', { disaster_id: id, include_damage: true }); await queryGame('stop_disaster', { disaster_id: id }); } catch {} }
  try { await queryGame('set_simulation_speed', { speed: 'normal' }); } catch {}
  throw error;
} finally {
  await writeFile(artifact, log.map(entry => JSON.stringify(entry)).join('\n') + '\n');
}

console.log(JSON.stringify(log.at(-1), null, 2));
