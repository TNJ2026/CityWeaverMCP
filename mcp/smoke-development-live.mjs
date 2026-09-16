import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'development-live', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? { ok: false, error: { message: (result.content ?? []).map(x => x.text ?? '').join('\n') } };
};
const ok = (value, label) => {
  assert.equal(value.ok, true, `${label}: ${JSON.stringify(value)}`);
  return value.data;
};

const status = ok(await call('get_game_status'), 'status');
assert.equal(status.bridge_version, '1.21.2');
assert.equal(status.city_loaded, true);
const tools = await client.listTools();
assert.equal(tools.tools.length, 342);

const reads = {};
reads.zone = ok(await call('get_zone_demand'), 'zone demand');
reads.resourceNonzero = ok(await call('get_resource_demand'), 'resource demand');
reads.resourceAll = ok(await call('get_resource_demand', { include_zero: true }), 'all resource demand');
reads.population = ok(await call('get_population_demographics'), 'population');
reads.housing = ok(await call('get_housing_statistics'), 'housing');
reads.employment = ok(await call('get_employment_statistics'), 'employment');
reads.education = ok(await call('get_education_statistics'), 'education');
assert.equal(reads.resourceAll.total, 41);
assert.equal(reads.education.levels.length, 5);
assert.equal(reads.zone.residential.factors.low.length, 19);

const runningReject = await call('set_unlimited_demand', { scope: 'all', enabled: true });
assert.equal(runningReject.ok, false);
assert.equal(runningReject.error.code, 'CITY_MUST_BE_PAUSED');

ok(await call('set_simulation_speed', { speed: 'paused' }), 'pause');
let enabledSnapshot;
let simulatedSnapshot;
try {
  for (const scope of ['residential', 'commercial', 'industrial']) {
    const on = ok(await call('set_unlimited_demand', { scope, enabled: true }), `enable ${scope}`);
    assert.equal(on.enabled, true);
    const off = ok(await call('set_unlimited_demand', { scope, enabled: false }), `disable ${scope}`);
    assert.equal(off.enabled, false);
  }
  enabledSnapshot = ok(await call('set_unlimited_demand', { scope: 'all', enabled: true }), 'enable all').settings;
  assert.equal(enabledSnapshot.residential, true);
  assert.equal(enabledSnapshot.commercial, true);
  assert.equal(enabledSnapshot.industrial_office, true);
  ok(await call('set_simulation_speed', { speed: 'normal' }), 'run enabled');
  await new Promise(resolve => setTimeout(resolve, 800));
  ok(await call('set_simulation_speed', { speed: 'paused' }), 'pause enabled');
  simulatedSnapshot = ok(await call('get_zone_demand'), 'read enabled demand');
} finally {
  await call('set_simulation_speed', { speed: 'paused' });
  await call('set_unlimited_demand', { scope: 'all', enabled: false });
  await call('set_simulation_speed', { speed: 'normal' });
  await new Promise(resolve => setTimeout(resolve, 800));
}

const final = ok(await call('get_zone_demand'), 'final demand');
assert.equal(final.unlimited_demand.residential, false);
assert.equal(final.unlimited_demand.commercial, false);
assert.equal(final.unlimited_demand.industrial_office, false);
const finalStatus = ok(await call('get_game_status'), 'final status');
assert.equal(finalStatus.paused, false);

console.log(JSON.stringify({
  bridge_version: status.bridge_version,
  city: status.city_name,
  tools: tools.tools.length,
  read_tools_passed: 6,
  resource_rows_all: reads.resourceAll.total,
  resource_rows_nonzero: reads.resourceNonzero.total,
  demand_factors_per_scope: reads.zone.residential.factors.low.length,
  running_rejection: runningReject.error.code,
  individual_toggle_cycles: 3,
  enabled_settings: enabledSnapshot,
  enabled_demands: {
    residential: simulatedSnapshot.residential.building_demand,
    commercial: simulatedSnapshot.commercial.building_demand,
    industrial: simulatedSnapshot.industrial.building_demand,
    office: simulatedSnapshot.office.building_demand,
    storage: simulatedSnapshot.storage.building_demand
  },
  restored_settings: final.unlimited_demand,
  final_paused: finalStatus.paused
}, null, 2));
await client.close();
