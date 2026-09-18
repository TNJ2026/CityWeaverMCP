import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 规划目标清单解析库。
 *
 * 目的：把「处理哪些设施、坐标是多少」收敛到一份权威配置（tools/presets/*.json）
 * 与规划文件（plans/*.json），让脚本只负责流程，不再各自维护 prefab 数组和写死坐标。
 *
 * 设计约束：
 * - 配置用命名方案（plans）表达多套不兼容的规划，每个 target 用 plans 字段声明归属。
 *   脚本只处理当前方案适用的项，不属于本方案的项单独归入 notApplicable，不算错误。
 * - 目标优先使用当前方案的 plan_ids 精确解析。只有未声明 ID 的兼容配置才回落到 prefab；
 *   显式 ID 不存在时必须报错，不能悄悄绑定同 prefab 的另一栋建筑。
 * - 属于本方案却解析不到的项不会被静默跳过，一律进 unresolved 并在脚本启动时显式报错。
 * - 坐标一律来自规划文件，脚本内不得再写死位置。
 * - 规划与城市强绑定：坐标只对某一个存档有效，配置用 expected_city 声明是哪个城，
 *   脚本首件事就是拿 get_game_status 的 city_name 比对，不符即中止（见 assertCityMatches）。
 *   没有这道闸，跑错城市的表现是「规划器正常返回 0 候选」，看起来像没路，极难自查。
 * - 清单里不保存任何会话相关数据：原生候选（含 road_edge_id）由脚本在运行时现场请求，
 *   因此不存在「换存档后 ID 失效」这一类需要预先比对会话的状态。
 */

export const DEFAULT_CONFIG = fileURLToPath(
  new URL('../presets/weford-public-services.json', import.meta.url),
);

export const SCRIPT_NAMES = ['relocation', 'preview', 'refresh', 'construction', 'verify'];

/**
 * preview 脚本在运行时向原生规划器取候选时的默认参数。
 * 这些是「怎么取候选」的可调项，不是坐标；清单里可以覆盖其中任意字段。
 */
export const DEFAULT_PREVIEW_POLICY = Object.freeze({
  search_radius_m: 96,
  candidate_count: 12,
  road_side: 'either',
  attempt_limit: 2,
  consider_service_coverage: false,
});

export class PlanTargetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PlanTargetError';
    this.code = code;
    this.details = details;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

