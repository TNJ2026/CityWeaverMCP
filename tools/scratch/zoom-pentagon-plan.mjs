// 一次性视觉复核：把施工图 SVG 裁到五边形范围并栅格化为 PNG，供人工/模型查看。
//   node tools/scratch/zoom-pentagon-plan.mjs <input.svg> <output.png> [minX minY width] 
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/cheng/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/');
const sharp = require('sharp');

const [input, output, minX = '940', minY = '500', size = '260'] = process.argv.slice(2);
const svg = await readFile(input, 'utf8');
const zoomed = svg.replace(
  /width="2200" height="1500" viewBox="0 0 2200 1500"/,
  `width="1500" height="1500" viewBox="${minX} ${minY} ${size} ${size}"`,
);
if (zoomed === svg) throw new Error('未能改写 SVG viewBox，渲染器输出格式可能已变化');
const temporary = `${output}.zoom.svg`;
await writeFile(temporary, zoomed, 'utf8');
await sharp(temporary, { density: 300 }).png().toFile(output);
console.log(JSON.stringify({ output, viewBox: `${minX} ${minY} ${size} ${size}` }));
