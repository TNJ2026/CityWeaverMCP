import assert from 'node:assert/strict';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { queryGame } from './bridge-client.mjs';

const artifact = new URL('../artifacts/population-operations-live-1.16.0.log', import.meta.url);
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(artifact, 'Cities Skylines II population operations live test\n');
const created = { citizen: null, household: null, company: null };
const results = [];

async function call(tool, args = {}) {
  const response = await queryGame(tool, args, { timeoutMs: 20000 });
  results.push({ tool, args, data: response.data });
  await appendFile(artifact, `\n## ${tool}\n${JSON.stringify({ args, data: response.data }, null, 2)}\n`);
  return response.data;
}

async function cleanup() {
  for (const [kind, tool] of [['citizen', 'delete_citizen'], ['company', 'delete_company'], ['household', 'delete_household']]) {
    if (!created[kind]) continue;
    try { await call(tool, { [`${kind}_id`]: created[kind] }); } catch (error) { await appendFile(artifact, `\ncleanup ${kind}: ${error.code} ${error.message}\n`); }
  }
  try { await call('set_simulation_speed', { speed: 'normal' }); } catch {}
}

try {
  const status = await call('get_game_status');
  assert.equal(status.bridge_version, '1.16.0');
  await call('set_simulation_speed', { speed: 'paused' });

  const citizenPrefabs = await call('list_citizen_prefabs');
  const householdPrefabs = await call('list_household_prefabs');
  const companyPrefabs = await call('list_company_prefabs');
  const existingHouseholds = await call('list_households', { limit: 10 });
  const buildings = await call('query_buildings', { building_type: 'all', limit: 20 });
  const schools = await call('query_entities', { category: 'schools', limit: 10 });
  assert.ok(citizenPrefabs.total >= 2);
  assert.ok(householdPrefabs.total > 0);
  assert.ok(companyPrefabs.total > 0);
  assert.ok(buildings.total > 0);
  const propertyId = buildings.items[0].entity_id;
  const originalHouseholdId = existingHouseholds.items[0]?.entity_id;

  const household = await call('create_household', { prefab: 'SingleHousehold', name: 'MCP Test Household', money: 12345, homeless: true });
  created.household = household.entity_id;
  assert.equal(household.money, 12345);
  assert.equal(household.homeless, true);
  await call('set_household_name', { household_id: created.household, name: 'MCP Household Renamed' });
  let householdProfile = await call('set_household_profile', { household_id: created.household, consumable_resources: 321, consumption_per_day: 12, shopping_today: 34, shopping_last_day: 56, salary_last_day: 789, leveling_spend_last_day: 90 });
  assert.equal(householdProfile.after.consumable_resource_units, 321);
  await call('set_household_money', { household_id: created.household, money: 23456 });
  await call('set_household_need', { household_id: created.household, resource: 'Food', amount: 22 });
  let householdView = await call('get_household', { household_id: created.household });
  assert.equal(householdView.current_need.resource, 'Food');
  await call('set_household_need', { household_id: created.household, clear: true });
  await call('set_household_housing', { household_id: created.household, property_id: propertyId, rent: 77 });

  const citizen = await call('create_citizen', { household_id: created.household, prefab: 'CitizenFemale', name: 'MCP Test Citizen', age: 'adult', health: 61, wellbeing: 62, education_level: 2 });
  created.citizen = citizen.entity_id;
  assert.equal(citizen.health, 61);
  assert.equal(citizen.wellbeing, 62);
  assert.equal(citizen.education_level, 2);
  assert.equal(citizen.male, false);
  await call('set_citizen_name', { citizen_id: created.citizen, name: 'MCP Citizen Renamed' });
  const profile = await call('set_citizen_profile', { citizen_id: created.citizen, age: 'teen', male: true, health: 63, wellbeing: 64, education_level: 3, failed_education_count: 2, leisure_counter: 7, penalty_counter: 8, unemployment_counter: 9, unemployment_time: 10.5, sickness_penalty: 11 });
  assert.equal(profile.after.age, 'teen');
  assert.equal(profile.after.male, true);
  assert.equal(profile.after.failed_education_count, 2);
  assert.equal(profile.after.leisure_counter, 7);
  await call('set_citizen_health_problem', { citizen_id: created.citizen, flags: 'Sick', timer: 3 });
  let citizenView = await call('get_citizen', { citizen_id: created.citizen });
  assert.equal(citizenView.health_problem.flags, 'Sick');
  assert.equal(citizenView.health_problem.timer, 3);
  await call('set_citizen_health_problem', { citizen_id: created.citizen, clear: true });
  await call('set_citizen_location', { citizen_id: created.citizen, building_id: propertyId });
  await call('set_citizen_location', { citizen_id: created.citizen, clear: true });
  if (originalHouseholdId) {
    await call('set_citizen_household', { citizen_id: created.citizen, household_id: originalHouseholdId });
    assert.ok((await call('get_household', { household_id: originalHouseholdId })).member_ids.includes(created.citizen));
    await call('set_citizen_household', { citizen_id: created.citizen, household_id: created.household });
    assert.ok((await call('get_household', { household_id: created.household })).member_ids.includes(created.citizen));
  }

  const company = await call('create_company', { prefab: companyPrefabs.items[0].name, property_id: propertyId, name: 'MCP Test Company', rent: 111, profitability: 123, last_total_worth: 4567 });
  created.company = company.entity_id;
  assert.equal(company.profitability, 123);
  await call('set_company_name', { company_id: created.company, name: 'MCP Company Renamed' });
  const financials = await call('set_company_financials', { company_id: created.company, profitability: 201, last_total_worth: 7654, rent: 222 });
  assert.equal(financials.profitability, 201);
  await call('set_company_workforce', { company_id: created.company, maximum_workers: 12 });
  await call('set_resource_amount', { holder_id: created.company, resource: 'Money', amount: 9000 });
  await call('set_citizen_workplace', { citizen_id: created.citizen, company_id: created.company, job_level: 2, shift: 'evening', last_commute_time: 33.5 });
  citizenView = await call('get_citizen', { citizen_id: created.citizen });
  assert.equal(citizenView.worker.workplace_id, created.company);
  assert.equal(citizenView.worker.job_level, 2);
  await call('set_citizen_workplace', { citizen_id: created.citizen, remove: true });
  await call('set_company_property', { company_id: created.company, remove: true });
  await call('set_company_property', { company_id: created.company, property_id: propertyId, rent: 333 });
  const tradeCreated = await call('set_company_trade_cost', { company_id: created.company, resource: 'Food', buy_cost: 12.5, sell_cost: 10.25 });
  assert.equal(tradeCreated.created, true);
  assert.equal((await call('get_company', { company_id: created.company })).trade_costs.find(row => row.resource === 'Food').buy_cost, 12.5);
  await call('set_company_trade_cost', { company_id: created.company, resource: 'Food', buy_cost: 13.5, sell_cost: 11.25 });
  const tradeRemoved = await call('set_company_trade_cost', { company_id: created.company, resource: 'Food', remove: true });
  assert.equal(tradeRemoved.removed, true);

  if (schools.total > 0) {
    const schoolId = schools.items[0].entity_id;
    await call('set_citizen_school', { citizen_id: created.citizen, school_id: schoolId, education_level: 2, last_commute_time: 44 });
    assert.equal((await call('get_citizen', { citizen_id: created.citizen })).student.school_id, schoolId);
    await call('set_citizen_school', { citizen_id: created.citizen, remove: true });
  } else {
    await appendFile(artifact, '\n## set_citizen_school\nSKIPPED: current save contains no school entity.\n');
  }

  await cleanup();
  created.citizen = created.household = created.company = null;
  await new Promise(resolve => setTimeout(resolve, 1500));
  const finalStatus = await call('get_game_status');
  assert.equal(finalStatus.paused, false);
  const summary = { ok: true, bridge_version: status.bridge_version, tools_exercised: new Set(results.map(x => x.tool)).size, schools_available: schools.total, trade_cost_crud: true };
  await appendFile(artifact, `\n## SUMMARY\n${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await appendFile(artifact, `\n## FAILURE\n${error.stack || error}\n`);
  await cleanup();
  console.error(error);
  process.exitCode = 1;
}
