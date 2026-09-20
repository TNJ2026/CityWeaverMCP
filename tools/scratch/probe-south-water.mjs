// 一次性勘察：已购区东南片（拟作南城设施园）是否有地表水。
import { queryGame } from '../../mcp/bridge-client.mjs';

const BOUNDS = { min_x: -512, min_z: -2816, max_x: 960, max_z: -1472 };
const CELL = 64;
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
let output = '';
const water = [];
for (let row = 0; row < rows; row++) {
  let line = '';
  for (let column = 0; column < columns; column++) {
    const cell = grid.get(`${column}:${row}`);
    if (!cell) { line += '?'; continue; }
    if (cell.water) { line += cell.water_depth_m >= 3 ? '#' : ':'; water.push(cell); }
    else line += '.';
  }
  output += `${String(Math.round(BOUNDS.min_z + (row + 0.5) * CELL)).padStart(6)} ${line}\n`;
}
console.log(`东南片 ${columns}x${rows}，cell ${CELL} m（'.' 干地  ':' 浅水  '#' 深水）`);
console.log(output);
console.log(`水域格 ${water.length}${water.length ? `，x ${Math.min(...water.map(c => c.x))}..${Math.max(...water.map(c => c.x))}，z ${Math.min(...water.map(c => c.z))}..${Math.max(...water.map(c => c.z))}，最大水深 ${Math.max(...water.map(c => c.water_depth_m)).toFixed(2)} m` : ''}`);
