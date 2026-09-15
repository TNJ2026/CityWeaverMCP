import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'cities2-native-probe', version: '1.0.0' });
const report = { fields: [], failures: [], limitations: [] };
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
    return r.structuredContent.data;
  };
  report.status = await call('get_game_status');
  for (const name of ['ResidentialDemandSystem', 'CommercialDemandSystem', 'IndustrialDemandSystem']) {
    const system = `Game.Simulation.${name}`;
    const schema = await call('get_system_schema', { system });
    for (const f of schema.fields.filter(f => /NativeArray|NativeList|NativeValue|NativeReference|Native.*Hash|NativeQueue|BlobAssetReference/.test(f.type))) {
      try {
        const result = await call('read_system_data', { system, field_path: [f.name], limit: 2 });
        const item = { system, field: f.name, type: f.type, value: result.value };
        if (result.value?.status === 'unavailable') report.limitations.push(item);
        else report.fields.push(item);
      } catch (e) { report.failures.push({ system, field: f.name, error: e.message }); }
    }
  }
  const entities = await call('query_entities', { category: 'citizens', limit: 1 });
  assert(entities.items.length > 0);
  const entity_id = entities.items[0].entity_id;
  const components = await call('get_entity_components', { entity_id, components: ['Game.Citizens.Citizen'] });
  const selected = await call('read_entity_field', { entity_id, component: 'Game.Citizens.Citizen', field_path: ['m_Health'] });
  assert.equal(typeof selected.value, 'number');
  report.entity_field = selected;
  report.entity_components = components;
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
} finally { await client.close(); }
