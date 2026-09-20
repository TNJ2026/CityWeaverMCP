import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFile} from 'node:fs/promises';
const c=new Client({name:'harbor-readonly-survey',version:'1'});
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:120000});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
async function pages(name,args,key='items'){let out=[],offset=0;do{const r=await call(name,{...args,offset,limit:1024});out.push(...r[key]);offset=r.next_offset;}while(offset!=null);return out;}
try{await c.connect(new StdioClientTransport({command:process.execPath,args:[new URL('./server.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]}));
const out={at:new Date().toISOString()};
out.water=await pages('read_surface_water_mask',{bounds:{min_x:-7168,min_z:-7168,max_x:7168,max_z:7168},cell_size_m:128},'cells');
out.tiles=await call('list_map_tiles',{state:'all',limit:500});
if(out.tiles.truncated){const tail=await call('list_map_tiles',{state:'all',limit:500,offset:500});out.tiles.items.push(...tail.items);out.tiles.truncated=false;}
out.waterways=await call('query_entities',{category:'net_edges',all_components:['Game.Net.Waterway'],include_components:['Game.Net.Curve','Game.Net.Edge','Game.Prefabs.PrefabRef'],limit:100});
out.map=await call('get_planning_map_snapshot',{bounds:{min_x:-3500,min_z:-4100,max_x:7168,max_z:3428},include_roads:true,include_buildings:true,include_tracks:true,max_features_per_layer:5000});
await writeFile('artifacts/auburn-harbor-survey.json',JSON.stringify(out));console.log(JSON.stringify({water:out.water.length,tiles:out.tiles.total,waterways:out.waterways.total,mapkeys:Object.keys(out.map)}));
}finally{await c.close();}


