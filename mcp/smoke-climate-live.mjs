import { queryGame } from './bridge-client.mjs';
import assert from 'node:assert/strict';

async function q(tool, args = {}) { return (await queryGame(tool, args)).data; }
let baseline;
try {
  const status = await q('get_game_status');
  assert.equal(status.bridge_version, '1.15.0');
  await q('set_simulation_speed', { speed: 'paused' });
  baseline = await q('get_climate_state');

  const changed = await q('set_weather_override', {
    temperature: 12.5, precipitation: 0.4, cloudiness: 0.6,
    fog: 0.2, aurora: 0.1, thunder: 0.3, hail: 0.15, rainbow: 0.25
  });
  assert.equal(changed.temperature.overridden, true);
  assert.equal(changed.temperature.value, 12.5);
  assert.equal(changed.precipitation.value, 0.4);
  assert.equal(changed.fog.value, 0.2);

  const windChanged = await q('set_wind', { x: 0.42, z: -0.18, pressure: 55 });
  assert.equal(windChanged.after.x, 0.42);
  assert.equal(windChanged.after.z, -0.18);
  assert.equal(windChanged.after.pressure, 55);
  const wind = await q('sample_wind', { points: [{ x: 0, z: 0 }, { x: 6200, z: 6200 }] });
  assert.equal(wind.items.length, 2);
  assert(wind.items.every(item => Number.isFinite(item.speed)));

  const soil = await q('sample_soil_water', { points: [{ x: 0, z: 0 }, { x: 6200, z: 6200 }] });
  assert.equal(soil.resolution, 128);
  assert.equal(soil.items.length, 2);
  assert(soil.items.every(item => typeof item.inside_map === 'boolean'));

  await restore();
  const restored = await q('get_climate_state');
  for (const name of ['temperature','precipitation','cloudiness','fog','aurora','thunder']) {
    assert.equal(restored[name].overridden, baseline[name].overridden);
    if (baseline[name].overridden) assert(Math.abs(restored[name].value - baseline[name].value) < 0.0001);
  }
  assert(Math.abs(restored.wind.x - baseline.wind.x) < 0.0001);
  assert(Math.abs(restored.wind.z - baseline.wind.z) < 0.0001);
  assert(Math.abs(restored.wind.pressure - baseline.wind.pressure) < 0.0001);
  await q('set_simulation_speed', { speed: 'normal' });
  console.log(JSON.stringify({ ok: true, report: { weatherOverrideRoundTrip: true, windRoundTrip: true, windSamples: wind.items, soilSamples: soil.items, restored: true } }, null, 2));
} finally {
  if (baseline) { try { await q('set_simulation_speed', { speed: 'paused' }); await restore(); } catch {} }
  try { await q('set_simulation_speed', { speed: 'normal' }); } catch {}
}

async function restore() {
  const weather = { clear: true, hail: baseline.hail, rainbow: baseline.rainbow };
  for (const name of ['temperature','precipitation','cloudiness','fog','aurora','thunder','date']) {
    if (baseline[name].overridden) weather[name] = baseline[name].override_value;
  }
  await q('set_weather_override', weather);
  await q('set_wind', { x: baseline.wind.x, z: baseline.wind.z, pressure: baseline.wind.pressure });
}
