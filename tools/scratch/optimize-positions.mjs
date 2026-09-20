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

function optimizeBuilding(b, minX, maxX, minZ, maxZ) {
  let bestX = b.position.x, bestZ = b.position.z;
  let minIssues = 999;
  for (let x = minX; x <= maxX; x += 8) {
    for (let z = minZ; z <= maxZ; z += 8) {
      b.position.x = x;
      b.position.z = z;
      const res = validateCityPlan({ bounds: planData.bounds }, planData.plan, planData.bounds);
      const myIssues = res.issues.filter(i => i.object_id === b.id || (i.related_object_ids && i.related_object_ids.includes(b.id))).length;
      if (myIssues === 0) {
        return { x, z, issues: 0 };
      }
      if (myIssues < minIssues) {
        minIssues = myIssues;
        bestX = x;
        bestZ = z;
      }
    }
  }
  return { x: bestX, z: bestZ, issues: minIssues };
}

const order = [
  { id: 'bld-city-hall', minX: -220, maxX: -70, minZ: 1100, maxZ: 1250 },
  { id: 'bld-general-hospital', minX: 70, maxX: 220, minZ: 1100, maxZ: 1250 },
  { id: 'bld-college', minX: -220, maxX: -70, minZ: 800, maxZ: 940 },
  { id: 'bld-police-hq', minX: 70, maxX: 220, minZ: 800, maxZ: 940 },
  { id: 'bld-fire-station-hq', minX: 60, maxX: 220, minZ: 1040, maxZ: 1140 },
  { id: 'bld-welfare-office', minX: -220, maxX: -60, minZ: 1040, maxZ: 1140 },
  { id: 'bld-central-park', minX: -200, maxX: 200, minZ: 850, maxZ: 1200 },

  { id: 'bld-substation-ne', minX: 580, maxX: 750, minZ: 1060, maxZ: 1200 },
  { id: 'bld-water-pump-ne', minX: 580, maxX: 750, minZ: 1150, maxZ: 1300 },
  { id: 'bld-sewage-treatment', minX: 650, maxX: 780, minZ: 1250, maxZ: 1400 },
  { id: 'bld-water-tower-ne', minX: 420, maxX: 540, minZ: 1220, maxZ: 1350 },
  { id: 'bld-recycling-center', minX: 580, maxX: 750, minZ: 1400, maxZ: 1650 },
  { id: 'bld-road-maintenance', minX: 280, maxX: 450, minZ: 1220, maxZ: 1380 },

  { id: 'bld-bus-terminal-se', minX: 580, maxX: 750, minZ: 850, maxZ: 980 },
  { id: 'bld-post-office-se', minX: 420, maxX: 540, minZ: 850, maxZ: 980 },
  { id: 'bld-parking-hall-se', minX: 340, maxX: 450, minZ: 850, maxZ: 980 },
  { id: 'bld-park-maintenance-se', minX: 420, maxX: 540, minZ: 680, maxZ: 800 },

  { id: 'bld-elem-school-sw', minX: -520, maxX: -400, minZ: 860, maxZ: 980 },
  { id: 'bld-clinic-sw', minX: -400, maxX: -320, minZ: 860, maxZ: 980 },
  { id: 'bld-fire-house-sw', minX: -540, maxX: -450, minZ: 860, maxZ: 980 },
  { id: 'bld-community-park-sw', minX: -500, maxX: -380, minZ: 680, maxZ: 800 },
  { id: 'bld-cemetery-sw', minX: -650, maxX: -500, minZ: 600, maxZ: 750 },

  { id: 'bld-elem-school-nw', minX: -520, maxX: -400, minZ: 1060, maxZ: 1180 },
  { id: 'bld-high-school-nw', minX: -560, maxX: -460, minZ: 1060, maxZ: 1180 },
  { id: 'bld-police-station-nw', minX: -400, maxX: -320, minZ: 1060, maxZ: 1180 },
  { id: 'bld-city-park-nw', minX: -500, maxX: -360, minZ: 1240, maxZ: 1380 }
];

for (const item of order) {
  const b = planData.plan.buildings.find(x => x.id === item.id);
  if (b) {
    const opt = optimizeBuilding(b, item.minX, item.maxX, item.minZ, item.maxZ);
    b.position.x = opt.x;
    b.position.z = opt.z;
    console.log(`Building ${b.id}: (${opt.x}, ${opt.z}) issues=${opt.issues}`);
  }
}

const finalRes = validateCityPlan({ bounds: planData.bounds }, planData.plan, planData.bounds);
console.log(`FINAL: valid=${finalRes.valid}, errors=${finalRes.error_count}, warnings=${finalRes.warning_count}`);

const positionsObj = {};
for (const b of planData.plan.buildings) {
  positionsObj[b.id] = { x: b.position.x, z: b.position.z };
}
fs.writeFileSync(path.join(repoRoot, 'artifacts', '_optimal_positions.json'), JSON.stringify(positionsObj, null, 2));
