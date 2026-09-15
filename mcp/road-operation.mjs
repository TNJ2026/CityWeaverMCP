// Usage: node road-operation.mjs preview route.json
//        node road-operation.mjs status OPERATION_ID
//        node road-operation.mjs cancel OPERATION_ID
//        node road-operation.mjs build OPERATION_ID REQUEST_ID MAX_COST
// This helper never silently creates a new request ID or retries a mutation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const client = new Client({ name: 'cities2-road-operation', version: '0.8.0' });
const [mode, first, request_id, cost] = process.argv.slice(2);
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(JSON.stringify(r.structuredContent ?? r.content));
    return r.structuredContent;
  };
  let result;
  if (mode === 'preview') {
    const input = JSON.parse((await readFile(first, 'utf8')).replace(/^\uFEFF/, ''));
    const tool = input.edge_id ? (input.road_prefab ? 'preview_road_upgrade' : 'preview_road_demolition') : Array.isArray(input.points) ? 'preview_road_route' : 'preview_road';
    result = await call(tool, input);
  }
  else if (mode === 'build') result = await call('build_road', { operation_id: first, request_id, max_cost: Number(cost) });
  else if (mode === 'cancel') result = await call('cancel_road_preview', { operation_id: first });
  else if (mode === 'status') result = await call('get_road_operation', { operation_id: first });
  else throw new Error('Choose preview, status, cancel or build.');
  console.log(JSON.stringify(result, null, 2));
  const waiting = new Set(['queued', 'generating_preview', 'commit_queued', 'applying']);
  const started = Date.now();
  while ((waiting.has(result.data.state) || mode === 'cancel' && !['cancelled', 'failed', 'expired', 'completed', 'outcome_unknown'].includes(result.data.state)) && Date.now() - started < 25000) {
    await new Promise(resolve => setTimeout(resolve, 400));
    result = await call('get_road_operation', { operation_id: result.data.operation_id });
  }
  console.log(JSON.stringify({ final_poll: result }, null, 2));
  if (['failed', 'outcome_unknown', 'expired'].includes(result.data.state)) process.exitCode = 1;
} finally { await client.close(); }

