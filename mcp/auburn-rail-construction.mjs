import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';
const client=new Client({name:'auburn-rail-construction',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const full=JSON.parse(await readFile('plans/auburn-rail-station-plan.json','utf8'));
 const plan={roads:full.plan.roads.filter(r=>r.level==='surface'),grid_exceptions:full.plan.grid_exceptions};
 const args={...full,plan};
 const r=await client.callTool({name:'render_city_plan',arguments:args});
 if(r.isError)throw Error(JSON.stringify(r));
 await writeFile('artifacts/auburn-rail-road-stage-render.json',JSON.stringify(r.structuredContent,null,2));
 const data=r.structuredContent.data;
 console.log(JSON.stringify({render:data.plan_id,validation:data.validation}));
 const stage={bounds:full.bounds,plan,approved_plan_id:data.plan_id};
 await writeFile('plans/auburn-rail-road-stage.json',JSON.stringify(stage,null,2));
 const prep=await client.callTool({name:'prepare_city_plan_construction',arguments:stage});
 await writeFile('artifacts/auburn-rail-road-stage-preparation.json',JSON.stringify(prep.structuredContent??prep,null,2));
 console.log(JSON.stringify(prep.structuredContent??prep));
}finally{await client.close();}
