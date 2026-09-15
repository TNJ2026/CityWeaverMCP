import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'cities2-deep-smoke', version: '0.8.0' });
const report = {};
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, false, JSON.stringify(response.structuredContent));
    return response.structuredContent.data;
  };
  const status = await call('get_game_status');
  assert.equal(status.bridge_version, '1.1.0'); assert.equal(status.city_loaded, true);
  assert.equal((await client.listTools()).tools.length, 38);
  const systems = await call('list_game_systems', { search: 'ResidentialDemand' });
  assert(systems.items.length > 0);
  const system = systems.items[0].system;
  const schema = await call('get_system_schema', { system });
  assert(schema.fields.some(f => f.visibility === 'non_public'));
  const field = schema.fields.find(f => f.name === 'm_LowDemandFactors');
  assert(field, 'Expected demand factor array');
  const factors = await call('read_system_data', { system, field_path: [field.name], limit: 2 });
  assert(Array.isArray(factors.value.items)); assert(factors.value.length > 0);
  report.demand = factors;
  const layers = await call('list_environment_layers');
  assert(layers.items.length >= 10);
  report.grids = [];
  report.grid_errors = [];
  for (const layer of layers.items) {
    try {
    const grid = await call('read_environment_grid', { system: layer.system, limit: 2 });
    assert(grid.resolution.x > 0 && grid.resolution.y > 0);
    assert.equal(grid.cells.length, grid.resolution.x * grid.resolution.y);
    assert.equal(grid.cells.items.length, 2);
    assert.equal(grid.cells.next_offset, 2);
    const second = await call('read_environment_grid', { system: layer.system, offset: 2, limit: 1 });
    assert.equal(second.cells.offset, 2); assert.equal(second.cells.items.length, 1);
    report.grids.push({ system: layer.system, length: grid.cells.length, sample: grid.cells.items });
    } catch (error) { report.grid_errors.push({ system: layer.system, error: error.message }); }
  }
  const response = await client.callTool({ name: 'read_system_data', arguments: { system, field_path: ['missing_field_for_test'] } });
  assert.equal(response.isError, true); assert.equal(response.structuredContent.error.code, 'FIELD_NOT_FOUND');
  console.log(JSON.stringify({ passed: report.grid_errors.length === 0, ...report }, null, 2));
  if (report.grid_errors.length) process.exitCode = 1;
} finally { await client.close(); }




