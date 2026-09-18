// 一次性工具：把交互规划页的「初始视图」按指定世界坐标框逐个覆写，
// 生成若干局部放大 HTML，便于无头截图逐片区核对。
// 页面默认把放大上限锁在 10×（2200px 画布 / 10 = 220px ≈ 2253m），任何片区视图
// 都会被 clampView 夹回「几乎全城」。所以这里同时覆写 maxZoom 才能真正看清片区内部。
//
// 用法：node tools/scratch/zoom-plan-views.mjs <in.html> <plan.json> <outdir> [--pad 90] [--zoom 30]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const [inHtml, planPath, outDir] = positional;
if (!inHtml || !planPath || !outDir) {
  throw new Error('Usage: node zoom-plan-views.mjs <in.html> <plan.json> <outdir> [--pad 90] [--zoom 30]');
}
const pad = flag('pad', 90);
const maxZoom = flag('zoom', 30);

const html = await readFile(inHtml, 'utf8');
const plan = JSON.parse(await readFile(planPath, 'utf8'));

// 与 mcp/planning-interactive.mjs 的 focusViewOf 保持同一套换算。
// 画布尺寸必须取规划自己的 render.width / render.height，否则视图会整体跑偏。
const WORLD_MIN = -7167.99951;
const WORLD_MAX = 7167.99951;
const WIDTH = Number(plan.render?.width ?? 1600);
const HEIGHT = Number(plan.render?.height ?? 1000);

function focusView(b) {
  const worldWidth = WORLD_MAX - WORLD_MIN;
  const worldHeight = WORLD_MAX - WORLD_MIN;
  const planWidth = b.max_x - b.min_x;
  const planHeight = b.max_z - b.min_z;
  const scale = Math.min(WIDTH / worldWidth, HEIGHT / worldHeight);
  const left = (WIDTH - worldWidth * scale) / 2;
  const top = (HEIGHT - worldHeight * scale) / 2;
  const centerX = left + ((b.min_x + b.max_x) / 2 - WORLD_MIN) * scale;
  const centerY = top + (WORLD_MAX - (b.min_z + b.max_z) / 2) * scale;
  const margin = 1 + 2 * 0.06;
  let viewWidth = planWidth * scale * margin;
  let viewHeight = planHeight * scale * margin;
  const grow = Math.max(1, WIDTH / maxZoom / viewWidth, HEIGHT / maxZoom / viewHeight);
  viewWidth *= grow; viewHeight *= grow;
  const shrink = Math.min(1, WIDTH / viewWidth, HEIGHT / viewHeight);
  viewWidth *= shrink; viewHeight *= shrink;
  const v = { x: centerX - viewWidth / 2, y: centerY - viewHeight / 2, width: viewWidth, height: viewHeight };
  // 复刻页面里的 clampView：宽高各有上下限，越界会被强行夹住（此时因 preserveAspectRatio 会留黑边）。
  v.width = Math.max(WIDTH / maxZoom, Math.min(WIDTH, v.width));
  v.height = Math.max(HEIGHT / maxZoom, Math.min(HEIGHT, v.height));
  v.x = Math.max(0, Math.min(WIDTH - v.width, v.x));
  v.y = Math.max(0, Math.min(HEIGHT - v.height, v.y));
  return v;
}

const focusMatch = html.match(/const focusView = (\{[^\n]*?\}|null);/);
const zoomMatch = html.match(/const maxZoom = \d+;/);
if (!focusMatch || !zoomMatch) throw new Error('未在 HTML 中找到 focusView / maxZoom 定义，渲染器可能已改版。');

const patched = html.replace(zoomMatch[0], `const maxZoom = ${maxZoom};`);

const targets = [
  ...plan.districts.map(d => ({ key: d.key, name: d.name, bounds: d.bounds })),
  { key: 'all', name: '全区', bounds: plan.bounds },
];

for (const t of targets) {
  const b = {
    min_x: t.bounds.min_x - pad,
    max_x: t.bounds.max_x + pad,
    min_z: t.bounds.min_z - pad,
    max_z: t.bounds.max_z + pad,
  };
  const view = focusView(b);
  const span = `宽 ${(view.width / 0.097656).toFixed(0)}m × 高 ${(view.height / 0.097656).toFixed(0)}m`;
  const out = patched.replace(focusMatch[0], `const focusView = ${JSON.stringify(view)};`);
  const file = path.join(outDir, `egelin-region-zoom-${t.key}.html`);
  await writeFile(file, out, 'utf8');
  console.log(`${t.name.padEnd(8)} -> ${path.basename(file)}  ${span}  view=${JSON.stringify(view)}`);
}
