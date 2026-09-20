import { readToolMedia } from './tool-media.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
const client = new Client({name:'rail-plan-export',version:'1.0'});
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const args=JSON.parse(await readFile(new URL('../plans/auburn-rail-station-plan.json',import.meta.url),'utf8'));
 const r=await client.callTool({name:'render_city_plan',arguments:args});
 if(r.isError) throw new Error(JSON.stringify(r));
 const resource=await readToolMedia(r);
 if(!resource) throw new Error('No HTML resource');
 await writeFile(new URL('../artifacts/auburn-rail-station-map.html',import.meta.url),resource);
 await writeFile(new URL('../artifacts/auburn-rail-render-result.json',import.meta.url),JSON.stringify(r.structuredContent,null,2));
 console.log(JSON.stringify(r.structuredContent?.data?.validation));
} finally {await client.close();}
