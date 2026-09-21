// Diagnostic CLI: uses the same MCP handshake and tools as any compatible Agent client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] || 'get_game_status';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const client = new Client({ name: 'cities2-query', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const result = await client.callTool({ name, arguments: args });
  console.log(JSON.stringify(result.structuredContent || result.content, null, 2));
  if (result.isError) process.exitCode = 1;
} finally { await client.close(); }
