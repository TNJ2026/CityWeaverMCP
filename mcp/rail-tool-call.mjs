import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
const [tool, file, output] = process.argv.slice(2);
const client = new Client({name:'rail-curve-construction',version:'1.0'});
try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
  const r = await client.callTool({name:tool,arguments:JSON.parse(await readFile(file,'utf8'))});
  if(output) await writeFile(output,JSON.stringify(r.structuredContent ?? r,null,2));
  const d=r.structuredContent?.data;
  console.log(JSON.stringify(d ? {operation_id:d.operation_id,state:d.state,can_commit:d.can_commit,cost:d.cost,errors:d.errors,error:d.error,curve_segments:d.curve_segments} : r));
} finally { await client.close(); }
