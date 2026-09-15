import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const c = new Client({ name: 'citizen-trip-live', version: '1.12.0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const q = async (name, args={}) => { const r=await c.callTool({name,arguments:args}); if(r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`); return r.structuredContent.data; };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out={}; let chosen=null;
try {
  await q('set_simulation_speed',{speed:'paused'});
  const citizens=await q('list_citizens',{limit:100});
  for(const citizen of citizens.items){if(!citizen.household_id||!citizen.current_building_id)continue;try{const trips=await q('list_citizen_trips',{citizen_id:citizen.entity_id});if(!trips.active_traveler_id&&!trips.queued_count){chosen=citizen;break;}}catch(error){if(!String(error).includes('ENTITY_NOT_FOUND'))throw error;}}
  const buildings=await q('query_buildings',{building_type:'all',limit:100});
  if(!chosen||!buildings.items.length){out.skipped='no idle citizen or building';console.log(JSON.stringify(out,null,2));process.exitCode=2;}
  else {
    const destination=buildings.items.find(x=>x.entity_id!==chosen.current_building_id)??buildings.items[0];
    out.queued=await q('request_citizen_trip',{citizen_id:chosen.entity_id,target_id:destination.entity_id,purpose:'Sightseeing',priority:255});
    await q('set_simulation_speed',{speed:'fastest'});
    let active=null;
    for(let i=0;i<30;i++){await sleep(1000);try{const state=await q('list_citizen_trips',{citizen_id:chosen.entity_id});if(state.active_traveler_id){active=state;break;}}catch(error){if(!String(error).includes('ENTITY_NOT_FOUND'))throw error;out.citizen_became_unavailable=true;break;}}
    out.spawned=!!active;
    if(active){
      await q('set_simulation_speed',{speed:'paused'});
      const id=active.active_traveler_id;
      const traveler=await q('get_traveler',{traveler_id:id});
      out.traveler=traveler;
      out.path=await q('get_traveler_path',{traveler_id:id,limit:1000});
      if(traveler.target_id) out.retarget=await q('set_traveler_target',{traveler_id:id,target_id:traveler.target_id});
      if(typeof traveler.navigation_max_speed_mps==='number'){
        const original=traveler.navigation_max_speed_mps,changed=Math.max(.1,original*.9);
        await q('set_traveler_speed',{traveler_id:id,max_speed_mps:changed});
        const observed=await q('get_traveler',{traveler_id:id});assert(Math.abs(observed.navigation_max_speed_mps-changed)<.001);
        await q('set_traveler_speed',{traveler_id:id,max_speed_mps:original});out.speed_round_trip=[original,observed.navigation_max_speed_mps,original];
      }
    } else {
      await q('set_simulation_speed',{speed:'paused'});
      if(!out.citizen_became_unavailable)out.cancelled=await q('cancel_citizen_trips',{citizen_id:chosen.entity_id,purpose:'Sightseeing'});
    }
    await q('set_simulation_speed',{speed:'normal'});
    out.final=await q('get_game_status');
    console.log(JSON.stringify(out,null,2));
  }
} finally { try{await q('set_simulation_speed',{speed:'normal'});}catch{} await c.close(); }
