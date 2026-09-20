import { readFile } from 'node:fs/promises';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const path = process.argv[2] ?? 'plans/sommerville-town-plan.json';
const plan = JSON.parse(await readFile(path, 'utf8'));

const base = validateCityPlan(
  { utilities: plan.plan.utilities ?? [] },
  { roads: plan.plan.roads, buildings: plan.plan.buildings, zones: plan.plan.zones },
  plan.bounds,
);
console.log('errors:', base.error_count, 'warnings:', base.warning_count);
for (const issue of base.issues) {
  console.log(`[${issue.severity}] ${issue.layer} ${issue.code ?? ''} :: ${issue.message}`);
  if (issue.details) console.log('    details:', JSON.stringify(issue.details).slice(0, 400));
}

// 逐栋排除，找出导致告警的建筑
console.log('\n--- 逐栋排除定位 ---');
for (const building of plan.plan.buildings) {
  const trial = plan.plan.buildings.filter(entry => entry.id !== building.id);
  const report = validateCityPlan(
    { utilities: plan.plan.utilities ?? [] },
    { roads: plan.plan.roads, buildings: trial, zones: plan.plan.zones },
    plan.bounds,
  );
  const buildingIssues = report.issues.filter(i => i.layer === 'buildings').length;
  if (buildingIssues < base.issues.filter(i => i.layer === 'buildings').length) {
    console.log(`→ 移除 ${building.id} (${building.prefab}) @ (${building.position.x}, ${building.position.z}) 后建筑告警 ${base.issues.filter(i => i.layer === 'buildings').length} → ${buildingIssues}`);
  }
}
