import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'cities2-road-discovery-test', version: '0.8.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
    return result.structuredContent.data;
  };
  const status = await call('get_game_status');
  assert.equal(status.city_loaded, true);
  assert.equal(status.bridge_version, '1.1.0');
  const report = { checked: 0, locked: 0, unlocked: 0 };
  for (let offset = 0; offset !== null;) {
    const page = await call('list_road_prefabs', { offset, limit: 100 });
    for (const item of page.items) {
      const entity = await call('get_entity_components', { entity_id: item.prefab_entity_id, components: ['Game.Prefabs.Locked'] });
      const locked = entity.components['Game.Prefabs.Locked'];
      assert.equal(item.locked, locked.present && locked.enabled === true, `${item.name}: lock flag must respect enabled state`);
      report.checked++; report[item.locked ? 'locked' : 'unlocked']++;
    }
    offset = page.next_offset;
  }
  assert(report.unlocked > 0, 'Expected at least the basic road to be unlocked');
  console.log(JSON.stringify({ passed: true, ...report }, null, 2));
} finally { await client.close(); }