export function createRunId(prefix = 'run') {
  const safePrefix = String(prefix).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'run';
  return `${safePrefix}-${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function matchesPlannedBuilding(target, building, toleranceM = 2) {
  if (building?.prefab !== target?.prefab) return false;
  const coordinates = [
    Number(target?.position?.x),
    Number(target?.position?.z),
    Number(building?.position?.x),
    Number(building?.position?.z),
  ];
  if (!coordinates.every(Number.isFinite)) return false;
  return Math.hypot(
    coordinates[2] - coordinates[0],
    coordinates[3] - coordinates[1],
  ) <= toleranceM;
}

export async function loadTargets({ configPath = DEFAULT_CONFIG, planKey = null, planPath = null } = {}) {
  const configAbs = path.resolve(configPath);
  const config = JSON.parse(await readFile(configAbs, 'utf8'));
  const planCatalog = config.plans ?? {};
  const activeKey = planKey ?? config.active_plan ?? Object.keys(planCatalog)[0];
  const definition = planCatalog[activeKey];

  if (!planPath && !definition?.path) {
    throw new PlanTargetError(
      'PLAN_KEY_UNKNOWN',
      `配置里没有名为 ${activeKey} 的规划方案`,
      { requested: activeKey, available: Object.keys(planCatalog) },
    );
  }

  const planAbs = planPath
    ? path.resolve(planPath)
    : path.resolve(path.dirname(configAbs), definition.path);
  const plan = JSON.parse(await readFile(planAbs, 'utf8'));

  const staged = plan.plan ?? {};
  const buildings = Array.isArray(staged.buildings) ? staged.buildings : [];
  const byId = new Map(buildings.filter(item => item.id).map(item => [item.id, item]));
  const byPrefab = new Map();
  for (const item of buildings) {
    if (!byPrefab.has(item.prefab)) byPrefab.set(item.prefab, []);
    byPrefab.get(item.prefab).push(item);
  }

  const declared = config.targets ?? [];
  const applicable = declared.filter(target => (target.plans ?? []).includes(activeKey));
  const notApplicable = declared.filter(target => !(target.plans ?? []).includes(activeKey));

  const targets = [];
  const unresolved = [];
  for (const target of applicable) {
    const declaredPlanId = target.plan_ids?.[activeKey] ?? target.plan_id ?? null;
    const hit = declaredPlanId
      ? byId.get(declaredPlanId)
      : (byPrefab.get(target.prefab) ?? [])[0];
    if (!hit) {
      unresolved.push({
        ...target,
        reason: declaredPlanId ? 'PLAN_ID_MISSING' : 'PLAN_TARGET_MISSING',
        requested_plan_id: declaredPlanId,
        plan_key: activeKey,
      });
      continue;
    }
    const duplicates = (byPrefab.get(target.prefab) ?? []).length;
    targets.push({
      ...target,
      plan_key: activeKey,
      plan_id: hit.id ?? null,
      plan_label: hit.label ?? null,
      position: hit.position ?? null,
      rotation_degrees: hit.rotation_degrees ?? null,
      construction_status: hit.construction_status ?? null,
      ambiguous_prefab: duplicates > 1,
      building: hit,
    });
  }

  return {
    configPath: configAbs,
    planKey: activeKey,
    planLabel: definition?.label ?? activeKey,
    planNote: definition?.note ?? null,
    planCatalog,
    planPath: planAbs,
    config,
    plan,
    bounds: plan.bounds ?? null,
    buildings,
    targets,
    unresolved,
    notApplicable,
    scriptNames: config.script_names ?? {},
    expectedCity: typeof config.expected_city === 'string' && config.expected_city.trim()
      ? config.expected_city.trim()
      : null,
    previewCandidatePolicy: { ...DEFAULT_PREVIEW_POLICY, ...(config.preview_candidate_policy ?? {}) },
  };
}

export function selectTargets(loaded, scriptName) {
  return loaded.targets.filter(
    target => Array.isArray(target.scripts) && target.scripts.includes(scriptName),
  );
}

export function describePlan(loaded) {
  return {
    plan_key: loaded.planKey,
    plan_label: loaded.planLabel,
    config: path.relative(process.cwd(), loaded.configPath) || loaded.configPath,
    plan: path.relative(process.cwd(), loaded.planPath) || loaded.planPath,
    plan_buildings: loaded.buildings.length,
    targets_resolved: loaded.targets.length,
    targets_unresolved: loaded.unresolved.map(item => item.prefab),
    targets_not_in_this_plan: loaded.notApplicable.map(item => item.prefab),
    bounds: loaded.bounds,
  };
}

export async function describePlanWithStamp(loaded) {
  const info = describePlan(loaded);
  try {
    const fileStat = await stat(loaded.planPath);
    info.plan_mtime = fileStat.mtime.toISOString();
    info.plan_bytes = fileStat.size;
  } catch {
    info.plan_mtime = null;
  }
  return info;
}

export function assertScriptResolved(loaded, scriptName, { ignorePrefabs = [] } = {}) {
  const ignored = new Set(ignorePrefabs);
  const missing = loaded.unresolved.filter(
    target => Array.isArray(target.scripts)
      && target.scripts.includes(scriptName)
      && !ignored.has(target.prefab),
  );
  if (missing.length === 0) return;
  throw new PlanTargetError(
    'PLAN_TARGET_MISSING',
    `${loaded.planKey} 方案下，${scriptName} 有 ${missing.length} 个目标在规划文件中找不到：${missing.map(item => item.prefab).join(', ')}`,
    {
      script: scriptName,
      plan_key: loaded.planKey,
      plan: loaded.planPath,
      missing: missing.map(item => ({
        prefab: item.prefab,
        script_id: item.script_id,
        declared_plans: item.plans ?? [],
      })),
      available_plans: Object.keys(loaded.planCatalog),
      hint: '确认 --plan 指向与本次施工同源的规划方案；两套方案的坐标不通用。',
    },
  );
}

/**
 * 把 --allow-city-mismatch 这类布尔开关归一化成选项对象。
 * parseArgs 把裸开关解析成 true、把带值开关解析成字符串，这里统一收口。
 */
export function cityGuardOptions(args = {}) {
  const raw = args['allow-city-mismatch'];
  return { allowMismatch: raw === true || raw === 'true' || raw === '1' };
}

/**
 * 规划坐标只对一个存档有效，跑错城市的失败方式极隐蔽：原生规划器照常工作，
 * 只是在目标区域找不到任何可接入道路，于是每个目标都返回 0 候选——看起来像「没路」
 * 或「规划器坏了」，实际是「根本不是这个城」。所以脚本必须先过这道闸。
 *
 * 配置没有声明 expected_city（或声明为空）时跳过比对，老清单继续可用。
 */
export function assertCityMatches(loaded, actualCityName, { allowMismatch = false } = {}) {
  const expected = loaded?.expectedCity ?? null;
  if (!expected || allowMismatch) return;
  const actual = typeof actualCityName === 'string' && actualCityName.trim()
    ? actualCityName.trim()
    : null;
  if (actual === expected) return;
  throw new PlanTargetError(
    'CITY_MISMATCH',
    `规划针对「${expected}」，当前加载的城市是「${actual ?? '未知'}」`,
    {
      expected_city: expected,
      actual_city: actual,
      plan_key: loaded?.planKey ?? null,
      plan: loaded?.planPath ?? null,
      hint: '在游戏里加载规划对应的存档后重试。确需对别的城市试跑可加 --allow-city-mismatch。',
    },
  );
}

export function formatFailure(error) {
  const isPlanError = error instanceof PlanTargetError;
  return {
    event: 'fatal',
    code: isPlanError ? error.code : (error?.code ?? 'UNEXPECTED'),
    message: error?.message ?? String(error),
    ...(isPlanError ? { details: error.details } : {}),
  };
}

export async function runMain(main) {
  try {
    await main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify(formatFailure(error), null, 2)}\n`);
    process.exitCode = 1;
  }
}
