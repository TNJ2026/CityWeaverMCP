// 离线校验：validateCityPlan + 实时已购格
import { readFileSync } from 'node:fs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const doc = JSON.parse(readFileSync('plans/nis-pentagon-city-plan.json', 'utf8'));
const tiles = JSON.parse(readFileSync('artifacts/nis-owned-tiles.json', 'utf8')).data.items.map((t) => ({ bounds: t.bounds }));
let issues = validateCityPlan({ purchased_tiles: tiles }, doc.plan, doc.bounds);
if (!Array.isArray(issues)) issues = issues.issues ?? issues.warnings ?? [];
console.log('return type:', Array.isArray(issues) ? 'array' : typeof issues, Array.isArray(issues) ? '' : Object.keys(issues));
const byCode = {};
for (const i of issues) byCode[i.code] = (byCode[i.code] || 0) + 1;
console.log('issues:', issues.length, JSON.stringify(byCode));
for (const i of issues) {
  if (i.code !== 'BUILDING_ROTATION_UNRESOLVED') console.log(i.code, i.severity, i.object_id, i.message);
}
