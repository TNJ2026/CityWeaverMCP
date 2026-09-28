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

test('local shallow water mode forwards bounded depth selection', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cityweaver-shallow-water-'));
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
  const args = { request_id: 'shallow-water-test', mode: 'clear_shallow_water', points: [{x: 10, z: 20}], brush_size_m: 100, max_water_depth_m: 0.3 };
  const result = await client.callTool({name: 'preview_terrain', arguments: args});
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(requests.at(-1).arguments.mode, args.mode);
  assert.equal(requests.at(-1).arguments.max_water_depth_m, 0.3);
  assert.deepEqual(requests.at(-1).arguments.points, args.points);
  for (const max_water_depth_m of [0, -1, 2.01]) {
    const count = requests.length;
    const invalid = await client.callTool({name: 'preview_terrain', arguments: {...args, max_water_depth_m}});
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, count);
  }
});
