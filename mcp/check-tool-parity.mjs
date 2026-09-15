import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { queryGame } from './bridge-client.mjs';

const client = new Client({ name: 'tool-parity', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./server.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1')] }));
try {
  const server = (await client.listTools()).tools.map(x => x.name).sort();
  const game = [...(await queryGame('get_query_capabilities', {})).data.tools].sort();
  console.log(JSON.stringify({ server: server.length, game: game.length, missingInGame: server.filter(x => !game.includes(x)), missingInServer: game.filter(x => !server.includes(x)) }, null, 2));
} finally { await client.close(); }
