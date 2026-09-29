import { parseArea, normalizeFeatures, selectEdges, planBatches, deriveRunId, parseCli, MAX_BATCH_SIZE } from '../batch-road-features.mjs';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) process.stdout.write(`PASS  ${name}\n`);
  else { failures += 1; process.stdout.write(`FAIL  ${name}${detail ? ` — ${detail}` : ''}\n`); }
}
function throws(fn) { try { fn(); return false; } catch { return true; } }

const line = (id, prefab, a, d, status = 'existing') => ({ id, prefab, status,
  curve: { a, b: { x: a.x + (d.x - a.x) / 3, z: a.z + (d.z - a.z) / 3 }, c: { x: a.x + 2 * (d.x - a.x) / 3, z: a.z + 2 * (d.z - a.z) / 3 }, d } });

process.stdout.write('--- 区域与选项解析 ---\n');
check('区域解析为 min/max', JSON.stringify(parseArea('-4848,2848,-2848,4848')) === JSON.stringify({ min_x: -4848, min_z: 2848, max_x: -2848, max_z: 4848 }));
check('区域 min>=max 被拒绝', throws(() => parseArea('10,0,0,10')));
check('区域超出地图被拒绝', throws(() => parseArea('-8000,0,0,10')));
check('布尔选项接受字符串 true/false', JSON.stringify(normalizeFeatures({ tram_tracks: 'true', left_bicycle_lane: false })) === JSON.stringify({ tram_tracks: true, left_bicycle_lane: false }));
check('布尔选项拒绝其他值', throws(() => normalizeFeatures({ tram_tracks: 'yes' })));
check('装饰选项只收 none/grass/trees', throws(() => normalizeFeatures({ left_decoration: 'flowers' })));
check('未知选项被拒绝（bridge 直连不经过 MCP schema）', throws(() => normalizeFeatures({ bicycle: true })));
check('空选项被拒绝', throws(() => normalizeFeatures({})));

process.stdout.write('--- 选路 ---\n');
const area = { min_x: 0, min_z: 0, max_x: 100, max_z: 100 };
const roads = [
  line('ring', 'Large Road Oneway', { x: 0, z: 0 }, { x: 100, z: 0 }),          // 恰在边界上
  line('inner', 'Small Road', { x: 20, z: 20 }, { x: 80, z: 20 }),
  line('connector', 'Large Road', { x: 50, z: 100 }, { x: 50, z: 200 }),        // 从边界伸出区域
  line('far', 'Small Road', { x: 300, z: 300 }, { x: 400, z: 300 }),
  line('ghost', 'Small Road', { x: 30, z: 30 }, { x: 60, z: 30 }, 'planned'),
];
const contain = selectEdges(roads, area).selected.map(e => e.id);
check('contain 模式选中边界上的环路和内部道路', contain.join() === 'ring,inner', contain.join());
check('contain 模式不选伸出区域的连接路', !contain.includes('connector'));
const touch = selectEdges(roads, area, { mode: 'touch' }).selected.map(e => e.id);
check('touch 模式包含伸出区域的连接路', touch.join() === 'ring,inner,connector', touch.join());
check('非 existing 道路被跳过', selectEdges(roads, area).skipped.not_existing === 1);
check('prefab 白名单生效', selectEdges(roads, area, { prefabs: ['Small Road'] }).selected.map(e => e.id).join() === 'inner');
check('prefab 黑名单生效', selectEdges(roads, area, { excludePrefabs: ['Small Road'] }).selected.map(e => e.id).join() === 'ring');
check('按 ID 排除生效', selectEdges(roads, area, { excludeIds: ['ring'] }).selected.map(e => e.id).join() === 'inner');
const offset = [line('edge', 'Small Road', { x: -1.5, z: 50 }, { x: 50, z: 50 })];
check('容差内的端点仍算在区域内', selectEdges(offset, area).selected.length === 1);
check('容差设为 0 时不算', selectEdges(offset, area, { tolerance: 0 }).selected.length === 0);

process.stdout.write('--- 分批与运行 ID ---\n');
const many = Array.from({ length: 150 }, (_, i) => ({ id: `e${String(i).padStart(3, '0')}`, prefab: i % 2 ? 'Small Road' : 'Medium Road' }));
const batches = planBatches(many);
check('150 段切成 3 批', batches.length === 3 && batches.map(b => b.length).join() === '64,64,22');
check('按 prefab 排序后同类相邻', batches[0].every(e => e.prefab === 'Medium Road'));
check('批大小超过 64 被拒绝', throws(() => planBatches(many, MAX_BATCH_SIZE + 1)));
const idA = deriveRunId(['b', 'a'], { left_bicycle_lane: true });
check('运行 ID 与边顺序无关', idA === deriveRunId(['a', 'b'], { left_bicycle_lane: true }));
check('运行 ID 随选项变化', idA !== deriveRunId(['a', 'b'], { left_bicycle_lane: false }));
check('运行 ID 派生的批请求 ID 符合 request_id 规则', /^[A-Za-z0-9_-]{8,100}$/.test(`${idA}-c63`));

process.stdout.write('--- CLI ---\n');
const cli = parseCli(['--area', '0,0,100,100', '--bicycle-lanes', '--set', 'left_tree_prefab=Oak=Tree', '--prefab', 'Small Road', '--commit']).options;
check('快捷写法展开为两侧选项', cli.features.left_bicycle_lane === true && cli.features.right_bicycle_lane === true);
check('--set 保留值中的等号', cli.features.left_tree_prefab === 'Oak=Tree');
check('--commit 需显式给出', cli.commit === true && parseCli(['--area', '0,0,1,1', '--bicycle-lanes']).options.commit === undefined);
check('未知参数被拒绝', throws(() => parseCli(['--area', '0,0,1,1', '--bicycle'])));
check('非法 run id 被拒绝', throws(() => parseCli(['--run-id', 'a b'])));

process.stdout.write(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
