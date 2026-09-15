import { queryGame } from './bridge-client.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function q(t,a={}){return (await queryGame(t,a)).data}
async function wait(id,wanted,timeout=20000){let end=Date.now()+timeout;while(Date.now()<end){let x=await q('get_transport_line_operation',{operation_id:id});if(wanted.includes(x.state))return x;if(['failed','cancelled','expired','outcome_unknown'].includes(x.state))throw new Error(JSON.stringify(x));await sleep(100)}throw new Error('timeout')}
let line=null;
try{
 await q('set_simulation_speed',{speed:'paused'});
 const stops=(await q('list_transport_stops',{transport_type:'Train',passenger_only:true})).items.map(x=>x.stop_id);
 const req='transport_vehicle_observation_140'; const p=await q('preview_transport_line',{request_id:req,line_prefab:'Passenger Train Line',stop_ids:stops,name:'MCP Vehicle Observation'}); await wait(p.operation_id,['preview_ready']); await q('apply_transport_line_operation',{operation_id:p.operation_id,request_id:req}); line=(await wait(p.operation_id,['completed'])).result_line_id;
 await q('set_simulation_speed',{speed:'fastest'}); let max=0,last;
 for(let i=0;i<15;i++){await sleep(2000);last=await q('get_transport_line',{line_id:line});max=Math.max(max,last.vehicle_count??0);if(max>0)break;}
 console.log(JSON.stringify({line_id:line,max_vehicle_count:max,vehicles:last.vehicles,total_waiting_passengers:last.total_waiting_passengers,vehicle_request_pending:last.vehicle_request_pending},null,2));
}finally{
 try{await q('set_simulation_speed',{speed:'paused'});if(line){const req='transport_vehicle_cleanup_140';const p=await q('preview_transport_line_delete',{request_id:req,line_id:line});await wait(p.operation_id,['preview_ready']);await q('apply_transport_line_operation',{operation_id:p.operation_id,request_id:req});await wait(p.operation_id,['completed']);}}finally{await q('set_simulation_speed',{speed:'normal'});}
}
