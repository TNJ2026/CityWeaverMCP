import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingWorkflow } from '../building-workflow.mjs';
import { BridgeError } from '../bridge-client.mjs';

test('concurrent identical requests share one preview and reject conflicting in-flight arguments',async()=>{
  let previews=0,release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const started=new Promise(resolve=>{entered=resolve;});
  const workflow=createBuildingWorkflow(async tool=>{
    if(tool==='get_game_status')return response({city_loaded:true,paused:true});
    if(tool==='list_building_prefabs')return response({items:[{name:'FixtureBuilding'}]});
    if(tool==='plan_building_site')return response({candidates:[{position:{x:0,z:0},rotation_degrees:0}]});
    if(tool==='preview_building_placement'){previews++;entered();await gate;return response({state:'preview_ready',operation_id:'one-preview'});}
    throw new Error(tool);
  });
  const args=planningArgs({category:'building'});
  const first=workflow.createPlan(args);
  await started;
  const duplicates=Array.from({length:8},()=>workflow.createPlan({...args}));
  await assert.rejects(workflow.createPlan({...args,near:{x:99,z:99}}),e=>e.code==='IDEMPOTENCY_CONFLICT');
  release();
  const results=await Promise.all([first,...duplicates]);
  assert.equal(previews,1);
  assert.equal(new Set(results.map(r=>r.plan_id)).size,1);
  const profile=results[0].performance;
  assert.equal(profile.queries.preview_building_placement.calls,1);
  assert.equal(profile.counters.preview_attempts,1);
  assert.ok(profile.elapsed_ms>=0);
  assert.ok(profile.stages_ms.preview>=0);
  assert.strictEqual((await workflow.createPlan(args)).performance,profile,'cached result retains its original profile');
});

test('terminal planning failure releases the pending request and records failed query timings',async()=>{
  let reads=0;
  const workflow=createBuildingWorkflow(async tool=>{
    if(tool==='get_game_status')return response({city_loaded:true,paused:true});
    if(tool==='list_building_prefabs')return response({items:[{name:'FixtureBuilding'}]});
    if(tool==='plan_building_site'){reads++;if(reads===1)throw new BridgeError('TERRAIN_UNAVAILABLE','fixture');return response({candidates:[{position:{x:0,z:0}}]});}
    if(tool==='preview_building_placement')return response({state:'preview_ready',operation_id:'retry'});
    throw new Error(tool);
  });
  const args=planningArgs({category:'building'});
  await assert.rejects(workflow.createPlan(args),e=>e.performance.queries.plan_building_site.failures===1&&e.performance.stages_ms.candidates>=0);
  assert.equal((await workflow.createPlan(args)).state,'preview_ready');
  assert.equal(reads,2);
});

test('education and passenger transport score all candidates in one batch query', async()=>{
  for(const category of ['city_service','transport_facility']){
    let analysisCalls=0;
    const tool=category==='city_service'?'analyze_education_demand':'analyze_transport_catchment';
    const workflow=createBuildingWorkflow(async(name,args)=>{
      if(name==='get_game_status')return response({city_loaded:true,paused:true});
      if(name===`list_${category}_prefabs`)return response({items:[{name:'FixtureBuilding',kind:'education',education_level:1,student_capacity:100,passenger:true}]});
      if(name===`plan_${category}_site`)return response({candidates:[0,100].map(x=>({position:{x,z:0},rotation_degrees:0,score:x}))});
      if(name===tool){
        analysisCalls++;assert.equal(args.positions.length,2);
        if(category==='city_service')assert.equal(args.education_level,1);
        return response({items:args.positions.map(p=>category==='city_service'
          ?{matching_students_in_range:p.x,schools:[]}
          :{residential_buildings_in_range:p.x,nearby_stop_count:0,nearby_waiting_passengers:0})});
      }
      if(name===`preview_${category}_placement`){assert.equal(args.position.x,100);return response({state:'preview_ready',operation_id:'batch-preview'});}
      throw new Error(name);
    });
    const result=await workflow.createPlan(planningArgs({category}));
    assert.equal(analysisCalls,1);
    assert.equal(result.selection.fallback,false);
  }
});

