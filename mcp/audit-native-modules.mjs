import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=path.join(root,'artifacts/native-import-20261027');
const client=new Client({name:'native-module-audit',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){const r=await client.callTool({name,arguments:args});if(r.isError||!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
try{
 const audit=[];
 for(const [model,expected] of [['CWHeliportWindingV2',54284],['CWHeliportTerminalWindingV2',27140],['CWMilMi26tcWindingV2',71519]]){
  const assembly=JSON.parse(fs.readFileSync(path.join(root,'assets_game_import/modules',model,'assembly.json')));
  const groups=[];let triangles=0;
  for(const group of assembly.groups){
   const operation=JSON.parse(fs.readFileSync(path.join(evidence,path.basename(group.directory)+'-operation.json')));
   if(operation.state!=='completed'||path.resolve(operation.source_path)!==path.resolve(group.directory))throw Error('Incomplete or mismatched operation');
   const result=operation.results[0];
   const live=await call('list_imported_models',{search:operation.operation_id,limit:10});
   if(live.items.length!==1||!live.items[0].native_bounds_ready||!live.items[0].native_selectable)throw Error('Model not ready');
   const materials=await call('list_asset_materials',{prefab:result.prefab});
   if(materials.materials.length!==group.material_parts||materials.materials.length>8)throw Error('Unexpected material count');
   const count=result.render_meshes.reduce((n,m)=>n+m.indices/3,0);triangles+=count;
   groups.push({...group,operation_id:operation.operation_id,root_prefab:result.prefab,asset_id:result.asset_id,
    render_prefabs:result.render_meshes.map(m=>m.name),triangles:count,live:live.items[0],materials:materials.materials});
  }
  if(triangles!==expected)throw Error('Geometry count mismatch: '+model);
  audit.push({model,triangles,expected_triangles:expected,status:'modules imported and verified; composite prefab not created',groups});
 }
 fs.writeFileSync(path.join(evidence,'module-assembly-live.json'),JSON.stringify(audit,null,2));
 console.log(JSON.stringify(audit.map(a=>({model:a.model,triangles:a.triangles,surfaces:a.groups.map(g=>g.materials.length),ready:true})),null,2));
}finally{await client.close();}
