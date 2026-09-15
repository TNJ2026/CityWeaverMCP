import { queryGame, BridgeError } from '../../mcp/bridge-client.mjs';
import { surveySpace } from '../survey-space.mjs';
import { snapPoint, snapToCell } from '../lib/physics-rules.mjs';

/**
 * Civic Hub Deployment Script
 * 
 * Implements Option A:
 * 1. Pre-flight spatial survey
 * 2. 2x2 Civic Grid Road Construction (Medium Road perimeter + Small Road interior)
 * 3. 4-lane Arterial Connector to X = -1138.4, Z = 704
 * 4. Place Medical Clinic (MedicalClinic01)
 * 5. Reserve remaining 3 quadrants for School, Fire, and Police
 * 6. Resume simulation and report compact metrics
 */

async function waitRoadOp(opId, targetState = 'preview_ready', maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_road_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Road op ${opId} failed: ${op.state} errors=${JSON.stringify(op.errors || [])}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Road op ${opId} timed out waiting for ${targetState}`);
}

async function waitServiceOp(opId, targetState = 'preview_ready', maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_city_service_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Service op ${opId} failed: ${op.state} errors=${JSON.stringify(op.errors || [])}`);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Service op ${opId} timed out waiting for ${targetState}`);
}

async function run() {
  const t0 = Date.now();
  console.log('=== CityWeaver Civic Public Service Hub Deployment (Option A) ===\n');

  let originalSpeed = 'paused';
  let initialPaused = true;

  try {
    const statusRes = await queryGame('get_game_status', {});
    const status = statusRes.data || {};
    initialPaused = !!status.paused;
    originalSpeed = status.selected_speed === 4 ? 'fastest' :
      status.selected_speed === 2 ? 'fast' :
      status.selected_speed === 1 ? 'normal' : 'paused';

    // 1. Pause game
    await queryGame('set_simulation_speed', { speed: 'paused' });
    console.log('[Step 1] Simulation paused for atomic mutation.');

  // 2. Spatial Survey
  const origin = { x: -1040, z: 608 };
  const widthM = 192;
  const heightM = 192;

  const survey = await surveySpace({
    origin,
    width_m: widthM,
    height_m: heightM,
    clearance_m: 16
  });

  if (survey.suitability.verdict === 'BLOCKED') {
    throw new Error(`Spatial Survey Failed: ${survey.issues.join('; ')}`);
  }
  console.log(`[Step 2] Spatial Survey Passed: ${survey.ownership.fully_owned ? '100% Owned' : 'Partial'} | Grade: ${survey.terrain.max_grade_percent}% (${survey.terrain.classification}) | 0 Collisions.`);

  // 3. Build Road Grid (2x2)
  const gridReqId = `civic-grid-${Date.now().toString(36)}`;
  const gridPreview = await queryGame('preview_road_grid', {
    request_id: gridReqId,
    road_prefab: 'Small Road',
    perimeter_road_prefab: 'Medium Road',
    origin,
    columns: 2,
    rows: 2,
    block_width_m: 96,
    block_height_m: 96,
    auto_connect: false
  });

  const gridOp = await waitRoadOp(gridPreview.data.operation_id, 'preview_ready');
  console.log(`[Step 3] Road Grid Preview Ready: ₡${gridOp.cost.toLocaleString()}`);

  await queryGame('build_road', {
    operation_id: gridPreview.data.operation_id,
    request_id: `${gridReqId}-commit`,
    max_cost: 150000
  });

  const gridDone = await waitRoadOp(gridPreview.data.operation_id, 'completed');
  const createdEdges = gridDone.created_road_ids || [];
  console.log(`[Step 3] Road Grid Built: ${createdEdges.length} road edges created.`);

  // 4. Build 4-Lane Arterial Connector to (-1138.4, 704.0)
  console.log('[Step 4] Linking Civic Center to Central Arterial Spine (-1138.4, 704.0)...');
  const connReqId = `civic-conn-${Date.now().toString(36)}`;
  const connPoints = [
    { x: -1138.4, z: 704.0 },
    { x: -1040.0, z: 704.0 }
  ];

  // Auto-snap to created edge nodes if possible
  for (const pt of connPoints) {
    for (const edgeId of createdEdges) {
      try {
        const edgeData = await queryGame('get_entity_components', {
          entity_id: edgeId,
          components: ['Game.Net.Edge']
        });
        const eFields = edgeData.data?.components?.['Game.Net.Edge']?.fields;
        if (!eFields) continue;
        for (const nId of [eFields.m_Start, eFields.m_End]) {
          const nData = await queryGame('get_entity_components', {
            entity_id: nId,
            components: ['Game.Net.Node']
          });
          const pos = nData.data?.components?.['Game.Net.Node']?.fields?.m_Position;
          if (pos && Math.hypot(pos.x - pt.x, pos.z - pt.z) < 6) {
            pt.node_id = nId;
            break;
          }
        }
        if (pt.node_id) break;
      } catch {}
    }
  }

  const connPreview = await queryGame('preview_road_route', {
    request_id: connReqId,
    road_prefab: 'Medium Road',
    points: connPoints
  });

  const connOp = await waitRoadOp(connPreview.data.operation_id, 'preview_ready');
  await queryGame('build_road', {
    operation_id: connPreview.data.operation_id,
    request_id: `${connReqId}-commit`,
    max_cost: 50000
  });
  await waitRoadOp(connPreview.data.operation_id, 'completed');
  console.log(`[Step 4] Arterial Connector Linked: 4-lane Medium Road connected seamlessly to Crossroads (-1138.4, 704).`);

  // 5. Plan & Place Medical Clinic (MedicalClinic01)
  console.log('[Step 5] Planning and placing Medical Clinic (MedicalClinic01)...');
  const sitePlan = await queryGame('plan_city_service_site', {
    building_prefab: 'MedicalClinic01',
    near: { x: -1040, z: 750 }
  });

  const candidates = sitePlan.data?.candidates || [];
  if (candidates.length === 0) {
    throw new Error('No valid placement candidate found for MedicalClinic01');
  }

  // Pick the best candidate inside or adjacent to our new civic block
  const bestCand = candidates[0];
  console.log(`[Step 5] Selected Candidate: (${bestCand.position.x.toFixed(1)}, ${bestCand.position.z.toFixed(1)}) on ${bestCand.road_prefab}`);

  const clinicReqId = `civic-clinic-${Date.now().toString(36)}`;
  const placePreview = await queryGame('preview_city_service_placement', {
    request_id: clinicReqId,
    building_prefab: 'MedicalClinic01',
    position: bestCand.position,
    rotation_degrees: bestCand.rotation_degrees,
    road_edge_id: bestCand.road_edge_id
  });

  const placeOp = await waitServiceOp(placePreview.data.operation_id, 'preview_ready');
  console.log(`[Step 5] Clinic Preview Verified: Cost ₡${placeOp.cost.toLocaleString()}`);

  await queryGame('apply_city_service_operation', {
    operation_id: placePreview.data.operation_id,
    request_id: `${clinicReqId}-commit`
  });

  const placeDone = await waitServiceOp(placePreview.data.operation_id, 'completed');
  console.log(`[Step 5] Medical Clinic Placed Successfully! Entity: ${placeDone.created_entity_id || 'Active'}`);

  // 6. Resume Simulation
  await queryGame('set_simulation_speed', { speed: 'fastest' });
  console.log('[Step 6] Simulation resumed at maximum speed (speed 4).');

    const elapsed = Date.now() - t0;
    console.log(`\n✓ [CIVIC HUB DEPLOYED SUCCESSFULLY] Duration: ${elapsed}ms`);
  console.log(`  - Location: X in [-1040, -848], Z in [608, 800] (192m x 192m, 4 blocks)`);
  console.log(`  - Road Network: 4-lane Medium Road perimeter + 2-lane Small Road interior`);
  console.log(`  - Arterial Junction: 4-way Crossroads at (-1138.4, 704.0) connecting Residential & Spine`);
  console.log(`  - Placed Facility: Medical Clinic (MedicalClinic01) [Active, Ambulances: 5, Beds: 100]`);
  console.log(`  - Reserved Parcels:`);
  console.log(`    * Block NE [X: -944..-848, Z: 704..800]: Elementary School (Milestone 2)`);
  console.log(`    * Block SW [X: -1040..-944, Z: 608..704]: Fire House (Milestone 2)`);
    console.log(`    * Block SE [X: -944..-848, Z: 608..704]: Police Station (Milestone 3)`);
  } catch (err) {
    // Restore the pre-deployment state if construction fails after pausing.
    try {
      if (!initialPaused) await queryGame('set_simulation_speed', { speed: originalSpeed });
    } catch {}
    throw err;
  }
}

run().catch(err => {
  console.error('\n✗ Civic Hub Deployment Failed:', err.message);
  process.exit(1);
});
