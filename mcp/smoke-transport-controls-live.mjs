import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const client=new Client({name:'transport-controls-live',version:'1.14.0'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(name,args={},allow=false){const r=await client.callTool({name,arguments:args});if(r.isError&&!allow)throw new Error(`${name}: ${r.content?.[0]?.text}`);return r.structuredContent||r;}
async function wait(id){for(let i=0;i<250;i++){const x=(await call('get_transport_line_operation',{operation_id:id})).data;if(['preview_ready','completed','failed','cancelled','expired','outcome_unknown'].includes(x.state))return x;await sleep(100);}throw new Error('operation timeout');}

await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
let lineId=null;const report={};
try{
  assert.equal((await client.listTools()).tools.length,342);
  const status=(await call('get_game_status')).data;assert.equal(status.bridge_version,'1.22.0');await call('set_simulation_speed',{speed:'paused'});
  const before=(await call('list_transport_lines')).data.total;
  const prefab=(await call('list_transport_line_prefabs',{search:'Bus'})).data.items.find(x=>x.name==='Bus Line');
  const stops=(await call('list_transport_stops',{transport_type:'Bus',passenger_only:true})).data.items;
  assert(prefab&&stops.length>=2);
  const selections=[stops.map(x=>x.stop_id),...stops.slice(1).map((_,i)=>[stops[0].stop_id,stops[i+1].stop_id])];
  for(let i=0;i<selections.length&&!lineId;i++){
    const request=`transport_controls_create_${i}_${Date.now()}`;const p=(await call('preview_transport_line',{request_id:request,line_prefab:prefab.name,stop_ids:selections[i],name:'MCP Controls Live'})).data;const ready=await wait(p.operation_id);if(ready.state!=='preview_ready')continue;await call('apply_transport_line_operation',{operation_id:p.operation_id,request_id:request});const done=await wait(p.operation_id);if(done.state==='completed')lineId=done.result_line_id;
  }
  assert(lineId,'No connected bus route available');let line=(await call('get_transport_line',{line_id:lineId})).data;
  report.created={line_id:lineId,stops:line.stop_count,distance_m:line.route_distance_m};
  await call('set_transport_line_number',{line_id:lineId,route_number:701});
  await call('set_transport_line_unbunching',{line_id:lineId,unbunching_factor:.33});
  await call('set_transport_line_schedule',{line_id:lineId,schedule:'day'});await sleep(250);
  line=(await call('get_transport_line',{line_id:lineId})).data;assert.equal(line.route_number,701);assert(Math.abs(line.unbunching_factor-.33)<.001);assert.equal(line.schedule,'day');
  await call('set_transport_line_schedule',{line_id:lineId,schedule:'day_and_night'});await sleep(250);assert.equal((await call('get_transport_line',{line_id:lineId})).data.schedule,'day_and_night');
  const policies=(await call('list_transport_line_policies',{line_id:lineId})).data.items;const ticket=policies.find(x=>x.option_mask===8&&x.slider);if(ticket){const price=Math.max(1,Math.ceil(ticket.slider.min));await call('set_transport_line_ticket_price',{line_id:lineId,ticket_price:price});await call('set_simulation_speed',{speed:'normal'});await sleep(1000);await call('set_simulation_speed',{speed:'paused'});assert.equal((await call('get_transport_line',{line_id:lineId})).data.ticket_price,price);await call('set_transport_line_ticket_price',{line_id:lineId,ticket_price:0});}
  const countProbe=await call('set_transport_line_vehicle_count',{line_id:lineId,vehicle_count:1},true);
  let requestedVehicleCount=1;let setCount=countProbe;
  if(countProbe.ok===false||countProbe.isError===true){const message=countProbe.error?.message||countProbe.content?.[0]?.text||'';const range=/native line range (\d+)\.\.(\d+)/.exec(message);assert(range,`Missing native vehicle-count range: ${message}`);requestedVehicleCount=Number(range[1]);setCount=await call('set_transport_line_vehicle_count',{line_id:lineId,vehicle_count:requestedVehicleCount});}
  assert.equal(setCount.data.requested_vehicle_count,requestedVehicleCount);report.vehicleCount=setCount.data;
  const stop=stops[0];await call('set_transport_stop_name',{stop_id:stop.stop_id,name:'MCP Stop Live'});assert.equal((await call('list_transport_stops',{transport_type:'Bus',passenger_only:true})).data.items.find(x=>x.stop_id===stop.stop_id).name,'MCP Stop Live');await call('set_transport_stop_name',{stop_id:stop.stop_id,name:''});
  const request=(await call('request_transport_line_vehicle',{line_id:lineId,priority:.8})).data;let requests=(await call('list_transport_vehicle_requests',{line_id:lineId})).data;assert(requests.total>=1&&requests.items.some(x=>x.request_id===request.request_id));const cancelled=(await call('cancel_transport_line_vehicle_requests',{line_id:lineId})).data;assert(cancelled.cancelled_request_count>=1);requests=(await call('list_transport_vehicle_requests',{line_id:lineId})).data;assert.equal(requests.total,0);
  report.controls={number:true,unbunching:true,schedule:true,ticketPrice:!!ticket,stopName:true,vehicleRequestRoundTrip:true};
  report.facilities={count:(await call('list_transport_facilities')).data.total};
  const delReq=`transport_controls_delete_${Date.now()}`;const p=(await call('preview_transport_line_delete',{request_id:delReq,line_id:lineId})).data;assert.equal((await wait(p.operation_id)).state,'preview_ready');await call('apply_transport_line_operation',{operation_id:p.operation_id,request_id:delReq});assert.equal((await wait(p.operation_id)).state,'completed');lineId=null;assert.equal((await call('list_transport_lines')).data.total,before);
  console.log(JSON.stringify({ok:true,report},null,2));
}finally{
  if(lineId){try{const request=`transport_controls_cleanup_${Date.now()}`;const p=(await call('preview_transport_line_delete',{request_id:request,line_id:lineId})).data;if((await wait(p.operation_id)).state==='preview_ready'){await call('apply_transport_line_operation',{operation_id:p.operation_id,request_id:request});await wait(p.operation_id);}}catch{}}
  try{await call('set_simulation_speed',{speed:'normal'});}catch{}await client.close();
}