test('unsupported analysis batches fall back once per city session and preserve single-point results',async()=>{
  let batchCalls=0,singleCalls=0,currentSession=sessionId;
  const r=data=>({data,meta:{session_id:currentSession}});
  const workflow=createBuildingWorkflow(async(tool,args)=>{
    if(tool==='get_game_status')return r({city_loaded:true,paused:true});
    if(tool==='list_city_service_prefabs')return r({items:[{name:'FixtureBuilding',kind:'education',education_level:1,student_capacity:100}]});
    if(tool==='plan_city_service_site')return r({candidates:[0,100].map(x=>({position:{x,z:0},rotation_degrees:0,score:x}))});
    if(tool==='analyze_education_demand'){
      if(args.positions){batchCalls++;throw new BridgeError('INVALID_ARGUMENT','legacy mod');}
      singleCalls++;return r({matching_students_in_range:args.position.x,schools:[]});
    }
    if(tool==='preview_city_service_placement')return r({state:'preview_ready',operation_id:'legacy-preview'});
    if(tool==='cancel_city_service_preview')return r({state:'cancelled'});
    throw new Error(tool);
  });
  for(let i=0;i<3;i++){
    if(i===2)currentSession='b'.repeat(32);
    const plan=await workflow.createPlan(planningArgs({request_id:`legacy-${i}`,category:'city_service'}));
    assert.equal(plan.candidate.position.x,100);
    await workflow.cancelPlan({plan_id:plan.plan_id});
  }
  assert.equal(batchCalls,2);assert.equal(singleCalls,6);
});

test('uncertain previews stop candidate fallback, retries and batch continuation', async () => {
  for (const code of ['WORKFLOW_TIMEOUT','GAME_TIMEOUT','CITY_SESSION_CHANGED','outcome_unknown']) {
    let previews=0;
    const workflow=createBuildingWorkflow(async tool=>{
      if(tool==='get_game_status')return response({city_loaded:true,paused:true});
      if(tool==='list_building_prefabs')return response({items:[{name:'FixtureBuilding'}]});
      if(tool==='plan_building_site')return response({candidates:[0,100].map(x=>({position:{x,z:0},rotation_degrees:0}))});
      if(tool==='preview_building_placement'){previews++;return response({state:'queued',operation_id:'original-preview'});}
      if(tool==='get_building_operation'){
        if(code==='outcome_unknown')return response({state:code,operation_id:'original-preview'});
        throw new BridgeError(code,'uncertain result');
      }
      throw new Error(tool);
    });
    const args=planningArgs({category:'building'});
    for(let retry=0;retry<2;retry++) await assert.rejects(workflow.createPlan(args),e=>e.recovery_required && e.operation_id==='original-preview');
    assert.equal(previews,1);
    const result=await workflow.deployPlans({request_id:'batch-uncertain',buildings:[args,args],operation_timeout_ms:1000,max_total_cost:100,max_cost_per_building:100,continue_on_error:true});
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].recovery_required,true);
    assert.equal(previews,2);
  }
});

test('reservation filtering widens a truncated candidate pool within the original search area', async()=>{
  const counts=[];
  const workflow=createBuildingWorkflow(async(tool,args)=>{
    if(tool==='get_game_status')return response({city_loaded:true,paused:true});
    if(tool==='list_building_prefabs')return response({items:[{name:'FixtureBuilding',size_m:{x:20,z:20}}]});
    if(tool==='plan_building_site'){
      counts.push(args.candidate_count);assert.equal(args.search_radius_m,500);
      return response({candidates:(args.candidate_count===1?[0]:[0,100]).map(x=>({position:{x,z:0},rotation_degrees:0}))});
    }
    if(tool==='preview_building_placement'){assert.equal(args.position.x,100);return response({state:'preview_ready',operation_id:'preview'});}
    throw new Error(tool);
  });
  await workflow.createPlan(planningArgs({category:'building',candidate_count:1,max_preview_attempts:1,reserved_footprints:[{position:{x:0,z:0},rotation_degrees:0,size_m:{x:20,z:20}}]}));
  assert.deepEqual(counts,[1,2]);
});

