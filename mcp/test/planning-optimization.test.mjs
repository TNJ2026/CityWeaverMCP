import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialIndex, footprint, footprintsOverlap, footprintBounds, sampleRoad, nearestPointPair } from '../planning-spatial.mjs';
import { routeUtility, routeUtilityAdaptive, segmentHitsBox } from '../utility-router.mjs';
import { proposeGridPlan } from '../planning-proposer.mjs';

const building = (x,z,width,depth,rotation=0) => ({ position:{x,z}, size_m:{x:width,z:depth}, rotation_degrees:rotation });

test('spatial index preserves every overlapping object across negative cells and deduplicates large footprints', () => {
  const items = Array.from({length:200},(_,i) => footprintBounds(building((i*47)%1000-500,(i*79)%1000-500,100,50,i%180)));
  const index = createSpatialIndex(items,b=>b,64);
  const query = {min_x:-170,max_x:90,min_z:-60,max_z:140};
  const actual = index.query(query);
  assert.equal(new Set(actual).size,actual.length);
  for (const box of items.filter(b => b.min_x <= query.max_x && b.max_x >= query.min_x && b.min_z <= query.max_z && b.max_z >= query.min_z)) assert.ok(actual.includes(box));
  assert.ok(actual.length < items.length);
});

test('SAT permits parallel slender buildings but rejects rotated crossings', () => {
  const a=footprint(building(0,0,100,8));
  assert.equal(footprintsOverlap(a,footprint(building(0,20,100,8))),false);
  assert.equal(footprintsOverlap(a,footprint(building(0,0,100,8,90))),true);
  assert.equal(footprintsOverlap(a,footprint(building(100.25,0,100,8))),false);
});

test('road samples lie on the Bezier rather than its control polygon', () => {
  const curve={a:{x:0,z:0},b:{x:0,z:100},c:{x:100,z:100},d:{x:100,z:0}};
  const samples=sampleRoad({curve});
  assert.deepEqual(samples[0],curve.a);
  assert.deepEqual(samples.at(-1),curve.d);
  assert.ok(samples.every(p=>p.z<=75));
  assert.ok(samples.some(p=>p.z>70));
});

test('bounded A* finds a multi-segment obstacle detour and verifies whole segments', () => {
  const obstacle=building(64,0,32,48);
  const start={x:0,z:0},end={x:128,z:0};
  const path=routeUtility(start,end,[obstacle],{clearance:0});
  assert.ok(path && path.length>2 && path.length<=16);
  assert.deepEqual(path[0],start); assert.deepEqual(path.at(-1),end);
  for (let i=1;i<path.length;i++) assert.equal(segmentHitsBox(path[i-1],path[i],footprintBounds(obstacle)),false);
  assert.equal(routeUtility(start,end,[building(0,0,500,500)],{detour:64}),null);
  assert.equal(routeUtility(start,{x:5000,z:5000},[]),null,'search size is bounded');
});

test('large grid search is bounded by coarse refinement rather than a full fine scan', () => {
  const snapshot={bounds:{min_x:0,max_x:4096,min_z:0,max_z:4096},buildings:[],roads:[]};
  const result=proposeGridPlan(snapshot,{columns:1,rows:1,block_width_m:96,block_height_m:96,search_step_m:32});
  assert.equal(result.search_strategy,'coarse_to_fine');
  assert.ok(result.evaluated_candidates<3000);
  assert.equal(result.placement.building_conflicts,0);
});

test('spatial any-match queries stop early even with large sparse bounds',()=>{
  const items=[building(0,0,20,20),building(1000,1000,20,20)];
  const index=createSpatialIndex(items,footprintBounds);
  let checked=0;
  assert.equal(index.some({min_x:-10000,max_x:10000,min_z:-10000,max_z:10000},()=>{checked++;return true;}),true);
  assert.equal(checked,1);
});

