import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const route = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
const client = new Client({ name: 'cities2-road-preview-test', version: '0.8.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, false, JSON.stringify(r.structuredContent)); return r.structuredContent.data;
  };
  const reject = async (name, args, code) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, true); assert.equal(r.structuredContent.error.code, code);
  };
  const wait = async (operation_id, desired) => {
    for (let i = 0; i < 60; i++) {
      const op = await call('get_road_operation', { operation_id });
      if (op.state === desired) return op;
      assert(!['failed', 'outcome_unknown', 'expired'].includes(op.state), JSON.stringify(op));
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Road preview state timeout');
  };
  assert.equal((await call('get_game_status')).paused, true);
  const before = await call('get_city_summary');
  const beforeCount = await call('count_entities', { category: 'roads', all_components: ['Game.Net.Edge'] });
  const preview = await call('preview_road', route);
  const op = await wait(preview.operation_id, 'preview_ready');
  assert.equal((await call('preview_road', route)).operation_id, op.operation_id);
  await reject('preview_road', { ...route, end: { ...route.end, x: route.end.x + 1 } }, 'IDEMPOTENCY_CONFLICT');
  assert(op.cost > 0, 'Expected nonzero construction cost for the budget rejection test');
  await reject('build_road', { operation_id: op.operation_id, request_id: 'budget-reject-test', max_cost: op.cost - 1 }, 'COST_LIMIT');
  assert.equal((await call('get_road_operation', { operation_id: op.operation_id })).commit_dispatched, false);
  await call('cancel_road_preview', { operation_id: op.operation_id });
  const cancelled = await wait(op.operation_id, 'cancelled');
  await reject('build_road', { operation_id: op.operation_id, request_id: 'cancelled-commit-test', max_cost: op.cost }, 'ROAD_NOT_READY');
  const after = await call('get_city_summary');
  const afterCount = await call('count_entities', { category: 'roads', all_components: ['Game.Net.Edge'] });
  assert.equal(after.money, before.money, 'Preview/cancel must not charge money');
  assert.deepEqual(afterCount, beforeCount, 'Preview/cancel must not add permanent roads');
  console.log(JSON.stringify({ passed: true, preview: op, cancelled, money_before: before.money, money_after: after.money, road_count: afterCount }, null, 2));
} finally { await client.close(); }
