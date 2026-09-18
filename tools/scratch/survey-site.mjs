// 只读选址勘察：在给定 bbox 上采样地形高程与水体，打印可建性网格。
// 不写入城市、不改变模拟状态。用法：
//   node tools/scratch/survey-site.mjs --min-x -3400 --max-x 1600 --min-z 200 --max-z 2800 --step 100
// 判定口径来自 tools/lib/physics-rules.mjs：道路限坡 15%（Small Road 规格），因此这里用
// 「相邻采样点高差 / 采样步长」估算坡度，超过 15% 记为陡坡（不可铺路）。
import { queryGame } from '../../mcp/bridge-client.mjs';
import { ROAD_SPECIFICATIONS, MAX_ZONING_DEPTH_M } from '../lib/physics-rules.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? Number(argv[index + 1]) : fallback;
};

const box = {
  min_x: arg('min-x', -3400), max_x: arg('max-x', 1600),
  min_z: arg('min-z', 200), max_z: arg('max-z', 2800),
};
const step = arg('step', 100);
const maxSlope = ROAD_SPECIFICATIONS['Small Road'].max_slope_percent / 100;

const xs = [];
for (let x = box.min_x; x <= box.max_x + 0.001; x += step) xs.push(Math.round(x));
const zs = [];
for (let z = box.max_z; z >= box.min_z - 0.001; z -= step) zs.push(Math.round(z));

async function sampleTerrain() {
  const heights = new Map();
  const points = [];
  for (const x of xs) for (const z of zs) points.push({ x, z });
  const chunk = 256; // 游戏侧上限：单次 1..256 个坐标
  for (let index = 0; index < points.length; index += chunk) {
    const response = await queryGame('sample_terrain', { points: points.slice(index, index + chunk) });
    if (!response?.ok) throw new Error(response?.error?.code ?? 'SAMPLE_TERRAIN_FAILED');
    for (const item of response.data.items ?? response.data.samples ?? []) {
      heights.set(`${item.x}|${item.z}`, Number(item.height_m));
    }
  }
  return heights;
}

async function sampleWater() {
  const cell = Math.max(64, step);
  const response = await queryGame('read_surface_water_mask', { bounds: box, cell_size_m: cell, limit: 1024 });
  if (!response?.ok) throw new Error(response?.error?.code ?? 'WATER_MASK_FAILED');
  const cells = (response.data.cells ?? []).filter(item => item.water).map(item => ({ x: Number(item.x), z: Number(item.z) }));
  return { cells, cell };
}

async function loadOwnedTiles() {
  const response = await queryGame('list_map_tiles', { state: 'owned', limit: 100 });
  if (!response?.ok) throw new Error(response?.error?.code ?? 'TILE_QUERY_FAILED');
  return response.data.items ?? [];
}

const [heights, water, tiles] = await Promise.all([sampleTerrain(), sampleWater(), loadOwnedTiles()]);
const owned = tile => point => point.x >= tile.bounds.min_x && point.x <= tile.bounds.max_x && point.z >= tile.bounds.min_z && point.z <= tile.bounds.max_z;

const at = (x, z) => heights.get(`${x}|${z}`);
const isOwned = (x, z) => tiles.some(tile => owned(tile)({ x, z }));
// 四邻最大坡度：取相邻采样点的最大高差除以步长
const slopeAt = (x, z) => {
  const here = at(x, z);
  let worst = 0;
  for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
    const other = at(x + dx, z + dz);
    if (other === undefined || here === undefined) continue;
    worst = Math.max(worst, Math.abs(other - here) / step);
  }
  return worst;
};
// 水体掩码按 cell 中心返回，采样点落在半个 cell 内即视为有水
const isWet = (x, z) => water.cells.some(cell => Math.abs(cell.x - x) <= water.cell / 2 && Math.abs(cell.z - z) <= water.cell / 2);

const header = `        ${xs.map(x => String(x).padStart(6)).join('')}`;
console.log(header);
let flatOwned = 0, ownedCount = 0;
for (const z of zs) {
  let line = String(z).padStart(7);
  for (const x of xs) {
    const height = at(x, z);
    const inOwned = isOwned(x, z);
    const wetHere = isWet(x, z);
    let mark;
    if (height === undefined) mark = '    ? ';
    else if (!inOwned) mark = '    · ';
    else {
      ownedCount += 1;
      const steep = slopeAt(x, z) > maxSlope;
      if (!steep && !wetHere) flatOwned += 1;
      mark = `${steep ? '^' : wetHere ? '~' : ' '}${String(Math.round(height)).padStart(4)} `;
    }
    line += mark.padStart(6);
  }
  console.log(line);
}

const usable = (x, z) => isOwned(x, z) && at(x, z) !== undefined && slopeAt(x, z) <= maxSlope && !isWet(x, z);
const flat = [];
for (const z of zs) for (const x of xs) if (usable(x, z)) flat.push({ x, z, h: at(x, z) });
const byH = {};
for (const point of flat) { const key = Math.round(point.h / 20) * 20; (byH[key] = byH[key] ?? []).push(point); }

// 连通可用区（4 邻接 BFS），用于挑连续的成片平地
const key = (x, z) => `${x}|${z}`;
const usableSet = new Set(flat.map(point => key(point.x, point.z)));
const seen = new Set();
const components = [];
for (const point of flat) {
  if (seen.has(key(point.x, point.z))) continue;
  const stack = [point];
  const members = [];
  seen.add(key(point.x, point.z));
  while (stack.length) {
    const current = stack.pop();
    members.push(current);
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = { x: current.x + dx, z: current.z + dz };
      if (!usableSet.has(key(next.x, next.z)) || seen.has(key(next.x, next.z))) continue;
      seen.add(key(next.x, next.z));
      stack.push(next);
    }
  }
  components.push(members);
}
const largest = components.sort((a, b) => b.length - a.length).slice(0, 5).map(members => ({
  samples: members.length,
  area_km2: Number((members.length * step * step / 1e6).toFixed(2)),
  x: [Math.min(...members.map(p => p.x)), Math.max(...members.map(p => p.x))],
  z: [Math.min(...members.map(p => p.z)), Math.max(...members.map(p => p.z))],
  height_m: [Math.round(Math.min(...members.map(p => p.h))), Math.round(Math.max(...members.map(p => p.h)))],
}));

console.log(JSON.stringify({
  step_m: step,
  legend: '行=z，列=x；格内为高程米数，前缀 ^ = 坡度超 15%（不可铺路），~ = 有水，· = 未购/无数据',
  owned_samples: ownedCount,
  flat_owned: flat.length,
  max_zoning_depth_m: MAX_ZONING_DEPTH_M,
  own_tiles: tiles.length,
  largest_flat_components: largest,
  height_bands: Object.entries(byH).sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    .map(([h, list]) => ({
      band_m: `${h}–${Number(h) + 20}`,
      samples: list.length,
      x: [Math.min(...list.map(p => p.x)), Math.max(...list.map(p => p.x))],
      z: [Math.min(...list.map(p => p.z)), Math.max(...list.map(p => p.z))],
    })),
}, null, 1));
