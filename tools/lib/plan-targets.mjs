import { readFile, stat } from 'node:fs/promises';
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
 * - 目标以 prefab 为主键解析（与既有脚本行为一致），plan_id 存在时优先精确匹配。
 * - 属于本方案却解析不到的项不会被静默跳过，一律进 unresolved 并在脚本启动时显式报错。
 * - 坐标一律来自规划文件，脚本内不得再写死位置。
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
    const hit = byId.get(target.plan_id) ?? (byPrefab.get(target.prefab) ?? [])[0];
    if (!hit) {
      unresolved.push({ ...target, reason: 'PLAN_TARGET_MISSING', plan_key: activeKey });
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
