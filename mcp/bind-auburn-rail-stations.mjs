import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';
const c=new Client({name:'auburn-rail-binding',version:'1'});
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const d=JSON.parse(await readFile('plans/auburn-rail-station-plan.json','utf8'));
 for(const r of d.plan.roads)r.construction_status='built';
 d.plan.buildings.find(b=>b.id==='terminus').position={x:-2700.25,z:-1020};
 d.plan.roads.find(r=>r.id==='terminus-entry').points=[{x:-2568,z:-912},{x:-2568,z:-960},{x:-2568,z:-1080}];
 for(const p of d.plan.roads.find(r=>r.id==='station-front').points)p.y=570.0087;
 d.plan.roads.find(r=>r.id==='station-spine').points.at(-1).y=570.0087;
 const r=await c.callTool({name:'bind_city_plan_buildings',arguments:{bounds:d.bounds,plan:d.plan,request_id:'auburn-rail-v5-binding-001',candidate_count:8,max_preview_attempts:4,search_radius_m:200,road_side:'right',continue_on_error:true,operation_timeout_ms:15000}});
 await writeFile('artifacts/auburn-rail-v5-building-bindings.json',JSON.stringify(r.structuredContent??r,null,2));
 console.log(JSON.stringify(r.structuredContent?.data?.results??r));
}finally{await c.close();}
