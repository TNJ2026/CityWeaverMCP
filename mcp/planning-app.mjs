import { gzipSync } from 'node:zlib';
import { PLANNING_THEME_CSS } from './planning-interactive.mjs';

export const PLANNING_APP_URI = 'ui://cityweaver/planning/v1.html';

export const PLANNING_DISPLAY_INSTRUCTIONS = 'Prefer the MCP App card. When the card is displayed, do not open a browser, embed another map, or show a duplicate planning webpage link. Use the saved HTML/SVG only if the card is unsupported or fails to display, or the user explicitly requests the webpage. Artifact paths are fallback files, not instructions to open them. A prepared card payload does not confirm that the host displayed it.';

// Model-visible guidance: private App metadata alone cannot prevent the agent
// from opening the same artifact in a browser as a second presentation.
export function planningPresentation(payload) {
  return {
    preferred: 'mcp_app',
    webpage: 'fallback_or_explicit_request',
    card_payload: payload?.map_error ? 'error' : payload?.map ? 'ready' : 'no_new_map',
    instructions: PLANNING_DISPLAY_INSTRUCTIONS,
  };
}

// Hosts may forward a CallToolResult, its structured data, or JSON text wrapping it.
// Unwrap only transport fields, with bounded depth; never search arbitrary plan objects.
export function normalizePlanningResult(input) {
  const seen = new Set();
  function visit(value, depth = 0) {
    if (depth > 12 || value == null) return null;
    if (typeof value === 'string') { try { return visit(JSON.parse(value), depth + 1); } catch { return null; } }
    if (typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 64)) { const found = visit(item, depth + 1); if (found) return found; }
      return null;
    }
    const meta = value._meta?.cityweaver_planning_app;
    if (value.ok === false || value.isError === true) {
      return { data: value.structuredContent?.error ? value.structuredContent : value, meta, isError: true };
    }
    for (const key of ['structuredContent', 'result', 'toolResult', 'toolOutput', 'output', 'data', 'content', 'text']) {
      const found = visit(value[key], depth + 1);
      if (found) return { ...found, meta: found.meta ?? meta };
    }
    if (value.sha256 || value.render?.sha256 || value.plan_id || value.approved_plan_id || value.plan_ref || value.error || meta) {
      return { data: value, meta, isError: false };
    }
    return null;
  }
  return visit(input) ?? { data: {}, meta: null, isError: false };
}

function renderMetadata(data) {
  if (data?.artifact_path && data?.sha256) return data;
  if (data?.render?.artifact_path && data.render.sha256) return data.render;
  return null;
}

function extractSvg(text, extension) {
  if (extension === 'svg') return text;
  const match = text.match(/<svg\b[\s\S]*?<\/svg>/i);
  return match?.[0] ?? null;
}

export async function readPlanningMap(store, sha256, extension) {
  const stored = await store.getArtifact(sha256, extension);
  const svg = extractSvg(stored.text, extension);
  if (!svg) throw new Error('SVG_NOT_FOUND');
  const compressed = gzipSync(Buffer.from(svg));
  return { encoding: 'gzip+base64', data: compressed.toString('base64'),
    original_bytes: Buffer.byteLength(svg), compressed_bytes: compressed.byteLength, artifact_sha256: sha256 };
}

const mapCache = new WeakMap();
const MAP_CHUNK_SIZE = 8192;
export async function readPlanningMapResource(store, sha256, extension, index) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || !['html','svg'].includes(extension)) throw new Error('INVALID_MAP_RESOURCE');
  let cache = mapCache.get(store);
  if (!cache) { cache = new Map(); mapCache.set(store, cache); }
  const key = sha256 + '/' + extension;
  let map = cache.get(key);
  if (!map) {
    map = await readPlanningMap(store, sha256, extension);
    if (cache.size >= 2) cache.delete(cache.keys().next().value);
    cache.set(key, map);
  }
  const chunk_count = Math.ceil(map.data.length / MAP_CHUNK_SIZE);
  if (index !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(String(index)) || Number(index) >= chunk_count) throw new Error('INVALID_MAP_CHUNK');
    return { artifact_sha256: sha256, index: Number(index), data: map.data.slice(Number(index) * MAP_CHUNK_SIZE, (Number(index) + 1) * MAP_CHUNK_SIZE) };
  }
  const { data, ...metadata } = map;
  return { ...metadata, extension, chunk_count, chunk_size: MAP_CHUNK_SIZE, encoded_length: data.length };
}

