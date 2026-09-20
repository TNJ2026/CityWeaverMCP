// 一次性：为五边形城施工图生成局部放大 HTML（投影口径从渲染产物实测反查）
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('artifacts/nis-pentagon-plan.html', 'utf8');
const focusMatch = html.match(/const focusView = (\{[^\n]*?\}|null);/);
const zoomMatch = html.match(/const maxZoom = \d+;/);
if (!focusMatch || !zoomMatch) throw new Error('渲染器已改版');

// 实测投影：连接道 baked path M768.36,571.87 ↔ 世界 (-312,2200)
const SX = (wx) => 800 + 0.1014 * wx;
const SY = (wz) => 795 - 0.1014 * wz;
const MAXZOOM = 30;

function focusView(b, pad = 40) {
  const x0 = SX(b.min_x - pad); const x1 = SX(b.max_x + pad);
  const y0 = SY(b.max_z + pad); const y1 = SY(b.min_z - pad);
  let width = Math.abs(x1 - x0); let height = Math.abs(y1 - y0);
  // 保持与画布等比，避免 letterboxing
  const aspect = 1600 / 1600;
  if (width / height < aspect) width = height * aspect; else height = width / aspect;
  width = Math.max(1600 / MAXZOOM, Math.min(1600, width));
  height = Math.max(1600 / MAXZOOM, Math.min(1600, height));
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  let x = cx - width / 2; let y = cy - height / 2;
  x = Math.max(0, Math.min(1600 - width, x));
  y = Math.max(0, Math.min(1600 - height, y));
  return { x, y, width, height };
}

const targets = [
  { key: 'core', name: '市中心', bounds: { min_x: -812, min_z: 500, max_x: 188, max_z: 1500 } },
  { key: 'campus', name: '南市政带', bounds: { min_x: -800, min_z: -520, max_x: 200, max_z: 120 } },
];
for (const t of targets) {
  const view = focusView(t.bounds);
  const out = html.replace(zoomMatch[0], `const maxZoom = ${MAXZOOM};`).replace(focusMatch[0], `const focusView = ${JSON.stringify(view)};`);
  const file = `artifacts/nis-pentagon-zoom-${t.key}.html`;
  writeFileSync(file, out, 'utf8');
  console.log(t.name, '->', file, JSON.stringify(view));
}
