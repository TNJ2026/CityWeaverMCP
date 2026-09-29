import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryGame } from '../mcp/bridge-client.mjs';
import { describeSimulationSpeed, speedToRestore } from './lib/simulation-speed.mjs';

/**
 * 批量道路功能升级：按矩形区域（或边 ID 清单）选路，分批调用 preview_road_features，
 * 逐批核对费用后经 build_road 提交。
 *
 * 默认只预览（每批预览后立即取消，不产生永久改动），报告道路数与费用；
 * 只有显式传入 commit 才提交。请求 ID 由「选中的边 + 升级选项」确定性派生，
 * 中断后原样重跑会跳过已完成的批次，不会重复扣费。
 */

export const MAX_BATCH_SIZE = 64;
const BOOLEAN_FEATURES = ['left_wide_sidewalk', 'right_wide_sidewalk', 'left_bicycle_lane', 'right_bicycle_lane',
  'left_public_transport_lane', 'right_public_transport_lane', 'tram_tracks', 'wide_median'];
const DECORATION_FEATURES = ['left_decoration', 'right_decoration', 'median_decoration'];
const TREE_FEATURES = ['left_tree_prefab', 'right_tree_prefab', 'median_tree_prefab'];
const DECORATIONS = ['none', 'grass', 'trees'];
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'expired', 'outcome_unknown']);
// 两侧同时设置的快捷写法：--bicycle-lanes 等价于 left_bicycle_lane=true + right_bicycle_lane=true。
const SHORTHANDS = {
  'bicycle-lanes': { left_bicycle_lane: true, right_bicycle_lane: true },
  'no-bicycle-lanes': { left_bicycle_lane: false, right_bicycle_lane: false },
  'wide-sidewalks': { left_wide_sidewalk: true, right_wide_sidewalk: true },
  'side-trees': { left_decoration: 'trees', right_decoration: 'trees' },
  'side-grass': { left_decoration: 'grass', right_decoration: 'grass' },
};

const canonicalize = value => Array.isArray(value) ? value.map(canonicalize)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex').slice(0, 16);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseArea(text) {
  const parts = String(text ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some(v => !Number.isFinite(v))) throw new Error('--area 需要 minX,minZ,maxX,maxZ 四个数值');
  const [min_x, min_z, max_x, max_z] = parts;
  if (min_x >= max_x || min_z >= max_z) throw new Error('--area 的最小值必须小于最大值');
  if ([min_x, min_z, max_x, max_z].some(v => v < -7168 || v > 7168)) throw new Error('--area 超出地图范围 -7168..7168');
  return { min_x, min_z, max_x, max_z };
}

/** 校验并规范化升级选项；bridge 直连会绕过 MCP 的 schema，所以这里必须自己把关。 */
export function normalizeFeatures(features) {
  const result = {};
  for (const [key, raw] of Object.entries(features ?? {})) {
    if (BOOLEAN_FEATURES.includes(key)) {
      const value = raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null;
      if (value === null) throw new Error(`${key} 只能是 true 或 false`);
      result[key] = value;
    } else if (DECORATION_FEATURES.includes(key)) {
      if (!DECORATIONS.includes(raw)) throw new Error(`${key} 只能是 ${DECORATIONS.join('/')}`);
      result[key] = raw;
    } else if (TREE_FEATURES.includes(key)) {
      if (typeof raw !== 'string' || raw.length < 1 || raw.length > 200) throw new Error(`${key} 需要精确的树木 prefab 名称`);
      result[key] = raw;
    } else throw new Error(`未知的升级选项 ${key}；可用：${[...BOOLEAN_FEATURES, ...DECORATION_FEATURES, ...TREE_FEATURES].join(', ')}`);
  }
  if (Object.keys(result).length === 0) throw new Error('至少指定一个升级选项，例如 --bicycle-lanes 或 --set tram_tracks=true');
  return result;
}

/**
 * 从道路快照中选边。contain：四个控制点都在区域内（Bezier 曲线不会超出控制点包围盒，
 * 因此整条路都在区域内）；touch：包围盒与区域相交即选中。tolerance 容纳路网端点的吸附误差。
 */
