import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  DEFAULT_PREVIEW_POLICY,
  PlanTargetError,
  assertScriptResolved,
  describePlan,
  loadTargets,
  selectTargets,
} from '../lib/plan-targets.mjs';
import * as planTargets from '../lib/plan-targets.mjs';

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
check('每个 target 的 script 名都合法',
  loaded.config.targets.every(target => target.scripts.every(name => Object.hasOwn(loaded.scriptNames, name))));

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

let unknownKeyError = null;
try {
  await loadTargets({ configPath: DEFAULT_CONFIG, planKey: 'does-not-exist' });
} catch (error) {
  unknownKeyError = error;
}
check('未知方案键报 PLAN_KEY_UNKNOWN',
  unknownKeyError instanceof PlanTargetError && unknownKeyError.code === 'PLAN_KEY_UNKNOWN',
  unknownKeyError ? `code=${unknownKeyError.code}` : '未抛错');

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

if (failures > 0) {
  process.stdout.write(`\n${failures} 项失败\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('\n全部通过\n');
}
