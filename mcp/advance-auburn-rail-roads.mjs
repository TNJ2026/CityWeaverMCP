import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';
const c=new Client({name:'auburn-road-stage',version:'1'}), log=[];
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 let next=JSON.parse(await readFile('artifacts/auburn-rail-road-stage-preparation.json','utf8')).data.next_action;
 for(let n=0;next&&n<8;n++){
  const r=await c.callTool({name:next.tool,arguments:{...next.arguments,operation_timeout_ms:20000}});
  const v=r.structuredContent;log.push(v??r);
  await writeFile('artifacts/auburn-rail-road-stage-execution.json',JSON.stringify(log,null,2));
  console.log(JSON.stringify(v??r));
  if(r.isError||!v?.ok)break;
  const d=v.data;
  if(!['preview_ready','completed_verified'].includes(d.state))break;
  next=d.next_action;
 }
}finally{await c.close();}
