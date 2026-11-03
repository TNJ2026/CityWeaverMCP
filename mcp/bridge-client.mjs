import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from './capacity-limits.mjs';

export class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function defaultEndpointPath() {
  return process.env.CSII_BRIDGE_FILE || path.join(os.homedir(), 'AppData', 'LocalLow', 'Colossal Order', 'Cities Skylines II', 'ModsData', 'CityWeaver', 'bridge.json');
}

const endpointCache = new Map();
const ENDPOINT_CACHE_TTL_MS = 100;

async function readEndpoint(endpointPath) {
  const now = Date.now();
  const cached = endpointCache.get(endpointPath);
  if (cached && now - cached.loadedAt < ENDPOINT_CACHE_TTL_MS) return cached.endpoint;
  try {
    const endpoint = JSON.parse(await readFile(endpointPath, 'utf8'));
    endpointCache.set(endpointPath, { endpoint, loadedAt: now });
    return endpoint;
  } catch (error) {
    endpointCache.delete(endpointPath);
    throw new BridgeError(error.code === 'ENOENT' ? 'BRIDGE_NOT_FOUND' : 'INVALID_ENDPOINT',
      error.code === 'ENOENT' ? 'Game query bridge is not running. Start the game with the updated mod.' : 'Cannot read bridge endpoint metadata. Restart the game.');
  }
}

export async function queryGame(tool, args = {}, options = {}) {
  const endpointPath = options.endpointPath || defaultEndpointPath();
  let endpoint;
  endpoint = await readEndpoint(endpointPath);
  if (endpoint.protocol_version !== 1 || endpoint.host !== '127.0.0.1' ||
      !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 ||
      typeof endpoint.token !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(endpoint.token)) {
    throw new BridgeError('INVALID_ENDPOINT', 'Unsupported bridge metadata. Only authenticated IPv4 loopback is allowed.');
  }
  const payload = JSON.stringify({ protocol_version: 1, token: endpoint.token, tool, arguments: args }) + '\n';
  // Older running mods still have the original frame limits. Never send a
  // newly enlarged request until the installed bridge advertises support.
  const requestLimit = endpoint.max_request_bytes ?? 8192;
  const responseLimit = endpoint.max_response_bytes ?? 2 * 1024 * 1024;
  if (!Number.isSafeInteger(requestLimit) || requestLimit < 1024 ||
      !Number.isSafeInteger(responseLimit) || responseLimit < 1024) {
    throw new BridgeError('INVALID_ENDPOINT', 'Invalid bridge capacity metadata.');
  }
  if (Buffer.byteLength(payload) > Math.min(MAX_REQUEST_BYTES, requestLimit)) throw new BridgeError('REQUEST_TOO_LARGE', 'Query exceeds the running bridge request capacity. Update the mod or request fewer items.');
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
    socket.on('error', () => {
      endpointCache.delete(endpointPath);
      finish(new BridgeError('GAME_UNAVAILABLE', 'Cannot connect to the game query bridge. It may have exited; restart the game if needed.'));
    });
    socket.on('end', () => finish(new BridgeError('INCOMPLETE_RESPONSE', 'Game bridge closed without a complete response.')));
    socket.on('data', chunk => {
      size += chunk.length;
      if (size > Math.min(MAX_RESPONSE_BYTES, responseLimit)) return finish(new BridgeError('RESPONSE_TOO_LARGE', 'Response exceeds the bridge capacity. Request fewer items.'));
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
