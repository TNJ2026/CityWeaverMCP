import { queryGame, BridgeError } from '../../mcp/bridge-client.mjs';

/**
 * CityWeaver Deathcare System Deployment Script (Scheme 2)
 * 
 * 1. Pauses simulation
 * 2. Previews and commits Cemetery02 (pos: -992.0, 836.3, rot: 180)
 * 3. Previews and commits Crematorium01 (pos: -896.0, 852.3, rot: 180)
 * 4. Resumes simulation at speed 4
 * 5. Monitors hearse dispatches and dead body pickup
 */

async function waitServiceOp(opId, targetState = 'preview_ready', maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_city_service_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Service op ${opId} failed: state=${op.state} errors=${JSON.stringify(op.errors || [])} error=${op.error}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Service op ${opId} timed out waiting for ${targetState}`);
}

async function run() {
  const t0 = Date.now();
  console.log('=== Deploying City Deathcare System (Cemetery & Crematorium) ===\n');

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
    console.log('[Step 1] Simulation paused for atomic construction.');

    // 2. Place Cemetery02
    console.log('[Step 2] Placing Cemetery02 (Eco-Cemetery: 8 hearses, 1,500 graves)...');
  const cemReqId = `deathcare-cem-${Date.now().toString(36)}`;
  const cemPrev = await queryGame('preview_city_service_placement', {
    request_id: cemReqId,
    building_prefab: 'Cemetery02',
    position: { x: -992.0, y: 512.0078, z: 836.25 },
    rotation_degrees: 180,
    road_edge_id: 'b633807521a241638940bcec3a4e5aeb:194056:235'
  });

  const cemOp = await waitServiceOp(cemPrev.data.operation_id, 'preview_ready');
  console.log(`[Step 2] Cemetery02 Preview Ready: Cost ₡${cemOp.cost.toLocaleString()}`);

  await queryGame('apply_city_service_operation', {
    operation_id: cemPrev.data.operation_id,
    request_id: `${cemReqId}-commit`,
    max_cost: 100000
  });

  const cemDone = await waitServiceOp(cemPrev.data.operation_id, 'completed');
  console.log(`[Step 2] Cemetery02 Permanently Placed! Entity: ${cemDone.result_entity_ids?.[0]}`);

  // 3. Place Crematorium01
  console.log('\n[Step 3] Placing Crematorium01 (Crematorium: 5 hearses, unlimited processing)...');
  const cremReqId = `deathcare-crem-${Date.now().toString(36)}`;
  const cremPrev = await queryGame('preview_city_service_placement', {
    request_id: cremReqId,
    building_prefab: 'Crematorium01',
    position: { x: -896.0, y: 512.0078, z: 852.25 },
    rotation_degrees: 180,
    road_edge_id: 'b633807521a241638940bcec3a4e5aeb:194165:149'
  });

  const cremOp = await waitServiceOp(cremPrev.data.operation_id, 'preview_ready');
  console.log(`[Step 3] Crematorium01 Preview Ready: Cost ₡${cremOp.cost.toLocaleString()}`);

  await queryGame('apply_city_service_operation', {
    operation_id: cremPrev.data.operation_id,
    request_id: `${cremReqId}-commit`,
    max_cost: 350000
  });

  const cremDone = await waitServiceOp(cremPrev.data.operation_id, 'completed');
  console.log(`[Step 3] Crematorium01 Permanently Placed! Entity: ${cremDone.result_entity_ids?.[0]}`);

  // 4. Resume simulation
  await queryGame('set_simulation_speed', { speed: 'fastest' });
  console.log('\n[Step 4] Simulation resumed at maximum speed (speed 4).');

  // 5. Query active deathcare facilities
  await new Promise(r => setTimeout(r, 2000));
  const facilities = await queryGame('list_city_service_facilities', { kind: 'deathcare' });
  console.log('\n[Active Deathcare Facilities]:');
  for (const f of facilities.data?.items || []) {
    console.log(`  - ${f.prefab}: pos=(${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)}) | Hearses: ${f.owned_vehicle_count} active | ID: ${f.facility_id}`);
  }

    const duration = Date.now() - t0;
    console.log(`\n✓ [DEATHCARE DEPLOYMENT COMPLETED] Duration: ${duration}ms`);
  } catch (err) {
    // Restore the pre-deployment state if construction fails after pausing.
    try {
      if (!initialPaused) await queryGame('set_simulation_speed', { speed: originalSpeed });
    } catch {}
    throw err;
  }
}

run().catch(err => {
  console.error('\n✗ Deathcare Deployment Failed:', err.message);
  process.exit(1);
});