const sessionId = 'a'.repeat(32);
const edgeId = `${sessionId}:10:1`;

test('batch deployment stops on unsafe outcomes and honors continue_on_error for terminal failures', async () => {
  for (const [outcome, continueOnError, expectedCommits] of [
    ['completed_readback_incomplete', false, 1], ['completed_readback_incomplete', true, 1],
    ['outcome_unknown', true, 1], ['failed', false, 1], ['failed', true, 2],
  ]) {
    let commits = 0, applied = false;
    const workflow = createBuildingWorkflow(async (tool, args) => {
      if (tool === 'get_game_status') return response({ city_loaded: true, paused: true, selected_speed: 0 });
      if (tool === 'list_building_prefabs') return response({ items: [{ name: 'School' }] });
      if (tool === 'plan_building_site') return response({ candidates: [{ position: args.near, rotation_degrees: 0, road_edge_id: edgeId }] });
      if (tool === 'preview_building_placement') { applied = false; return response({ operation_id: `op-${commits}`, state: 'preview_ready', cost: 100 }); }
      if (tool === 'get_building_operation') return response({ state: applied ? outcome : 'preview_ready', cost: 100 });
      if (tool === 'apply_building_operation') {
        commits++; applied = true;
        return response({ state: outcome === 'completed_readback_incomplete' ? 'completed' : 'commit_queued', cost: 100, result_entity_ids: ['built-entity'] });
      }
      if (tool === 'get_building_state') return response({ road_edge_id: null });
      throw new Error(`Unexpected tool ${tool}`);
    });
    const args = {
      request_id: 'batch-failure', buildings: [0, 100].map(x => planningArgs({ building_prefab: 'School', category: 'building', near: { x, z: 0 } })),
      operation_timeout_ms: 1000, max_cost_per_building: 100, max_total_cost: 200, continue_on_error: continueOnError,
    };
    const result = await workflow.deployPlans(args);
    assert.equal(commits, expectedCommits, `${outcome}, continue_on_error=${continueOnError}`);
    assert.equal(result.results[0].state, outcome);
    if (outcome === 'completed_readback_incomplete') {
      assert.equal(result.total_cost, 100);
      assert.deepEqual(result.results[0].result_entity_ids, ['built-entity']);
      assert.equal(result.results[0].recovery_required, true);
    }
    assert.deepEqual(await workflow.deployPlans(args), result);
    assert.equal(commits, expectedCommits, 'retries must not commit again');
  }
});

function response(data) { return { ok: true, meta: { session_id: sessionId }, data }; }

function planningArgs(overrides = {}) {
  return {
    request_id: 'workflow-test-001', building_prefab: 'FixtureBuilding', near: { x: 100, z: 200 }, category: 'auto',
    search_radius_m: 500, road_side: 'either', candidate_count: 8, max_preview_attempts: 8,
    operation_timeout_ms: 2000, mode: 'auto', minimum_water_depth_m: 1,
    consider_service_coverage: true, impact_radius_m: 500, allow_approximate_collisions: false,
    reserve_upgrade_prefabs: [],
    ...overrides
  };
}

test('planned footprint reservations filter candidates before creating native previews', async () => {
  const selected = [];
  const workflow = createBuildingWorkflow(async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded:true, paused:true });
    if (tool === 'list_building_prefabs') return response({items:[{name:'FixtureBuilding',size_m:{x:40,z:20}}]});
    if (tool === 'plan_building_site') return response({candidates:[0,100].map(x=>({position:{x,z:0},rotation_degrees:0,score:x}))});
    if (tool === 'preview_building_placement') { selected.push(args.position.x); return response({state:'preview_ready',operation_id:'preview'}); }
    throw new Error(`Unexpected ${tool}`);
  });
  await workflow.createPlan(planningArgs({ category:'building',reserved_footprints:[{position:{x:0,z:0},rotation_degrees:90,size_m:{x:30,z:30}}] }));
  assert.deepEqual(selected,[100]);
});