export async function createPlanningAppPayload(toolName, data, store) {
  const artifact = renderMetadata(data);
  const payload = {
    schema_version: 1,
    tool_name: toolName,
    plan_ref: data?.plan_ref ?? null,
    plan_id: data?.plan_id ?? data?.approved_plan_id ?? null,
    construction_id: data?.construction_id ?? null,
    state_version: data?.state_version ?? null,
  };
  if (!artifact) return payload;
  const extension = artifact.mime_type === 'image/svg+xml' ? 'svg' : 'html';
  return { ...payload, map: await readPlanningMapResource(store, artifact.sha256, extension) };
}

export function planningAppHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--bg:#f7f7f5;--panel:#fff;--fg:#1f2937;--muted:#667085;--line:#d9dde5;--accent:#2563eb;--ok:#138a57;--warn:#b76e00}
    @media(prefers-color-scheme:dark){:root{--bg:#151719;--panel:#202326;--fg:#f3f4f6;--muted:#a8b0bb;--line:#3a4048;--accent:#76a9ff;--ok:#5bd49b;--warn:#ffc266}}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .app{position:relative;height:var(--app-height,900px);min-height:0}.card{position:absolute;z-index:3;top:52px;left:12px;right:12px;max-height:70%;overflow:auto;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    [hidden]{display:none!important}
    .top{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.title{font-size:17px;font-weight:700}.sub{color:var(--muted);margin-top:2px;word-break:break-all}.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.chip{padding:3px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
    .actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}button{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--fg);padding:7px 10px;border-radius:8px;cursor:pointer}button:hover{border-color:var(--accent)}button.primary{background:var(--accent);border-color:var(--accent);color:white}
    .viewer{position:absolute;inset:0;overflow:hidden;background:var(--panel)}.map{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden}.map svg{display:block;width:100%;height:100%;touch-action:none;user-select:none}.empty{color:var(--muted);padding:32px;text-align:center}
    .details-toggle{position:absolute;z-index:4;top:12px;right:12px}
    .toolbar{position:absolute;z-index:2;right:12px;bottom:12px;display:flex;gap:4px;padding:4px;background:color-mix(in srgb,var(--panel) 90%,transparent);border:1px solid var(--line);border-radius:8px;box-shadow:0 5px 18px #0002}
    .toolbar button{height:26px;min-width:26px;padding:3px 6px;border-radius:5px;font-size:12px;line-height:18px}.toolbar button[data-zoom]{padding:3px}
    .status-error{color:#d14343}.status-ok{color:var(--ok)}
    .map{${PLANNING_THEME_CSS}}
    @media(max-width:640px){.top{display:block}.actions{justify-content:flex-start;margin-top:10px}}
  </style>
</head>
<body>
<main class="app">
  <button class="details-toggle" id="details-toggle" aria-controls="details" aria-expanded="false">规划详情</button>
  <section class="card" id="details" hidden>
    <div class="top">
      <div><div class="title" id="title">CityWeaver 规划</div><div class="sub" id="subtitle">等待规划结果…</div></div>
      <div class="actions"><button class="primary" id="continue" disabled>继续施工流程</button></div>
    </div>
    <div class="chips" id="chips"></div>
  </section>
  <section class="viewer"><div class="map" id="map"><div class="empty">最终规划图将显示在这里</div></div><div class="toolbar"><button id="fullscreen">全屏地图</button><button data-zoom="in" aria-label="放大">＋</button><button data-zoom="out" aria-label="缩小">－</button></div></section>
</main>
<script>
(() => {
  const pending = new Map(); let seq = 1; let latest = null; let baseView = null; let view = null; let svg = null; let drag = null; let mapRevision = 0; let displayedPlanId = null;
  const post = message => window.parent.postMessage(message, '*');
  const request = (method, params) => new Promise((resolve, reject) => { const id = seq++; pending.set(id,{resolve,reject}); post({jsonrpc:'2.0',id,method,params}); });
  const notify = (method, params={}) => post({jsonrpc:'2.0',method,params});
  let lastSize = ''; let connected = false;
  let hostContext = {};
  function applyHostContext(context={}){
    hostContext={...hostContext,...context};
    const dims=hostContext.containerDimensions||{};
    // Use the host's allocation/ceiling, never the iframe height we just requested.
    const height=[dims.height,dims.maxHeight,window.screen?.availHeight,900].find(n=>Number.isFinite(n)&&n>0);
    document.querySelector('.app').style.setProperty('--app-height',Math.floor(height)+'px');
    reportSize();
  }
  function reportSize(){
    if(!connected)return;
    const app=document.querySelector('.app'), rect=app.getBoundingClientRect();
    const size={width:Math.ceil(rect.width),height:Math.ceil(rect.height)};
    const key=JSON.stringify(size);if(size.width>0&&size.height>0&&key!==lastSize){lastSize=key;notify('ui/notifications/size-changed',size);}
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeResult = ${normalizePlanningResult.toString()};
  function chip(text, cls=''){ return '<span class="chip '+cls+'">'+esc(text)+'</span>'; }
  function summary(result){
    const revision=++mapRevision;
    const normalized=normalizeResult(result), data=normalized.data, meta=normalized.meta;
    latest={...data,...meta,plan_id:meta?.plan_id||data.plan_id||data.approved_plan_id};
    const artifact=data.sha256?data:data.render;
    document.getElementById('title').textContent = ({render_city_plan:'城市综合规划图',propose_city_plan:'城市规划候选',propose_grid_plan:'网格规划候选',prepare_city_plan_construction:'施工准备',advance_city_plan_construction:'施工进度',prepare_grid_native_preview:'原生道路预览',advance_grid_construction:'网格施工进度'}[meta?.tool_name]||'CityWeaver 规划');
    const id=meta?.plan_id||data.plan_id||data.approved_plan_id; document.getElementById('subtitle').textContent=id?('方案 '+id):'规划结果';
    const parts=[]; if(meta?.plan_ref||data.plan_ref)parts.push(chip('已保存方案')); if(meta?.construction_id||data.construction_id)parts.push(chip('施工 '+String(meta?.construction_id||data.construction_id).slice(0,24)+'…'));
    if(data.validation?.valid===false||data.error)parts.push(chip('需要处理错误','status-error')); else parts.push(chip('数据已就绪','status-ok'));
    if(data.native_preview_summary?.state)parts.push(chip('预览 '+data.native_preview_summary.state)); if(data.next_action?.action)parts.push(chip('下一步 '+data.next_action.action));
    document.getElementById('chips').innerHTML=parts.join(''); document.getElementById('continue').disabled=!(latest?.plan_ref&&id);
    if(meta?.map?.data) loadMap(meta.map,revision,id).catch(error=>{if(revision===mapRevision)showError(error)});
    else if(meta?.map?.chunk_count)loadStoredMap({sha256:meta.map.artifact_sha256,mime_type:meta.map.extension==='svg'?'image/svg+xml':'text/html'},revision,id).catch(error=>{if(revision===mapRevision)showError(error)});
    else if(meta?.map_error||meta?.artifact_error)showError('规划地图生成失败：'+(meta.map_error||meta.artifact_error));
    else if(normalized.isError||data.error)showError(data.error?.message||'规划工具执行失败');
    else if(/^[a-f0-9]{64}$/.test(artifact?.sha256||''))loadStoredMap(artifact,revision,id).catch(error=>{if(revision===mapRevision)showError('读取规划图失败：'+error.message)});
    else if(!meta&&!svg){
      const shape=Object.keys(result||{}).slice(0,12).join(', ')||typeof result;
      showError('无法解析规划结果。收到的顶层字段：'+shape+'；请提供这条错误以定位宿主返回格式。');
    }
    else if(!svg||displayedPlanId!==id){document.getElementById('map').innerHTML='<div class="empty">此步骤未附带最终规划图，请渲染已保存的规划。</div>';svg=null;displayedPlanId=null;}
    reportSize();
  }
  async function loadStoredMap(artifact,revision,id){
    document.getElementById('map').innerHTML='<div class="empty">正在读取最终规划图…</div>';
    const extension=artifact.mime_type==='image/svg+xml'?'svg':'html';
    const uri='cityweaver://planning-map/'+artifact.sha256+'/'+extension;
    const result=await request('resources/read',{uri});
    if(revision!==mapRevision)return;
    const content=result?.contents?.find(item=>item.uri===uri&&typeof item.text==='string');
    if(!content)throw new Error('地图资源未返回内容');
    const map=JSON.parse(content.text);
    if(map.artifact_sha256!==artifact.sha256)throw new Error('地图资源与当前方案不一致');
    if(map.chunk_count!==undefined){
      if(!Number.isInteger(map.chunk_count)||map.chunk_count<1||map.chunk_count>4096||map.chunk_size!==8192||!Number.isInteger(map.encoded_length)||map.encoded_length<1||Math.ceil(map.encoded_length/map.chunk_size)!==map.chunk_count)throw new Error('地图分块清单无效');
      const chunks=[];
      for(let index=0;index<map.chunk_count;index++){
        const chunkUri=uri+'/chunks/'+index;
        const response=await request('resources/read',{uri:chunkUri});
        if(revision!==mapRevision)return;
        const item=response?.contents?.find(c=>c.uri===chunkUri&&typeof c.text==='string');
        if(!item)throw new Error('地图分块缺失：'+index);
        const chunk=JSON.parse(item.text);
        const expected=Math.min(map.chunk_size,map.encoded_length-index*map.chunk_size);
        if(chunk.artifact_sha256!==artifact.sha256||chunk.index!==index||typeof chunk.data!=='string'||chunk.data.length!==expected||!/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.data))throw new Error('地图分块损坏或被截断：'+index);
        chunks.push(chunk.data);
        document.getElementById('map').innerHTML='<div class="empty">正在读取最终规划图… '+Math.round((index+1)/map.chunk_count*100)+'%</div>';
      }
      map.data=chunks.join('');
    }
    await loadMap(map,revision,id);
  }
  async function decodeMap(map){
    if(!['base64','gzip+base64'].includes(map.encoding)||typeof map.data!=='string'||map.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(map.data))throw new Error('地图编码数据损坏或被截断，请重新加载规划卡片');
    const bytes=Uint8Array.from(atob(map.data),c=>c.charCodeAt(0));
    if(map.compressed_bytes!==undefined&&bytes.length!==map.compressed_bytes)throw new Error('地图数据长度不完整');
    if(map.encoding==='gzip+base64'){ if(!('DecompressionStream'in window))throw new Error('当前宿主不支持压缩规划图解码'); return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
    return new TextDecoder().decode(bytes);
  }
  function sanitize(root){
    root.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n=>n.remove());
    for(const el of root.querySelectorAll('*'))for(const attr of [...el.attributes]){
      const value=attr.value.trim();
      if(/^on/i.test(attr.name)||(/^(href|xlink:href)$/i.test(attr.name)&&!/^(#|data:image\\/)/i.test(value))||/url\\s*\\(\\s*['"]?(?!#)/i.test(value))el.removeAttribute(attr.name);
    }
  }
  async function loadMap(map,revision,id){
    const text=await decodeMap(map);if(revision!==mapRevision)return;
    const doc=new DOMParser().parseFromString(text,'image/svg+xml'), root=doc.documentElement; if(root.nodeName.toLowerCase()!=='svg')throw new Error('规划图格式无效'); sanitize(root);
    root.setAttribute('preserveAspectRatio','xMidYMid meet');displayedPlanId=id;
    const host=document.getElementById('map'); host.replaceChildren(document.importNode(root,true)); svg=host.querySelector('svg'); const vb=svg.viewBox.baseVal; baseView={x:vb.x,y:vb.y,width:vb.width,height:vb.height}; view={...baseView}; applyView(); bindMap(); reportSize();
  }
  function applyView(){
    if(!svg||!view||!baseView)return;
    svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));
    const scale=baseView.width/view.width;
    document.querySelectorAll('[data-zoom]').forEach(b=>b.disabled=b.dataset.zoom==='in'?scale>=5:scale<=1);
  }
  function zoom(factor,cx=.5,cy=.5){
    if(!view||!baseView)return;
    const scale=Math.max(1,Math.min(5,baseView.width/view.width/factor));
    if(scale===1){view={...baseView};applyView();return;}
    const nw=baseView.width/scale,nh=baseView.height/scale;
    view.x+=view.width*cx-nw*cx;view.y+=view.height*cy-nh*cy;view.width=nw;view.height=nh;applyView();
  }
  function bindMap(){
    svg.addEventListener('pointerdown',e=>{svg.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...view}}});
    svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const r=svg.getBoundingClientRect();view.x=drag.start.x-(e.clientX-drag.x)*drag.start.width/r.width;view.y=drag.start.y-(e.clientY-drag.y)*drag.start.height/r.height;applyView()});
    const end=e=>{if(drag?.id===e.pointerId)drag=null};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
  }
  function showError(error){ svg=null;displayedPlanId=null;document.getElementById('map').innerHTML='<div class="empty status-error">'+esc(error?.message||error)+'</div>'; reportSize(); }
  window.addEventListener('message',event=>{const msg=event.data;if(event.source!==window.parent||!msg||msg.jsonrpc!=='2.0')return;if(Object.hasOwn(msg,'id')){const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message||'请求失败')):p.resolve(msg.result);return;}if(msg.method==='ui/notifications/tool-result')summary(msg.params);if(msg.method==='ui/notifications/host-context-changed')applyHostContext(msg.params);});
  document.getElementById('details-toggle').onclick=()=>{const panel=document.getElementById('details');panel.hidden=!panel.hidden;document.getElementById('details-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
  document.getElementById('fullscreen').onclick=()=>request('ui/request-display-mode',{mode:'fullscreen'}).catch(showError);
  document.getElementById('continue').onclick=()=>{if(!latest?.plan_ref||!latest?.plan_id)return;request('ui/message',{role:'user',content:[{type:'text',text:'请继续处理 CityWeaver 规划 '+latest.plan_ref+'，已查看的方案 ID 为 '+latest.plan_id+'。先执行施工准备或下一项安全预览，不要跳过原生预览和预算确认。'}]}).catch(showError)};
  document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>zoom(b.dataset.zoom==='in'?0.8:1.25));
  request('ui/initialize',{appInfo:{name:'cityweaver-planning',version:'1.0.5'},appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'2026-01-26'}).then(result=>{
    applyHostContext(result?.hostContext);notify('ui/notifications/initialized');connected=true;reportSize();
    if('ResizeObserver'in window)new ResizeObserver(reportSize).observe(document.querySelector('.app'));
    window.addEventListener('resize',reportSize);
  }).catch(showError);
})();
</script>
</body></html>`;
}
