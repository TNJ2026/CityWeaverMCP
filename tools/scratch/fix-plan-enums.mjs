// 一次性：把生成器里不符合 MCP schema 的枚举值改成合法值。
//   node tools/scratch/fix-plan-enums.mjs
import { readFile, writeFile } from 'node:fs/promises';

const target = 'tools/scratch/generate-pentagon-city-plan.mjs';
const original = await readFile(target, 'utf8');
const rules = [
  ["planning_status: 'conceptually_bound'", "planning_status: 'conceptual'"],
  ["category: 'emergency'", "category: 'city_service'"],
  ["category: 'deathcare'", "category: 'city_service'"],
  ["category: 'garbage'", "category: 'city_service'"],
];
let text = original;
const applied = [];
for (const [from, to] of rules) {
  const count = text.split(from).length - 1;
  if (!count) { applied.push(`${from} -> NOT FOUND`); continue; }
  text = text.split(from).join(to);
  applied.push(`${count}x ${from} -> ${to}`);
}
// 建筑的 district 不是 schema 字段：改为仅在内部保留，输出时剥离。
text = text.replace(
  "    size_m: { x: spec.size[0], z: spec.size[1] },\n    reserved_size_m: { x: spec.size[0] + 4, z: spec.size[1] + 4 },\n    district: siteLabel,\n  });",
  "    size_m: { x: spec.size[0], z: spec.size[1] },\n    reserved_size_m: { x: spec.size[0] + 4, z: spec.size[1] + 4 },\n    site_label: siteLabel,\n  });",
);
if (text === original) throw new Error('没有任何替换生效');
await writeFile(target, text, 'utf8');
console.log(JSON.stringify({ applied, districtRemoved: text.includes('site_label: siteLabel') }, null, 2));