test('greedy deployment re-reads marginal coverage after each permanent building', async () => {
  let built = 0;
  const selected = [], analysisSnapshots = [];
  const workflow = createBuildingWorkflow(async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, paused: true, selected_speed: 0 });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'Clinic', kind: 'healthcare' }] });
    if (tool === 'plan_city_service_site') return response({ candidates: [0, 100].map(x => ({ position: { x, z: 0 }, score: x, road_edge_id: edgeId, rotation_degrees: 0 })) });
    if (tool === 'analyze_service_coverage') {
      analysisSnapshots.push(built);
      assert.ok(args.positions, 'coverage must use one batched snapshot per building');
      return response({ items: args.positions.map(position => ({ uncovered_residential_buildings: position.x === 100 && built === 0 ? 100 : position.x === 0 ? 10 : 0 })) });
    }
    if (tool === 'preview_city_service_placement') {
      selected.push(args.position.x);
      return response({ operation_id: `operation-${built}`, state: 'preview_ready', cost: 10 });
    }
    if (tool === 'get_city_service_operation') return response({ state: 'preview_ready', cost: 10 });
    if (tool === 'apply_city_service_operation') {
      built++;
      return response({ state: 'completed', cost: 10, result_entity_ids: [`clinic-${built}`] });
    }
    if (tool === 'get_city_service_facility') return response({ road_edge_id: edgeId });
    throw new Error(`Unexpected tool ${tool}`);
  });
  const result = await workflow.deployPlans({ request_id: 'greedy-batch',
    buildings: [1, 2].map(() => planningArgs({ building_prefab: 'Clinic', category: 'city_service' })),
    operation_timeout_ms: 1000, max_cost_per_building: 10, max_total_cost: 20, continue_on_error: false });
  assert.equal(result.completed_count, 2);
  assert.deepEqual(selected, [100, 0]);
  assert.deepEqual(analysisSnapshots, [0, 1]);
});

test('greedy ranking still rejects collisions and falls back after native rejection', async () => {
  const previews = [];
  const workflow = createBuildingWorkflow(async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, paused: true, selected_speed: 0 });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'Clinic', kind: 'healthcare' }] });
    if (tool === 'plan_city_service_site') return response({ candidates: [0, 100, 200].map(x => ({ position: { x, z: 0 }, score: x, approximate_collision: x === 200 })) });
    if (tool === 'analyze_service_coverage') return response({ uncovered_residential_buildings: args.position.x });
    if (tool === 'preview_city_service_placement') {
      previews.push(args.position.x);
      return response({ operation_id: 'preview', state: args.position.x === 100 ? 'failed' : 'preview_ready' });
    }
    if (tool === 'get_city_service_operation') return response({ state: 'failed' });
    throw new Error(`Unexpected tool ${tool}`);
  });
  const result = await workflow.createPlan(planningArgs({ building_prefab: 'Clinic', category: 'city_service' }));
  assert.deepEqual(previews, [100, 0]);
  assert.equal(result.candidate.position.x, 0);
  assert.equal(result.attempts[0].state, 'failed');
  assert.equal(result.candidate_rankings.length, 2);
});

