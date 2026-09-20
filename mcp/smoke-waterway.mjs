import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const client = new Client({ name: 'waterway-preview-only', version: '1' });
let operation;
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  if (!r.structuredContent?.ok) throw new Error(JSON.stringify(r.structuredContent ?? r));
  return r.structuredContent.data;
}
try {
  const args = JSON.parse(await readFile(process.argv[2], 'utf8'));
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  if (!(await call('get_game_status', {})).paused) throw new Error('Pause the city first.');
  const capabilities = await call('get_query_capabilities', {});
  if (!capabilities.tools.includes('preview_waterway')) throw new Error('Deploy the waterway-enabled mod first.');
  operation = await call('preview_waterway', args);
  for (let i = 0; i < 40 && ['queued', 'generating_preview'].includes(operation.state); i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    operation = await call('get_waterway_operation', { operation_id: operation.operation_id });
  }
  console.log(JSON.stringify(operation, null, 2));
  if (operation.state !== 'preview_ready' || !operation.can_commit || operation.errors?.length) throw new Error('Native preview did not pass.');
} finally {
  try { if (operation) console.log(JSON.stringify(await call('cancel_waterway_preview', { operation_id: operation.operation_id }))); }
  finally { await client.close(); }
}
