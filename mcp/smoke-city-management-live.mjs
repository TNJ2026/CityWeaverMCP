import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { queryGame } from './bridge-client.mjs';

const artifact = new URL('../artifacts/city-management-live-1.17.0.log', import.meta.url);
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(artifact, 'Cities Skylines II city management live test\n');
const calls = [];
async function call(tool, args = {}) {
  const response = await queryGame(tool, args, { timeoutMs: 20000 });
  calls.push(tool);
  await appendFile(artifact, `\n## ${tool}\n${JSON.stringify({ args, data: response.data }, null, 2)}\n`);
  return response.data;
}
async function waitPolicy(name, active) {
  for (let i = 0; i < 20; i++) {
    const list = await call('list_city_policies');
    const policy = list.items.find(item => item.name === name);
    if (policy?.active === active) return policy;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Policy ${name} did not reach active=${active}`);
}

let original;
let originalMoney;
let selectedPolicy;
try {
  const status = await call('get_game_status');
  assert.equal(status.bridge_version, '1.22.0');
  await call('set_simulation_speed', { speed: 'paused' });
  original = await call('get_city_configuration');
  if (original.unlimited_money) await call('set_city_configuration', { unlimited_money: false });
  const economy = await call('get_city_economy');
  originalMoney = economy.money;

  const overview = await call('get_city_management_overview');
  assert.equal(overview.configuration.city_name, original.city_name);
  assert.ok(overview.economy);
  assert.ok(overview.progression);

  const testName = `${original.city_name} MCP管理测试`;
  assert.equal((await call('set_city_name', { name: testName })).city_name, testName);
  assert.equal((await call('get_city_configuration')).city_name, testName);
  await call('set_city_name', { name: original.city_name });

  const testMoney = originalMoney >= 2000000000 ? originalMoney - 1 : originalMoney + 1;
  await call('set_city_money', { amount: testMoney });
  assert.equal((await call('get_city_economy')).money, testMoney);
  await call('set_city_money', { amount: originalMoney });
  if (original.unlimited_money) await call('set_city_configuration', { unlimited_money: true });

  const changedConfig = await call('set_city_configuration', { unlimited_money: !original.unlimited_money, natural_disasters: !original.natural_disasters });
  assert.equal(changedConfig.after.unlimited_money, !original.unlimited_money);
  assert.equal(changedConfig.after.natural_disasters, !original.natural_disasters);
  const restoredConfig = await call('set_city_configuration', { unlimited_money: original.unlimited_money, natural_disasters: original.natural_disasters });
  assert.equal(restoredConfig.after.unlimited_money, original.unlimited_money);
  assert.equal(restoredConfig.after.natural_disasters, original.natural_disasters);

  const policies = await call('list_city_policies');
  selectedPolicy = policies.items.find(item => !item.locked);
  if (selectedPolicy) {
    await call('set_city_policy', { policy: selectedPolicy.name, active: !selectedPolicy.active, adjustment: selectedPolicy.adjustment });
    await waitPolicy(selectedPolicy.name, !selectedPolicy.active);
    await call('set_city_policy', { policy: selectedPolicy.name, active: selectedPolicy.active, adjustment: selectedPolicy.adjustment });
    await waitPolicy(selectedPolicy.name, selectedPolicy.active);
  }

  const modifiers = await call('list_city_modifiers');
  assert.ok(modifiers.total > 0);
  const statistics = await call('list_city_statistics', { search: 'Population', parameter: 0 });
  const population = statistics.items.find(item => item.statistic === 'Population');
  assert.equal(population.available, true);
  const history = await call('get_city_statistic_history', { statistic: 'Population', parameter: 0, limit: 10 });
  assert.ok(history.sample_count > 0);
  assert.ok(history.items.length > 0);

  await call('set_simulation_speed', { speed: 'normal' });
  const final = await call('get_game_status');
  assert.equal(final.paused, false);
  const summary = { ok: true, bridge_version: status.bridge_version, distinct_tools_exercised: new Set(calls).size, city_policies: policies.total, selected_policy_roundtrip: selectedPolicy?.name ?? null, policy_roundtrip_skipped: !selectedPolicy, modifier_types: modifiers.total, population_history_samples: history.sample_count };
  await appendFile(artifact, `\n## SUMMARY\n${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await appendFile(artifact, `\n## FAILURE\n${error.stack || error}\n`);
  try { if (original) await call('set_city_name', { name: original.city_name }); } catch {}
  try { if (originalMoney !== undefined) await call('set_city_money', { amount: originalMoney }); } catch {}
  try { if (original) await call('set_city_configuration', { unlimited_money: original.unlimited_money, natural_disasters: original.natural_disasters }); } catch {}
  try { if (selectedPolicy) await call('set_city_policy', { policy: selectedPolicy.name, active: selectedPolicy.active, adjustment: selectedPolicy.adjustment }); } catch {}
  try { await call('set_simulation_speed', { speed: 'normal' }); } catch {}
  console.error(error);
  process.exitCode = 1;
}
