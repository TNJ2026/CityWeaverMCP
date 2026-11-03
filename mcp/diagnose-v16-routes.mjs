import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const client=new Client({name:'pedestrian-repair',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args={}){const r=await client.callTool({name,arguments:args});const v=r.structuredContent;if(!v?.ok)throw Error(JSON.stringify(v||r));return v.data;}
try{
const fsx=await call('list_transport_facilities');const stops=[];
for(const f of fsx.items.filter(x=>x.prefab.startsWith('CityWeaver'))){const d=await call('get_transport_facility',{facility_id:f.facility_id});for(const s of d.stops||[]){const p=await call('get_entity_details',{entity_id:s.stop_id});stops.push({id:s.stop_id,facility:f.name,pos:p.position});}}
const ls=await call('list_transport_lines');const plan=[];
for(const l of ls.items.filter(x=>x.prefab==='CityWeaver Helicopter Line')){const d=await call('get_transport_line',{line_id:l.line_id});const ids=d.stops.map(s=>{if(s.stop_id)return s.stop_id;const ordered=stops.map(t=>({...t,dist:Math.hypot(t.pos.x-s.position.x,t.pos.z-s.position.z)})).sort((a,b)=>a.dist-b.dist);if(ordered[0].dist>2)throw Error('No exact matching replacement stop '+JSON.stringify(s));return ordered[0].id;});plan.push({line_id:l.line_id,name:l.name,stop_ids:ids,was_invalid:!l.stops_valid});}
fs.writeFileSync('artifacts/native-import-20261027/v16-route-repair-plan.json',JSON.stringify({stops,plan},null,2));console.log(JSON.stringify({stops,plan},null,2));
}finally{await client.close();}
