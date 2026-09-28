import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PlanningStore } from '../planning-store.mjs';
import { createPlanningAppPayload, readPlanningMapResource, normalizePlanningResult, planningAppHtml, planningPresentation, PLANNING_APP_URI } from '../planning-app.mjs';
import { renderCityPlanInteractive } from '../planning-interactive.mjs';

test('presentation prefers one card and preserves fallback without claiming display success', () => {
  for (const [payload, status] of [[{map:{}}, 'ready'], [{map_error:'SVG_NOT_FOUND'}, 'error'], [{}, 'no_new_map']]) {
    const presentation = planningPresentation(payload);
    assert.equal(presentation.preferred, 'mcp_app');
    assert.equal(presentation.webpage, 'fallback_or_explicit_request');
    assert.equal(presentation.card_payload, status);
    assert.match(presentation.instructions, /do not open a browser/);
    assert.match(presentation.instructions, /does not confirm/);
  }
});

test('the MCP card receives the same locally projected SVG as the standalone page', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'planning-local-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PlanningStore(root);
  const bounds = { min_x: -7168, max_x: 7168, min_z: -7168, max_z: 7168 };
  const planning_bounds = { min_x: 2400, max_x: 3600, min_z: -6950, max_z: -5750 };
  const rendered = renderCityPlanInteractive({ bounds }, {}, { planning_bounds, view: 'surface' });
  assert.deepEqual(rendered.bounds, planning_bounds);
  const artifact = await store.artifact(rendered.html);
  const payload = await createPlanningAppPayload('render_city_plan', { ...rendered, ...artifact }, store);
  let encoded = '';
  for (let i = 0; i < payload.map.chunk_count; i++) encoded += (await readPlanningMapResource(store, artifact.sha256, 'html', i)).data;
  const svg = gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
  assert.equal(svg, rendered.html.match(/<svg\b[\s\S]*?<\/svg>/)[0]);
  assert.match(svg, /clip-path="url\(#extent-surface\)"/);
});

test('planning app payload embeds a compressed SVG from a stored artifact', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'planning-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PlanningStore(root);
  const artifact = await store.artifact('<!doctype html><main><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></main>');
  const payload = await createPlanningAppPayload('render_city_plan', { ...artifact, plan_ref: `plan-${'a'.repeat(64)}`, plan_id: 'cplan-0123456789abcdef' }, store);

  assert.equal(payload.map.encoding, 'gzip+base64');
  assert.equal(payload.map.data, undefined);
  const chunk = await readPlanningMapResource(store, artifact.sha256, 'html', 0);
  assert.match(gunzipSync(Buffer.from(chunk.data, 'base64')).toString('utf8'), /^<svg[\s\S]*<\/svg>$/);
  await assert.rejects(readPlanningMapResource(store, artifact.sha256, 'html', -1));
  await assert.rejects(readPlanningMapResource(store, artifact.sha256, 'html', payload.map.chunk_count));
  assert.equal(payload.map.artifact_sha256, artifact.sha256);
});

