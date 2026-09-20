import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
const c=new Client({name:'octagon-native-builder',version:'1'});
const mode=process.argv[2]??'ramps',path='artifacts/octagon-build-journal.jsonl';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:60000});const v=r.structuredContent??JSON.parse(r.content.find(x=>x.type==='text')?.text??'null');if(r.isError||!v?.ok)throw Error(JSON.stringify(v??r));return v.data;}
async function log(v){await appendFile(path,JSON.stringify({at:new Date().toISOString(),...v})+'\n');}
async function poll(id,target){for(let i=0;i<50;i++){let d=await call('get_road_operation',{operation_id:id});if(d.state===target)return d;if(['failed','cancelled','expired','outcome_unknown'].includes(d.state))throw Error(JSON.stringify(d));await sleep(350);}throw Error('Unresolved operation '+id);}
function bez(cv,t){let u=1-t;return Object.fromEntries(['x','y','z'].map(k=>[k,u*u*u*cv.a[k]+3*u*u*t*cv.b[k]+3*u*t*t*cv.c[k]+t*t*t*cv.d[k]]));}
function der(cv,t){let u=1-t;return Object.fromEntries(['x','y','z'].map(k=>[k,3*u*u*(cv.b[k]-cv.a[k])+6*u*t*(cv.c[k]-cv.b[k])+3*t*t*(cv.d[k]-cv.c[k])]));}
function sub(cv,t0,t1){let a=bez(cv,t0),d=bez(cv,t1),v=der(cv,t0),w=der(cv,t1),h=(t1-t0)/3;return{a,b:Object.fromEntries(['x','y','z'].map(k=>[k,a[k]+v[k]*h])),c:Object.fromEntries(['x','y','z'].map(k=>[k,d[k]-w[k]*h])),d};}
async function build(job){
 const status=await call('get_game_status',{});if(status.selected_speed!==0)throw Error('Must remain paused');
 let snap=await call('get_planning_map_snapshot',{bounds:{min_x:4800,min_z:200,max_x:7100,max_z:2800},max_features_per_layer:3000});
 const terrain=await call('sample_terrain',{points:job.points.map(({x,z})=>({x,z}))});
 let points=[];
 for(let i=0;i<job.points.length;i++){
  let p=job.points[i],pt={x:p.x,z:p.z,elevation_m:p.y===undefined?0:p.y-terrain.items[i].height_m};
  const matches=snap.roads.flatMap(r=>['a','d'].map(k=>({r,k,p:r.curve[k]}))).filter(v=>Math.hypot(v.p.x-p.x,v.p.z-p.z)<.7).sort((a,b)=>Math.abs(a.p.y-(p.y??terrain.items[i].height_m))-Math.abs(b.p.y-(p.y??terrain.items[i].height_m)));
  if(matches.length){let m=matches[0];const v=await call('get_entity_components',{entity_id:m.r.id,components:['Game.Net.Edge']});pt.node_id=v.components['Game.Net.Edge'].fields[m.k==='a'?'m_Start':'m_End'];delete pt.elevation_m;}
  points.push(pt);
 }
 const request_id='oct-v2-'+job.id;let args=job.curve?{request_id,road_prefab:job.prefab,start:points[0],end:points.at(-1),curve:{mode:'cubic',control_1:{x:job.curve.b.x,z:job.curve.b.z},control_2:{x:job.curve.c.x,z:job.curve.c.z}}}:{request_id,road_prefab:job.prefab,points};
 await log({stage:'request',id:job.id,args});let op=await call(job.curve?'preview_road':'preview_road_route',args);await log({stage:'preview',id:job.id,operation_id:op.operation_id});
 op=await poll(op.operation_id,'preview_ready');if(op.errors?.length||!op.can_commit)throw Error(JSON.stringify(op));if(op.cost>100000)throw Error('Per-operation budget exceeded');
 await log({stage:'ready',id:job.id,operation:op});await call('build_road',{operation_id:op.operation_id,request_id:request_id+'-commit',max_cost:op.cost});op=await poll(op.operation_id,'completed');
 const fresh=await call('get_planning_map_snapshot',{bounds:{min_x:4800,min_z:200,max_x:7100,max_z:2800},max_features_per_layer:3000});if(!op.created_road_ids.length||op.created_road_ids.some(id=>!fresh.roads.some(r=>r.id===id)))throw Error('Permanent readback incomplete '+op.operation_id);
 await log({stage:'completed_verified',id:job.id,operation:op});console.log(JSON.stringify({id:job.id,state:op.state,cost:op.cost,edges:op.created_road_ids.length}));
}
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const data=JSON.parse(await readFile('artifacts/octagon-access-design.json','utf8'));let jobs=[];
 if(mode==='ramps')for(const r of data.ramp_design_curves){for(let i=0;i<3;i++){let cv=sub(r.curve,i/3,(i+1)/3);jobs.push({id:r.id+'-'+i,prefab:'Highway Oneway - 1 lane',points:[cv.a,cv.d],curve:cv});}}
 if(mode==='roads'){
  const q=JSON.parse(await readFile('plans/auburn-octagon-town.json','utf8'));let selected=q.plan.roads.filter(r=>!r.id.startsWith('ramp-')&&!r.id.startsWith('interchange-overpass'));
  const order=['interchange-approach-r2','shared-distributor','south-corner-descent','south-rail-bridge','south-corner-approach','east-rail-south-ramp','east-rail-bridge','east-rail-north-ramp','east-corner-access']; const rank=r=>order.includes(r.id)?order.indexOf(r.id):r.id.startsWith('ring-680')?20:r.id.startsWith('spoke')?30:40;selected.sort((a,b)=>rank(a)-rank(b));
  for(const r of selected){let pts=[r.points[0]];for(let i=1;i<r.points.length;i++){let a=r.points[i-1],b=r.points[i],n=Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/240);for(let j=1;j<=n;j++)pts.push(Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+(b[k]-a[k])*j/n])));}jobs.push({id:r.id,prefab:r.prefab,points:pts});}
 }
 let journal='';try{journal=await readFile(path,'utf8')}catch{}const done=new Set(journal.trim().split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.stage==='completed_verified').map(x=>x.id));
 for(const job of jobs){if(done.has(job.id))continue;await build(job);}
}catch(e){await log({stage:'stopped',error:e.message});console.error(e.message);process.exitCode=1;}finally{await c.close()}
