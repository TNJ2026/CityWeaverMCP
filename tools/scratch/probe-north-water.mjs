// 一次性勘察：补测已购区北半区（z ∈ [-200, 315]）的地表水，确认五边形北顶点附近无水。
import { queryGame } from '../../mcp/bridge-client.mjs';

const PENTAGON = [
  { x: -520, z: 160 }, { x: -1400, z: -480 }, { x: -1064, z: -1512 },
  { x: 24, z: -1512 }, { x: 360, z: -480 },
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

const BOUNDS = { min_x: -1600, min_z: -224, max_x: 960, max_z: 320 };
const CELL = 32;
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

const columns = Math.round((BOUNDS.max_x - BOUNDS.min_x) / CELL);
const rows = Math.round((BOUNDS.max_z - BOUNDS.min_z) / CELL);
console.log(`北半区采样 ${columns}×${rows}，cell ${CELL} m（'.' 干地  ':' 浅水  '#' 深水  'P' 五边形内干地）`);
let output = '';
const insideWater = [];
for (let row = 0; row < rows; row++) {
  let line = '';
  for (let column = 0; column < columns; column++) {
    const x = BOUNDS.min_x + (column + 0.5) * CELL, z = BOUNDS.min_z + (row + 0.5) * CELL;
    const cell = grid.get(`${column}:${row}`);
    if (!cell) { line += '?'; continue; }
    if (cell.water) {
      line += cell.water_depth_m >= 3 ? '#' : ':';
      if (insidePentagon({ x, z })) insideWater.push({ x, z, depth: cell.water_depth_m });
    } else line += insidePentagon({ x, z }) ? 'P' : ' ';
  }
  output += `${String(Math.round(BOUNDS.min_z + (row + 0.5) * CELL)).padStart(6)} ${line}\n`;
}
console.log(output);
console.log(`五边形北半区内的水域格：${insideWater.length}${insideWater.length ? `（最大水深 ${Math.max(...insideWater.map(c => c.depth)).toFixed(2)} m，x ${Math.min(...insideWater.map(c => c.x))}..${Math.max(...insideWater.map(c => c.x))}，z ${Math.min(...insideWater.map(c => c.z))}..${Math.max(...insideWater.map(c => c.z))}）` : ''}`);
