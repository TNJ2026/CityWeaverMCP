import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

async function main() {
  const planDoc = JSON.parse(readFileSync('plans/egelin-region-plan.json', 'utf8'));
  const snap = await queryGame('get_planning_map_snapshot', {
    bounds: planDoc.bounds,
    include_buildings: true,
    include_roads: false,
    max_features_per_layer: 5000,
  });
  const liveBuildings = snap.data?.buildings ?? [];
  console.log('Total live buildings in bounds:', liveBuildings.length);

  const planned = planDoc.plan.buildings;
  console.log('Total planned buildings:', planned.length);

  const matched = [];
  const unmatchedPlanned = [];

  for (const p of planned) {
    const samePrefab = liveBuildings.filter(b => b.prefab === p.prefab);
    let best = null, bestDist = Infinity;
    for (const b of samePrefab) {
      const d = Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    if (best && bestDist < 150) {
      matched.push({
        id: p.id,
        label: p.label,
        prefab: p.prefab,
        planned: p.position,
        live: best.position,
        rotation: best.rotation ?? 0,
        dist: bestDist,
        liveId: best.id,
      });
    } else {
      unmatchedPlanned.push({
        id: p.id,
        label: p.label,
        prefab: p.prefab,
        planned: p.position,
        bestDist: bestDist === Infinity ? null : bestDist,
      });
    }
  }

  console.log('\n--- MATCHED BUILDINGS ---');
  for (const m of matched) {
    console.log(`${m.id} (${m.prefab}) planned=(${m.planned.x}, ${m.planned.z}) live=(${m.live.x.toFixed(1)}, ${m.live.z.toFixed(1)}) dist=${m.dist.toFixed(2)}m entity=${m.liveId}`);
  }

  console.log('\n--- UNMATCHED PLANNED BUILDINGS ---');
  for (const u of unmatchedPlanned) {
    console.log(`${u.id} (${u.prefab}) planned=(${u.planned.x}, ${u.planned.z}) closestDist=${u.bestDist ? u.bestDist.toFixed(1) : 'none'}`);
  }

  const specialLive = liveBuildings.filter(b => {
    return !b.prefab.includes('Residential') && !b.prefab.includes('Commercial') && !b.prefab.includes('Industrial') && !b.prefab.includes('Office');
  });
  console.log(`\n--- ALL SPECIAL/SERVICE LIVE BUILDINGS (${specialLive.length}) ---`);
  for (const b of specialLive) {
    const isMatched = matched.some(m => m.liveId === b.id);
    console.log(`[${isMatched ? 'MATCHED' : 'EXTRA'}] ${b.id}: prefab=${b.prefab}, pos=(${b.position.x.toFixed(1)}, ${b.position.y.toFixed(1)}, ${b.position.z.toFixed(1)}), rot=${b.rotation?.toFixed ? b.rotation.toFixed(1) : b.rotation}`);
  }
}

main().catch(console.error);
