import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('upgrade queries forward bounded catalog options and preserve legacy defaults', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-upgrades-'));
  const requests = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let input = '';
    socket.on('data', chunk => {
      input += chunk;
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.split('\n')[0]);
      requests.push(request);
      socket.end(JSON.stringify({ ok: true, meta: { session_id: 'fixture' }, data: { args: request.arguments } }) + '\n');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpointPath = path.join(dir, 'bridge.json');
  await writeFile(endpointPath, JSON.stringify({ protocol_version: 1, host: '127.0.0.1', port: server.address().port, token: Buffer.alloc(32, 7).toString('base64') }));
  const client = new Client({ name: 'upgrade-options-test', version: '1.0' });
  t.after(async () => {
    await client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
    env: { ...process.env, CSII_BRIDGE_FILE: endpointPath, CITYWEAVER_PLANNING_STORE: path.join(dir, 'plans') } }));
  for (const [name, key] of [['list_building_upgrades', 'building_id'], ['list_transport_facility_upgrades', 'facility_id']]) {
    const owner = { [key]: 'a'.repeat(32) + ':1:1' };
    for (const args of [owner, { ...owner, include_placement_geometry: false },
      { ...owner, upgrade_prefab: 'CargoHarborComplexCrane02', include_placement_geometry: true }]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.deepEqual(requests.at(-1).arguments, { include_placement_geometry: true, ...args });
    }
    const before = requests.length;
    const invalid = await client.callTool({ name, arguments: { ...owner, upgrade_prefab: '' } });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, before, 'invalid query must not reach the game');
  }
});
