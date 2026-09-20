import fs from 'node:fs';
import { queryGame } from '../../mcp/bridge-client.mjs';

async function main() {
  const planDoc = JSON.parse(fs.readFileSync('plans/meridian-circular-town-plan.json', 'utf8'));
  const roads = planDoc.plan.roads.map(r => ({ ...r, construction_status: 'built' }));
  const plan = { ...planDoc.plan, roads };

  console.log('Calling bind_city_plan_buildings...');
  const res = await queryGame('bind_city_plan_buildings', {
    request_id: 'bind-meridian-bld-01',
    bounds: planDoc.bounds,
    plan,
    search_radius_m: 300,
    continue_on_error: true
  });

  console.log('Bind result: ok =', res.ok);
  if (res.data) {
    const buildings = res.data.plan?.buildings || [];
    const bound = buildings.filter(item => item.placement_status === 'candidate_bound' || item.placement_status === 'preview_ready');
    console.log(`Bound buildings count: ${bound.length} of ${buildings.length}`);
    for (const bld of buildings) {
      console.log(`- ${bld.id} (${bld.label}): status=${bld.placement_status} edge=${bld.road_edge_id || bld.position?.edge_id || 'none'} rot=${bld.rotation_degrees}`);
    }
    // Save bound plan
    fs.writeFileSync('artifacts/meridian-bound-plan.json', JSON.stringify(res.data, null, 2), 'utf8');
    console.log('[OK] Bound plan saved to artifacts/meridian-bound-plan.json');
  } else {
    console.log('Error:', res.error);
  }
}

main().catch(console.error);
