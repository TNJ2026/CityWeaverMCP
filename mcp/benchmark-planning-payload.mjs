import { readFile } from 'node:fs/promises';
import { compactResult } from './planning-store.mjs';

const files = process.argv.slice(2);
if (!files.length) throw new Error('Provide one or more JSON files containing bounds and plan. No game connection is used.');
const reports = [];
const bytes = value => Buffer.byteLength(JSON.stringify(value));
for (const file of files) {
  const input = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  if (!input.bounds || !input.plan) throw new Error(`${file} must contain bounds and plan.`);
  const legacy = { action: 'preview_batch', batch_id: 'road-batch-07', bounds: input.bounds, plan: input.plan, approved_plan_id: 'cplan-' + 'a'.repeat(16), expected_session_id: 'b'.repeat(32), request_id: 'payload_benchmark_preview' };
  const handle = { action: 'preview_batch', batch_id: 'road-batch-07', construction_id: 'construction-' + 'c'.repeat(64), state_version: 7 };
  const oldResult = { state: 'preview_ready', plan: input.plan, next_action: { tool: 'advance_city_plan_construction', arguments: legacy } };
  const newResult = { ...compactResult({ ...oldResult, next_action: { tool: 'advance_city_plan_construction', arguments: handle } }), evidence_ref: 'evidence-' + 'd'.repeat(64) };
  reports.push({ file, request_before_bytes: bytes(legacy), request_after_bytes: bytes(handle), request_reduction_percent: +(100 * (1 - bytes(handle) / bytes(legacy))).toFixed(2), example_response_before_bytes: bytes(oldResult), example_response_after_bytes: bytes(newResult) });
}
console.log(JSON.stringify({ kind: 'offline_protocol_payload_comparison', token_count: null, note: 'Measures JSON bytes with the same source plan, not actual model tokens, tool latency, or an end-to-end game run.', reports }, null, 2));
