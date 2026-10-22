// 预检：生成器引用的 prefab 名称是否都在实时目录里
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const load = async f => {
  const r = JSON.parse(await readFile(`${repoRoot}/artifacts/${f}`, 'utf8'));
  if (Array.isArray(r)) return r;
  return r?.data?.items ?? [];
};

const svc = await load('hex-survey-services.json');
const utl = await load('hex-survey-utilities.json');
const all = [...svc, ...utl];
const names = new Set(all.map(i => i.name));

const src = await readFile(`${repoRoot}/tools/generate-hexagon-town-plan.mjs`, 'utf8');
const want = [...src.matchAll(/prefab:\s*'([^']+)'/g)].map(m => m[1]);
const uniq = [...new Set(want)];
const miss = uniq.filter(n => !names.has(n));

console.log(`目录条目: services=${svc.length} utilities=${utl.length} 合计=${all.length}`);
console.log(`生成器引用 prefab(去重)=${uniq.length}`);
console.log('缺失:', miss.length ? miss.join(', ') : '无');

const k = {};
for (const i of all) k[i.kind] = (k[i.kind] || 0) + 1;
console.log('--- kind 分布 ---');
console.log(k);

// 顺带把关键 prefab 的占地尺寸打印出来，供方案核对
const KEY = ['GroundwaterPumpingStation01', 'WaterTower01', 'GasPowerPlant01', 'TransformerStation01',
  'WastewaterTreatmentPlant01', 'Hospital01', 'MedicalClinic01', 'FireHouse01', 'PoliceStation01',
  'PoliceStation02', 'ElementarySchool01', 'HighSchool02', 'College01', 'Cemetery01', 'Crematorium01',
  'Landfill01', 'PostOffice01', 'ParkMaintenanceDepot01', 'RoadMaintenanceDepot01', 'WelfareOffice01',
  'LargeEmergencyShelter01', 'EarlyDisasterWarningSystem01', 'TelecomTower01', 'RadioMast01',
  'CityPark02', 'CityPark08', 'CommunityPool01', 'BasketballCourt01', 'Playground01', 'PocketPark05',
  'ParkingLot01'];
console.log('--- 关键 prefab 占地 (格 / 米) ---');
for (const n of KEY) {
  const hit = all.find(i => i.name === n);
  if (!hit) { console.log(`${n}: [缺失]`); continue; }
  const c = hit.lot_cells ?? {};
  console.log(`${n}: kind=${hit.kind} cells=${c.width}x${c.length} size_m=${JSON.stringify(hit.size_m ?? null)} mode=${hit.placement_mode}`);
}
