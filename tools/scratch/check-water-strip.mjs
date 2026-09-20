// 读取 read_surface_water_mask 的落盘结果，统计含水格与其世界范围。
//   node tools/scratch/check-water-strip.mjs <spill.txt>
import { readFile } from 'node:fs/promises';

const text = await readFile(process.argv[2], 'utf8');
const match = text.match(/"cells":\[(.*?)\]/s);
if (!match) throw new Error('未在结果中找到 cells 数组');
const cells = JSON.parse(`[${match[1]}]`);
const water = cells.filter(cell => cell.water);
console.log(JSON.stringify({
  cells: cells.length,
  water_cells: water.length,
  water_x_range: water.length ? [Math.min(...water.map(c => c.x)), Math.max(...water.map(c => c.x))] : null,
  water_z_range: water.length ? [Math.min(...water.map(c => c.z)), Math.max(...water.map(c => c.z))] : null,
  deepest: water.length ? Math.max(...water.map(c => c.water_depth_m)) : 0,
  sample: water.slice(0, 8).map(c => ({ x: c.x, z: c.z, d: c.water_depth_m })),
}, null, 2));
