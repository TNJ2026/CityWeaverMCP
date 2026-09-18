import {
  filterAlreadyBuiltBatches,
  findCompletedPlannedBuildingIds,
  mayContinueAfterPreviewFailure,
  samplePolyline,
} from '../lib/construction-safety.mjs';
import { readAllOwnedTiles, readAllSurfaceWaterCells } from '../lib/survey-pagination.mjs';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) process.stdout.write(`PASS  ${name}\n`);
  else { failures += 1; process.stdout.write(`FAIL  ${name}${detail ? ` — ${detail}` : ''}\n`); }
}

process.stdout.write('--- 已建道路与建筑识别 ---\n');
const elbow = samplePolyline([{ x: 0, z: 0 }, { x: 16, z: 0 }, { x: 16, z: 16 }], 8);
check('折线路径逐段采样并保留 90° 拐点',
  elbow.some(point => point.x === 16 && point.z === 0)
  && elbow.every(point => point.z === 0 || point.x === 16), JSON.stringify(elbow));

const plannedBuildings = [
  { id: 'school-a', prefab: 'School', position: { x: 10, z: 20 } },
  { id: 'school-b', prefab: 'School', position: { x: 100, z: 20 } },
];
const completedBuildings = findCompletedPlannedBuildingIds(plannedBuildings, [
  { prefab: 'School', position: { x: 11, z: 20 } },
]);
check('同 prefab 建筑按目标坐标一对一匹配',
  JSON.stringify(completedBuildings) === JSON.stringify(['school-a']), completedBuildings.join(','));

const batches = [
  { batch_id: 'ring-part-1', batch_type: 'route', object_ids: ['ring'] },
  { batch_id: 'ring-part-2', batch_type: 'route', object_ids: ['ring'] },
  { batch_id: 'school-a', batch_type: 'building', object_ids: ['school-a'] },
  { batch_id: 'school-b', batch_type: 'building', object_ids: ['school-b'] },
];
const remaining = filterAlreadyBuiltBatches(batches, {
  skip: true, roadIds: ['ring'], buildingIds: ['school-a'],
});
check('跳过已建道路的全部原生分批及精确匹配的建筑批次',
  JSON.stringify(remaining.map(batch => batch.batch_id)) === JSON.stringify(['school-b']),
  remaining.map(batch => batch.batch_id).join(','));

process.stdout.write('\n--- 预览失败停机边界 ---\n');
check('普通 failed 可由显式 continue 记录后继续', mayContinueAfterPreviewFailure('failed', true));
for (const state of ['outcome_unknown', 'expired', 'cancelled']) {
  check(`${state} 即使开启 continue 也必须停机`, !mayContinueAfterPreviewFailure(state, true));
}
check('仍在生成的非终态预览不能被 continue 越过',
  !mayContinueAfterPreviewFailure('generating_preview', true));

process.stdout.write('\n--- 勘察分页 ---\n');
const waterCalls = [];
const water = await readAllSurfaceWaterCells(async (_tool, args) => {
  waterCalls.push(args);
  return args.offset === 0
    ? { ok: true, data: { total_cells: 3, next_offset: 2, cells: [{ x: 0 }, { x: 1 }] } }
    : { ok: true, data: { total_cells: 3, next_offset: null, cells: [{ x: 2 }] } };
}, { bounds: { min_x: 0, max_x: 1, min_z: 0, max_z: 1 }, cell_size_m: 8 }, 2);
check('水域掩码跟随 next_offset 读取全部页面',
  water.cells.length === 3 && waterCalls.length === 2 && waterCalls[1].offset === 2);

let tileArgs = null;
const tiles = await readAllOwnedTiles(async (_tool, args) => {
  tileArgs = args;
  return { ok: true, data: { items: Array.from({ length: 120 }, (_, index) => ({ index })) } };
});
check('已购地图格使用地图总上限 529 一次读取', tiles.length === 120 && tileArgs.limit === 529);

if (failures) {
  process.stdout.write(`\n${failures} 项失败\n`);
  process.exitCode = 1;
} else process.stdout.write('\n全部通过\n');
