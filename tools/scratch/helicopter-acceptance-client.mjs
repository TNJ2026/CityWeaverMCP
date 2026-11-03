import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'artifacts/helicopter-acceptance-20261030');
fs.mkdirSync(output,{recursive:true});
export const client=new Client({name:'helicopter-acceptance-20261030',version:'1'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')]}));
let sequence=0;
export async function q(name,args={}){
  const result=await client.callTool({name,arguments:args});
  const value=result.structuredContent;
  fs.writeFileSync(path.join(output,`${Date.now()}-${++sequence}-${name}.json`),JSON.stringify({arguments:args,result:value||result},null,2));
  if(result.isError||!value?.ok)throw Error(JSON.stringify(value||result));
  return value.data;
}
export async function poll(name,id,states=['completed'],attempts=40){
  for(let i=0;i<attempts;i++){
    const data=await q(name,{operation_id:id});
    if(states.includes(data.state))return data;
    if(['failed','cancelled','expired','outcome_unknown'].includes(data.state)||data.error)
      throw Error(JSON.stringify(data));
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('Inspect original operation before continuing: '+id);
}
export function save(name,value){fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2));}
