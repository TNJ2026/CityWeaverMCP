// 打印环路点列，并检查污水处理厂候选位置与环路的实际冲突。
//   node tools/scratch/peiqi-riverside-check.mjs
import { readFile } from 'node:fs/promises';

const doc = JSON.parse(await readFile('plans/peiqi-pentagon-city-plan.json', 'utf8'));
const plan = doc.plan;
const ring = plan.roads.find((r) => r.id === 'pentagon-ring');
console.log('ring prefab', ring.prefab, 'width', ring.width_m);
console.log('ring points', JSON.stringify(ring.points));

const spine = plan.roads.find((r) => r.id === 'riverside-spine');
console.log('spine points', JSON.stringify(spine?.points));
const access = plan.roads.find((r) => r.id === 'riverside-access');
console.log('access points', JSON.stringify(access?.points));
const portal = plan.roads.find((r) => r.id === 'highway-portal-link');
console.log('portal points', JSON.stringify(portal?.points), 'len', portal ? Math.hypot(portal.points[1].x - portal.points[0].x, portal.points[1].z - portal.points[0].z).toFixed(4) : null);
const gateway = plan.roads.find((r) => r.id === 'gateway-highway');
console.log('gateway points', JSON.stringify(gateway?.points));

// 候选：污水处理厂沿 riverside-spine 东侧
const size = [95.6, 79.6];
const halfRoad = 24 / 2, gap = 4;
const depth = size[1], width = size[0];
const offset = halfRoad + gap + depth / 2;
for (const centreZ of [-372.2, -212.6, -73, 10]) {
  const centre = { x: 344 + offset, z: centreZ };
  const halfX = depth / 2 + 2, halfZ = width / 2 + 2;
  const hits = [];
  for (const road of [...plan.roads]) {
    const hr = road.width_m / 2;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i];
      const minX = centre.x - halfX - hr, maxX = centre.x + halfX + hr;
      const minZ = centre.z - halfZ - hr, maxZ = centre.z + halfZ + hr;
      let t0 = 0, t1 = 1;
      for (const [o, d, low, high] of [[a.x, b.x - a.x, minX, maxX], [a.z, b.z - a.z, minZ, maxZ]]) {
        if (Math.abs(d) < 1e-9) { if (o < low || o > high) { t0 = 2; break; } continue; }
        let near = (low - o) / d, far = (high - o) / d;
        if (near > far) [near, far] = [far, near];
        t0 = Math.max(t0, near); t1 = Math.min(t1, far);
        if (t0 > t1) { t0 = 2; break; }
      }
      if (t0 <= t1) hits.push(road.id);
    }
  }
  console.log(JSON.stringify({ centre, hits: [...new Set(hits)] }));
}
console.log('riverside buildings', JSON.stringify(plan.buildings.filter((b) => (b.label ?? '').match(/垃圾|回收|污水|变电/)).map((b) => ({ label: b.label, position: b.position }))));
