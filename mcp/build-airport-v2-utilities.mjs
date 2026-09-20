import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {appendFile,readFile,writeFile} from 'node:fs/promises';
const c=new Client({name:'airport-utilities',version:'1'}), path='artifacts/airport-v2-utilities.jsonl';
async function call(name,args){let r=await c.callTool({name,arguments:args},undefined,{timeout:60000});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
const log=x=>appendFile(path,JSON.stringify(x)+'\n');
async function poll(id,target){for(let i=0;i<80;i++){let d=await call('get_utility_operation',{operation_id:id});if(d.state===target)return d;if(['failed','cancelled','expired','outcome_unknown'].includes(d.state))throw Error(JSON.stringify(d));await new Promise(r=>setTimeout(r,300));}throw Error('Unresolved '+id);}
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 let old='';try{old=await readFile(path,'utf8')}catch{}const done=new Set(old.trim().split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.stage==='completed').map(x=>x.id));
 const a={x:799.9978,z:-886.181335,node_id:'5a7035fc0c7b444bb3cf31ba653fce0c:378307:1'},b={x:1200,z:-1600,node_id:'5a7035fc0c7b444bb3cf31ba653fce0c:84076:51'};
 for(const [id,prefab,n,depth] of [['water-sewage','Combined Small Pipe',5,-15],['electricity','Low-voltage Ground Cable',10,-10]]){
  if(done.has(id))continue;const points=[a,...Array.from({length:n-1},(_,i)=>({x:a.x+(b.x-a.x)*(i+1)/n,z:a.z+(b.z-a.z)*(i+1)/n,elevation_m:depth})),b];
  await log({stage:'request',id,points,prefab});let op=await call('preview_utility_network',{request_id:'airport-v2-'+id,utility_prefab:prefab,points});await log({stage:'preview',id,operation_id:op.operation_id});op=await poll(op.operation_id,'preview_ready');await log({stage:'ready',id,op});if(!op.can_commit||op.errors?.length||op.cost>100000)throw Error('Rejected '+JSON.stringify(op));await call('apply_utility_operation',{operation_id:op.operation_id,request_id:'airport-v2-'+id+'-commit',max_cost:op.cost});op=await poll(op.operation_id,'completed');await log({stage:'completed',id,op});console.log(JSON.stringify({id,state:op.state,cost:op.cost,created:op.created_utility_ids??op.created_network_ids}));
 }
 await writeFile('artifacts/airport-v2-utilities-asbuilt.json',JSON.stringify(await call('list_utility_networks',{}),null,2));
}catch(e){await log({stage:'stopped',error:e.message});console.error(e.message);process.exitCode=1;}finally{await c.close();}
