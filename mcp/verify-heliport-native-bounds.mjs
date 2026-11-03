// Read-only evidence for the V7 native OBJ coordinate conversion.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const client=new Client({name:'heliport-native-bounds',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
async function call(name,args){const r=await client.callTool({name,arguments:args});if(r.isError||!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
try{
 const model=await call('get_vehicle_model',{prefab:'CityWeaver_5a5acb502fdf4a3b858fcddd2f0f3494'});
 const parts=[];
 for(const part of model.parts){
  const data=await call('get_entity_components',{entity_id:part.render_prefab_id,components:['Game.Prefabs.MeshData']});
  parts.push({name:part.render_prefab,bounds:data.components['Game.Prefabs.MeshData'].fields.m_Bounds});
 }
 const footprint={minX:Math.min(...parts.map(p=>p.bounds.min.x)),minZ:Math.min(...parts.map(p=>p.bounds.min.z)),maxX:Math.max(...parts.map(p=>p.bounds.max.x)),maxZ:Math.max(...parts.map(p=>p.bounds.max.z))};
 const expected={minX:-50,minZ:-52,maxX:62,maxZ:50};
 if(parts.length!==6||Object.keys(expected).some(k=>!Number.isFinite(footprint[k])||Math.abs(footprint[k]-expected[k])>.1))throw Error(JSON.stringify({footprint,expected}));
 const evidence={parts,footprint,expected,valid:true};
 fs.writeFileSync(fileURLToPath(new URL('../artifacts/native-import-20261027/heliport-native-bounds-1.36.11.json',import.meta.url)),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({parts:parts.length,footprint,valid:true}));
}finally{await client.close();}
