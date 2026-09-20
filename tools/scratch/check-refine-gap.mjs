import { readFile } from 'node:fs/promises';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const plan = JSON.parse(await readFile('plans/sommerville-town-plan.json', 'utf8'));
const { roads, buildings, zones } = plan.plan;

const show = (label, report) => {
  console.log(`\n### ${label}: errors=${report.error_count} warnings=${report.warning_count}`);
  for (const issue of report.issues) console.log(`  [${issue.severity}] ${issue.layer} ${issue.code ?? ''} :: ${issue.message}`);
};

show('完整（含 zones + utilities）', validateCityPlan({ utilities: plan.plan.utilities ?? [] }, { roads, buildings, zones }, plan.bounds));
show('refine 口径（zones:[] utilities:[]）', validateCityPlan({ utilities: [] }, { roads, buildings, zones: [] }, plan.bounds));
