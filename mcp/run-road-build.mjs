import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const spec = JSON.parse(process.argv[2] ?? '{}');
const previewTool = spec.preview_tool ?? 'preview_road_route';
const previewArgs = spec.preview_args;
if (!previewArgs?.request_id) throw new Error('preview_args.request_id is required');

const client = new Client({ name: 'serial-road-build', version: '0.1.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))]
}));

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent?.data ?? result.structuredContent;
};

const terminal = new Set(['failed', 'expired', 'outcome_unknown', 'cancelled']);
const waitFor = async (operationId, wanted) => {
  for (let i = 0; i < 120; i += 1) {
    const op = await call('get_road_operation', { operation_id: operationId });
    if (op.state === wanted) return op;
    if (terminal.has(op.state)) throw new Error(`STOP ${op.state} ${operationId} ${op.error ?? ''}`.trim());
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`STOP timeout ${operationId} waiting for ${wanted}`);
};

try {
  const preview = await call(previewTool, previewArgs);
  const ready = await waitFor(preview.operation_id, 'preview_ready');
  if (ready.errors?.length || ready.error) throw new Error(`STOP preview validation ${ready.operation_id}`);
  const maxCost = spec.max_cost ?? ready.cost;
  if (ready.cost > maxCost) throw new Error(`STOP cost ${ready.cost} > ${maxCost}`);
  await call('build_road', {
    operation_id: ready.operation_id,
    request_id: spec.commit_request_id,
    max_cost: maxCost
  });
  const completed = await waitFor(ready.operation_id, 'completed');
  if (!completed.created_road_ids?.length) throw new Error(`STOP no permanent roads ${ready.operation_id}`);
  console.log(JSON.stringify({
    state: completed.state,
    operation_id: completed.operation_id,
    preview_request_id: completed.request_id,
    commit_request_id: spec.commit_request_id,
    cost: completed.cost,
    errors: completed.errors ?? [],
    error: completed.error ?? null,
    created_road_ids: completed.created_road_ids
  }, null, 2));
} finally {
  await client.close();
}
