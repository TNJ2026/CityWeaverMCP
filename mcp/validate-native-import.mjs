import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.resolve(process.argv[2]);
// This diagnostic imports one flat LOD directory. Count material parts before
// contacting the game; the native renderer permits only 16 batches per group.
const partCount=fs.readdirSync(source).filter(p=>p.endsWith('.obj')).reduce((sum,p)=>{
 const text=fs.readFileSync(path.join(source,p),'utf8');
 return sum+Math.max(1,new Set([...text.matchAll(/^usemtl\s+(.+)$/gm)].map(m=>m[1].trim())).size);
},0);
if(partCount>16)throw Error(`Native render group has ${partCount} material parts (limit 16); split into separate render modules before importing.`);
const dir=path.join(root,'artifacts/native-import-20261027');
const mark=path.join(dir,path.basename(source)+'-operation.json');
if(fs.existsSync(mark))throw Error('Existing operation; inspect instead of automatic reimport: '+mark);
const client=new Client({name:'native-isolation',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){
 const r=await client.callTool({name,arguments:args});const v=r.structuredContent;
 fs.writeFileSync(path.join(dir,`${Date.now()}-${name}.json`),JSON.stringify(v||r,null,2));
 if(r.isError||!v?.ok)throw Error(JSON.stringify(v||r));return v.data;
}
try{
 const request_id='isolate-'+path.basename(source)+'-20261027';
 let d=await call('preview_model_import',{request_id,source_directory:source,preset:'static_object'});
 fs.writeFileSync(mark,JSON.stringify(d,null,2));
 if(d.state!=='preview_ready'||!d.can_commit)throw Error(JSON.stringify(d));
 d=await call('apply_asset_file_operation',{operation_id:d.operation_id,request_id,max_input_bytes:d.input_bytes});
 fs.writeFileSync(mark,JSON.stringify(d,null,2));
 for(let i=0;i<120&&d.state==='importing';i++){
  await new Promise(r=>setTimeout(r,5000));d=await call('get_asset_file_operation',{operation_id:d.operation_id});
  fs.writeFileSync(mark,JSON.stringify(d,null,2));
 }
 console.log(JSON.stringify(d,null,2));
 if(d.state!=='completed')process.exitCode=1;
}finally{await client.close();}