test('planning app resource is self-contained and initializes the MCP Apps bridge', () => {
  const html = planningAppHtml();
  assert.equal(PLANNING_APP_URI, 'ui://cityweaver/planning/v1.html');
  assert.match(html, /ui\/initialize/);
  assert.match(html, /ui\/request-display-mode/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

function appHarness() {
  const messages = [], listeners = new Map(), nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', disabled: false, hidden: id === 'details', setAttribute(key,value){this[key]=value}, replaceChildren(child){this.child=child}, querySelector(){return this.child} }); return nodes.get(id); };
  let height = 900;
  const app = { scrollHeight: 0, style: { setProperty(key,value){if(key==='--app-height')height=parseFloat(value)} }, getBoundingClientRect: () => ({ width: 800, height }) };
  const parent = { postMessage: msg => messages.push(msg) };
  const window = { parent, DecompressionStream, addEventListener: (name, fn) => listeners.set(name, fn) };
  const document = { getElementById: node, querySelector: () => app, querySelectorAll: () => [], importNode: root => root };
  class DOMParser { parseFromString(text){return {documentElement:{text,nodeName:'svg',querySelectorAll:()=>[],setAttribute(key,value){this[key]=value},viewBox:{baseVal:{x:0,y:0,width:1600,height:1400}},addEventListener(){}}}} }
  vm.runInNewContext(planningAppHtml().match(/<script>([\s\S]*)<\/script>/)[1], { window, document, atob, TextDecoder, DOMParser, DecompressionStream, Response, Blob });
  const receive = data => listeners.get('message')({ source: parent, data });
  return { messages, node, app, receive, listeners };
}

test('app reports a nonzero size after handshake and changed content, without resize loops', async () => {
  const h = appHarness();
  assert.equal(h.messages[0].method, 'ui/initialize');
  h.receive({ jsonrpc: '2.0', id: h.messages[0].id, result: { protocolVersion: '2026-01-26' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.messages.slice(1).map(m => m.method), ['ui/notifications/initialized', 'ui/notifications/size-changed']);
  assert.equal(h.messages[2].params.height, 900);
  h.listeners.get('resize')();
  assert.equal(h.messages.length, 3);
  h.app.style.setProperty('--app-height','960px');
  h.listeners.get('resize')();
  assert.equal(h.messages[3].params.height, 960);
});

test('card fills the host maximum height and follows fullscreen allocation changes', async () => {
  const h=appHarness();
  h.receive({jsonrpc:'2.0',id:1,result:{hostContext:{containerDimensions:{maxHeight:1200}}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.messages.at(-1).params.height,1200);
  h.receive({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{displayMode:'fullscreen',containerDimensions:{height:1500}}});
  assert.equal(h.messages.at(-1).params.height,1500);
  h.receive({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{containerDimensions:{maxHeight:300}}});
  assert.equal(h.messages.at(-1).params.height,300);
  assert.equal(h.node('details').hidden,true);
  h.node('details-toggle').onclick();
  assert.equal(h.node('details').hidden,false);
});

test('latest final map wins and status-only updates retain the image for the same plan', async () => {
  const h=appHarness();
  const send=(id,text)=>h.receive({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{cityweaver_planning_app:{plan_id:id,...(text?{map:{encoding:'base64',data:Buffer.from(text).toString('base64')}}:{})}}}});
  send('old','<svg>old</svg>');send('final','<svg>final</svg>');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.node('map').child.text,'<svg>final</svg>');
  assert.equal(h.node('map').child.preserveAspectRatio,'xMidYMid meet');
  h.node('map').innerHTML='rendered final image';
  send('final');assert.equal(h.node('map').innerHTML,'rendered final image');
  send('different');assert.match(h.node('map').innerHTML,/未附带最终规划图/);
});

test('missing app metadata and artifact failures produce actionable errors instead of a waiting map', () => {
  const h = appHarness();
  const result = params => h.receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params });
  result({ structuredContent: { ok: true, data: { plan_id: 'cplan-test' } } });
  assert.match(h.node('map').innerHTML, /无法解析规划结果.*structuredContent/);
  result({ _meta: { cityweaver_planning_app: { artifact_error: 'SVG_NOT_FOUND' } } });
  assert.match(h.node('map').innerHTML, /SVG_NOT_FOUND/);
  result({ _meta: { cityweaver_planning_app: { map_error: '<missing artifact>' } } });
  assert.match(h.node('map').innerHTML, /&lt;missing artifact&gt;/);
  result({ isError: true, structuredContent: { ok: false, error: { message: 'City unavailable' } } });
  assert.match(h.node('map').innerHTML, /City unavailable/);
});

test('card reads saved map without private metadata through nested transport envelopes', async () => {
  const wrappers = [
    value => value,
    value => ({structuredContent:value}),
    value => ({content:[{type:'text',text:JSON.stringify(value)}]}),
    value => ({content:[{type:'text',text:JSON.stringify({structuredContent:value})}]}),
    value => ({result:{toolOutput:{output:JSON.stringify({structuredContent:value})}}}),
    value => ({content:[{type:'text',text:'{}'},{type:'text',text:JSON.stringify({content:[{type:'text',text:JSON.stringify(value)}]})}]}),
  ];
  for(const wrap of wrappers){
    const h=appHarness(), sha='a'.repeat(64);
    const value={ok:true,data:{plan_id:'cplan-final',plan_ref:'plan-saved',sha256:sha,mime_type:'text/html'}};
    const params=wrap(value);
    h.receive({jsonrpc:'2.0',method:'ui/notifications/tool-result',params});
    const req=h.messages.find(m=>m.method==='resources/read');
    assert.ok(req,'must fetch the image when _meta is stripped');
    assert.equal(req.params.uri,'cityweaver://planning-map/'+sha+'/html');
    assert.equal(h.node('continue').disabled,false);
    h.receive({jsonrpc:'2.0',id:req.id,result:{contents:[{uri:req.params.uri,text:JSON.stringify({encoding:'base64',data:Buffer.from('<svg>four towns</svg>').toString('base64'),artifact_sha256:sha})}]}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.node('map').child.text,'<svg>four towns</svg>');
  }
});

test('result normalization preserves private metadata and errors with bounded traversal', () => {
  const data={plan_id:'saved',sha256:'a'.repeat(64)};
  const meta={plan_id:'saved',map:{data:'encoded'}};
  assert.deepEqual(normalizePlanningResult({result:{structuredContent:{ok:true,data},_meta:{cityweaver_planning_app:meta}}}),{data,meta,isError:false});
  const error={ok:false,error:{message:'Unavailable'}};
  assert.equal(normalizePlanningResult({content:[{text:JSON.stringify(error)}]}).isError,true);
  const cycle={};cycle.result=cycle;
  assert.deepEqual(normalizePlanningResult(cycle).data,{});
  let deep=data;for(let i=0;i<20;i++)deep={result:deep};
  assert.deepEqual(normalizePlanningResult(deep).data,{});
  assert.deepEqual(normalizePlanningResult({unrelated:data}).data,{});
});

test('card assembles compressed SVG chunks and rejects truncated or mismatched chunks', async () => {
  const svg='<svg>湖湾主城 西原镇 东岸镇 环湖岛镇'+Array.from({length:7000},(_,i)=>'<path d="M'+i+' '+(i*7919%9973)+'"/>').join('')+'</svg>';
  const zipped=gzipSync(svg), encoded=zipped.toString('base64'), sha='a'.repeat(64);
  const manifest={encoding:'gzip+base64',artifact_sha256:sha,chunk_count:Math.ceil(encoded.length/8192),chunk_size:8192,encoded_length:encoded.length,compressed_bytes:zipped.length};
  assert.ok(manifest.chunk_count>1);
  for(const failure of [null,'truncated','wrong-index','wrong-hash']){
    const h=appHarness();
    h.receive({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{_meta:{cityweaver_planning_app:{plan_id:'four-towns',map:manifest}}}});
    const req=h.messages.at(-1);
    h.receive({jsonrpc:'2.0',id:req.id,result:{contents:[{uri:req.params.uri,text:JSON.stringify(manifest)}]}});
    for(let index=0;index<manifest.chunk_count;index++){
      await new Promise(resolve=>setImmediate(resolve));
      const chunkReq=h.messages.at(-1);
      assert.equal(chunkReq.params.uri,req.params.uri+'/chunks/'+index);
      const chunk={index,artifact_sha256:sha,data:encoded.slice(index*8192,(index+1)*8192)};
      if(failure==='truncated')chunk.data=chunk.data.slice(0,100)+'…tokens truncated…';
      if(failure==='wrong-index')chunk.index++;
      if(failure==='wrong-hash')chunk.artifact_sha256='b'.repeat(64);
      h.receive({jsonrpc:'2.0',id:chunkReq.id,result:{contents:[{uri:chunkReq.params.uri,text:JSON.stringify(chunk)}]}});
      if(failure)break;
    }
    if(failure){
      await new Promise(resolve=>setImmediate(resolve));
      assert.match(h.node('map').innerHTML,/地图分块损坏或被截断/);
      assert.equal(h.node('map').child,undefined);
    }else{
      for(let i=0;i<100&&!h.node('map').child;i++)await new Promise(resolve=>setTimeout(resolve,5));
      assert.equal(h.node('map').child?.text,svg);
    }
  }
});

test('resource failures and mismatched artifacts cannot silently display another map', async () => {
  for(const failure of ['denied','wrong-hash']){
    const h=appHarness();
    h.receive({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{data:{plan_id:'final',sha256:'a'.repeat(64)}}}});
    const req=h.messages.find(m=>m.method==='resources/read');
    h.receive({jsonrpc:'2.0',id:req.id,...(failure==='denied'?{error:{message:'Resources unavailable'}}:{result:{contents:[{uri:req.params.uri,text:JSON.stringify({artifact_sha256:'b'.repeat(64)})}]}})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(h.node('map').innerHTML,failure==='denied'?/Resources unavailable/:/当前方案不一致/);
    assert.equal(h.node('map').child,undefined);
  }
});

test('the app supplies every CSS variable referenced by a real interactive map SVG', () => {
  const rendered = renderCityPlanInteractive({ bounds: { min_x: 0, min_z: 0, max_x: 100, max_z: 100 }, roads: [], buildings: [], tracks: [], utilities: [] }, { zones: [{ id: 'r', kind: 'residential', polygon: [{ x: 10, z: 10 }, { x: 90, z: 10 }, { x: 90, z: 90 }] }] });
  const svg = rendered.html.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  const vars = [...new Set([...svg.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))];
  assert.ok(vars.includes('--background'));
  assert.ok(vars.includes('--viz-series-1'));
  const css = planningAppHtml().match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const variable of vars) assert.match(css, new RegExp(`${variable}\\s*:`), `missing SVG color ${variable}`);
});
