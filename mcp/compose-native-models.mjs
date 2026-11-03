import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'artifacts/native-import-20261027');
const requests=JSON.parse(fs.readFileSync(process.argv[2]?path.resolve(process.argv[2]):path.join(dir,'composition-requests.json')));
const client=new Client({name:'native-composition-validation',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){const r=await client.callTool({name,arguments:args});const v=r.structuredContent;
 fs.writeFileSync(path.join(dir,`${Date.now()}-${name}.json`),JSON.stringify(v||r,null,2));
 if(r.isError||!v?.ok)throw Error(JSON.stringify(v||r));return v.data;}
try{
 for(const request of requests){
  const mark=path.join(dir,request.model+'-composition.json');
  if(fs.existsSync(mark))throw Error('Existing composition journal; inspect before repeating: '+mark);
  let op=await call(request.tool,request.arguments);
  fs.writeFileSync(mark,JSON.stringify(op,null,2));
  if(op.state!=='preview_ready'||!op.can_commit)throw Error('Composition preview not ready');
  op=await call('apply_asset_file_operation',{operation_id:op.operation_id,request_id:op.request_id,max_input_bytes:0});
  fs.writeFileSync(mark,JSON.stringify(op,null,2));
  for(let i=0;i<30&&op.state==='importing';i++){
   await new Promise(r=>setTimeout(r,1000));op=await call('get_asset_file_operation',{operation_id:op.operation_id});
   fs.writeFileSync(mark,JSON.stringify(op,null,2));
  }
  if(op.state!=='completed')throw Error(JSON.stringify({state:op.state,error:op.error,id:op.operation_id}));
  const result=op.results[0];
  const materials=await call('list_asset_materials',{prefab:result.prefab});
  const expected=op.composition_modules.reduce((n,m)=>n+m.surfaces.length,0);
  if(materials.materials.length!==expected)throw Error('Composition material count mismatch');
  fs.writeFileSync(path.join(dir,request.model+'-composition-materials.json'),JSON.stringify(materials,null,2));
  console.log(JSON.stringify({model:request.model,state:op.state,prefab:result.prefab,meshes:result.render_meshes.length,materials:expected,size:result.size_m}));
 }
}finally{await client.close();}