test('building workflow falls back after native rejection and commits only during execute', async () => {
  const calls = [];
  let paused = false;
  let applied = false;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 4 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 4 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'FixtureBuilding', placement_flags: 'RoadSide, OnGround', construction_cost: 12000 }] });
    if (tool.startsWith('list_') && tool.endsWith('_facility_prefabs') || tool === 'list_city_service_prefabs') return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [
      { position: { x: 110, y: 5, z: 210 }, rotation_degrees: 0, road_edge_id: edgeId, approximate_collision: false },
      { position: { x: 120, y: 5, z: 220 }, rotation_degrees: 90, road_edge_id: edgeId, approximate_collision: false }
    ] });
    if (tool === 'preview_building_placement') return response({ operation_id: args.position.x === 110 ? '1'.repeat(32) : '2'.repeat(32), state: 'queued' });
    if (tool === 'get_building_operation' && args.operation_id === '1'.repeat(32)) return response({ operation_id: args.operation_id, state: 'failed', errors: ['Fixture collision'] });
    if (tool === 'get_building_operation' && !applied) return response({ operation_id: args.operation_id, state: 'preview_ready', cost: 12000, warnings: [], expires_at_utc: '2099-01-01T00:00:00Z' });
    if (tool === 'apply_building_operation') { applied = true; return response({ operation_id: args.operation_id, state: 'commit_queued' }); }
    if (tool === 'get_building_operation' && applied) return response({ operation_id: args.operation_id, state: 'completed', cost: 12000, result_entity_ids: [`${sessionId}:20:1`] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true, road_edge_id: edgeId });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs());
  assert.equal(plan.state, 'preview_ready');
  assert.equal(plan.selected_candidate_index, 1);
  assert.equal(plan.attempts[0].state, 'failed');
  assert.equal(calls.some(call => call.tool === 'apply_building_operation'), false, 'planning must not commit');
  const previewCalls = calls.filter(call => call.tool === 'preview_building_placement');
  assert.deepEqual(previewCalls[0].args.position, { x: 110, z: 210 }, 'ordinary preview strips planner-only y');
  assert.deepEqual(calls.find(call => call.tool === 'plan_building_site').args.reserve_upgrade_prefabs, []);
  assert.equal(paused, false, 'planning restores the original speed');

  const done = await workflow.executePlan({ request_id: 'workflow-build-001', plan_id: plan.plan_id, max_cost: 12000, resume_speed: 'original' });
  assert.equal(done.state, 'completed');
  assert.equal(done.result_entity_ids.length, 1);
  assert.equal(done.readback.active, true);
  assert.equal(paused, false, 'execution restores the original speed');
  assert.equal(calls.filter(call => call.tool === 'apply_building_operation').length, 1);

  const retried = await workflow.executePlan({ request_id: 'workflow-build-001', plan_id: plan.plan_id, max_cost: 12000, resume_speed: 'original' });
  assert.equal(retried.state, 'completed');
  assert.equal(calls.filter(call => call.tool === 'apply_building_operation').length, 1, 'identical execution retry is idempotent');
});

test('auto discovery prefers city-service workflow and supports cancellation', async () => {
  const calls = [];
  let paused = false;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 2 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 2 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'FixturePark', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'FixturePark', kind: 'park', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'list_transport_facility_prefabs' || tool === 'list_utility_facility_prefabs') return response({ items: [] });
    if (tool === 'plan_city_service_site') return response({ coverage_model: 'euclidean_radius_proxy', candidates: [{ position: { x: 50, y: 5, z: 60 }, road_edge_id: edgeId, rotation_degrees: -90, approximate_collision: false }] });
    if (tool === 'preview_city_service_placement') return response({ operation_id: '3'.repeat(32), state: 'preview_ready', cost: 5000, warnings: [], expires_at_utc: '2099-01-01T00:00:00Z' });
    if (tool === 'analyze_attraction_impact') return response({ nearby_buildings: 25, nearby_parks: 0 });
    if (tool === 'analyze_service_coverage') return response({ uncovered_residential_buildings: 25, uncovered_households: 25 });
    if (tool === 'cancel_city_service_preview') return response({ operation_id: args.operation_id, state: 'cancelled' });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-park-001', building_prefab: 'FixturePark' }));
  assert.equal(plan.category, 'city_service');
  assert.equal(plan.impact.nearby_buildings, 25);
  assert.equal(paused, false);
  const cancelled = await workflow.cancelPlan({ plan_id: plan.plan_id });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(calls.filter(call => call.tool === 'cancel_city_service_preview').length, 1);
});

