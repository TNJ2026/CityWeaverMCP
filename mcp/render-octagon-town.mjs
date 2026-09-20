import { readToolMedia } from './tool-media.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
const c=new Client({name:'octagon-planning',version:'1.0'});
try {
 await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
 const args=JSON.parse(await readFile('plans/auburn-octagon-town.json','utf8'));
 const r=await c.callTool({name:'render_city_plan',arguments:args},undefined,{timeout:180000});
 if(r.isError) throw Error(JSON.stringify(r));
 const html=await readToolMedia(r);
 if(!html) throw Error('HTML missing');
 await writeFile('artifacts/auburn-octagon-map.html',html);
 await writeFile('artifacts/octagon-render-result.json',JSON.stringify(r.structuredContent,null,2));
 console.log(JSON.stringify(r.structuredContent?.data?.validation));
}finally{await c.close()}
