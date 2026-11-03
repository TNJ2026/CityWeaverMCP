import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const client=new Client({name:'imported-instance-audit',version:'1.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
try {
  let offset=0,snapshot_id; const items=[];
  do {
    const r=await client.callTool({name:'query_entities',arguments:{all_components:['Game.Objects.Static','Game.Objects.Transform'],none_components:['Game.Objects.Tree','Game.Objects.Plant','Game.Common.Owner','Game.Buildings.Building'],limit:100,offset,...(snapshot_id?{snapshot_id}:{})}});
    const v=r.structuredContent;
    if(r.isError||!v?.ok)throw Error(JSON.stringify(v||r));
    snapshot_id=v.data.snapshot_id;
    items.push(...v.data.items.filter(x=>x.prefab_name?.startsWith('CityWeaver_')));
    offset=v.data.next_offset;
  }while(offset!=null);
  const result={captured_at:new Date().toISOString(),items};
  fs.writeFileSync(new URL('../artifacts/native-import-20261027/imported-instances-latest.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}finally{await client.close();}
