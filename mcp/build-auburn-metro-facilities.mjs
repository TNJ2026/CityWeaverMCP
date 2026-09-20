import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {appendFile,readFile} from 'node:fs/promises';
const c=new Client({name:'metro-facilities',version:'1'}),file='artifacts/auburn-metro-construction.jsonl';
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:60000});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r.structuredContent??r));return r.structuredContent.data}
async function log(v){await appendFile(file,JSON.stringify({at:new Date().toISOString(),...v})+'\n')}
try{await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
let old='';try{old=await readFile(file,'utf8')}catch{}const done=new Set(old.split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.stage==='completed').map(x=>x.id));
for(const it of [{id:'S1',x:-460.4446,z:400.249969,rotation:180},{id:'S2',x:700,z:191.75,rotation:0},{id:'S3',x:4927.899,z:1958.01416,rotation:67.50005},{id:'S4',x:5975.999,z:2009.75,rotation:0}]){
if(done.has(it.id))continue;
const p=await call('plan_building_workflow',{request_id:'auburn-metro-'+it.id+'-site-v1',building_prefab:'SubwayStation01',category:'transport_facility',near:{x:it.x,z:it.z},search_radius_m:65,candidate_count:24,max_preview_attempts:8,consider_service_coverage:false,site_selection:'native'});await log({id:it.id,stage:'preview',plan:p});
if(p.state!=='preview_ready'||p.cost>200000||p.warnings?.length||Math.hypot(p.candidate.position.x-it.x,p.candidate.position.z-it.z)>80)throw Error('Preview gate '+it.id);
const d=await call('execute_building_plan',{request_id:'auburn-metro-'+it.id+'-commit-v1',plan_id:p.plan_id,max_cost:p.cost,resume_speed:'paused'});await log({id:it.id,stage:d.state==='completed'?'completed':'needs_audit',result:d});console.log(JSON.stringify({id:it.id,state:d.state,position:d.candidate?.position,entities:d.result_entity_ids,road:d.road_binding}));if(d.state!=='completed'||!d.road_binding?.verified)throw Error('Completion gate');
for(const entity_id of d.result_entity_ids){let raw=await call('get_entity_components',{entity_id,components:['Game.Buildings.Building','Game.Buildings.ElectricityConsumer','Game.Buildings.WaterConsumer']});await log({id:it.id,stage:'raw_readback',raw});if(!raw.components['Game.Buildings.Building']?.fields?.m_RoadEdge)throw Error('Road binding missing');}
}
}catch(e){await log({stage:'stopped',error:e.message});console.error(e.message);process.exitCode=1}finally{await c.close()}
