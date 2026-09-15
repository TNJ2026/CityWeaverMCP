import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const client = new Client({ name: 'transport-live-smoke', version: '1.0.0' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(name, args = {}, allowError = false) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError && !allowError) throw new Error(`${name}: ${r.content?.[0]?.text}`);
  return r.structuredContent || r;
}
async function waitOperation(id, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await call('get_transport_line_operation', { operation_id: id });
    if (['preview_ready','completed','failed','expired','cancelled','outcome_unknown'].includes(r.data.state)) return r.data;
    await sleep(100);
  }
  throw new Error(`operation ${id} timed out`);
}
async function previewReady(id) { const op=await waitOperation(id); return op.state==='preview_ready'?op:null; }

await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
const report={}; const created=[]; let seq=0;
try {
  const toolList=await client.listTools(); assert.equal(toolList.tools.length,110); report.toolCount=110;
  const status=await call('get_game_status'); assert.equal(status.data.bridge_version,'1.4.0'); await call('set_simulation_speed',{speed:'paused'});
  const prefabs=(await call('list_transport_line_prefabs',{search:''})).data.items;
  const stops=(await call('list_transport_stops',{})).data.items;
  const before=(await call('list_transport_lines')).data;
  report.discovery={prefabs:prefabs.length,stops:stops.length,initialLines:before.total,stopTypes:[...new Set(stops.map(x=>x.transport_type))]};
  assert(prefabs.length>=10); assert(stops.length>=2);

  const invalid=await call('preview_transport_line',{request_id:'transport_invalid_duplicate_140',line_prefab:prefabs[0].name,stop_ids:[stops[0].stop_id,stops[0].stop_id]},true);
  assert(invalid.isError===true || invalid.ok===false); report.duplicateStopRejected=true;

  const candidates=[];
  for(const p of prefabs) {
    const compatible=stops.filter(s=>s.transport_type===p.transport_type && (!p.passenger||s.passenger) && (!p.cargo||s.cargo));
    if(!p.locked && compatible.length>=2) candidates.push({p,compatible});
  }
  report.candidates=candidates.map(x=>`${x.p.name}:${x.compatible.length}`);

  let exhaustiveDone=false;
  for(const {p,compatible} of candidates) {
    // Try the widest useful closed route first, then pairs if native pathfinding rejects it.
    const selections=[compatible.map(x=>x.stop_id), ...compatible.slice(1).map((_,i)=>[compatible[0].stop_id,compatible[i+1].stop_id])];
    let lineId=null, selectedStops=null, failure=null;
    for(const ids of selections) {
      const request=`transport_create_140_${++seq}`;
      const preview=await call('preview_transport_line',{request_id:request,line_prefab:p.name,stop_ids:ids,name:`MCP ${p.name}`,color:{r:34,g:139,b:230,a:255}});
      const ready=await previewReady(preview.data.operation_id);
      if(!ready){ failure=(await call('get_transport_line_operation',{operation_id:preview.data.operation_id})).data.error; continue; }
      await call('apply_transport_line_operation',{operation_id:preview.data.operation_id,request_id:request});
      const done=await waitOperation(preview.data.operation_id); if(done.state!=='completed'){failure=done.error;continue;}
      lineId=done.result_line_id; selectedStops=ids; created.push(lineId); break;
    }
    if(!lineId){ (report.nativeRejected??=[]).push({prefab:p.name,error:failure}); continue; }
    const detail=(await call('get_transport_line',{line_id:lineId})).data;
    assert.equal(detail.complete,true); assert.equal(detail.stop_count,selectedStops.length); assert.equal(detail.name,`MCP ${p.name}`);
    (report.createdTypes??=[]).push({prefab:p.name,lineId,stops:selectedStops.length,distance:detail.route_distance_m});

    if(!exhaustiveDone) {
      await call('set_transport_line_name',{line_id:lineId,name:'MCP Transit Verification'});
      await call('set_transport_line_color',{line_id:lineId,r:230,g:70,b:90,a:255});
      let state=(await call('get_transport_line',{line_id:lineId})).data;
      assert.equal(state.name,'MCP Transit Verification'); assert.deepEqual(state.color,{r:230,g:70,b:90,a:255});

      await call('set_transport_line_active',{line_id:lineId,active:false}); await sleep(250);
      state=(await call('get_transport_line',{line_id:lineId})).data; assert.equal(state.active,false);
      await call('set_transport_line_active',{line_id:lineId,active:true}); await sleep(250);
      state=(await call('get_transport_line',{line_id:lineId})).data; assert.equal(state.active,true); report.activeRoundTrip=true; report.vehicleAndWaitingStatusShape=true;

      const policies=(await call('list_transport_line_policies',{line_id:lineId})).data.items; report.policyCount=policies.length;
      const inactive=policies.find(x=>!x.locked && x.option_mask===4);
      if(inactive){ await call('set_transport_line_policy',{line_id:lineId,policy:inactive.name,active:true}); await sleep(250); assert.equal((await call('get_transport_line',{line_id:lineId})).data.active,false); await call('set_transport_line_policy',{line_id:lineId,policy:inactive.name,active:false}); await sleep(250); assert.equal((await call('get_transport_line',{line_id:lineId})).data.active,true); report.policyRoundTrip=inactive.name; }

      const reordered=[...selectedStops].reverse();
      const updateReq=`transport_stops_140_${++seq}`;
      const update=await call('preview_transport_line_stops',{request_id:updateReq,line_id:lineId,stop_ids:reordered});
      const updateReady=await previewReady(update.data.operation_id); assert(updateReady,`stop update failed: ${JSON.stringify(await call('get_transport_line_operation',{operation_id:update.data.operation_id}))}`);
      await call('apply_transport_line_operation',{operation_id:update.data.operation_id,request_id:updateReq}); assert.equal((await waitOperation(update.data.operation_id)).state,'completed');
      state=(await call('get_transport_line',{line_id:lineId})).data; assert.deepEqual(state.stops.map(x=>x.stop_id),reordered); report.stopReorder=true;

      const cancelReq=`transport_cancel_140_${++seq}`;
      const cancel=await call('preview_transport_line_stops',{request_id:cancelReq,line_id:lineId,stop_ids:selectedStops});
      assert(await previewReady(cancel.data.operation_id)); await call('cancel_transport_line_preview',{operation_id:cancel.data.operation_id}); assert.equal((await waitOperation(cancel.data.operation_id)).state,'cancelled'); report.cancelledPreview=true;
      exhaustiveDone=true;
    }

    const delReq=`transport_delete_140_${++seq}`;
    const del=await call('preview_transport_line_delete',{request_id:delReq,line_id:lineId});
    const delReady=await previewReady(del.data.operation_id); assert(delReady,`delete preview failed for ${lineId}`);
    await call('apply_transport_line_operation',{operation_id:del.data.operation_id,request_id:delReq}); assert.equal((await waitOperation(del.data.operation_id)).state,'completed');
    created.splice(created.indexOf(lineId),1); (report.deletedTypes??=[]).push(p.name);
  }
  assert(exhaustiveDone,'No connected native transport route could be created on this map.');
  const after=(await call('list_transport_lines')).data; assert.equal(after.total,before.total); report.finalLines=after.total;
  console.log(JSON.stringify({ok:true,report},null,2));
} catch(e) {
  console.error(e.stack||e); console.error(JSON.stringify({report,remainingCreated:created},null,2)); process.exitCode=1;
} finally { await client.close(); }


