import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=path.join(root,'artifacts','native-import-20261027');
fs.mkdirSync(evidence,{recursive:true});
const client=new Client({name:'native-conversion-validation',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
try {
  const name=process.argv[2], args=JSON.parse(process.argv[3]||'{}');
  const result=await client.callTool({name,arguments:args});
  for(const item of result.content||[])if(item.type==='image'){
    const imagePath=path.join(evidence,`${Date.now()}-${name}.png`);
    fs.writeFileSync(imagePath,Buffer.from(item.data,'base64'));console.log('Image: '+imagePath);
  }
  const value=result.structuredContent||result.content;
  fs.writeFileSync(path.join(evidence,`${Date.now()}-${name}.json`),JSON.stringify(value,null,2));
  console.log(JSON.stringify(value,null,2));
  if(result.isError)process.exitCode=1;
} finally {await client.close();}
