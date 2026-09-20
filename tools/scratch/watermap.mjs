// 一次性脚本：把 read_surface_water_mask 的落盘结果解析成 ASCII 岸线图。
// 用法：node tools/scratch/watermap.mjs <tool-result.txt>
import { readFile } from 'node:fs/promises';

const raw = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { resolution, cells } = raw.data;
const grid = Array.from({ length: resolution.z }, () => Array(resolution.x).fill(null));
for (const cell of cells) grid[cell.grid_z][cell.grid_x] = cell;
// 北上打印：grid_z 大 = 北（z 更接近 world_bounds.max_z）
console.log(raw.data.world_bounds, 'cell', raw.data.cell_size_m + 'm', '图例: 空=陆地 .=浅水(0-2m) +=中水(2-10m) #=深水(>10m)');
for (let gz = resolution.z - 1; gz >= 0; gz--) {
  const row = [];
  for (let gx = 0; gx < resolution.x; gx++) {
    const cell = grid[gz][gx];
    if (!cell) { row.push('?'); continue; }
    if (cell.water) row.push(cell.water_depth_m > 10 ? '#' : cell.water_depth_m > 2 ? '+' : '.');
    else row.push(' ');
  }
  console.log(String(Math.round(grid[gz][0].z)).padStart(6), row.join(''));
}
