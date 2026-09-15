import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function defaultEndpointPath() {
  return process.env.CSII_BRIDGE_FILE || path.join(os.homedir(), 'AppData', 'LocalLow', 'Colossal Order', 'Cities Skylines II', 'ModsData', 'CitiesSkylines2Mod', 'bridge.json');
}

export async function queryGame(tool, args = {}, options = {}) {
  let endpoint;
  try { endpoint = JSON.parse(await readFile(options.endpointPath || defaultEndpointPath(), 'utf8')); }
  catch (error) {
    throw new BridgeError(error.code === 'ENOENT' ? 'BRIDGE_NOT_FOUND' : 'INVALID_ENDPOINT',
      error.code === 'ENOENT' ? 'Game query bridge is not running. Start the game with the updated mod.' : 'Cannot read bridge endpoint metadata. Restart the game.');
  }
  if (endpoint.protocol_version !== 1 || endpoint.host !== '127.0.0.1' ||
      !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 ||
      typeof endpoint.token !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(endpoint.token)) {
    throw new BridgeError('INVALID_ENDPOINT', 'Unsupported bridge metadata. Only authenticated IPv4 loopback is allowed.');
  }
  const payload = JSON.stringify({ protocol_version: 1, token: endpoint.token, tool, arguments: args }) + '\n';
  if (Buffer.byteLength(payload) > 8192) throw new BridgeError('REQUEST_TOO_LARGE', 'Query exceeds 8192 bytes.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: endpoint.port });
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(response);
    };
    const timer = setTimeout(() => finish(new BridgeError('GAME_TIMEOUT', 'Game did not answer in time. Wait for loading to finish.')), options.timeoutMs ?? 14000);
    socket.on('connect', () => socket.write(payload));
    socket.on('error', () => finish(new BridgeError('GAME_UNAVAILABLE', 'Cannot connect to the game query bridge. It may have exited; restart the game if needed.')));
    socket.on('end', () => finish(new BridgeError('INCOMPLETE_RESPONSE', 'Game bridge closed without a complete response.')));
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return finish(new BridgeError('RESPONSE_TOO_LARGE', 'Response exceeds 2 MiB. Request fewer items.'));
      chunks.push(chunk);
      if (!chunk.includes(10)) return;
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString('utf8').split('\n')[0]);
        if (!response || typeof response.ok !== 'boolean' || (response.ok && (!response.meta || !response.data))) throw new Error('Invalid envelope');
        if (!response.ok) return finish(new BridgeError(response.error?.code || 'QUERY_FAILED', response.error?.message || 'Game query failed.'));
        finish(null, response);
      } catch { finish(new BridgeError('INVALID_RESPONSE', 'Invalid response from game query bridge.')); }
    });
  });
}
