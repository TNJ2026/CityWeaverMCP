import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'population-economy-live', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); return result.structuredContent ?? { ok: false, error: { message: (result.content ?? []).map(x => x.text ?? '').join('\n') } }; };
const ok = (value, label) => { assert.equal(value.ok, true, `${label}: ${JSON.stringify(value)}`); return value.data; };

const status = ok(await call('get_game_status'), 'status'); assert.equal(status.bridge_version, '1.11.0'); assert.equal(status.city_loaded, true);
const tools = await client.listTools(); assert.equal(tools.tools.length, 200);
const citizens = ok(await call('list_citizens', { limit: 100 }), 'citizens');
const workers = ok(await call('list_citizens', { role: 'worker', limit: 100 }), 'workers');
const students = ok(await call('list_citizens', { role: 'student', limit: 100 }), 'students');
const households = ok(await call('list_households', { limit: 100 }), 'households');
const companies = ok(await call('list_companies', { limit: 100 }), 'companies');
const resources = ok(await call('get_resource_economy', { include_zero: true }), 'resource economy');
const holders = ok(await call('list_resource_holders', { limit: 100 }), 'resource holders');
assert.equal(resources.total, 41); assert.ok(citizens.total > 0 && households.total > 0 && companies.total > 0 && holders.total > 0);
const citizen = ok(await call('get_citizen', { citizen_id: citizens.items[0].entity_id }), 'citizen detail');
const household = ok(await call('get_household', { household_id: households.items[0].entity_id }), 'household detail');
const company = ok(await call('get_company', { company_id: companies.items[0].entity_id }), 'company detail');

for (const [name, args] of [
  ['set_citizen_attributes', { citizen_id: citizen.entity_id, health: citizen.health }],
  ['set_household_money', { household_id: household.entity_id, money: household.money }],
  ['set_company_profitability', { company_id: company.entity_id, profitability: company.profitability }]
]) { const result = await call(name, args); assert.equal(result.ok, false); assert.equal(result.error.code, 'CITY_MUST_BE_PAUSED'); }

ok(await call('set_simulation_speed', { speed: 'paused' }), 'pause');
let citizenWrite, householdWrite, companyWrite, resourceWrite;
try {
  const newHealth = citizen.health === 100 ? 99 : citizen.health + 1;
  citizenWrite = ok(await call('set_citizen_attributes', { citizen_id: citizen.entity_id, health: newHealth, wellbeing: citizen.wellbeing, education_level: citizen.education_level }), 'citizen write');
  assert.equal(ok(await call('get_citizen', { citizen_id: citizen.entity_id }), 'citizen readback').health, newHealth);
  ok(await call('set_citizen_attributes', { citizen_id: citizen.entity_id, health: citizen.health, wellbeing: citizen.wellbeing, education_level: citizen.education_level }), 'citizen restore');

  householdWrite = ok(await call('set_household_money', { household_id: household.entity_id, money: household.money + 1 }), 'household write');
  assert.equal(ok(await call('get_household', { household_id: household.entity_id }), 'household readback').money, household.money + 1);
  ok(await call('set_household_money', { household_id: household.entity_id, money: household.money }), 'household restore');

  const newProfit = company.profitability === 255 ? 254 : company.profitability + 1;
  companyWrite = ok(await call('set_company_profitability', { company_id: company.entity_id, profitability: newProfit }), 'company write');
  assert.equal(ok(await call('get_company', { company_id: company.entity_id }), 'company readback').profitability, newProfit);
  ok(await call('set_company_profitability', { company_id: company.entity_id, profitability: company.profitability }), 'company restore');

  const holder = holders.items.find(x => x.resources.some(r => r.amount >= 0)); assert.ok(holder); const held = holder.resources.find(r => r.amount >= 0);
  resourceWrite = ok(await call('set_resource_amount', { holder_id: holder.entity_id, resource: held.resource, amount: held.amount + 1 }), 'resource write');
  const holderRead = ok(await call('list_resource_holders', { resource: held.resource, limit: 100 }), 'resource readback').items.find(x => x.entity_id === holder.entity_id);
  assert.equal(holderRead.resources.find(r => r.resource === held.resource).amount, held.amount + 1);
  ok(await call('set_resource_amount', { holder_id: holder.entity_id, resource: held.resource, amount: held.amount }), 'resource restore');
} finally {
  await call('set_simulation_speed', { speed: 'paused' });
  await call('set_citizen_attributes', { citizen_id: citizen.entity_id, health: citizen.health, wellbeing: citizen.wellbeing, education_level: citizen.education_level });
  await call('set_household_money', { household_id: household.entity_id, money: household.money });
  await call('set_company_profitability', { company_id: company.entity_id, profitability: company.profitability });
  await call('set_simulation_speed', { speed: 'normal' });
}

const finalCitizen = ok(await call('get_citizen', { citizen_id: citizen.entity_id }), 'final citizen');
const finalHousehold = ok(await call('get_household', { household_id: household.entity_id }), 'final household');
const finalCompany = ok(await call('get_company', { company_id: company.entity_id }), 'final company');
assert.equal(finalCitizen.health, citizen.health); assert.equal(finalHousehold.money, household.money); assert.equal(finalCompany.profitability, company.profitability);
console.log(JSON.stringify({ bridge_version: status.bridge_version, city: status.city_name, tools: tools.tools.length, citizens: citizens.total, workers: workers.total, students: students.total, households: households.total, companies: companies.total, resource_holders: holders.total, resources: resources.total, citizen_health_round_trip: [citizenWrite.before.health, citizenWrite.after.health, finalCitizen.health], household_money_round_trip: [householdWrite.money_before, householdWrite.money, finalHousehold.money], company_profitability_round_trip: [companyWrite.profitability_before, companyWrite.profitability, finalCompany.profitability], resource_amount_round_trip: [resourceWrite.amount_before, resourceWrite.amount], final_paused: ok(await call('get_game_status'), 'final status').paused }, null, 2));
await client.close();
