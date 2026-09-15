import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'economy-live', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent ?? { ok: false, error: (result.content ?? []).map(x => x.text ?? '').join('\n') };
};
const runId = Date.now().toString(36);
const request = suffix => `econ_${runId}_${suffix}`;
const poll = async operationId => {
  for (let i = 0; i < 200; i++) {
    const state = await call('get_economy_operation', { operation_id: operationId });
    if (!state.ok) throw new Error(JSON.stringify(state));
    if (['completed','failed','cancelled','expired','outcome_unknown'].includes(state.data.state)) return state.data;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timeout: ${operationId}`);
};
const change = async (tool, args, suffix) => {
  const requestId = request(suffix);
  const preview = await call(tool, { request_id: requestId, ...args });
  if (!preview.ok || preview.data.state !== 'preview_ready') throw new Error(JSON.stringify(preview));
  const applied = await call('apply_economy_operation', { operation_id: preview.data.operation_id, request_id: requestId });
  if (!applied.ok) throw new Error(JSON.stringify(applied));
  const done = applied.data.state === 'completed' ? applied.data : await poll(preview.data.operation_id);
  if (done.state !== 'completed') throw new Error(JSON.stringify(done));
  return done;
};

const taxes0 = (await call('get_tax_settings')).data;
const budgets0 = (await call('list_service_budgets')).data;
const fees0 = (await call('list_service_fees')).data;
const loan0 = (await call('get_loan_status')).data.current.amount;
const money0 = (await call('get_city_economy')).data.money;
const main0 = taxes0.main_rate;
const residential0 = taxes0.areas.find(x => x.area === 'residential').rate;
const education0 = taxes0.residential_education.find(x => x.education_level === 2).rate;
const beverage0 = taxes0.resources.find(x => x.resource === 'Beverages').commercial;
const roads0 = budgets0.items.find(x => x.service_prefab === 'Roads').budget_percent;
const electricity0 = fees0.items.find(x => x.resource === 'electricity').fee;
const chooseDifferent = (oldValue, min, max, delta = 1) => oldValue + delta <= max ? oldValue + delta : oldValue - delta >= min ? oldValue - delta : oldValue;
const results = {};

await call('set_simulation_speed', { speed: 'paused' });
try {
  const cancelRequest = request('cancel');
  const cancelledPreview = await call('preview_tax_change', { request_id: cancelRequest, scope: 'main', rate: chooseDifferent(main0, taxes0.main_range.min, taxes0.main_range.max) });
  results.cancel = (await call('cancel_economy_preview', { operation_id: cancelledPreview.data.operation_id })).data.state;

  const conflictARequest = request('conflict_a');
  const conflictBRequest = request('conflict_b');
  const conflictValue = chooseDifferent(main0, taxes0.main_range.min, taxes0.main_range.max);
  const conflictA = await call('preview_tax_change', { request_id: conflictARequest, scope: 'main', rate: conflictValue });
  const conflictB = await call('preview_tax_change', { request_id: conflictBRequest, scope: 'main', rate: chooseDifferent(main0, taxes0.main_range.min, taxes0.main_range.max, 2) });
  await call('set_simulation_speed', { speed: 'normal' });
  results.running_rejection = (await call('apply_economy_operation', { operation_id: conflictA.data.operation_id, request_id: conflictARequest })).error?.code;
  await call('set_simulation_speed', { speed: 'paused' });
  const firstApply = await call('apply_economy_operation', { operation_id: conflictA.data.operation_id, request_id: conflictARequest });
  results.idempotent = (await call('apply_economy_operation', { operation_id: conflictA.data.operation_id, request_id: conflictARequest })).data.state;
  results.conflict = (await call('apply_economy_operation', { operation_id: conflictB.data.operation_id, request_id: conflictBRequest })).error?.code;
  await change('preview_tax_change', { scope: 'main', rate: main0 }, 'restore_conflict_main');

  results.main = (await change('preview_tax_change', { scope: 'main', rate: chooseDifferent(main0, taxes0.main_range.min, taxes0.main_range.max) }, 'main')).state;
  await change('preview_tax_change', { scope: 'main', rate: main0 }, 'main_restore');
  results.area = (await change('preview_tax_change', { scope: 'area', area: 'residential', rate: chooseDifferent(residential0, -10, 30) }, 'area')).state;
  await change('preview_tax_change', { scope: 'area', area: 'residential', rate: residential0 }, 'area_restore');
  results.education = (await change('preview_tax_change', { scope: 'residential_education', education_level: 2, rate: chooseDifferent(education0, -10, 30) }, 'education')).state;
  await change('preview_tax_change', { scope: 'residential_education', education_level: 2, rate: education0 }, 'education_restore');
  results.resource = (await change('preview_tax_change', { scope: 'resource', area: 'commercial', resource: 'Beverages', rate: chooseDifferent(beverage0, -10, 30) }, 'resource')).state;
  await change('preview_tax_change', { scope: 'resource', area: 'commercial', resource: 'Beverages', rate: beverage0 }, 'resource_restore');

  results.budget = (await change('preview_service_budget', { service_prefab: 'Roads', budget_percent: chooseDifferent(roads0, 50, 150, 10) }, 'budget')).state;
  await change('preview_service_budget', { service_prefab: 'Roads', budget_percent: roads0 }, 'budget_restore');
  results.fee = (await change('preview_service_fee', { resource: 'electricity', fee: chooseDifferent(electricity0, 0, .4, .05) }, 'fee')).state;
  await change('preview_service_fee', { resource: 'electricity', fee: electricity0 }, 'fee_restore');

  const loanTest = Math.min(100000, (await call('get_loan_status')).data.credit_limit);
  results.borrow = (await change('preview_loan_change', { amount: loanTest }, 'borrow')).state;
  results.repay = (await change('preview_loan_change', { amount: loan0 }, 'repay')).state;
} finally {
  await call('set_simulation_speed', { speed: 'paused' });
  const taxes = (await call('get_tax_settings')).data;
  if (taxes.main_rate !== main0) await change('preview_tax_change', { scope: 'main', rate: main0 }, 'finally_main');
  const area = taxes.areas.find(x => x.area === 'residential').rate;
  if (area !== residential0) await change('preview_tax_change', { scope: 'area', area: 'residential', rate: residential0 }, 'finally_area');
  const education = taxes.residential_education.find(x => x.education_level === 2).rate;
  if (education !== education0) await change('preview_tax_change', { scope: 'residential_education', education_level: 2, rate: education0 }, 'finally_education');
  const beverage = taxes.resources.find(x => x.resource === 'Beverages').commercial;
  if (beverage !== beverage0) await change('preview_tax_change', { scope: 'resource', area: 'commercial', resource: 'Beverages', rate: beverage0 }, 'finally_resource');
  const roads = (await call('list_service_budgets')).data.items.find(x => x.service_prefab === 'Roads').budget_percent;
  if (roads !== roads0) await change('preview_service_budget', { service_prefab: 'Roads', budget_percent: roads0 }, 'finally_budget');
  const electricity = (await call('list_service_fees')).data.items.find(x => x.resource === 'electricity').fee;
  if (Math.abs(electricity - electricity0) > .0001) await change('preview_service_fee', { resource: 'electricity', fee: electricity0 }, 'finally_fee');
  const loan = (await call('get_loan_status')).data.current.amount;
  if (loan !== loan0) await change('preview_loan_change', { amount: loan0 }, 'finally_loan');
  const finalTaxes = (await call('get_tax_settings')).data;
  const finalBudget = (await call('list_service_budgets')).data.items.find(x => x.service_prefab === 'Roads').budget_percent;
  const finalFee = (await call('list_service_fees')).data.items.find(x => x.resource === 'electricity').fee;
  const finalLoan = (await call('get_loan_status')).data.current.amount;
  const finalMoney = (await call('get_city_economy')).data.money;
  await call('set_simulation_speed', { speed: 'normal' });
  console.log('RESULTS', JSON.stringify(results));
  console.log('BASELINE_RESTORED', JSON.stringify({
    main: finalTaxes.main_rate === main0,
    area: finalTaxes.areas.find(x => x.area === 'residential').rate === residential0,
    education: finalTaxes.residential_education.find(x => x.education_level === 2).rate === education0,
    resource: finalTaxes.resources.find(x => x.resource === 'Beverages').commercial === beverage0,
    budget: finalBudget === roads0,
    fee: Math.abs(finalFee - electricity0) < .0001,
    loan: finalLoan === loan0,
    money: finalMoney === money0,
    values: { main0, residential0, education0, beverage0, roads0, electricity0, loan0, money0, finalMoney }
  }));
  await client.close();
}
