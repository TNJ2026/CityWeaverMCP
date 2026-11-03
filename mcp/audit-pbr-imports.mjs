import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'artifacts/native-import-20261027');
const report=JSON.parse(fs.readFileSync(path.join(root,'assets_game_import/pbr-v2-uv/report.json')));
const client=new Client({name:'pbr-import-audit',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){const r=await client.callTool({name,arguments:args});if(r.isError||!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
try {
  const groups=[];
  for(const group of report.groups){
    const name=path.basename(group.directory);
    const op=JSON.parse(fs.readFileSync(path.join(dir,name+'-operation.json')));
    if(op.state!=='completed'||path.resolve(op.source_path)!==path.resolve(group.directory))throw Error('Incomplete or mismatched '+name);
    const materials=await call('list_asset_materials',{prefab:op.results[0].prefab});
    const masks=materials.materials.filter(m=>m.textures.some(t=>t.property==='_MaskMap')).length;
    const expectedMasks=report.materials.filter(m=>m.group===name&&m.source_mga).length;
    if(materials.materials.length!==group.parts)throw Error('Material count mismatch '+name);
    const inheritedMasks=[];
    for(const source of report.materials.filter(m=>m.group===name)){
      const surface=materials.materials.find(m=>m.surface_id.includes('/'+source.part+'_'));
      if(!surface)throw Error('Missing surface '+source.part);
      const mask=surface.textures.find(t=>t.property==='_MaskMap');
      if(source.source_mga&&!mask?.texture_id.includes('/'+source.part+'_MaskMap_'))throw Error('Missing or incorrect mask '+source.part);
      if(!source.source_mga&&mask)inheritedMasks.push({part:source.part,texture:mask.texture_id});
    }
    groups.push({name,prefab:op.results[0].prefab,materials:materials.materials.length,masks,source_masks_verified:expectedMasks,inherited_masks_requiring_review:inheritedMasks,triangles:op.results[0].render_meshes.reduce((n,m)=>n+m.indices/3,0)});
  }
  const models=[];
  for(const base of ['CWHelipad','CWHelipadSm','CWHeliportModule','CWHeliport','CWHeliportTerminal','CWMilMi26tc']){
    const members=groups.filter(g=>g.name.startsWith(base+'PBRSection'));
    const prefab=members.length===1?members[0].prefab:JSON.parse(fs.readFileSync(path.join(dir,base+'PBRV2-composition.json'))).results[0].prefab;
    const live=await call('list_asset_materials',{prefab});
    if(live.materials.length!==members.reduce((n,g)=>n+g.materials,0))throw Error('Composite mismatch '+base);
    models.push({model:base,prefab,materials:live.materials.length,triangles:members.reduce((n,g)=>n+g.triangles,0),groups:members.map(g=>g.name)});
  }
  const audit={captured_at:new Date().toISOString(),status:'all LOD0 modules imported; source masks verified; CWHelipadPart14 inherits Part09 textures and requires explicit material configuration; full visual/gameplay/reload verification pending',groups,models};
  fs.writeFileSync(path.join(dir,'pbr-v2-live-audit.json'),JSON.stringify(audit,null,2));
  console.log(JSON.stringify({groups:groups.length,materials:groups.reduce((n,g)=>n+g.materials,0),masks:groups.reduce((n,g)=>n+g.masks,0),models},null,2));
}finally{await client.close();}
