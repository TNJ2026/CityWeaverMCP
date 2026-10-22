// 只读勘察：为「佩奇代尔 正六边形城镇」取地形、水体、既有路网与实时 prefab 目录。
// 不暂停城市、不创建任何原生预览、不产生任何永久对象。
// 用法：node tools/survey-hexagon-site.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const ROOT = 'D:/Develop/game/CityWeaverMCP';
const SDK = `file:///${ROOT}/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm`;
const { Client } = await import(`${SDK}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);

// 已购区域：4 列 × 5 行共 20 格，实测并集
const OWNED = { min_x: -1558.26074, min_z: -2804.86914, max_x: 934.956543, max_z: 311.652344 };
const WATER_BOUNDS = { min_x: -1600, min_z: -2860, max_x: 1000, max_z: 370 };
const CELL = 128;

const client = new Client({ name: 'hexagon-site-survey', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${ROOT}/mcp/server.mjs`],
  cwd: `${ROOT}/mcp`
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const payload = r.structuredContent ?? r;
  if (payload && payload.ok === false) throw new Error(`${name}: ${JSON.stringify(payload).slice(0, 400)}`);
  return payload;
};

const page = async (name, args, limit = 100) => {
  const items = [];
  for (let offset = 0; offset < 2000; offset += limit) {
    const r = await call(name, { ...args, offset, limit });
    const batch = r?.data?.items ?? [];
    items.push(...batch);
    if (batch.length < limit) break;
  }
  return items;
};

await mkdir(`${ROOT}/artifacts`, { recursive: true });

