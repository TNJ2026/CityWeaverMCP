import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'cities2-expanded-smoke', version: '0.8.0' });
const report = {};
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, false, JSON.stringify(response.structuredContent || response.content));
    return response.structuredContent;
  };
  const reject = async (name, args, code) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent?.error?.code, code);
  };
  const status = await call('get_game_status');
  assert.equal(status.data.bridge_version, '1.1.0', 'Deploy and restart the updated game mod.');
  assert.equal(status.data.city_loaded, true);
  report.status = status;
  const caps = await call('get_query_capabilities');
  assert.equal(caps.data.tools.length, 38);
  assert(caps.data.component_catalog.discovered_types > 100);
  report.catalog = caps.data.component_catalog;
  const catalog = await call('list_component_types', { search: 'Citizen', limit: 100 });
  assert(catalog.data.items.some(t => t.name === 'Game.Citizens.Citizen' && t.readable));
  const schema = await call('get_component_schema', { component: 'Game.Citizens.Citizen' });
  assert(schema.data.fields.some(f => f.name === 'm_Health'));
  assert(schema.data.fields.some(f => f.name === 'm_State' && Array.isArray(f.enum_names)));
  report.city_data = (await call('get_city_data')).data;
  report.samples = {};
  const samples = {
    citizens: 'Game.Citizens.Citizen', households: 'Game.Citizens.Household', companies: 'Game.Companies.CompanyData',
    roads: 'Game.Net.Road', vehicles: 'Game.Vehicles.Vehicle', transport_lines: 'Game.Routes.TransportLine',
    districts: 'Game.Areas.District', schools: 'Game.Buildings.School', hospitals: 'Game.Buildings.Hospital',
    power_plants: 'Game.Buildings.ElectricityProducer', water_pumps: 'Game.Buildings.WaterPumpingStation'
  };
  for (const [category, component] of Object.entries(samples)) {
    const page = await call('query_entities', { category, limit: 2, include_components: [component] });
    const count = await call('count_entities', { category });
    if (status.data.paused) assert.equal(page.data.total, count.data.count);
    for (const item of page.data.items) {
      const value = item.components[component];
      assert.equal(value.present, true);
      assert(!value.status, JSON.stringify(value));
      const explicit = await call('get_entity_components', { entity_id: item.entity_id, components: [component] });
      assert.equal(explicit.data.components[component].present, true);
    }
    report.samples[category] = page.data;
  }
  const households = await call('query_entities', { category: 'households', limit: 1, include_components: ['Game.Citizens.HouseholdCitizen'], buffer_limit: 1 });
  if (households.data.items.length) {
    const house = households.data.items[0];
    const members = house.components['Game.Citizens.HouseholdCitizen'];
    if (members.present) {
      assert.equal(members.kind, 'buffer');
      assert(members.items.length <= 1);
      if (members.items.length) {
        const citizenId = members.items[0].m_Citizen;
        assert.equal(typeof citizenId, 'string');
        const citizen = await call('get_entity_components', { entity_id: citizenId, components: ['Game.Citizens.Citizen'] });
        assert.equal(citizen.data.components['Game.Citizens.Citizen'].present, true);
      }
      if (members.next_offset !== null) {
        const next = await call('get_entity_components', { entity_id: house.entity_id, components: ['Game.Citizens.HouseholdCitizen'], buffer_offset: members.next_offset, buffer_limit: 1 });
        assert.equal(next.data.components['Game.Citizens.HouseholdCitizen'].offset, members.next_offset);
      }
    }
  }
  const buildings = await call('query_entities', { category: 'buildings', all_components: ['Game.Buildings.ResidentialProperty'], limit: 1 });
  if (buildings.data.items.length) {
    const prefabId = buildings.data.items[0].prefab_entity_id;
    const prefab = await call('get_entity_components', { entity_id: prefabId, components: ['Game.Prefabs.BuildingPropertyData'] });
    report.residential_prefab = prefab.data;
    assert.equal(prefab.data.components['Game.Prefabs.BuildingPropertyData'].present, true);
    assert.equal(typeof prefab.data.components['Game.Prefabs.BuildingPropertyData'].fields.m_ResidentialProperties, 'number');
    const absent = await call('get_entity_components', { entity_id: prefabId, components: ['Game.Citizens.Citizen'] });
    assert.equal(absent.data.components['Game.Citizens.Citizen'].present, false);
  }
  if (buildings.data.next_offset !== null) {
    const next = await call('query_entities', { category: 'buildings', all_components: ['Game.Buildings.ResidentialProperty'], limit: 1, offset: buildings.data.next_offset, snapshot_id: buildings.data.snapshot_id });
    assert.notEqual(next.data.items[0]?.entity_id, buildings.data.items[0]?.entity_id);
    await reject('query_entities', { category: 'citizens', snapshot_id: buildings.data.snapshot_id }, 'INVALID_ARGUMENT');
  }
  await reject('get_component_schema', { component: 'Game.DoesNotExist' }, 'UNKNOWN_COMPONENT');
  await reject('count_entities', { category: 'citizens', none_components: ['Game.Citizens.Citizen'] }, 'INVALID_ARGUMENT');
  await reject('query_entities', { offset: 1 }, 'INVALID_ARGUMENT');
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS: expanded live MCP discovery/schema/counts/fields/buffers/entity references/prefab data/pagination/filter validation. Empty categories remain unverified for value reads.');
} finally { await client.close(); }






