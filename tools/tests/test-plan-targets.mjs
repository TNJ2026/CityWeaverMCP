import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_CONFIG,
  DEFAULT_PREVIEW_POLICY,
  PlanTargetError,
  assertCityMatches,
  assertScriptResolved,
  cityGuardOptions,
  createRunId,
  describePlan,
  loadTargets,
  matchesPlannedBuilding,
  selectTargets,
} from '../lib/plan-targets.mjs';
import * as planTargets from '../lib/plan-targets.mjs';
import {
  SIMULATION_SPEEDS,
  describeSimulationSpeed,
  speedToRestore,
} from '../lib/simulation-speed.mjs';

const EXPECTED = {
  'public-services': {
    resolved: 8,
    notApplicable: ['MedicalClinic02', 'CityPark03', 'CommunityPool01'],
    order: ['PoliceStation02', 'FireHouse02', 'Hospital01', 'BusDepot01', 'Landfill01', 'Cemetery02'],
    counts: { relocation: 6, preview: 6, refresh: 4, construction: 6, verify: 8 },
  },
  master: {
    resolved: 10,
    notApplicable: ['Hospital01'],
    order: ['PoliceStation02', 'FireHouse02', 'MedicalClinic02', 'CityPark03', 'CommunityPool01', 'BusDepot01', 'Landfill01', 'Cemetery02'],
    counts: { relocation: 8, preview: 8, refresh: 5, construction: 8, verify: 10 },
  },
};

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    process.stdout.write(`PASS  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL  ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const loaded = await loadTargets({ configPath: DEFAULT_CONFIG });

check('默认方案是 public-services', loaded.planKey === 'public-services', loaded.planKey);
check('两套规划方案都在配置里', Object.keys(loaded.planCatalog).length === 2,
  Object.keys(loaded.planCatalog).join(', '));

for (const [planKey, expected] of Object.entries(EXPECTED)) {
  process.stdout.write(`\n--- 方案 ${planKey} ---\n`);
  const state = planKey === loaded.planKey
    ? loaded
    : await loadTargets({ configPath: DEFAULT_CONFIG, planKey });

  check(`${planKey} 无未解析项`, state.unresolved.length === 0,
    `未解析: ${state.unresolved.map(item => item.prefab).join(', ')}`);
  check(`${planKey} 解析 ${expected.resolved} 项`, state.targets.length === expected.resolved,
    `实际 ${state.targets.length}`);

  const notApplicable = state.notApplicable.map(item => item.prefab).sort();
  check(`${planKey} 不适用项正确`,
    JSON.stringify(notApplicable) === JSON.stringify([...expected.notApplicable].sort()),
    `实际 ${notApplicable.join(', ')}`);

  for (const [script, count] of Object.entries(expected.counts)) {
    const group = selectTargets(state, script);
    check(`${planKey}/${script} 分组 ${count} 项`, group.length === count, `实际 ${group.length}`);
  }

  const order = selectTargets(state, 'construction').map(target => target.prefab);
  check(`${planKey}/construction 顺序稳定`,
    JSON.stringify(order) === JSON.stringify(expected.order),
    `实际 ${order.join(', ')}`);

  check(`${planKey} 每项都有坐标`,
    state.targets.every(target => Number.isFinite(target.position?.x) && Number.isFinite(target.position?.z)));
  check(`${planKey} 每项按显式 plan_id 解析`,
    state.targets.every(target => target.plan_id === target.plan_ids?.[planKey]),
    state.targets.filter(target => target.plan_id !== target.plan_ids?.[planKey]).map(target => target.prefab).join(', '));

  for (const script of Object.keys(expected.counts)) {
    let threw = null;
    try {
      assertScriptResolved(state, script);
    } catch (error) {
      threw = error;
    }
    check(`${planKey}/${script} 通过缺失断言`, threw === null, threw?.message ?? '');
  }
}

process.stdout.write('\n--- 通用约束 ---\n');
check('script_id 唯一',
  new Set(loaded.targets.map(target => target.script_id)).size === loaded.targets.length);
check('每个 target 都声明了 plans',
  loaded.config.targets.every(target => Array.isArray(target.plans) && target.plans.length > 0));
check('每个 target 都声明了 scripts',
  loaded.config.targets.every(target => Array.isArray(target.scripts) && target.scripts.length > 0));
check('每个 target 对适用方案都声明了 plan_ids',
  loaded.config.targets.every(target => target.plans.every(planKey => target.plan_ids?.[planKey])));
check('每个 target 的 script 名都合法',
  loaded.config.targets.every(target => target.scripts.every(name => Object.hasOwn(loaded.scriptNames, name))));

const fireTarget = loaded.targets.find(target => target.prefab === 'FireHouse02');
check('重复 prefab 精确绑定中心消防站', fireTarget?.plan_id === 'service-fire-central', fireTarget?.plan_id);
check('同 prefab 但远离目标的建筑不算已建',
  !matchesPlannedBuilding(fireTarget, {
    prefab: 'FireHouse02',
    position: { x: -940.000061, z: 1243.75 },
  }));
check('目标坐标容差内的同 prefab 建筑算已建',
  matchesPlannedBuilding(fireTarget, {
    prefab: 'FireHouse02',
    position: { x: fireTarget.position.x + 1, z: fireTarget.position.z + 1 },
  }));

const info = describePlan(loaded);
check('describePlan 暴露方案与来源',
  info.plan_key === 'public-services' && typeof info.plan === 'string' && info.plan_buildings > 0);

check('权威清单的 targets 不写死坐标',
  loaded.config.targets.every(target => !Object.hasOwn(target, 'position')));

process.stdout.write('\n--- 清单里不留任何会话相关数据 ---\n');
const configText = await readFile(loaded.configPath, 'utf8');
check('清单已无 session_bound_preview_candidates 段',
  !Object.hasOwn(loaded.config, 'session_bound_preview_candidates'));
check('loadTargets 不再暴露会话绑定候选',
  !Object.hasOwn(loaded, 'sessionBoundCandidates'));
check('lib 不再导出 assertSessionMatches',
  !Object.hasOwn(planTargets, 'assertSessionMatches'));
check('清单文本不含 road_edge_id', !configText.includes('road_edge_id'));
check('清单文本不含会话 ID 字段', !configText.includes('session_id'));
check('清单文本不含坐标字段', !configText.includes('"position"'));
check('清单文本不含 32 位十六进制会话标识',
  !/[0-9a-f]{32}/i.test(configText),
  (configText.match(/[0-9a-f]{32}/i) ?? []).join(', '));

process.stdout.write('\n--- 规划文件已纳入 plans/ ---\n');
for (const [planKey, definition] of Object.entries(loaded.planCatalog)) {
  const state = planKey === loaded.planKey
    ? loaded
    : await loadTargets({ configPath: DEFAULT_CONFIG, planKey });
  const relative = state.planPath.replaceAll('\\', '/');
  check(`${planKey} 规划文件位于仓库 plans/ 目录`,
    /\/plans\/[^/]+\.json$/.test(relative), relative);
  check(`${planKey} 规划文件含 bounds 与 buildings`,
    Number.isFinite(state.bounds?.min_x) && state.buildings.length > 0,
    `bounds=${state.bounds?.min_x} buildings=${state.buildings.length}`);
  check(`${planKey} 规划文件里每栋建筑都有非空 id`,
    state.buildings.every(item => typeof item.id === 'string' && item.id.length > 0),
    state.buildings.filter(item => !item.id).map(item => item.prefab).join(', '));
  check(`${planKey} 清单声明路径指向 plans/`,
    String(definition.path ?? '').replaceAll('\\', '/').includes('/plans/'),
    String(definition.path));
}

process.stdout.write('\n--- preview 运行时取候选的策略 ---\n');
const policy = loaded.previewCandidatePolicy;
check('策略回落到默认值',
  Object.keys(DEFAULT_PREVIEW_POLICY).every(key => Object.hasOwn(policy, key)),
  Object.keys(policy).join(', '));
check('search_radius_m 为正数', Number(policy.search_radius_m) > 0, String(policy.search_radius_m));
check('candidate_count 为正整数', Number.isInteger(policy.candidate_count) && policy.candidate_count > 0,
  String(policy.candidate_count));
check('attempt_limit 在 1..candidate_count 之间',
  Number.isInteger(policy.attempt_limit)
  && policy.attempt_limit >= 1
  && policy.attempt_limit <= policy.candidate_count,
  String(policy.attempt_limit));
check('road_side 取值合法',
  ['either', 'left', 'right'].includes(policy.road_side), String(policy.road_side));
check('清单里的策略块不含坐标',
  !JSON.stringify(loaded.config.preview_candidate_policy ?? {}).includes('position'));

const runIdA = createRunId('planpreview');
const runIdB = createRunId('planpreview');
check('每次预览运行生成不同且 schema 合法的请求前缀',
  runIdA !== runIdB && /^[A-Za-z0-9_-]{8,100}$/.test(runIdA) && /^[A-Za-z0-9_-]{8,100}$/.test(runIdB),
  `${runIdA}, ${runIdB}`);

let unknownKeyError = null;
try {
  await loadTargets({ configPath: DEFAULT_CONFIG, planKey: 'does-not-exist' });
} catch (error) {
  unknownKeyError = error;
}
check('未知方案键报 PLAN_KEY_UNKNOWN',
  unknownKeyError instanceof PlanTargetError && unknownKeyError.code === 'PLAN_KEY_UNKNOWN',
  unknownKeyError ? `code=${unknownKeyError.code}` : '未抛错');

const tempDirectory = await mkdtemp(path.join(tmpdir(), 'cityweaver-plan-targets-'));
let strictIdState = null;
try {
  const brokenConfig = structuredClone(loaded.config);
  brokenConfig.plans['public-services'].path = loaded.planPath;
  brokenConfig.targets.find(target => target.prefab === 'FireHouse02')
    .plan_ids['public-services'] = 'missing-fire-house-id';
  const brokenConfigPath = path.join(tempDirectory, 'targets.json');
  await writeFile(brokenConfigPath, JSON.stringify(brokenConfig), 'utf8');
  strictIdState = await loadTargets({ configPath: brokenConfigPath, planKey: 'public-services' });
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
check('显式 plan_id 缺失时不回落到同 prefab 第一项',
  strictIdState.unresolved.some(target => target.prefab === 'FireHouse02'
    && target.reason === 'PLAN_ID_MISSING')
  && !strictIdState.targets.some(target => target.prefab === 'FireHouse02'));

let missingError = null;
try {
  const broken = await loadTargets({ configPath: DEFAULT_CONFIG, planKey: 'public-services' });
  broken.targets = broken.targets.filter(target => target.prefab !== 'Hospital01');
  const hospital = broken.config.targets.find(target => target.prefab === 'Hospital01');
  broken.unresolved.push({ ...hospital, reason: 'PLAN_TARGET_MISSING', plan_key: 'public-services' });
  assertScriptResolved(broken, 'construction');
} catch (error) {
  missingError = error;
}
check('缺失项断言带可操作信息',
  missingError?.code === 'PLAN_TARGET_MISSING'
  && Array.isArray(missingError?.details?.missing)
  && Array.isArray(missingError?.details?.available_plans),
  missingError ? `code=${missingError.code}` : '未抛错');

process.stdout.write('\n--- 城市闸门：规划坐标只对 expected_city 有效 ---\n');
check('清单声明了 expected_city', loaded.expectedCity === '韦福德', String(loaded.expectedCity));
check('loadTargets 暴露 expectedCity', Object.hasOwn(loaded, 'expectedCity'));

let cityMismatchError = null;
try {
  assertCityMatches(loaded, '埃格林');
} catch (error) {
  cityMismatchError = error;
}
check('城市不符报 CITY_MISMATCH',
  cityMismatchError instanceof PlanTargetError && cityMismatchError.code === 'CITY_MISMATCH',
  cityMismatchError ? `code=${cityMismatchError.code}` : '未抛错');
check('CITY_MISMATCH 带可操作信息',
  cityMismatchError?.details?.expected_city === '韦福德'
  && cityMismatchError?.details?.actual_city === '埃格林'
  && typeof cityMismatchError?.details?.hint === 'string');

let cityOkError = null;
try {
  assertCityMatches(loaded, '韦福德');
} catch (error) {
  cityOkError = error;
}
check('城市相符不抛错', cityOkError === null, cityOkError?.message ?? '');

let cityUnknownError = null;
try {
  assertCityMatches(loaded, null);
} catch (error) {
  cityUnknownError = error;
}
check('城市名取不到（null）也拦下', cityUnknownError?.code === 'CITY_MISMATCH');

let cityOverrideError = null;
try {
  assertCityMatches(loaded, '埃格林', cityGuardOptions({ 'allow-city-mismatch': true }));
} catch (error) {
  cityOverrideError = error;
}
check('--allow-city-mismatch 可显式放行', cityOverrideError === null, cityOverrideError?.message ?? '');

let citySkippedError = null;
try {
  assertCityMatches({ expectedCity: null }, '任意城');
} catch (error) {
  citySkippedError = error;
}
check('未声明 expected_city 时跳过比对（老清单兼容）',
  citySkippedError === null, citySkippedError?.message ?? '');

check('cityGuardOptions 只认显式真值',
  cityGuardOptions({}).allowMismatch === false
  && cityGuardOptions({ 'allow-city-mismatch': true }).allowMismatch === true
  && cityGuardOptions({ 'allow-city-mismatch': 'false' }).allowMismatch === false);

process.stdout.write('\n--- 五个脚本都接上了城市闸门 ---\n');
const scratchDirectory = path.resolve(path.dirname(loaded.configPath), '..', 'scratch');
const scratchSources = {};
for (const name of [
  'plan-public-service-relocation',
  'preview-public-service-plan',
  'refresh-public-service-road-bindings',
  'build-public-services-from-plan',
  'verify-public-services-phase',
]) {
  const source = await readFile(path.join(scratchDirectory, `${name}.mjs`), 'utf8');
  scratchSources[name] = source;
  const calls = (source.match(/assertCityMatches\(/g) ?? []).length;
  check(`${name} 调用了 assertCityMatches`, calls >= 1, `调用 ${calls} 次`);
}
check('build 的城市闸门排在任何写入动作之前',
  scratchSources['build-public-services-from-plan'].indexOf('assertCityMatches(')
  < scratchSources['build-public-services-from-plan'].indexOf('prepareCityPlanConstruction('));
check('清单文本声明了 expected_city',
  (await readFile(loaded.configPath, 'utf8')).includes('"expected_city"'));

process.stdout.write('\n--- 模拟速度：数字索引不是 0/1/2/3 ---\n');
check('实测映射覆盖 4 档速度', SIMULATION_SPEEDS.length === 4);
check('fastest 的索引是 4 而不是 3（实测值，写成 3 会静默降速）',
  SIMULATION_SPEEDS.find(entry => entry.speed === 'fastest')?.code === 4);
check('paused 的索引是 0 且 paused 为真',
  SIMULATION_SPEEDS.find(entry => entry.speed === 'paused')?.code === 0
  && SIMULATION_SPEEDS.find(entry => entry.speed === 'paused')?.paused === true);

// 每一档都要能「读出来再还原回去」。这条是核心回归防线：
// 如果哪天有人把映射改成 0/1/2/3，fastest 会被还原成 fast，这里立刻挂。
for (const entry of SIMULATION_SPEEDS) {
  const described = describeSimulationSpeed({ paused: entry.paused, selected_speed: entry.code });
  const restore = speedToRestore(described);
  check(`${entry.speed} 读出来再还原仍是 ${entry.speed}`,
    described.speed === entry.speed
    && described.paused === entry.paused
    && restore.speed === entry.speed
    && restore.fallback === false,
    `读出 ${described.speed} / 还原 ${restore.speed}`);
}

check('未知索引不假装认识（3 不是合法速度）',
  describeSimulationSpeed({ paused: false, selected_speed: 3 }).speed === null);
check('速度字段缺失时不崩',
  describeSimulationSpeed({ paused: false }).code === null
  && describeSimulationSpeed({ paused: false }).speed === null);
check('未知索引还原到 normal 并标记 fallback，不谎报精确还原',
  speedToRestore(describeSimulationSpeed({ paused: false, selected_speed: 3 })).speed === 'normal'
  && speedToRestore(describeSimulationSpeed({ paused: false, selected_speed: 3 })).fallback === true
  && speedToRestore(describeSimulationSpeed({ paused: false, selected_speed: 3 })).unknown_code === 3);
check('暂停优先于数字：paused 为真时即使数字缺失也还原成 paused',
  speedToRestore({ paused: true, code: null, speed: null }).speed === 'paused');

process.stdout.write('\n--- preview 脚本会还原它自己改过的模拟速度 ---\n');
const previewSource = scratchSources['preview-public-service-plan'];
check('preview 用共享的速度模块，不自己抄一份映射',
  previewSource.includes("from '../lib/simulation-speed.mjs'")
  && !previewSource.includes('selected_speed === 4'));
check('preview 的还原写在 finally 里（中途出错也还原）',
  previewSource.includes('finally')
  && (previewSource.match(/restoreSimulationSpeed\(\)/g) ?? []).length >= 2,
  `restore 调用 ${(previewSource.match(/restoreSimulationSpeed\(\)/g) ?? []).length} 次`);
const normalWrite = previewSource.indexOf("set_simulation_speed', { speed: 'normal' }");
const changedFlag = previewSource.indexOf('speedChanged = true', normalWrite);
const pausedWrite = previewSource.indexOf("set_simulation_speed', { speed: 'paused' }");
check('第一次速度写入成功后立即启用 finally 还原保护',
  normalWrite >= 0 && changedFlag > normalWrite && changedFlag < pausedWrite,
  `normal=${normalWrite} changed=${changedFlag} paused=${pausedWrite}`);
check('preview 输出里报告了还原结果',
  previewSource.includes('restored:')
  && previewSource.includes('restore_speed:'));

if (failures > 0) {
  process.stdout.write(`\n${failures} 项失败\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\n全部通过\n');
}
