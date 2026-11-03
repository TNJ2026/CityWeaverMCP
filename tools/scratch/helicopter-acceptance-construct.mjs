import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {q,poll,client,save} from './helicopter-acceptance-client.mjs';

try{
  const game=await q('get_game_status');
  if(!game.city_loaded||game.loading)throw Error('City is not ready');
  const baseline=await q('get_passenger_helicopter_status');
  if(!baseline.ready||baseline.facilities.length||baseline.lines.length)
    throw Error('Expected the saved city without prior acceptance facilities; inspect existing objects');
  await q('set_simulation_speed',{speed:'paused'});
  const configuration_path=fileURLToPath(new URL('../../../TransportFever3Helicopters/assets/vehicle-defaults/mi26.json',import.meta.url));
  for(const [label,prefab] of [['city','CityWeaver Passenger Helicopter'],['native','HelicopterPassenger01']]){
    const current=await q('get_vehicle_model',{prefab});
    if(current.parts.length===1&&current.parts[0].bones.length===3&&current.parts[0].material_count===6&&
       current.parts[0].render_prefab.startsWith('CityWeaver_Vehicle_')&&!current.persistence.error)continue;
    const request_id='heli-budget-mi26-'+label+'-20261030';
    const p=await q('preview_vehicle_replacement',{request_id,prefab,configuration_path});
    save('budget-'+label+'-model-preview',p);
    if(p.state!=='preview_ready'||!p.can_commit||p.affected_instances_at_preview!==0)
      throw Error('Model preview needs review');
    let d=await q('apply_vehicle_replacement',{operation_id:p.operation_id,request_id,max_affected_instances:0});
    if(d.state!=='completed')d=await poll('get_vehicle_replacement_operation',p.operation_id);
    console.log(JSON.stringify({model:prefab,state:d.state,changes:d.changes}));
  }
  async function build(label,prefab,near,max_cost){
    const sites=await q('plan_transport_facility_site',{building_prefab:prefab,near,search_radius_m:160,candidate_count:8});
    if(!sites.candidates.length)throw Error('No live candidate for '+label);
    const candidate=sites.candidates[0],request_id='heli-budget-'+label+'-20261030';
    save('budget-'+label+'-site',sites);
    let p=await q('preview_transport_facility_placement',{request_id,building_prefab:prefab,
      position:candidate.position,rotation_degrees:candidate.rotation_degrees,road_edge_id:candidate.road_edge_id});
    save('budget-'+label+'-preview',p);
    if(p.state!=='preview_ready')p=await poll('get_transport_facility_operation',p.operation_id,['preview_ready']);
    if(!p.can_commit||p.errors.length||p.warnings.length||p.cost>max_cost)throw Error('Unsafe facility preview');
    let d=await q('apply_transport_facility_operation',{operation_id:p.operation_id,request_id,max_cost});
    if(d.state!=='completed')d=await poll('get_transport_facility_operation',p.operation_id);
    save('budget-'+label+'-built',d);
    if(d.result_entity_ids.length!==1)throw Error('Expected one permanent facility');
    const f=await q('get_transport_facility',{facility_id:d.result_entity_ids[0]});
    save('budget-'+label+'-facility',f);
    if(!f.road_edge_id||f.road_edge_id!==candidate.road_edge_id||!f.stops.length)
      throw Error('Permanent road/stop readback failed');
    console.log(JSON.stringify({facility:label,id:f.facility_id,road:f.road_edge_id,cost:d.cost,stops:f.stops}));
    return f;
  }
  const airport=await build('airport','CityWeaver_850b7b8e4f8b4a679fa2623a7c3dd3e0',{x:4521.2915,z:4204.76563},250000);
  const pad=await build('pad','CityWeaver Imported Helipad Station',{x:-2111.96387,z:-694.7627},120000);
  const request_id='heli-budget-line-20261030';
  let p=await q('preview_passenger_helicopter_line',{request_id,stop_ids:[airport.stops[0].stop_id,pad.stops[0].stop_id],name:'Mi-26 直升机客运验收线'});
  save('budget-line-preview',p);
  if(p.state!=='preview_ready')p=await poll('get_transport_line_operation',p.operation_id,['preview_ready']);
  if(!p.can_commit||p.errors.length||p.warnings.length)throw Error('Unsafe line preview');
  let d=await q('apply_transport_line_operation',{operation_id:p.operation_id,request_id});
  if(d.state!=='completed')d=await poll('get_transport_line_operation',p.operation_id);
  save('budget-line-built',d);
  console.log('line',JSON.stringify(await q('get_transport_line',{line_id:d.result_line_id})));
  console.log('resume',JSON.stringify(await q('set_simulation_speed',{speed:'fastest'})));
}finally{await client.close();}
