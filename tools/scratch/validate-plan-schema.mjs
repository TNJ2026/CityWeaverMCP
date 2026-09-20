// 离线预检：用 MCP 服务器真实注册的工具 inputSchema 校验将要提交的参数。
//   node tools/scratch/validate-plan-schema.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv = require('../../mcp/node_modules/ajv');

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const base = JSON.parse(await readFile(path.join(ROOT, 'plans', 'peiqi-pentagon-city-plan.json'), 'utf8'));

function stagePlan(name) {
  const plan = structuredClone(base.plan);
  plan.zones = [];
  plan.tracks = [];
  if (name === 'roads') { plan.buildings = []; plan.utilities = []; }
  else if (name === 'buildings') {
    for (const road of plan.roads) road.construction_status = 'completed';
    for (const grid of plan.grids) grid.construction_status = 'completed';
    plan.utilities = [];
  } else if (name === 'utilities') {
    for (const road of plan.roads) road.construction_status = 'completed';
    for (const grid of plan.grids) grid.construction_status = 'completed';
    for (const building of plan.buildings) building.construction_status = 'completed';
  }
  return plan;
}

const client = new Client({ name: 'plan-schema-precheck', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const list = await client.listTools();
  const schemas = new Map(list.tools.map((t) => [t.name, t.inputSchema]));
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const report = [];

  const summarize = (errors) => {
    const counts = new Map();
    for (const error of errors) {
      const pathText = (error.instancePath || '/').replace(/\/\d+/g, '/[]');
      const key = `${pathText} ${error.message}${error.params?.additionalProperty ? ` (${error.params.additionalProperty})` : ''}${error.params?.allowedValues ? ` [${error.params.allowedValues.join('|')}]` : ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => `${count}x ${key}`);
  };
  const check = (label, tool, args) => {
    const schema = schemas.get(tool);
    if (!schema) { report.push({ label, tool, error: 'tool schema not found' }); return; }
    const validate = ajv.compile(schema);
    const ok = validate(args);
    report.push({ label, tool, ok, errors: ok ? [] : summarize(validate.errors ?? []) });
  };

  for (const stage of ['roads', 'buildings', 'utilities']) {
    const plan = stagePlan(stage);
    check(`${stage}:render`, 'render_city_plan', {
      bounds: base.bounds,
      render: { ...(base.render ?? {}), title: `schema check ${stage}` },
      water_cell_size_m: base.water_cell_size_m ?? 8,
      terrain_cell_size_m: base.terrain_cell_size_m ?? 64,
      plan,
    });
    check(`${stage}:prepare`, 'prepare_city_plan_construction', {
      bounds: base.bounds, plan, approved_plan_id: 'cplan-0000000000000000',
    });
    check(`${stage}:advance`, 'advance_city_plan_construction', {
      action: 'preview_batch', bounds: base.bounds, plan, approved_plan_id: 'cplan-0000000000000000',
      batch_id: 'x', request_id: 'precheck_0001', operation_timeout_ms: 120000,
    });
  }
  check('bind', 'bind_city_plan_buildings', {
    request_id: 'precheck_bind_0001', bounds: base.bounds, plan: stagePlan('buildings'),
    search_radius_m: 256, road_side: 'either', candidate_count: 8, max_preview_attempts: 8,
    operation_timeout_ms: 120000, continue_on_error: true,
  });

  console.log(JSON.stringify(report, null, 1));
  console.log(report.every((r) => r.ok) ? 'ALL SCHEMA CHECKS PASS' : 'SCHEMA ERRORS PRESENT');
} finally {
  await client.close();
}