export function selectEdges(roads, area, { mode = 'contain', tolerance = 2, prefabs = [], excludePrefabs = [], excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds);
  const inside = p => p.x >= area.min_x - tolerance && p.x <= area.max_x + tolerance && p.z >= area.min_z - tolerance && p.z <= area.max_z + tolerance;
  const selected = [];
  const skipped = { outside: 0, not_existing: 0, prefab: 0, excluded: 0 };
  for (const road of roads) {
    if (road.status && road.status !== 'existing') { skipped.not_existing++; continue; }
    if (excluded.has(road.id)) { skipped.excluded++; continue; }
    if ((prefabs.length && !prefabs.includes(road.prefab)) || excludePrefabs.includes(road.prefab)) { skipped.prefab++; continue; }
    const points = ['a', 'b', 'c', 'd'].map(k => road.curve[k]);
    let hit;
    if (mode === 'contain') hit = points.every(inside);
    else {
      const xs = points.map(p => p.x), zs = points.map(p => p.z);
      hit = Math.max(...xs) >= area.min_x - tolerance && Math.min(...xs) <= area.max_x + tolerance
        && Math.max(...zs) >= area.min_z - tolerance && Math.min(...zs) <= area.max_z + tolerance;
    }
    if (!hit) { skipped.outside++; continue; }
    selected.push({ id: road.id, prefab: road.prefab });
  }
  return { selected, skipped };
}

/** 按 prefab 分组排序后切批：同批道路类型一致，出错时容易定位。 */
export function planBatches(edges, size = MAX_BATCH_SIZE) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_BATCH_SIZE) throw new Error(`批大小必须在 1..${MAX_BATCH_SIZE}`);
  const sorted = [...edges].sort((x, y) => x.prefab.localeCompare(y.prefab) || x.id.localeCompare(y.id));
  const batches = [];
  for (let i = 0; i < sorted.length; i += size) batches.push(sorted.slice(i, i + size));
  return batches;
}

/** 同一组边 + 同一组选项 → 同一 run id，重跑即续跑。 */
export function deriveRunId(edgeIds, features) {
  return `rf-${digest({ edges: [...edgeIds].sort(), features })}`;
}

export function batchRequestId(runId, index, phase) {
  return `${runId}-${phase}${index}`;
}

