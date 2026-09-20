// 一次性诊断：查看某栋建筑与冲突道路的实际几何关系。
import { readFile } from 'node:fs/promises';

const document = JSON.parse(await readFile(process.argv[2], 'utf8'));
const label = process.argv[3];
const building = document.plan.buildings.find(item => item.label === label);
console.log('建筑:', building.label, building.prefab, JSON.stringify(building.position), JSON.stringify(building.size_m));
console.log('预留区:');
for (const site of document.reserved_sites) console.log(' ', JSON.stringify(site));
const halfX = (building.size_m.x + 4) / 2, halfZ = (building.size_m.z + 4) / 2;
const hits = [];
for (const road of document.plan.roads) {
  const halfRoad = road.width_m / 2;
  for (let index = 1; index < road.points.length; index++) {
    const a = road.points[index - 1], b = road.points[index];
    const near = Math.min(
      Math.hypot(a.x - building.position.x, a.z - building.position.z),
      Math.hypot(b.x - building.position.x, b.z - building.position.z));
    const padding = halfRoad + 8;
    if (near < Math.hypot(halfX, halfZ) + padding + 40) {
      hits.push({ id: road.id, prefab: road.prefab, width: road.width_m, a, b, near: Math.round(near) });
    }
  }
}
for (const hit of hits) console.log(' 近邻道路:', JSON.stringify(hit));
console.log('建筑外扩盒 x', building.position.x - halfX - 16, building.position.x + halfX + 16,
  'z', building.position.z - halfZ - 16, building.position.z + halfZ + 16);
