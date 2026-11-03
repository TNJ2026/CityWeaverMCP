import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'artifacts/native-import-20261027');
const client=new Client({name:'native-import-batch',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){
 const r=await client.callTool({name,arguments:args});const v=r.structuredContent;
 fs.writeFileSync(path.join(dir,`${Date.now()}-${name}.json`),JSON.stringify(v||r,null,2));
 if(r.isError||!v?.ok)throw Error(JSON.stringify(v||r));return v.data;
}
async function finish(id){
 for(let i=0;i<180;i++){
  const d=await call('get_asset_file_operation',{operation_id:id});
  if(d.state==='completed'){console.log(JSON.stringify({state:d.state,source:d.source_path,results:d.results}));return d;}
  if(d.state!=='importing')throw Error(JSON.stringify(d));
  await new Promise(r=>setTimeout(r,5000));
 }
 throw Error('Import still running; inspect original operation before continuing: '+id);
}
try{
 await finish('1e87732be38a48248fbb6138c662a379');
 for(const model of ['CWHelipad','CWHeliportModule','CWHeliportTerminal','CWHeliport','CWMilMi26tc']){
  const mark=path.join(dir,model+'.json');
  if(fs.existsSync(mark)){console.log('Existing operation: '+model+'; inspect before rerunning.');break;}
  const request_id='native-named-v2-'+model.toLowerCase()+'-20261027';
  const p=await call('preview_model_import',{request_id,source_directory:path.join(root,'assets_game_import',model),preset:'static_object'});
  fs.writeFileSync(mark,JSON.stringify(p,null,2));
  if(p.state!=='preview_ready'||!p.can_commit)throw Error(JSON.stringify(p));
  console.log('Importing '+model+' ('+p.input_bytes+' bytes)');
  await call('apply_asset_file_operation',{operation_id:p.operation_id,request_id,max_input_bytes:p.input_bytes});
  const result=await finish(p.operation_id);fs.writeFileSync(mark,JSON.stringify(result,null,2));
 }
}finally{await client.close();}
