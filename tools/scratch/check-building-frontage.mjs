// 检查所有公共服务/市政建筑是否真的挨着道路：
// ① 占地矩形到全镇路网的最小距离（临街间隙 = 该距离 − 路宽一半）；
// ② 声明的 roadside_of 是否确实是最近的道路；
// ③ WaterTower01 / WindTurbine01 是无需路 prefab，单列说明。
import { readFile } from 'node:fs/promises';

const path = process.argv[2] ?? 'plans/sommerville-town-plan.json';
const plan = JSON.parse(await readFile(path, 'utf8'));
const { buildings, roads } = plan.plan;

const NO_ROAD_NEEDED = new Set(['WaterTower01', 'WindTurbine01', 'WindTurbine02', 'WindTurbine03']);

function pointSegDist(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

function rectEdgeDist(rect, road) {
  // 矩形边到折线的最小距离：对折线每段求「段到矩形」的距离（中心距 − 内切半宽近似，
  // 精确做法：把段裁剪进矩形外接框后取段端点/最近点）。这里用保守近似：
  // 取段上到矩形中心最近点，若点在矩形内则距离 0，否则到矩形边缘的距离。
  let best = Infinity;
  for (let i = 0; i + 1 < road.points.length; i++) {
    const a = road.points[i], b = road.points[i + 1];
    for (const p of [a, b]) {
      const ex = Math.max(rect.min_x - p.x, 0, p.x - rect.max_x);
      const ez = Math.max(rect.min_z - p.z, 0, p.z - rect.max_z);
      best = Math.min(best, Math.hypot(ex, ez));
    }
    // 采样段中点与四分点，覆盖长段从中间贴过来的情况
    for (const t of [0.25, 0.5, 0.75]) {
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const ex = Math.max(rect.min_x - px, 0, px - rect.max_x);
      const ez = Math.max(rect.min_z - pz, 0, pz - rect.max_z);
      best = Math.min(best, Math.hypot(ex, ez));
    }
  }
  return best;
}

const TOLERANCE_M = 8; // 临街间隙超过 8 m 视为「没挨着路」
let failures = 0;

console.log('建筑                prefab                 声明道路          最近道路         路心距  临街间隙');
for (const building of buildings) {
  const size = building.size_m ?? { x: 20, z: 20 };
  const rect = {
    min_x: building.position.x - size.x / 2, max_x: building.position.x + size.x / 2,
    min_z: building.position.z - size.z / 2, max_z: building.position.z + size.z / 2,
  };
  let nearest = null, nearestDist = Infinity;
  for (const road of roads) {
    const d = rectEdgeDist(rect, road);
    if (d < nearestDist) { nearestDist = d; nearest = road; }
  }
  const frontage = nearestDist - nearest.width_m / 2;
  const declared = building.roadside_of ? roads.find(road => road.id === building.roadside_of) : null;
  const declaredDist = declared ? rectEdgeDist(rect, declared) : null;
  const noRoad = NO_ROAD_NEEDED.has(building.prefab);
  const ok = noRoad || (frontage >= 0 && frontage <= TOLERANCE_M && (!declared || declaredDist <= nearestDist + 2));
  if (!ok) failures++;
  const tag = noRoad ? '（无需路）' : ok ? '✓' : '✗ 未贴路或贴错路';
  console.log(
    `${building.id.padEnd(20)}${building.prefab.padEnd(23)}`
    + `${(building.roadside_of ?? '—').padEnd(16)}${(ok ? nearest.id : `!! ${nearest.id}`).padEnd(16)}`
    + `${nearestDist.toFixed(1).padStart(6)}m  ${frontage.toFixed(1).padStart(6)}m  ${tag}`
    + (declared && declaredDist > nearestDist + 2 ? `  [声明 ${building.roadside_of} 距 ${declaredDist.toFixed(1)}m，非最近]` : ''),
  );
}

console.log(`\n合计 ${buildings.length} 栋，问题 ${failures} 栋（无需路 prefab ${buildings.filter(b => NO_ROAD_NEEDED.has(b.prefab)).length} 栋不参与判定）`);
process.exitCode = failures > 0 ? 1 : 0;
