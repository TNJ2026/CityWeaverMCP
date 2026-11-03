import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'artifacts/native-import-20261027');
const client=new Client({name:'native-import-audit',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){const r=await client.callTool({name,arguments:args});if(r.isError||!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
try{
 const suffix=process.argv[2]||'SafeTextures';
 const models=suffix==='SafeTextures'?[['CWHelipadSm','1e87732be38a48248fbb6138c662a379']]:[];
 const names=['CWHelipad','CWHeliportModule','CWHeliportTerminal','CWHeliport','CWMilMi26tc'];
 if(suffix!=='SafeTextures')names.unshift('CWHelipadSm');
 for(const name of names){
  const op=JSON.parse(fs.readFileSync(path.join(dir,name+suffix+'-operation.json')));
  if(op.state!=='completed')throw Error(name+' not completed');models.push([name,op.operation_id]);
 }
 const result=[];
 for(const [model,id] of models){
  const live=await call('list_imported_models',{search:id,limit:10});
  if(live.items.length!==1||!live.items[0].native_bounds_ready||!live.items[0].native_selectable)throw Error('Unready: '+model);
  const materials=await call('list_asset_materials',{prefab:'CityWeaver_'+id});
  result.push({model,operation_id:id,live:live.items[0],materials:materials.materials});
 }
 fs.writeFileSync(path.join(dir,suffix==='SafeTextures'?'live-audit.json':`live-audit-${suffix}.json`),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result.map(r=>({model:r.model,size_m:r.live.size_m,surfaces:r.materials.length,ready:true})),null,2));
}finally{await client.close();}
