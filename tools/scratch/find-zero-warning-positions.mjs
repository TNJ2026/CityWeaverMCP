import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = path.join(repoRoot, 'plans', 'meridian-circular-town-plan.json');
const planData = JSON.parse(fs.readFileSync(planPath, 'utf8'));

for (const b of planData.plan.buildings) {
  b.placement_status = 'candidate_bound';
  b.rotation_source = 'manual';
}

const pos = JSON.parse(fs.readFileSync(path.join(repoRoot, 'artifacts', '_optimal_positions.json'), 'utf8'));
for (const b of planData.plan.buildings) {
  if (pos[b.id]) {
    b.position.x = pos[b.id].x;
    b.position.z = pos[b.id].z;
  }
}

// 目标：依次将有 issue 的建筑放到全局 0 issue 的位置
const problematic = [
  'bld-fire-station-hq',
  'bld-central-park',
  'bld-road-maintenance',
  'bld-high-school-nw'
];

for (const id of problematic) {
  const b = planData.plan.buildings.find(x => x.id === id);
  // 先把这栋建筑移到很远的地方，避免干扰其他建筑
  b.position.x = 9999;
  b.position.z = 9999;
}

for (const id of problematic) {
  const b = planData.plan.buildings.find(x => x.id === id);
  let found = false;
  // 在合理的区域步长 4m 搜索
  let searchRanges = [];
  if (id === 'bld-fire-station-hq') {
    // 核心区内东南侧或者东北侧
    searchRanges.push({ minX: 40, maxX: 200, minZ: 1040, maxZ: 1200 });
    searchRanges.push({ minX: 40, maxX: 200, minZ: 850, maxZ: 1000 });
  } else if (id === 'bld-central-park') {
    // 核心区绿地
    searchRanges.push({ minX: -200, maxX: 200, minZ: 850, maxZ: 1200 });
  } else if (id === 'bld-road-maintenance') {
    // 东北产业区
    searchRanges.push({ minX: 250, maxX: 700, minZ: 1050, maxZ: 1550 });
  } else if (id === 'bld-high-school-nw') {
    // 西北居住区
    searchRanges.push({ minX: -700, maxX: -250, minZ: 1050, maxZ: 1550 });
  }

  outer: for (const range of searchRanges) {
    for (let x = range.minX; x <= range.maxX; x += 4) {
      for (let z = range.minZ; z <= range.maxZ; z += 4) {
        b.position.x = x;
        b.position.z = z;
        const res = validateCityPlan({ bounds: planData.bounds }, planData.plan, planData.bounds);
        const myIssues = res.issues.filter(i => i.object_id === id || (i.related_object_ids && i.related_object_ids.includes(id))).length;
        if (myIssues === 0) {
          console.log(`[FOUND 0 ISSUES] ${id} at (${x}, ${z})`);
          found = true;
          break outer;
        }
      }
    }
  }
  if (!found) {
    console.log(`[FAILED TO FIND 0 ISSUES] ${id}`);
  }
}

const finalRes = validateCityPlan({ bounds: planData.bounds }, planData.plan, planData.bounds);
console.log(`Final issues count: ${finalRes.issues.length}`);
for (const i of finalRes.issues) {
  console.log(i.code, i.object_id, i.message);
}

// 保存最终位置
for (const b of planData.plan.buildings) {
  pos[b.id] = { x: b.position.x, z: b.position.z };
}
fs.writeFileSync(path.join(repoRoot, 'artifacts', '_optimal_positions.json'), JSON.stringify(pos, null, 2));
