import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const c=new Client({name:'mi26-check',version:'1'});
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
 const r=await c.callTool({name:'capture_game_view',arguments:{max_width:1280,max_height:720}});
 const img=r.content.find(x=>x.type==='image');if(!img)throw Error(JSON.stringify(r.structuredContent));
 fs.writeFileSync(process.argv[2],Buffer.from(img.data,'base64'));
 console.log(JSON.stringify(r.structuredContent));
}finally{await c.close();}
