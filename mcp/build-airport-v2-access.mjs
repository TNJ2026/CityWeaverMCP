import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {appendFile,readFile,writeFile} from 'node:fs/promises';
const c=new Client({name:'airport-v2-access',version:'1'}), journal='artifacts/airport-v2-access.jsonl';
const bounds={min_x:900,min_z:-2200,max_x:3200,max_z:-900};
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:60000});const v=r.structuredContent;if(r.isError||!v?.ok)throw Error(JSON.stringify(v??r));return v.data;}
const log=v=>appendFile(journal,JSON.stringify({at:new Date().toISOString(),...v})+'\n');
async function poll(id,target){for(let i=0;i<80;i++){let d=await call('get_road_operation',{operation_id:id});if(d.state===target)return d;if(['failed','cancelled','expired','outcome_unknown'].includes(d.state))throw Error(JSON.stringify(d));await new Promise(r=>setTimeout(r,300));}throw Error('Unresolved '+id);}
async function snap(){return call('get_planning_map_snapshot',{bounds,max_features_per_layer:1000});}
async function build(id,pts,curve,prefab='Medium Road'){
 const s=await snap(), ts=await call('sample_terrain',{points:pts.map(({x,z})=>({x,z}))}),points=[];
 for(let i=0;i<pts.length;i++){const p=pts[i];let q={x:p.x,z:p.z,elevation_m:p.y-ts.items[i].height_m};const m=s.roads.flatMap(r=>['a','d'].map(k=>({r,k,p:r.curve[k]}))).find(v=>Math.hypot(v.p.x-p.x,v.p.z-p.z)<.7&&Math.abs(v.p.y-p.y)<2);
  if(m){const raw=await call('get_entity_components',{entity_id:m.r.id,components:['Game.Net.Edge']});q.node_id=raw.components['Game.Net.Edge'].fields[m.k==='a'?'m_Start':'m_End'];delete q.elevation_m;}points.push(q);}
 const request_id='airport-v2-'+id,args=curve?{request_id,road_prefab:prefab,start:points[0],end:points[1],curve:{mode:'cubic',control_1:curve.b,control_2:curve.c}}:{request_id,road_prefab:prefab,points};
 await log({stage:'request',id,args});let op=await call(curve?'preview_road':'preview_road_route',args);await log({stage:'preview',id,operation_id:op.operation_id});op=await poll(op.operation_id,'preview_ready');await log({stage:'ready',id,operation:op});if(!op.can_commit||op.errors?.length||op.cost>100000)throw Error('Rejected '+JSON.stringify(op));await call('build_road',{operation_id:op.operation_id,request_id:request_id+'-commit',max_cost:op.cost});op=await poll(op.operation_id,'completed');const fresh=await snap();if(op.created_road_ids.some(x=>!fresh.roads.some(r=>r.id===x)))throw Error('Readback incomplete');await log({stage:'completed',id,operation:op});console.log(JSON.stringify({id,state:op.state,cost:op.cost}));
}
function bez(v,t){let u=1-t;return Object.fromEntries(['x','y','z'].map(k=>[k,u*u*u*v.a[k]+3*u*u*t*v.b[k]+3*u*t*t*v.c[k]+t*t*t*v.d[k]]));}
function der(v,t){return Object.fromEntries(['x','y','z'].map(k=>[k,3*(1-t)**2*(v.b[k]-v.a[k])+6*(1-t)*t*(v.c[k]-v.b[k])+3*t*t*(v.d[k]-v.c[k])]));}
function sub(v,t0,t1){let a=bez(v,t0),d=bez(v,t1),v0=der(v,t0),v1=der(v,t1),h=(t1-t0)/3;return {a,b:Object.fromEntries(['x','y','z'].map(k=>[k,a[k]+v0[k]*h])),c:Object.fromEntries(['x','y','z'].map(k=>[k,d[k]-v1[k]*h])),d};}
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));if(!(await call('get_game_status',{})).paused)throw Error('Must be paused');
 let old='';try{old=await readFile(journal,'utf8')}catch{}let done=new Set(old.trim().split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.stage==='completed').map(x=>x.id));
 const jobs=[{id:'access-link',pts:[{x:2300,y:546.508362,z:-1600},{x:2500,y:544,z:-1680}]},{id:'bridge-clear-powerline',pts:[{x:2500,y:544,z:-1680},{x:2500,y:558,z:-1560},{x:2500,y:558,z:-1430}]}];
 const ramps=[
 {id:'eb-off',a:{x:2276.734,y:546.570862,z:-1499.80676},b:{x:2410,y:546,z:-1493},c:{x:2500,y:545,z:-1570},d:{x:2500,y:544,z:-1680}},
 {id:'eb-on',a:{x:2500,y:544,z:-1680},b:{x:2630,y:548,z:-1680},c:{x:2650,y:553,z:-1481},d:{x:2770.97388,y:555.9994,z:-1475.09961}},
 {id:'wb-off',a:{x:2769.97559,y:555.9994,z:-1455.125},b:{x:2660,y:557,z:-1449},c:{x:2560,y:558,z:-1430},d:{x:2500,y:558,z:-1430}},
 {id:'wb-on',a:{x:2500,y:558,z:-1430},b:{x:2410,y:554,z:-1430},c:{x:2360,y:548,z:-1476},d:{x:2275.73535,y:546.570862,z:-1479.83167}}
 ];
 for(const r of ramps)for(let i=0;i<2;i++){let cv=sub(r,i/2,(i+1)/2);jobs.push({id:r.id+'-'+i,pts:[cv.a,cv.d],curve:{b:{x:cv.b.x,z:cv.b.z},c:{x:cv.c.x,z:cv.c.z}},prefab:'Highway Oneway - 1 lane'});}
 const off=jobs.find(j=>j.id==='eb-off-1');off.id='eb-off-frontage';off.pts[1]={x:2407.70337,y:545.202637,z:-1643.08142};off.curve.c={x:2445,z:-1610};
 await writeFile('artifacts/airport-v2-access-design.json',JSON.stringify({jobs,ramps},null,2));
 for(const j of jobs)if(j.id!=='eb-on-1'&&!done.has(j.id))await build(j.id,j.pts,j.curve,j.prefab);
 await writeFile('artifacts/airport-v2-access-asbuilt.json',JSON.stringify(await snap(),null,2));
}catch(e){await log({stage:'stopped',error:e.message});console.error(e.message);process.exitCode=1;}finally{await c.close();}