test('adaptive routing handles long spans and expands the detour for a tall obstacle',()=>{
  assert.ok(routeUtilityAdaptive({x:0,z:0},{x:5000,z:5000},[]));
  const wall=building(64,0,32,340),start={x:0,z:0},end={x:128,z:0};
  assert.equal(routeUtility(start,end,[wall]),null);
  const path=routeUtilityAdaptive(start,end,[wall]);
  assert.ok(path && path.some(p=>Math.abs(p.z)>170));
  for(let i=1;i<path.length;i++)assert.equal(segmentHitsBox(path[i-1],path[i],footprintBounds(wall)),false);
});

test('unknown terrain is reported explicitly and loses to a surveyed clear site',()=>{
  const snapshot={bounds:{min_x:0,max_x:256,min_z:0,max_z:128},terrain:{cells:[{center:{x:16,z:16},slope_degrees:1,elevation_m:10}]}};
  const result=proposeGridPlan(snapshot,{columns:1,rows:1,block_width_m:32,block_height_m:32});
  assert.equal(result.placement.terrain_known,true);
  const unknown=proposeGridPlan({...snapshot,terrain:null},{columns:1,rows:1,block_width_m:32,block_height_m:32});
  assert.equal(unknown.placement.maximum_slope_degrees,null);
});

test('coarse search falls back to the fine grid when every result still conflicts',()=>{
  const snapshot={bounds:{min_x:0,max_x:2304,min_z:0,max_z:2304},buildings:[building(1152,1152,4608,4608)]};
  const result=proposeGridPlan(snapshot,{columns:1,rows:1,block_width_m:32,block_height_m:32});
  assert.equal(result.fallback_fine_search,true);
  assert.equal(result.evaluated_candidates,72*72);
});


test('nearest pair pruning exactly matches exhaustive order, boundaries and ties', () => {
  let seed = 73;
  const rand = () => (seed = (Math.imul(seed,1664525)+1013904223) >>> 0) % 2000 - 1000;
  const brute = (sources, targets, limit) => {
    let result = {distance:limit,source:null,target:null};
    for (const source of sources) for (const target of targets) {
      const distance = Math.hypot(source.x-target.x,source.z-target.z);
      if (distance < result.distance) result = {distance,source,target};
    }
    return result;
  };
  for(let i=0;i<100;i++) {
    const sources=Array.from({length:20},()=>({x:rand(),z:rand()}));
    const targets=Array.from({length:200},()=>({x:rand(),z:rand()}));
    assert.deepEqual(nearestPointPair(sources,targets,1000),brute(sources,targets,1000));
  }
  const origin={x:0,z:0};
  for(const targets of [[],[{x:1000,z:0}],[{x:3,z:4},{x:0,z:5}],[{x:-3,z:4},{x:3,z:4}]])
    assert.deepEqual(nearestPointPair([origin,origin],targets,1000),brute([origin,origin],targets,1000));
});

test('adaptive retries reuse obstacle preparation and preserve direct-search path', () => {
  let reads=0;
  const wall={position:{x:64,z:0},get size_m(){reads++;return {x:32,z:340};}};
  const start={x:0,z:0},end={x:128,z:0};
  const path=routeUtilityAdaptive(start,end,[wall]);
  assert.equal(reads,1);
  assert.deepEqual(path,routeUtility(start,end,[building(64,0,32,340)],{detour:256}));
});

test('single-pass terrain statistics retain invalid, negative and boundary values', () => {
  const bounds={min_x:0,max_x:32,min_z:0,max_z:32};
  const cells=[{center:{x:0,z:0},slope_degrees:-3,elevation_m:-12},{center:{x:32,z:32},slope_degrees:-1,elevation_m:-2},
    {center:{x:33,z:32},slope_degrees:99,elevation_m:99}];
  const request={columns:1,rows:1,block_width_m:32,block_height_m:32};
  const result=proposeGridPlan({bounds,terrain:{cells}},request).placement;
  assert.equal(result.maximum_slope_degrees,-1);
  assert.equal(result.terrain_relief_m,10);
  assert.equal(result.steep_terrain_cells,0);
  cells[0].elevation_m=null;
  assert.equal(proposeGridPlan({bounds,terrain:{cells}},request).placement.terrain_known,false);
});
