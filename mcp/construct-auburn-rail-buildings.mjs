import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';
const c=new Client({name:'auburn-rail-buildings',version:'1'}),log=[];
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const d=JSON.parse(await readFile('plans/auburn-rail-station-plan.json','utf8'));
 const rendered=JSON.parse(await readFile('artifacts/auburn-rail-render-result.json','utf8'));
 const prep=await c.callTool({name:'prepare_city_plan_construction',arguments:{bounds:d.bounds,plan:d.plan,approved_plan_id:rendered.data.plan_id}});
 await writeFile('artifacts/auburn-rail-v5-buildings-preparation.json',JSON.stringify(prep.structuredContent??prep,null,2));
 console.log(JSON.stringify({preparation:prep.structuredContent??prep}));
 if(!prep.structuredContent?.data?.construction_ready)throw Error('Plan not construction ready');
 let next=prep.structuredContent.data.next_action;
 for(let n=0;next&&n<8;n++){
  const r=await c.callTool({name:next.tool,arguments:{...next.arguments,operation_timeout_ms:25000}});
  const v=r.structuredContent;log.push(v??r);
  await writeFile('artifacts/auburn-rail-v5-buildings-execution.json',JSON.stringify(log,null,2));
  const q=v?.data;console.log(JSON.stringify({ok:v?.ok,state:q?.state,batch:q?.batch_id,native:q?.native_operation??q?.native_preview,readback:q?.permanent_readback,error:v?.error??(r.isError?r:undefined)}));
  if(r.isError||!v?.ok||!['preview_ready','completed_verified'].includes(q.state))break;
  next=q.next_action;
 }
}finally{await c.close();}