try {
  await client.connect(transport);

  // ---------- 1. 地形 16×16 ----------
  const xs = Array.from({ length: 16 }, (_, i) => -1540 + 160 * i);
  const zs = Array.from({ length: 16 }, (_, j) => -2800 + 200 * j);
  const points = [];
  for (const z of zs) for (const x of xs) points.push({ x, z });
  const terrain = await call('sample_terrain', { points });
  const tItems = terrain?.data?.items ?? terrain?.data?.samples ?? terrain?.data?.points ?? [];
  const tMap = new Map(tItems.map(s => [`${Math.round(s.x ?? s.position?.x)}|${Math.round(s.z ?? s.position?.z)}`, s.height_m ?? s.height ?? s.y ?? s.elevation_m]));
  await writeFile(`${ROOT}/artifacts/hex-survey-terrain.json`, JSON.stringify(terrain, null, 2));

  console.log('=== 地形矩阵（行 = z 从北到南，列 = x 从西到东，单位 m）===');
  console.log('x: ' + xs.map(v => String(v).padStart(7)).join(''));
  const terrainValues = [];
  for (const z of zs) {
    const row = xs.map(x => tMap.get(`${x}|${z}`));
    row.forEach(v => { if (typeof v === 'number' && Number.isFinite(v)) terrainValues.push(v); });
    console.log(`z=${String(z).padStart(6)} ` + row.map(v => (typeof v === 'number' ? v.toFixed(1) : '  ?  ').padStart(7)).join(''));
  }
  const tMin = Math.min(...terrainValues), tMax = Math.max(...terrainValues);
  console.log(`地形：min ${tMin.toFixed(1)} m / max ${tMax.toFixed(1)} m / 起伏 ${(tMax - tMin).toFixed(1)} m（样本 ${terrainValues.length}）`);

  // ---------- 2. 水体掩码 ----------
  const waterArgs = { bounds: WATER_BOUNDS, cell_size_m: CELL, limit: 1024 };
  let water = await call('read_surface_water_mask', waterArgs);
  const wCells = water?.data?.cells ?? water?.data?.items ?? [];
  await writeFile(`${ROOT}/artifacts/hex-survey-water.json`, JSON.stringify(water, null, 2));
  const wet = wCells.filter(c => (c.depth_m ?? c.water_depth_m ?? 0) > 0.01);
  const maxDepth = wet.reduce((m, c) => Math.max(m, c.depth_m ?? c.water_depth_m ?? 0), 0);
  console.log(`\n=== 水体掩码（cell ${CELL} m）===`);
  console.log(`总格 ${wCells.length}，有水 ${wet.length} 格，最深 ${maxDepth.toFixed(2)} m`);
  if (wet.length) {
    const wx = wet.map(c => c.x ?? c.center?.x), wz = wet.map(c => c.z ?? c.center?.z);
    console.log(`水体外接：x ${Math.min(...wx).toFixed(0)}..${Math.max(...wx).toFixed(0)} / z ${Math.min(...wz).toFixed(0)}..${Math.max(...wz).toFixed(0)}`);
    console.log('最深 8 格：' + wet.sort((a, b) => (b.depth_m ?? 0) - (a.depth_m ?? 0)).slice(0, 8)
      .map(c => `(${(c.x ?? c.center?.x).toFixed(0)},${(c.z ?? c.center?.z).toFixed(0)}) ${(c.depth_m ?? c.water_depth_m).toFixed(1)}m`).join('  '));
  }

  // ---------- 3. 既有路网与建筑 ----------
  const snap = await call('get_planning_map_snapshot', { bounds: OWNED, max_features_per_layer: 5000 });
  await writeFile(`${ROOT}/artifacts/hex-survey-snapshot.json`, JSON.stringify(snap, null, 2));
  const d = snap?.data ?? {};
  const roads = d.roads ?? [], buildings = d.buildings ?? [], tracks = d.tracks ?? [], utilities = d.utilities ?? [];
  console.log('\n=== 既有几何（规划范围内）===');
  console.log(`道路 ${roads.length} 段 / 建筑 ${buildings.length} 栋 / 轨道 ${tracks.length} 段 / 独立管网 ${utilities.length} 段`);
  if (roads.length) {
    let len = 0;
    for (const r of roads) {
      const c = r.curve ?? {};
      const pts = ['a', 'b', 'c', 'd'].map(k => c[k]).filter(Boolean);
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    console.log(`既有道路折线总长 ${(len / 1000).toFixed(2)} km；样例：${roads.slice(0, 6).map(r => r.prefab ?? r.prefab_name ?? '?').join(', ')}`);
  }
  if (buildings.length) {
    console.log('既有建筑样例：' + buildings.slice(0, 10).map(b => `${b.prefab ?? b.prefab_name ?? '?'}@(${(b.position?.x ?? 0).toFixed(0)},${(b.position?.z ?? 0).toFixed(0)})`).join('  '));
  }

  // ---------- 4. 道路 prefab ----------
  const roadPrefabs = await page('list_road_prefabs', { search: '' }, 100);
  await writeFile(`${ROOT}/artifacts/hex-survey-road-prefabs.json`, JSON.stringify(roadPrefabs, null, 2));
  console.log(`\n=== 道路 prefab（${roadPrefabs.length}）===`);
  const byWidth = {};
  for (const p of roadPrefabs) {
    const w = p.width_m ?? p.width ?? '?';
    (byWidth[w] ??= []).push(`${p.name}${p.locked ? '(锁)' : ''}`);
  }
  for (const w of Object.keys(byWidth).sort((a, b) => Number(a) - Number(b))) {
    console.log(`  ${String(w).padStart(3)} m: ${byWidth[w].join(', ')}`);
  }

  // ---------- 5. 分区类型 ----------
  const zoneTypes = await call('list_zone_types', { unlocked_only: true });
  const zItems = zoneTypes?.data?.items ?? [];
  await writeFile(`${ROOT}/artifacts/hex-survey-zone-types.json`, JSON.stringify(zoneTypes, null, 2));
  console.log(`\n=== 分区类型（${zItems.length}）===`);
  console.log(zItems.map(z => `${z.name}${z.area_type ? `[${z.area_type}]` : ''}${z.lot_support === false ? '(无地块)' : ''}`).join('\n  '));

  // ---------- 6. 市政服务 prefab ----------
  const services = await page('list_city_service_prefabs', {}, 100);
  await writeFile(`${ROOT}/artifacts/hex-survey-services.json`, JSON.stringify(services, null, 2));
  console.log(`\n=== 市政服务 prefab（${services.length}）===`);
  const svcByKind = {};
  for (const s of services) (svcByKind[s.kind ?? 'other'] ??= []).push(s);
  for (const [k, list] of Object.entries(svcByKind)) {
    console.log(`  ${k} (${list.length}): ` + list.slice(0, 14).map(s => {
      const sz = s.size_m ?? {};
      const dim = sz.x && sz.z ? `${Math.round(sz.x)}x${Math.round(sz.z)}` : '?';
      return `${s.name}(${dim}${s.requires_road === false ? ',不需临路' : ',临路'},${Math.round((s.construction_cost ?? 0) / 1000)}k)`;
    }).join('  '));
  }

  // ---------- 7. 公用设施 prefab ----------
  const utils = await page('list_utility_facility_prefabs', {}, 100);
  await writeFile(`${ROOT}/artifacts/hex-survey-utilities.json`, JSON.stringify(utils, null, 2));
  console.log(`\n=== 公用设施 prefab（${utils.length}）===`);
  for (const u of utils.slice(0, 60)) {
    const sz = u.size_m ?? {};
    console.log(`  [${u.kind ?? '?'}] ${u.name} ${sz.x ? `${Math.round(sz.x)}x${Math.round(sz.z)}` : '?'} ${u.requires_road === false ? '不需临路' : '临路'} ${Math.round((u.construction_cost ?? 0) / 1000)}k`);
  }

  console.log('\nSURVEY: OK');
} catch (e) {
  console.error('SURVEY: FAIL -', e.message);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
