import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'economy-matrix', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? {
    ok: false,
    error: { code: 'MCP_TEXT_ERROR', message: (result.content ?? []).map(x => x.text ?? '').join('\n') }
  };
};
const requireOk = (value, label) => {
  if (!value?.ok) throw new Error(`${label}: ${JSON.stringify(value)}`);
  return value.data;
};
const runId = Date.now().toString(36);
let sequence = 0;
const requestId = label => `matrix_${runId}_${++sequence}_${label.replace(/[^a-z0-9]/gi, '_')}`;
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired', 'outcome_unknown']);
const poll = async operationId => {
  for (let i = 0; i < 200; i++) {
    const state = requireOk(await call('get_economy_operation', { operation_id: operationId }), 'poll');
    if (terminal.has(state.state)) return state;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`operation timeout: ${operationId}`);
};
const apply = async (tool, args, label) => {
  const id = requestId(label);
  const preview = requireOk(await call(tool, { request_id: id, ...args }), `${label} preview`);
  if (preview.state !== 'preview_ready') throw new Error(`${label}: unexpected preview ${preview.state}`);
  const applied = requireOk(await call('apply_economy_operation', {
    operation_id: preview.operation_id,
    request_id: id
  }), `${label} apply`);
  const done = applied.state === 'completed' ? applied : await poll(preview.operation_id);
  if (done.state !== 'completed') throw new Error(`${label}: terminal state ${done.state}`);
};
const different = (value, min, max, delta = 1) => value + delta <= max ? value + delta : value - delta >= min ? value - delta : value;
const close = (a, b) => Math.abs(a - b) < 1e-6;

const status = requireOk(await call('get_game_status'), 'status');
if (status.bridge_version !== '1.9.0' || !status.city_loaded) throw new Error(`expected loaded bridge 1.9.0: ${JSON.stringify(status)}`);
const tax0 = requireOk(await call('get_tax_settings'), 'tax baseline');
const budget0 = requireOk(await call('list_service_budgets'), 'budget baseline');
const fee0 = requireOk(await call('list_service_fees'), 'fee baseline');
const money0 = requireOk(await call('get_city_economy'), 'economy baseline').money;

const results = { passed: [], failed: [], restored: [] };
const roundTrip = async (kind, label, tool, changed, original) => {
  try {
    await apply(tool, changed, `${label}_change`);
    results.passed.push({ kind, label });
  } catch (error) {
    results.failed.push({ kind, label, phase: 'change', error: error.message });
    return;
  }
  try {
    await apply(tool, original, `${label}_restore`);
    results.restored.push({ kind, label });
  } catch (error) {
    results.failed.push({ kind, label, phase: 'restore', error: error.message });
  }
};

requireOk(await call('set_simulation_speed', { speed: 'paused' }), 'pause');
try {
  await roundTrip('main_tax', 'main', 'preview_tax_change',
    { scope: 'main', rate: different(tax0.main_rate, tax0.main_range.min, tax0.main_range.max) },
    { scope: 'main', rate: tax0.main_rate });

  for (const row of tax0.areas) {
    await roundTrip('area_tax', row.area, 'preview_tax_change',
      { scope: 'area', area: row.area, rate: different(row.rate, row.range.min, row.range.max) },
      { scope: 'area', area: row.area, rate: row.rate });
  }
  for (const row of tax0.residential_education) {
    await roundTrip('education_tax', String(row.education_level), 'preview_tax_change',
      { scope: 'residential_education', education_level: row.education_level, rate: different(row.rate, tax0.residential_education_range.min, tax0.residential_education_range.max) },
      { scope: 'residential_education', education_level: row.education_level, rate: row.rate });
  }
  for (const row of tax0.resources) {
    for (const area of ['commercial', 'industrial', 'office']) {
      if (!(area in row)) continue;
      await roundTrip('resource_tax', `${row.resource}/${area}`, 'preview_tax_change',
        { scope: 'resource', resource: row.resource, area, rate: different(row[area], tax0.resource_range.min, tax0.resource_range.max) },
        { scope: 'resource', resource: row.resource, area, rate: row[area] });
    }
  }
  for (const row of budget0.items.filter(x => x.adjustable)) {
    await roundTrip('service_budget', row.service_prefab, 'preview_service_budget',
      { service_prefab: row.service_prefab, budget_percent: different(row.budget_percent, 50, 150, 10) },
      { service_prefab: row.service_prefab, budget_percent: row.budget_percent });
  }
  for (const row of fee0.items.filter(x => x.adjustable)) {
    const delta = Math.max(row.maximum_fee / 20, 0.01);
    await roundTrip('service_fee', row.resource, 'preview_service_fee',
      { resource: row.resource, fee: different(row.fee, 0, row.maximum_fee, delta) },
      { resource: row.resource, fee: row.fee });
  }
} finally {
  await call('set_simulation_speed', { speed: 'normal' });
}

const tax1 = requireOk(await call('get_tax_settings'), 'tax final');
const budget1 = requireOk(await call('list_service_budgets'), 'budget final');
const fee1 = requireOk(await call('list_service_fees'), 'fee final');
const money1 = requireOk(await call('get_city_economy'), 'economy final').money;
const snapshot = data => JSON.stringify(data);
const taxComparable = value => ({
  main_rate: value.main_rate,
  areas: value.areas,
  residential_education: value.residential_education,
  resources: value.resources
});
const budgetComparable = value => value.items.map(x => [x.service_prefab, x.budget_percent]);
const feeComparable = value => value.items.map(x => [x.resource, x.fee]);
const baselineRestored = {
  taxes: snapshot(taxComparable(tax0)) === snapshot(taxComparable(tax1)),
  budgets: snapshot(budgetComparable(budget0)) === snapshot(budgetComparable(budget1)),
  fees: feeComparable(fee0).every(([resource, fee]) => close(feeComparable(fee1).find(x => x[0] === resource)[1], fee)),
  money: money0 === money1
};
const counts = results.passed.reduce((acc, x) => ((acc[x.kind] = (acc[x.kind] ?? 0) + 1), acc), {});
const report = {
  bridge_version: status.bridge_version,
  city: status.city_name,
  tested: results.passed.length,
  restored: results.restored.length,
  counts,
  failures: results.failed,
  baseline_restored: baselineRestored,
  money: { before: money0, after: money1 }
};
console.log(JSON.stringify(report, null, 2));
await client.close();
if (results.failed.length || !Object.values(baselineRestored).every(Boolean)) process.exitCode = 1;
