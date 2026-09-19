// Offline synthetic workloads only. Does not connect to or modify a city.
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { createSpatialIndex, footprintBounds, nearestPointPair } from './planning-spatial.mjs';
import { proposeGridPlan } from './planning-proposer.mjs';
import { routeUtilityAdaptive } from './utility-router.mjs';
import { createBuildingWorkflow } from './building-workflow.mjs';
import { BridgeError } from './bridge-client.mjs';

const iterations = Number(process.argv[2] ?? 7);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('iterations must be an integer in 1..100');
const seed = 20260919;
let state = seed;
const random = () => ((state = (Math.imul(state,1664525)+1013904223) >>> 0) / 2**32);
const round = n => Math.round(n*1000)/1000;
async function measure(name, fn) {
  for(let i=0;i<2;i++) await fn();
  const samples=[];
  let output;
  for(let i=0;i<iterations;i++){
    const start=performance.now(); output=await fn(); samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);
  return {name,median_ms:round(samples[Math.floor(samples.length/2)]),p95_ms:round(samples[Math.ceil(samples.length*.95)-1]),output};
}
const reports=[];
const overlap=(a,b)=>a.min_x<=b.max_x&&a.max_x>=b.min_x&&a.min_z<=b.max_z&&a.max_z>=b.min_z;
for(const count of [128,1024,8192]){
  const buildings=Array.from({length:count},()=>({position:{x:random()*8192-4096,z:random()*8192-4096},size_m:{x:16+random()*64,z:16+random()*64},rotation_degrees:random()*360}));
  const boxes=buildings.map(footprintBounds);
  const queries=Array.from({length:512},()=>{const x=random()*8192-4096,z=random()*8192-4096;return {min_x:x-32,max_x:x+32,min_z:z-32,max_z:z+32};});
  const expected=queries.map(q=>boxes.some(b=>overlap(q,b)));
  reports.push(await measure(`spatial_index_${count}`,()=>{
    const index=createSpatialIndex(boxes,b=>b);
    const actual=queries.map(q=>index.some(q,b=>overlap(q,b)));
    assert.deepEqual(actual,expected);
    return {buildings:count,queries:queries.length,hits:actual.filter(Boolean).length,includes_index_build:true};
  }));
  reports.push(await measure(`linear_scan_${count}`,()=>{
    assert.deepEqual(queries.map(q=>boxes.some(b=>overlap(q,b))),expected);
    return {buildings:count,queries:queries.length};
  }));
}
const perimeter = Array.from({length:64},(_,i)=>({x:(i%16)*32,z:Math.floor(i/16)*128}));
const roadPoints = Array.from({length:8192},()=>({x:random()*2400-1000,z:random()*2400-1000}));
const exhaustivePair = () => {
  let result={distance:1000,source:null,target:null};
  for(const source of perimeter) for(const target of roadPoints){
    const distance=Math.hypot(source.x-target.x,source.z-target.z);
    if(distance<result.distance) result={distance,source,target};
  }
  return result;
};
const expectedPair=exhaustivePair();
for(const [name,fn] of [['road_nearest_pruned',()=>nearestPointPair(perimeter,roadPoints)],['road_nearest_exhaustive',exhaustivePair]]){
  reports.push(await measure(name,()=>{
    const result=fn(); assert.deepEqual(result,expectedPair);
    return {perimeter_points:perimeter.length,road_points:roadPoints.length,distance:result.distance,includes_sort:name==='road_nearest_pruned'};
  }));
}
const snapshot={bounds:{min_x:0,max_x:4096,min_z:0,max_z:4096},buildings:[],roads:[]};
reports.push(await measure('grid_4096m',()=>{
  const result=proposeGridPlan(snapshot,{columns:1,rows:1,block_width_m:96,block_height_m:96,search_step_m:32});
  return {evaluated_candidates:result.evaluated_candidates,strategy:result.search_strategy,terrain_known:result.placement.terrain_known};
}));
reports.push(await measure('utility_wall_detour',()=>{
  const path=routeUtilityAdaptive({x:0,z:0},{x:128,z:0},[{id:'wall',position:{x:64,z:0},size_m:{x:32,z:340},rotation_degrees:0}]);
  assert.ok(path); return {path_points:path.length};
}));
for(const legacy of [false,true]){
  reports.push(await measure(legacy?'workflow_legacy_16':'workflow_batch_16',async()=>{
    const response=data=>({data,meta:{session_id:'benchmark'}});
    const workflow=createBuildingWorkflow(async(tool,args)=>{
      if(tool==='get_game_status')return response({city_loaded:true,paused:true});
      if(tool==='list_city_service_prefabs')return response({items:[{name:'Clinic',kind:'healthcare'}]});
      if(tool==='plan_city_service_site')return response({candidates:Array.from({length:16},(_,i)=>({position:{x:i*32,z:0},rotation_degrees:0,score:i*32}))});
      if(tool==='analyze_service_coverage'){
        if(args.positions && legacy)throw new BridgeError('INVALID_ARGUMENT','legacy fixture');
        const impact=p=>({uncovered_residential_buildings:p.x});
        return response(args.positions?{items:args.positions.map(impact)}:impact(args.position));
      }
      if(tool==='preview_city_service_placement')return response({state:'preview_ready',operation_id:'synthetic-preview'});
      throw new Error(tool);
    });
    const plan=await workflow.createPlan({request_id:'benchmark',building_prefab:'Clinic',category:'city_service',near:{x:0,z:0},candidate_count:16,max_preview_attempts:8,impact_radius_m:500});
    return {performance:plan.performance,selected_position:plan.candidate.position};
  }));
}
console.log(JSON.stringify({kind:'offline_synthetic_benchmark',seed,iterations,warmup_iterations:2,node:process.version,platform:process.platform,
  note:'No game or bridge latency. Wall time is machine-dependent; fixture outputs and query counts are reproducible. Index and linear cases both include correctness checks.',reports},null,2));
