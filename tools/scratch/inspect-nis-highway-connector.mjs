// 查看上一版五边形城在本地图中成功的「高速接驳路」原生预览参数，作为本次锚点参照。
//   node tools/scratch/inspect-nis-highway-connector.mjs
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

for (const file of [
  'artifacts/nis-pentagon-roads-highway-connector-preview.json',
  'artifacts/nis-pentagon-roads-highway-connector-commit.json',
]) {
  if (!existsSync(file)) { console.log(`${file}: MISSING`); continue; }
  const text = await readFile(file, 'utf8');
  const doc = JSON.parse(text);
  console.log(`=== ${file}`);
  console.log(JSON.stringify({
    state: doc.state ?? doc.native_preview?.state,
    cost: doc.native_preview?.cost ?? doc.cost,
    errors: doc.native_preview?.errors ?? doc.errors,
    msg: doc.message ?? doc.error ?? doc.native_preview?.error,
  }));
  const points = text.match(/"points":\s*\[[^\]]*\]/g);
  if (points) console.log('points:', points.join(' ').slice(0, 900));
  const nodeIds = [...new Set(text.match(/[a-f0-9]{32}:\d+:\d+/g) ?? [])];
  console.log('entity ids seen:', nodeIds.slice(0, 8));
}
