import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';import {fileURLToPath} from 'node:url';import fs from 'node:fs';
const c=new Client({name:'verify-reload-v17',version:'1'});await c.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args={}){const r=await c.callTool({name,arguments:args});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
async function comp(id,components){return (await call('get_entity_components',{entity_id:id,components})).components;}
try{
const facilities=await call('list_transport_facilities');const airport=facilities.items.find(f=>f.name==='CityWeaver双停机坪机场');const detail=await call('get_transport_facility',{facility_id:airport.facility_id});const stop=detail.stops[0].stop_id;
const icon=await comp(airport.facility_id,['Game.Notifications.IconElement']);const sd=await comp(stop,['Game.Objects.SpawnLocation','Game.Prefabs.PrefabRef']);const pd=await comp(sd['Game.Prefabs.PrefabRef'].fields.m_Prefab,['Game.Prefabs.SpawnLocationData']);
const lines=[];
for(const l of (await call('list_transport_lines')).items.filter(x=>x.prefab==='CityWeaver Helicopter Line')){
 const d=await call('get_transport_line',{line_id:l.line_id});const access=[];
 for(const s of d.stops){const a=(await comp(s.waypoint_id,['Game.Routes.AccessLane']))['Game.Routes.AccessLane'];const lane=a.fields?.m_Lane;const data=lane?await comp(lane,['Game.Net.PedestrianLane']):{};access.push({stop:s.stop_id,lane,real_pedestrian_lane:data['Game.Net.PedestrianLane']?.present===true});}
 lines.push({name:l.name,active:l.active,stops_valid:l.stops_valid,path_complete:l.path_complete,vehicles:l.vehicle_count,access});
}
const result={airport,warning_count:icon['Game.Notifications.IconElement'].length||0,stop,legacy_spawn_present:sd['Game.Objects.SpawnLocation'].present,legacy_prefab_spawn_present:pd['Game.Prefabs.SpawnLocationData'].present,lines};fs.writeFileSync('artifacts/native-import-20261027/v17-reload-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await c.close();}
