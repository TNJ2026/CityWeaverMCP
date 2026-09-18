// 埃格林「高原镇」规划回归测试。
// 离线部分不需要游戏：校验 plans/egelin-plateau-town-plan.json 的 plan_id、8 米对齐、街区计数与人口核算口径。
// 游戏在跑时追加实机部分：用实时已购地图格校验规划几何，并核对道路 prefab 与分区名确实是当前城市里的。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

// 实机只读：拉取当前已购地图格（分页沿用 next_offset）。桥未启动时抛错，由调用处跳过实机部分。
async function loadPurchasedTiles() {
  const response = await queryGame('list_map_tiles', { state: 'owned', offset: 0, limit: 100 });
  if (!response?.ok) throw new Error(response?.error?.code ?? 'QUERY_FAILED');
  return { tiles: response.data.items ?? [] };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = path.join(repoRoot, 'plans', 'egelin-plateau-town-plan.json');

let total = 0, failures = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (ok) return;
  failures++;
  process.stdout.write(`✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
};

const document = JSON.parse(await readFile(planPath, 'utf8'));
const { bounds, plan } = document;
const roads = plan.roads ?? [], zones = plan.zones ?? [], buildings = plan.buildings ?? [];

process.stdout.write('--- 规划文件结构与哈希 ---\n');
check('plan_id 与 bounds+plan 的哈希一致（施工前必须一致）', computeCityPlanId(bounds, plan) === document.plan_id,
  `${document.plan_id} vs ${computeCityPlanId(bounds, plan)}`);
check('规划文件里存在道路、分区与建筑', roads.length > 0 && zones.length > 0 && buildings.length > 0);
check('每个对象都有非空唯一 id',
  new Set([...roads, ...zones, ...buildings].map(item => item.id)).size === roads.length + zones.length + buildings.length
  && [...roads, ...zones, ...buildings].every(item => typeof item.id === 'string' && item.id.length > 0));
check('规划对象全部落在规划边界内', [...roads.flatMap(r => r.points), ...zones.flatMap(z => z.polygon),
  ...buildings.flatMap(b => [b.position])].every(p => p.x >= bounds.min_x && p.x <= bounds.max_x && p.z >= bounds.min_z && p.z <= bounds.max_z));

process.stdout.write('\n--- 几何：8 米对齐与道路分段限制 ---\n');
check('道路端点都在 8 米格上', roads.every(road => road.points.every(p => p.x % 8 === 0 && p.z % 8 === 0)),
  roads.filter(road => !road.points.every(p => p.x % 8 === 0 && p.z % 8 === 0)).map(r => r.id).join(','));
check('每条道路都声明了 prefab 与实际宽度',
  roads.every(road => typeof road.prefab === 'string' && road.prefab.length > 0 && Number.isFinite(road.width_m) && road.width_m > 0));
check('所有坐标都是有限数值（NaN/缺失会静默落下界外的对象）',
  [...roads.flatMap(road => road.points), ...zones.flatMap(zone => zone.polygon),
    ...buildings.flatMap(building => [building.position, building.size_m])]
    .every(point => Number.isFinite(point?.x) && Number.isFinite(point?.z)));
check('每条道路至少 2 个点且没有零长度段（长直线由施工流程按 240 米拆分）',
  roads.every(road => road.points.length >= 2 && road.points.slice(1).every((point, index) =>
    Math.hypot(point.x - road.points[index].x, point.z - road.points[index].z) > 0)));

process.stdout.write('\n--- 人口核算口径 ---\n');
const codeOf = { 'EU Residential Low': 'L', 'EU Residential Medium Row': 'R', 'EU Residential Medium': 'M' };
const residentialZones = zones.filter(zone => codeOf[zone.kind]);
check('住宅分区只使用低密/中密排屋/中密三个精确分区名',
  residentialZones.length === zones.filter(zone => String(zone.kind).includes('Residential')).length);
const households = residentialZones.reduce((sum, zone) => sum + ({ L: 18, R: 36, M: 50 })[codeOf[zone.kind]], 0);
const people = Math.round(households * 2.5);
check('户数核算与规划文件一致', households === document.accounting.households, `${households} vs ${document.accounting.households}`);
check('中位人口落在 1 万人口目标的 ±10% 内', Math.abs(people - document.target_population) <= document.target_population * 0.1,
  `${people}`);
check('规划的住宅街区数与户数口径可复算',
  residentialZones.length === document.accounting.residentialBlocks);

process.stdout.write('\n--- 实机：实时已购地图格与实时目录 ---\n');
let live = null;
try {
  live = await loadPurchasedTiles();
} catch (error) {
  process.stdout.write(`! 游戏未连接，跳过实机校验：${error?.message ?? error}\n`);
}
if (live) {
  const result = validateCityPlan({ purchased_tiles: live.tiles.map(tile => ({ tile_id: tile.tile_id, bounds: tile.bounds })), utilities: [] }, plan, bounds);
  check('规划几何全部位于当前已购地图格内（0 错误）', result.error_count === 0,
    result.issues.filter(issue => issue.severity === 'error').slice(0, 3).map(issue => `${issue.object_id}:${issue.code}`).join(','));
  const roadCatalog = await queryGame('list_road_prefabs', { limit: 100 });
  const roadNames = new Set((roadCatalog.data?.items ?? []).map(item => item.name));
  check('规划道路 prefab 都是当前城市存在的实时 prefab',
    roads.every(road => roadNames.has(road.prefab)),
    roads.filter(road => !roadNames.has(road.prefab)).map(road => `${road.id}:${road.prefab}`).join(','));
  const zoneCatalog = await queryGame('list_zone_types', { limit: 100 });
  const zoneNames = new Set((zoneCatalog.data?.items ?? []).map(item => item.name));
  check('规划分区名都是当前城市存在的实时分区预设',
    zones.every(zone => zoneNames.has(zone.kind)),
    zones.filter(zone => !zoneNames.has(zone.kind)).map(zone => `${zone.id}:${zone.kind}`).join(','));
  const serviceNames = new Set();
  for (const tool of ['list_city_service_prefabs', 'list_utility_facility_prefabs']) {
    for (const offset of [0, 100]) {
      const catalog = await queryGame(tool, { kind: 'all', unlocked_only: false, offset, limit: 100 });
      const items = catalog.data?.items ?? [];
      for (const item of items) serviceNames.add(item.name);
      if (items.length < 100) break;
    }
  }
  check('规划建筑 prefab 都是当前城市存在的服务/公用设施 prefab',
    buildings.every(building => serviceNames.has(building.prefab)),
    buildings.filter(building => !serviceNames.has(building.prefab)).map(building => `${building.id}:${building.prefab}`).join(','));
}

process.stdout.write(failures > 0 ? `\n${failures} 项失败（共 ${total} 项）\n` : `\n全部通过（共 ${total} 项）\n`);
if (failures > 0) process.exitCode = 1;