test('building workflow skips optional service impact analysis when disabled', async () => {
  const query = async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused: true, selected_speed: 0 });
    if (tool === 'list_city_service_prefabs') return response({ items: [{ name: 'FixtureSchool', kind: 'education', placement_flags: 'RoadSide, OnGround' }] });
    if (tool === 'plan_city_service_site') return response({ candidates: [{ position: { x: 50, y: 5, z: 60 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_city_service_placement') return response({ operation_id: '7'.repeat(32), state: 'preview_ready', cost: 5000 });
    if (tool.startsWith('analyze_')) throw new Error('impact analysis should be disabled');
    throw new Error(`Unexpected tool ${tool}`);
  };
  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-no-impact-001', building_prefab: 'FixtureSchool', category: 'city_service', consider_service_coverage: false }));
  assert.equal(plan.state, 'preview_ready');
  assert.equal(plan.impact, null);
});

test('execution recovers an already completed native operation and reads it back', async () => {
  const entityId = `${sessionId}:30:1`;
  let paused = false;
  let operationState = 'preview_ready';
  const calls = [];
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 1 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 1 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'RecoveredBuilding', placement_flags: 'RoadSide, OnGround', placement: { unique: true } }] });
    if (tool.startsWith('list_')) return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [{ position: { x: 20, y: 5, z: 30 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_building_placement') return response({ operation_id: '4'.repeat(32), state: 'preview_ready', cost: 7000 });
    if (tool === 'analyze_attraction_impact') return response({ nearby_buildings: 12, nearby_transport_stops: 1 });
    if (tool === 'get_building_operation') return response({ operation_id: args.operation_id, state: operationState, cost: 7000, result_entity_ids: operationState === 'completed' ? [entityId] : [] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true, road_edge_id: edgeId });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-recovery-plan', building_prefab: 'RecoveredBuilding' }));
  assert.equal(plan.impact.nearby_buildings, 12);
  operationState = 'completed';
  const recovered = await workflow.executePlan({ request_id: 'workflow-recovery-run', plan_id: plan.plan_id, max_cost: 7000, resume_speed: 'original' });
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.readback.building_id, entityId);
  assert.equal(calls.some(call => call.tool === 'apply_building_operation'), false);
  assert.equal(paused, false);
});

