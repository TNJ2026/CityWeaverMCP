// 一次性勘察：逐行打印五边形内的水域区间（世界坐标），用于重新定五边形尺寸与位置。
import { queryGame } from '../../mcp/bridge-client.mjs';

const PENTAGON = [
  { x: -312, z: -216 }, { x: -1400, z: -1008 }, { x: -984, z: -2288 },
  { x: 360, z: -2288 }, { x: 776, z: -1008 },
];

function insidePentagon(point) {
  let sign = 0;
  for (let index = 0; index < PENTAGON.length; index++) {
    const a = PENTAGON[index], b = PENTAGON[(index + 1) % PENTAGON.length];
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

const BOUNDS = { min_x: -1472, min_z: -2336, max_x: 832, max_z: -160 };
const CELL = 16;
const grid = new Map();
let offset = 0;
for (;;) {
  const response = await queryGame('read_surface_water_mask', {
    bounds: BOUNDS, cell_size_m: CELL, water_threshold_m: 0.02, offset, limit: 1024,
  });
  for (const cell of response.data.cells) grid.set(`${cell.grid_x}:${cell.grid_z}`, cell);
  if (response.data.next_offset == null) break;
  offset = response.data.next_offset;
}

const rows = new Map();
for (const cell of grid.values()) {
  if (!cell.water) continue;
  if (!insidePentagon({ x: cell.x, z: cell.z })) continue;
  const list = rows.get(cell.z) ?? [];
  list.push(cell);
  rows.set(cell.z, list);
}

console.log('五边形内水域（每行区间，世界米，括号内为该区间最大水深）:');
let maxDepth = 0;
let totalCells = 0;
for (const z of [...rows.keys()].sort((a, b) => a - b)) {
  const cells = rows.get(z).sort((a, b) => a.x - b.x);
  const intervals = [];
  for (const cell of cells) {
    const last = intervals[intervals.length - 1];
    if (last && cell.x - last.end <= CELL + 1e-6) {
      last.end = cell.x;
      last.depth = Math.max(last.depth, cell.water_depth_m);
    } else intervals.push({ start: cell.x, end: cell.x, depth: cell.water_depth_m });
  }
  totalCells += cells.length;
  maxDepth = Math.max(maxDepth, ...cells.map(cell => cell.water_depth_m));
  console.log(`  z=${String(z).padStart(6)} : ${intervals.map(i => `${i.start}..${i.end}(${i.depth.toFixed(1)}m)`).join('  ')}`);
}
console.log(`合计 ${totalCells} 格 × ${CELL}² m = ${totalCells * CELL * CELL} m²；最大水深 ${maxDepth.toFixed(2)} m`);
console.log('五边形西边界/东边界（按行）:');
for (const z of [-2288, -2200, -2000, -1800, -1600, -1400, -1250, -1170, -1100, -1000, -900, -800, -720, -600, -400, -216]) {
  let west = Infinity, east = -Infinity;
  for (let x = -1500; x <= 850; x += 4) if (insidePentagon({ x, z })) { west = Math.min(west, x); east = Math.max(east, x); }
  if (west === Infinity) continue;
  console.log(`  z=${String(z).padStart(6)} : 西 ${west}  东 ${east}`);
}
