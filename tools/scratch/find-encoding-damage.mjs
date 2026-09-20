// 列出源码中全部编码损坏点（U+FFFD），供逐点修复。
//   node tools/scratch/find-encoding-damage.mjs <file>
import { readFile } from 'node:fs/promises';

const text = await readFile(process.argv[2], 'utf8');
const lines = text.split('\n');
let total = 0;
const report = [];
lines.forEach((line, index) => {
  const hits = [...line.matchAll(/\uFFFD+/g)];
  if (!hits.length) return;
  total += hits.length;
  report.push({ line: index + 1, hits: hits.length, text: line.trim() });
});
console.log(JSON.stringify({ damaged_lines: report.length, replacement_runs: total }, null, 2));
console.log(report.map(entry => `${entry.line}\t${entry.text}`).join('\n'));
