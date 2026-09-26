import { gzipSync } from 'node:zlib';

export const PLANNING_APP_URI = 'ui://cityweaver/planning/v1.html';

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
  const stored = await store.getArtifact(artifact.sha256, extension);
  const svg = extractSvg(stored.text, extension);
  if (!svg) return { ...payload, artifact_error: 'SVG_NOT_FOUND' };
  const compressed = gzipSync(Buffer.from(svg));
  return {
    ...payload,
    map: {
      encoding: 'gzip+base64',
      data: compressed.toString('base64'),
      original_bytes: Buffer.byteLength(svg),
      compressed_bytes: compressed.byteLength,
      artifact_sha256: artifact.sha256,
    },
  };
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
    .app{display:grid;grid-template-rows:auto minmax(260px,1fr);min-height:360px;max-height:100vh}.card{padding:14px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
    .top{display:flex;align-items:flex-start;gap:12px;justify-content:space-between}.title{font-size:17px;font-weight:700}.sub{color:var(--muted);margin-top:2px;word-break:break-all}.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.chip{padding:3px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
    .actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}button{appearance:none;border:1px solid var(--line);background:var(--panel);color:var(--fg);padding:7px 10px;border-radius:8px;cursor:pointer}button:hover{border-color:var(--accent)}button.primary{background:var(--accent);border-color:var(--accent);color:white}
    .viewer{position:relative;overflow:hidden;background:var(--panel);min-height:260px}.map{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden}.map svg{width:100%;height:100%;touch-action:none;user-select:none}.empty{color:var(--muted);padding:32px;text-align:center}
    .toolbar{position:absolute;z-index:2;right:12px;bottom:12px;display:flex;gap:6px;padding:6px;background:color-mix(in srgb,var(--panel) 90%,transparent);border:1px solid var(--line);border-radius:10px;box-shadow:0 5px 18px #0002}
    .status-error{color:#d14343}.status-ok{color:var(--ok)}
    @media(max-width:640px){.top{display:block}.actions{justify-content:flex-start;margin-top:10px}.app{min-height:420px}}
  </style>
</head>
<body>
<main class="app">
  <section class="card">
    <div class="top">
      <div><div class="title" id="title">CityWeaver 规划</div><div class="sub" id="subtitle">等待规划结果…</div></div>
      <div class="actions"><button id="fullscreen">全屏地图</button><button class="primary" id="continue" disabled>继续施工流程</button></div>
    </div>
    <div class="chips" id="chips"></div>
  </section>
  <section class="viewer"><div class="map" id="map"><div class="empty">规划结果将显示在这里</div></div><div class="toolbar"><button data-zoom="in">＋</button><button data-zoom="out">－</button><button data-zoom="reset">复位</button></div></section>
</main>
<script>
(() => {
  const pending = new Map(); let seq = 1; let latest = null; let baseView = null; let view = null; let svg = null; let drag = null;
  const post = message => window.parent.postMessage(message, '*');
  const request = (method, params) => new Promise((resolve, reject) => { const id = seq++; pending.set(id,{resolve,reject}); post({jsonrpc:'2.0',id,method,params}); });
  const notify = (method, params={}) => post({jsonrpc:'2.0',method,params});
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dataOf = result => result?.structuredContent?.data ?? result?.structuredContent ?? {};
  function chip(text, cls=''){ return '<span class="chip '+cls+'">'+esc(text)+'</span>'; }
  function summary(result){
    const data=dataOf(result), meta=result?._meta?.cityweaver_planning_app; latest=meta||latest;
    document.getElementById('title').textContent = ({render_city_plan:'城市综合规划图',propose_city_plan:'城市规划候选',propose_grid_plan:'网格规划候选',prepare_city_plan_construction:'施工准备',advance_city_plan_construction:'施工进度',prepare_grid_native_preview:'原生道路预览',advance_grid_construction:'网格施工进度'}[meta?.tool_name]||'CityWeaver 规划');
    const id=meta?.plan_id||data.plan_id||data.approved_plan_id; document.getElementById('subtitle').textContent=id?('方案 '+id):'规划结果';
    const parts=[]; if(meta?.plan_ref||data.plan_ref)parts.push(chip('已保存方案')); if(meta?.construction_id||data.construction_id)parts.push(chip('施工 '+String(meta?.construction_id||data.construction_id).slice(0,24)+'…'));
    if(data.validation?.valid===false||data.error)parts.push(chip('需要处理错误','status-error')); else parts.push(chip('数据已就绪','status-ok'));
    if(data.native_preview_summary?.state)parts.push(chip('预览 '+data.native_preview_summary.state)); if(data.next_action?.action)parts.push(chip('下一步 '+data.next_action.action));
    document.getElementById('chips').innerHTML=parts.join(''); document.getElementById('continue').disabled=!(meta?.plan_ref&&id);
    if(meta?.map?.data) loadMap(meta.map).catch(showError);
  }
  async function decodeMap(map){
    const bytes=Uint8Array.from(atob(map.data),c=>c.charCodeAt(0));
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
  async function loadMap(map){
    const text=await decodeMap(map), doc=new DOMParser().parseFromString(text,'image/svg+xml'), root=doc.documentElement; if(root.nodeName.toLowerCase()!=='svg')throw new Error('规划图格式无效'); sanitize(root);
    const host=document.getElementById('map'); host.replaceChildren(document.importNode(root,true)); svg=host.querySelector('svg'); const vb=svg.viewBox.baseVal; baseView={x:vb.x,y:vb.y,width:vb.width,height:vb.height}; view={...baseView}; applyView(); bindMap();
  }
  function applyView(){ if(svg&&view)svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' ')); }
  function zoom(factor,cx=.5,cy=.5){ if(!view||!baseView)return; const nw=view.width*factor,nh=view.height*factor; view.x+=view.width*cx-nw*cx;view.y+=view.height*cy-nh*cy;view.width=nw;view.height=nh;applyView(); }
  function bindMap(){
    svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(e.deltaY>0?1.18:.84,(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);},{passive:false});
    svg.addEventListener('pointerdown',e=>{svg.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...view}}});
    svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const r=svg.getBoundingClientRect();view.x=drag.start.x-(e.clientX-drag.x)*drag.start.width/r.width;view.y=drag.start.y-(e.clientY-drag.y)*drag.start.height/r.height;applyView()});
    const end=e=>{if(drag?.id===e.pointerId)drag=null};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
  }
  function showError(error){ document.getElementById('map').innerHTML='<div class="empty status-error">'+esc(error?.message||error)+'</div>'; }
  window.addEventListener('message',event=>{const msg=event.data;if(!msg||msg.jsonrpc!=='2.0')return;if(Object.hasOwn(msg,'id')){const p=pending.get(msg.id);if(!p)return;pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message||'请求失败')):p.resolve(msg.result);return;}if(msg.method==='ui/notifications/tool-result')summary(msg.params);});
  document.getElementById('fullscreen').onclick=()=>request('ui/request-display-mode',{mode:'fullscreen'}).catch(showError);
  document.getElementById('continue').onclick=()=>{if(!latest?.plan_ref||!latest?.plan_id)return;request('ui/message',{role:'user',content:[{type:'text',text:'请继续处理 CityWeaver 规划 '+latest.plan_ref+'，已查看的方案 ID 为 '+latest.plan_id+'。先执行施工准备或下一项安全预览，不要跳过原生预览和预算确认。'}]}).catch(showError)};
  document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{const a=b.dataset.zoom;if(a==='reset'){view={...baseView};applyView()}else zoom(a==='in'?0.8:1.25)});
  request('ui/initialize',{appInfo:{name:'cityweaver-planning',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'2026-01-26'}).then(()=>notify('ui/notifications/initialized')).catch(showError);
})();
</script>
</body></html>`;
}
