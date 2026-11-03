import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
const c=new Client({name:'authorized-old-heliport-cleanup',version:'1'});
await c.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))]}));
const output='artifacts/native-import-20261027/v19-old-heliport-cleanup.json';
const record={operations:[]};
function save(){fs.writeFileSync(output,JSON.stringify(record,null,2));}
async function call(name,args={}){const r=await c.callTool({name,arguments:args});if(!r.structuredContent?.ok)throw Error(JSON.stringify(r));return r.structuredContent.data;}
async function poll(d,tool,wanted){for(let n=0;n<120;n++){if(d.state===wanted)return d;if(['failed','cancelled','expired','outcome_unknown'].includes(d.state))throw Error(JSON.stringify(d));await new Promise(r=>setTimeout(r,250));d=await call(tool,{operation_id:d.operation_id});}throw Error('Timed out: '+JSON.stringify(d));}
try {
 await call('set_simulation_speed',{speed:'paused'});
 record.before={facilities:await call('list_transport_facilities'),lines:await call('list_transport_lines')};save();
 const keep=record.before.facilities.items.filter(x=>x.name==='CityWeaver双停机坪机场');
 if(keep.length!==1||keep[0].prefab!=='CityWeaver_850b7b8e4f8b4a679fa2623a7c3dd3e0')throw Error('Retained airport mismatch');
 const oldPrefabs=['CityWeaver Helicopter Station','CityWeaver Passenger Heliport','CityWeaver_f461c8e50b9f48fa8d122772146c2e35'];
 const facilities=record.before.facilities.items.filter(x=>oldPrefabs.includes(x.prefab));
 const lines=record.before.lines.items.filter(x=>x.prefab==='CityWeaver Helicopter Line');
 if(facilities.length!==6||lines.length!==4)throw Error('Cleanup scope changed');
 for(const line of lines){
  const request_id='v19-delete-old-line-'+line.line_id.split(':')[1];
  let d=await poll(await call('preview_transport_line_delete',{request_id,line_id:line.line_id}),'get_transport_line_operation','preview_ready');
  record.operations.push(d);save();if(!d.can_commit)throw Error(JSON.stringify(d));
  d=await poll(await call('apply_transport_line_operation',{request_id,operation_id:d.operation_id}),'get_transport_line_operation','completed');
  record.operations.push(d);save();console.log(JSON.stringify({deleted_line:line.name,state:d.state}));
 }
 for(const facility of facilities){
  const request_id='v19-delete-old-airport-'+facility.facility_id.split(':')[1];
  let d=await poll(await call('preview_building_demolition',{request_id,building_id:facility.facility_id}),'get_building_operation','preview_ready');
  record.operations.push(d);save();if(!d.can_commit||d.errors?.length)throw Error(JSON.stringify(d));
  d=await poll(await call('apply_building_operation',{request_id:request_id+'-commit',operation_id:d.operation_id,max_cost:Math.max(0,d.cost)}),'get_building_operation','completed');
  record.operations.push(d);save();console.log(JSON.stringify({deleted_facility:facility.name||facility.prefab,state:d.state}));
 }
 record.after={facilities:await call('list_transport_facilities'),lines:await call('list_transport_lines')};save();
 if(record.after.facilities.items.some(x=>oldPrefabs.includes(x.prefab))||record.after.lines.items.some(x=>x.prefab==='CityWeaver Helicopter Line'))throw Error('Old facilities/lines remain');
 if(!record.after.facilities.items.some(x=>x.facility_id===keep[0].facility_id))throw Error('Retained airport missing');
 console.log(JSON.stringify(record.after));
}catch(e){record.error=String(e);save();throw e;}finally{await c.close();}