async function callWithBusyRetry(tool, args, { attempts = 10, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await queryGame(tool, args); }
    catch (error) {
      if (error.code !== 'TOOL_BUSY' || attempt >= attempts) {
        if (error.code === 'TOOL_BUSY') error.message += '（游戏里仍有工具处于激活状态：请在游戏中按 Esc 回到默认选择工具后重跑）';
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

async function pollRoadOperation(operationId, until, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const op = (await queryGame('get_road_operation', { operation_id: operationId })).data;
    if (until(op.state)) return op;
    await sleep(300);
  }
  throw new Error(`道路操作 ${operationId} 在 ${timeoutMs} ms 内没有进入目标状态；请用 get_road_operation 查询，不要换 ID 重试`);
}

async function readRoads(area, tolerance) {
  const pad = Math.max(tolerance, 1) + 1;
  const snapshot = await queryGame('get_planning_map_snapshot', {
    bounds: { min_x: Math.max(-7168, area.min_x - pad), min_z: Math.max(-7168, area.min_z - pad), max_x: Math.min(7168, area.max_x + pad), max_z: Math.min(7168, area.max_z + pad) },
    include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false, max_features_per_layer: 5000,
  });
  if (snapshot.data.truncated) throw new Error('区域内道路超过 5000 段，快照被截断；请拆成更小的区域');
  return { roads: snapshot.data.roads, sessionId: snapshot.data.session_id };
}

/**
 * options: { area | edge_ids, features, mode, tolerance, prefabs, exclude_prefabs, exclude_edge_ids,
 *            batch_size, commit, max_cost_per_batch, max_total_cost, run_id, journal }
 */
export async function batchRoadFeatures(options) {
  const started = Date.now();
  const features = normalizeFeatures(options.features);
  const commit = options.commit === true;
  const maxBatchCost = options.max_cost_per_batch ?? 1_000_000;
  const maxTotalCost = options.max_total_cost ?? Number.MAX_SAFE_INTEGER;
  const tolerance = options.tolerance ?? 2;

  let selection;
  if (options.edge_ids?.length) selection = { selected: options.edge_ids.map(id => ({ id, prefab: 'unknown' })), skipped: null };
  else if (options.area) {
    const { roads } = await readRoads(options.area, tolerance);
    selection = selectEdges(roads, options.area, { mode: options.mode ?? 'contain', tolerance, prefabs: options.prefabs ?? [],
      excludePrefabs: options.exclude_prefabs ?? [], excludeIds: options.exclude_edge_ids ?? [] });
  } else throw new Error('需要 area 或 edge_ids');
  if (selection.selected.length === 0) throw new Error('没有选中任何道路');

  const batches = planBatches(selection.selected, options.batch_size ?? MAX_BATCH_SIZE);
  const runId = options.run_id ?? deriveRunId(selection.selected.map(e => e.id), features);
  const journal = options.journal ?? null;
  const record = entry => { if (journal) appendFileSync(journal, JSON.stringify({ at: new Date().toISOString(), run_id: runId, ...entry }) + '\n'); };
  if (journal) mkdirSync(path.dirname(journal), { recursive: true });

  const byPrefab = {};
  for (const edge of selection.selected) byPrefab[edge.prefab] = (byPrefab[edge.prefab] ?? 0) + 1;
  const before = describeSimulationSpeed((await queryGame('get_game_status', {})).data);
  const results = [];
  let totalCost = 0;
  let failure = null;
  try {
    await queryGame('set_simulation_speed', { speed: 'paused' });
    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      // 预览用一次性 ID（取消后不可复用）；提交用确定性 ID，重跑时直接命中已完成的操作。
      const requestId = commit ? batchRequestId(runId, index, 'c') : batchRequestId(`${runId}-${Date.now().toString(36)}`, index, 'd');
      const preview = (await callWithBusyRetry('preview_road_features', { request_id: requestId, edge_ids: batch.map(e => e.id), ...features })).data;
      const op = await pollRoadOperation(preview.operation_id, state => state === 'preview_ready' || TERMINAL_STATES.has(state));
      const entry = { batch: index, edges: batch.length, prefabs: [...new Set(batch.map(e => e.prefab))], request_id: requestId, operation_id: op.operation_id, cost: op.cost ?? 0 };
      if (op.state === 'completed') { results.push({ ...entry, state: 'completed', resumed: true }); record(results.at(-1)); continue; }
      if (op.state !== 'preview_ready') {
        failure = { ...entry, state: op.state, error: op.error ?? null, errors: op.errors ?? [] };
        if (op.state === 'outcome_unknown') failure.note = '结果未知：先用 get_road_operation 与道路快照核实，不要换 ID 重试';
        else if (commit) failure.note = '该批请求 ID 已进入终态；如需重做请换 --run-id';
        record(failure);
        break;
      }
      if (!commit) {
        await queryGame('cancel_road_preview', { operation_id: op.operation_id });
        totalCost += entry.cost;
        results.push({ ...entry, state: 'previewed' }); record(results.at(-1));
        continue;
      }
      if (entry.cost > maxBatchCost || totalCost + entry.cost > maxTotalCost) {
        await queryGame('cancel_road_preview', { operation_id: op.operation_id });
        // 取消后该确定性 ID 不可再用，续跑需要新的 run id。
        failure = { ...entry, state: 'cost_cap_exceeded', max_cost_per_batch: maxBatchCost, max_total_cost: maxTotalCost,
          note: '超出费用上限，已取消该批；调高上限后需用新的 --run-id 重跑（已完成批次不会回滚）' };
        record(failure);
        break;
      }
      await callWithBusyRetry('build_road', { operation_id: op.operation_id, request_id: requestId, max_cost: maxBatchCost });
      const done = await pollRoadOperation(op.operation_id, state => TERMINAL_STATES.has(state));
      if (done.state !== 'completed') {
        failure = { ...entry, state: done.state, error: done.error ?? null, errors: done.errors ?? [],
          note: done.state === 'outcome_unknown' ? '结果未知：先核实，不要换 ID 重试' : undefined };
        record(failure);
        break;
      }
      totalCost += entry.cost;
      results.push({ ...entry, state: 'completed' }); record(results.at(-1));
    }
  } finally {
    const restore = speedToRestore(before);
    await queryGame('set_simulation_speed', { speed: restore.speed }).catch(() => {});
  }
  return {
    success: failure === null,
    mode: commit ? 'commit' : 'preview_only',
    run_id: runId,
    features,
    edges_selected: selection.selected.length,
    edges_by_prefab: byPrefab,
    skipped: selection.skipped,
    batches: batches.length,
    batches_done: results.length,
    batches_resumed: results.filter(r => r.resumed).length,
    total_cost: totalCost,
    failure,
    results,
    duration_ms: Date.now() - started,
  };
}

const HELP = `用法: node tools/batch-road-features.mjs (--area minX,minZ,maxX,maxZ | --edges-file ids.json) <升级选项> [参数]

升级选项（至少一个，可组合）:
  --bicycle-lanes | --no-bicycle-lanes | --wide-sidewalks | --side-trees | --side-grass
  --set key=value        任意 preview_road_features 选项，例如 --set tram_tracks=true、
                         --set left_tree_prefab=CoconutPalmTree01（可重复）

选路:
  --mode contain|touch   contain（默认）只选整条落在区域内的路；touch 选与区域相交的路
  --tolerance M          端点容差，默认 2 米
  --prefab NAME          只处理该道路 prefab（可重复）
  --exclude-prefab NAME  排除该道路 prefab（可重复）
  --exclude-edge ID      排除某条边（可重复）

执行:
  --commit               真正提交；省略时只逐批预览、报告费用并取消预览
  --max-cost-per-batch N 单批费用上限，默认 1000000
  --max-total-cost N     总费用上限，默认不限
  --batch-size N         每批道路数，1..64，默认 64
  --run-id ID            指定运行 ID；默认由选中道路和升级选项派生，原样重跑会跳过已完成批次
  --journal PATH         逐批结果追加写入 JSONL 日志
  --verbose              输出完整 JSON
`;

export function parseCli(argv) {
  const options = { features: {}, prefabs: [], exclude_prefabs: [], exclude_edge_ids: [] };
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${arg} 缺少参数值`); return argv[++i]; };
    const flag = arg.replace(/^--/, '');
    if (SHORTHANDS[flag]) Object.assign(options.features, SHORTHANDS[flag]);
    else if (arg === '--set') {
      const [key, ...rest] = next().split('=');
      if (!rest.length) throw new Error('--set 需要 key=value');
      options.features[key] = rest.join('=');
    }
    else if (arg === '--area') options.area = parseArea(next());
    else if (arg === '--edges-file') {
      const ids = JSON.parse(readFileSync(next(), 'utf8'));
      options.edge_ids = (Array.isArray(ids) ? ids : ids.edge_ids ?? []).map(item => typeof item === 'string' ? item : item.id);
    }
    else if (arg === '--mode') { options.mode = next(); if (!['contain', 'touch'].includes(options.mode)) throw new Error('--mode 只能是 contain 或 touch'); }
    else if (arg === '--tolerance') options.tolerance = Number(next());
    else if (arg === '--prefab') options.prefabs.push(next());
    else if (arg === '--exclude-prefab') options.exclude_prefabs.push(next());
    else if (arg === '--exclude-edge') options.exclude_edge_ids.push(next());
    else if (arg === '--commit') options.commit = true;
    else if (arg === '--max-cost-per-batch') options.max_cost_per_batch = Number(next());
    else if (arg === '--max-total-cost') options.max_total_cost = Number(next());
    else if (arg === '--batch-size') options.batch_size = Number(next());
    else if (arg === '--run-id') options.run_id = next();
    else if (arg === '--journal') options.journal = next();
    else if (arg === '--verbose') verbose = true;
    else throw new Error(`未知参数 ${arg}；用 --help 查看用法`);
  }
  if (options.run_id !== undefined && !/^[A-Za-z0-9_-]{4,80}$/.test(options.run_id)) throw new Error('--run-id 只能包含字母、数字、_ 和 -，长度 4..80');
  return { options, verbose };
}

// 精确比对路径：测试文件 test-batch-road-features.mjs 同样以本文件名结尾。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
  try {
    const { options, verbose } = parseCli(args);
    const result = await batchRoadFeatures(options);
    const prefabs = Object.entries(result.edges_by_prefab).map(([name, count]) => `${name} ${count}`).join(', ');
    console.log(`${result.success ? '✓' : '✗'} [${result.mode === 'commit' ? '道路升级' : '道路升级预览'}] run ${result.run_id}`);
    console.log(`  - 选项: ${JSON.stringify(result.features)}`);
    console.log(`  - 道路: ${result.edges_selected} 段 (${prefabs})${result.skipped ? ` | 跳过: ${JSON.stringify(result.skipped)}` : ''}`);
    console.log(`  - 批次: ${result.batches_done}/${result.batches}${result.batches_resumed ? `（其中 ${result.batches_resumed} 批此前已完成）` : ''} | ${result.mode === 'commit' ? '本次费用' : '预计费用'}: ₡${result.total_cost.toLocaleString()} | ${result.duration_ms} ms`);
    if (result.failure) console.log(`  - 失败: ${JSON.stringify(result.failure)}`);
    if (result.mode !== 'commit' && result.success) console.log('  - 未做永久改动；确认后加 --commit 提交');
    if (verbose) console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`✗ [道路升级失败] ${error.code ? `${error.code}: ` : ''}${error.message}`);
    process.exit(1);
  }
}