test('execution rejects a completed roadside building whose permanent road binding is missing', async () => {
  const entityId = `${sessionId}:31:1`;
  let paused = false;
  let applied = false;
  const query = async (tool, args) => {
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 2 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 2 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'UnboundBuilding', placement_flags: 'RoadSide, OnGround' }] });
    if (tool.startsWith('list_')) return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [{ position: { x: 40, y: 5, z: 50 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_building_placement') return response({ operation_id: '8'.repeat(32), state: 'preview_ready', cost: 6000 });
    if (tool === 'get_building_operation' && !applied) return response({ operation_id: args.operation_id, state: 'preview_ready', cost: 6000 });
    if (tool === 'apply_building_operation') { applied = true; return response({ operation_id: args.operation_id, state: 'commit_queued' }); }
    if (tool === 'get_building_operation' && applied) return response({ operation_id: args.operation_id, state: 'completed', cost: 6000, result_entity_ids: [entityId] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true, road_edge_id: null });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const plan = await workflow.createPlan(planningArgs({ request_id: 'workflow-unbound-plan', building_prefab: 'UnboundBuilding' }));
  const result = await workflow.executePlan({ request_id: 'workflow-unbound-run', plan_id: plan.plan_id, max_cost: 6000, resume_speed: 'original' });
  assert.equal(result.state, 'completed_readback_incomplete');
  assert.equal(result.built, false);
  assert.equal(result.recovery_required, true);
  assert.deepEqual(result.road_binding, { expected_road_edge_id: edgeId, actual_road_edge_id: null, verified: false });
  assert.match(result.error, /road binding/i);
  assert.equal(paused, false);
});

test('batch deployment pauses once and restores speed once', async () => {
  const calls = [];
  let paused = false;
  let operationNumber = 0;
  const query = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_game_status') return response({ city_loaded: true, city_name: 'Fixture City', paused, selected_speed: paused ? 0 : 4 });
    if (tool === 'set_simulation_speed') { paused = args.speed === 'paused'; return response({ paused, selected_speed: paused ? 0 : 4 }); }
    if (tool === 'list_building_prefabs') return response({ items: [{ name: 'BatchBuilding', placement_flags: 'RoadSide, OnGround' }] });
    if (tool.startsWith('list_')) return response({ items: [] });
    if (tool === 'plan_building_site') return response({ candidates: [{ position: { x: 100 + operationNumber, y: 5, z: 200 }, road_edge_id: edgeId, rotation_degrees: 0, approximate_collision: false }] });
    if (tool === 'preview_building_placement') {
      operationNumber++;
      return response({ operation_id: String(operationNumber).padStart(32, '0'), state: 'preview_ready', cost: 1000 });
    }
    if (tool === 'get_building_operation') return response({ operation_id: args.operation_id, state: 'preview_ready', cost: 1000 });
    if (tool === 'apply_building_operation') return response({ operation_id: args.operation_id, state: 'completed', cost: 1000, result_entity_ids: [`${sessionId}:${40 + operationNumber}:1`] });
    if (tool === 'get_building_state') return response({ building_id: args.building_id, active: true, road_edge_id: edgeId });
    throw new Error(`Unexpected tool ${tool}`);
  };

  const workflow = createBuildingWorkflow(query);
  const result = await workflow.deployPlans({
    request_id: 'workflow-batch-001', buildings: [
      planningArgs({ building_prefab: 'BatchBuilding', near: { x: 100, z: 200 } }),
      planningArgs({ building_prefab: 'BatchBuilding', near: { x: 200, z: 200 } })
    ], operation_timeout_ms: 2000, max_cost_per_building: 1000, max_total_cost: 2000, continue_on_error: false
  });
  assert.equal(result.state, 'completed');
  assert.equal(result.completed_count, 2);
  assert.deepEqual(calls.filter(call => call.tool === 'set_simulation_speed').map(call => call.args.speed), ['paused', 'fastest']);
  assert.equal(paused, false);
});


test('different requests share in-flight prefab discovery and retry after failure', async () => {
  for (const fail of [false,true]) {
    let calls=0,release,entered;
    const gate=new Promise(r=>{release=r;});
    const started=new Promise(r=>{entered=r;});
    const workflow=createBuildingWorkflow(async tool=>{
      if(tool==='get_game_status')return response({city_loaded:true,paused:true});
      if(tool==='list_building_prefabs'){
        calls++; entered(); await gate;
        if(fail && calls===1)throw new BridgeError('GAME_UNAVAILABLE','fixture');
        return response({items:[{name:'FixtureBuilding'}]});
      }
      if(tool==='plan_building_site')return response({candidates:[{position:{x:0,z:0}}]});
      if(tool==='preview_building_placement')return response({state:'preview_ready',operation_id:'shared-discovery'});
      throw new Error(tool);
    });
    const first=workflow.createPlan(planningArgs({request_id:'discovery-a',category:'building'}));
    await started;
    const second=workflow.createPlan(planningArgs({request_id:'discovery-b',category:'building'}));
    await new Promise(resolve=>setImmediate(resolve));
    release();
    const results=await Promise.allSettled([first,second]);
    assert.equal(calls,1);
    assert.ok(results.every(r=>r.status===(fail?'rejected':'fulfilled')));
    if(fail){
      assert.equal((await workflow.createPlan(planningArgs({request_id:'discovery-c',category:'building'}))).state,'preview_ready');
      assert.equal(calls,2);
    }
  }
});
