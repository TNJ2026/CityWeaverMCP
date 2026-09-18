import { renderCityPlan } from './planning-renderer.mjs';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const THEME_COLORS = new Map([
  ['#ffffff', 'var(--background)'], ['#f8fafc', 'var(--background)'], ['#e2e8f0', 'var(--muted)'],
  ['#0f172a', 'var(--foreground)'], ['#334155', 'var(--foreground)'], ['#64748b', 'var(--border)'],
  ['#111827', 'var(--foreground)'], ['#030712', 'var(--background)'], ['#1f2937', 'var(--border)'],
  ['#4b5563', 'var(--foreground)'], ['#a855f7', 'var(--viz-series-4)'], ['#ef4444', 'var(--viz-series-5)'],
  ['#38bdf8', 'var(--blue)'],
  ['#f59e0b', 'var(--viz-series-3)'], ['#2563eb', 'var(--viz-series-2)'], ['#92400e', 'var(--viz-series-3)'],
  ['#0f766e', 'var(--viz-series-6)'], ['#06b6d4', 'var(--viz-series-2)'], ['#7c3aed', 'var(--viz-series-4)'],
  ['#86efac', 'var(--viz-series-1)'], ['#60a5fa', 'var(--viz-series-2)'], ['#fbbf24', 'var(--viz-series-3)'],
  ['#c084fc', 'var(--viz-series-4)'], ['#fb7185', 'var(--viz-series-5)'], ['#cbd5e1', 'var(--muted)'],
  ['#16a34a', 'var(--green)'], ['#dc2626', 'var(--destructive)'],
]);

function themeSvg(svg) {
  let themed = svg;
  for (const [source, target] of THEME_COLORS) themed = themed.replaceAll(source, target);
  return themed.replace('<svg ', '<svg class="city-plan-map" role="img" aria-label="交互式城市规划图" ');
}

export function renderCityPlanInteractive(snapshot, plan, options = {}) {
  const rendered = renderCityPlan(snapshot, plan, options);
  const rootId = `city-plan-${rendered.plan_id.replace(/[^a-z0-9-]/gi, '')}`;
  const svg = themeSvg(rendered.svg);
  const title = escapeHtml(options.title ?? '城市综合规划图');
  const counts = rendered.counts;
  const validation = rendered.validation;
  const nativePreview = rendered.native_preview_summary;
  const validationText = validation.issue_count
    ? `校验发现 ${validation.error_count} 个错误、${validation.warning_count} 个警告。选择对象查看详情。`
    : '几何校验未发现问题；正式施工仍需通过游戏原生 preview。';
  const validationJson = JSON.stringify(validation.issues).replaceAll('<', '\\u003c');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: light; --background: #fff; --foreground: #0f172a; --muted: #e2e8f0; --border: #94a3b8; --ring: #2563eb; --blue: #38bdf8; --green: #16a34a; --destructive: #dc2626; --viz-series-1: #22c55e; --viz-series-2: #2563eb; --viz-series-3: #f59e0b; --viz-series-4: #a855f7; --viz-series-5: #ef4444; --viz-series-6: #0f766e; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: #f1f5f9; color: var(--foreground); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
    #${rootId} { color: var(--foreground); width: 100%; }
    #${rootId} .city-plan-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    #${rootId} .city-plan-heading h2 { margin: 0; }
    #${rootId} .city-plan-map-wrap { margin-top: 12px; border: 1px solid var(--border); overflow: hidden; background: var(--background); cursor: grab; touch-action: none; user-select: none; }
    #${rootId} .city-plan-map-wrap.is-dragging { cursor: grabbing; }
    #${rootId} .city-plan-map { display: block; width: 100%; height: min(78vh, 1000px); min-height: 480px; }
    #${rootId} .city-plan-map .existing { opacity: .52; }
    #${rootId} .city-plan-map .planned { opacity: .96; }
    #${rootId} .city-plan-map [data-plan-object] { cursor: pointer; outline: none; }
    #${rootId} .city-plan-map [data-plan-object][hidden] { display: none; }
    #${rootId} .city-plan-map [data-plan-object].is-selected { filter: drop-shadow(0 0 4px var(--ring)); opacity: 1; }
    #${rootId} .city-plan-map path.has-error, #${rootId} .city-plan-map polygon.has-error, #${rootId} .city-plan-map .has-error rect, #${rootId} .city-plan-map .has-error .line-geometry { stroke: var(--destructive) !important; }
    #${rootId} .city-plan-map path.has-warning, #${rootId} .city-plan-map polygon.has-warning, #${rootId} .city-plan-map .has-warning rect, #${rootId} .city-plan-map .has-warning .line-geometry { stroke: var(--viz-series-3) !important; }
    #${rootId} .city-plan-native { margin-top: 8px; }
    #${rootId} .city-plan-detail { margin-top: 12px; }
    #${rootId} .city-plan-detail p { margin: 0; }
    #${rootId} .city-plan-legend { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px; }
    #${rootId} .city-plan-key { display: inline-flex; align-items: center; gap: 6px; }
    #${rootId} .city-plan-line { width: 24px; border-top: 3px solid var(--foreground); }
    #${rootId} .city-plan-line.planned-key { border-top-color: var(--viz-series-1); }
    #${rootId} .city-plan-line.underground-key { border-top-style: dashed; }
    #${rootId} .viz-controls { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 12px; }
    #${rootId} .form-check { display: inline-flex; align-items: center; gap: 5px; }
    #${rootId} .map-actions { margin-left: auto; display: inline-flex; gap: 6px; }
    #${rootId} button { border: 1px solid var(--border); border-radius: 6px; background: var(--background); color: var(--foreground); padding: 5px 10px; cursor: pointer; }
    #${rootId} .card { background: var(--background); border: 1px solid var(--border); border-radius: 7px; padding: 10px 12px; }
    #${rootId} .text-muted { color: #64748b; }
    @media (max-width: 520px) { #${rootId} .city-plan-heading { align-items: flex-start; } }
  </style>
</head>
<body>
<main id="${rootId}" class="city-plan-v2">
  <div class="city-plan-heading">
    <h2>${title}</h2>
    <span class="text-small text-muted">规划 ${counts.roads} 条道路 · ${counts.zones} 个分区 · ${counts.buildings} 栋建筑</span>
  </div>
  ${nativePreview ? `<div class="city-plan-native text-small${nativePreview.errors.length || nativePreview.error ? ' text-destructive' : ''}" ${nativePreview.errors.length || nativePreview.error ? 'role="alert"' : 'aria-live="polite"'}>原生道路预检：${escapeHtml(nativePreview.state)} · 费用 ${escapeHtml(Number(nativePreview.cost).toLocaleString('zh-CN'))} · 警告 ${nativePreview.warnings.length} · 错误 ${nativePreview.errors.length + (nativePreview.error ? 1 : 0)}${nativePreview.snapped_origin ? ` · 吸附原点 (${escapeHtml(nativePreview.snapped_origin.x)}, ${escapeHtml(nativePreview.snapped_origin.z)})` : ''}</div>` : ''}
  <div class="viz-controls" aria-label="规划图层">
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="roads" checked><span class="form-check-label">道路</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="buildings" checked><span class="form-check-label">建筑</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="zones" checked><span class="form-check-label">分区</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="tracks" checked><span class="form-check-label">轨道</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="utilities" checked><span class="form-check-label">管网</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="waters" checked><span class="form-check-label">水域</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="layer" value="terrain" checked><span class="form-check-label">坡度</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="status" value="existing" checked><span class="form-check-label">现状</span></label>
    <label class="form-check"><input class="form-check-input" type="checkbox" data-filter="status" value="planned" checked><span class="form-check-label">规划</span></label>
    <span class="map-actions" aria-label="地图视图控制"><button type="button" data-map-action="zoom-out" aria-label="缩小">−</button><button type="button" data-map-action="reset">复位</button><button type="button" data-map-action="zoom-in" aria-label="放大">＋</button></span>
  </div>
  <div class="city-plan-legend text-small" aria-label="线型说明">
    <span class="city-plan-key"><span class="city-plan-line"></span>现状</span>
    <span class="city-plan-key"><span class="city-plan-line planned-key"></span>规划</span>
    <span class="city-plan-key"><span class="city-plan-line underground-key"></span>地下</span>
  </div>
  <div class="city-plan-map-wrap">${svg}</div>
  <div class="card city-plan-detail" aria-live="polite"${validation.error_count ? ' role="alert"' : ''}><p data-selection>${escapeHtml(validationText)}</p></div>
  <script>
    (() => {
      const root = document.getElementById('${rootId}');
      if (!root) return;
      const controls = [...root.querySelectorAll('input[data-filter]')];
      const objects = [...root.querySelectorAll('[data-plan-object]')];
      const selection = root.querySelector('[data-selection]');
      const mapWrap = root.querySelector('.city-plan-map-wrap');
      const svg = root.querySelector('.city-plan-map');
      const issues = ${validationJson};
      const issuesByObject = new Map();
      for (const issue of issues) {
        const list = issuesByObject.get(issue.object_id) || [];
        list.push(issue);
        issuesByObject.set(issue.object_id, list);
      }
      for (const object of objects) {
        const objectIssues = issuesByObject.get(object.dataset.objectId) || [];
        if (objectIssues.some(issue => issue.severity === 'error')) object.classList.add('has-error');
        else if (objectIssues.length) object.classList.add('has-warning');
      }
      const saved = window.openai && window.openai.widgetState && window.openai.widgetState.privateContent;
      if (saved && saved.filters) {
        for (const input of controls) {
          const values = saved.filters[input.dataset.filter];
          if (Array.isArray(values)) input.checked = values.includes(input.value);
        }
      }
      const currentFilters = () => ({
        layer: controls.filter(input => input.dataset.filter === 'layer' && input.checked).map(input => input.value),
        status: controls.filter(input => input.dataset.filter === 'status' && input.checked).map(input => input.value),
      });
      const applyFilters = persist => {
        const filters = currentFilters();
        for (const object of objects) object.hidden = !filters.layer.includes(object.dataset.layer) || !filters.status.includes(object.dataset.status);
        if (persist && window.openai && window.openai.setWidgetState) window.openai.setWidgetState({
          modelContent: { visibleLayers: filters.layer, visibleStatus: filters.status },
          privateContent: { filters },
        }).catch(() => {});
      };
      const selectObject = object => {
        for (const item of objects) item.classList.toggle('is-selected', item === object);
        const name = object.getAttribute('aria-label') || object.dataset.objectId || '未命名对象';
        const status = object.dataset.status === 'planned' ? '规划' : '现状';
        const objectIssues = issuesByObject.get(object.dataset.objectId) || [];
        const issueText = objectIssues.length ? ' · ' + objectIssues.map(issue => issue.message).join('；') : ' · 未发现几何问题';
        const nativeText = object.dataset.nativeState
          ? ' · 原生预检 ' + object.dataset.nativeState + ' · 费用 ' + Number(object.dataset.nativeCost || 0).toLocaleString('zh-CN')
            + (object.dataset.nativeWarnings ? ' · 警告：' + object.dataset.nativeWarnings : '')
            + (object.dataset.nativeErrors ? ' · 错误：' + object.dataset.nativeErrors : '')
          : '';
        selection.textContent = name + ' · ' + object.dataset.layer + ' · ' + object.dataset.kind + ' · ' + status + nativeText + issueText;
      };
      for (const input of controls) input.addEventListener('change', () => applyFilters(true));
      const baseView = { x: 0, y: 0, width: ${rendered.bounds ? Number(options.width ?? 1600) : 1600}, height: ${rendered.bounds ? Number(options.height ?? 1000) : 1000} };
      const view = { ...baseView };
      const maxZoom = 10;
      let pointer = null;
      let dragged = false;
      const clampView = () => {
        view.width = Math.max(baseView.width / maxZoom, Math.min(baseView.width, view.width));
        view.height = Math.max(baseView.height / maxZoom, Math.min(baseView.height, view.height));
        view.x = Math.max(baseView.x, Math.min(baseView.x + baseView.width - view.width, view.x));
        view.y = Math.max(baseView.y, Math.min(baseView.y + baseView.height - view.height, view.y));
        svg.setAttribute('viewBox', [view.x, view.y, view.width, view.height].join(' '));
      };
      const zoomAt = (factor, clientX, clientY) => {
        const rect = svg.getBoundingClientRect();
        const px = (clientX - rect.left) / Math.max(1, rect.width);
        const py = (clientY - rect.top) / Math.max(1, rect.height);
        const nextWidth = view.width / factor;
        const nextHeight = view.height / factor;
        view.x += (view.width - nextWidth) * px;
        view.y += (view.height - nextHeight) * py;
        view.width = nextWidth; view.height = nextHeight; clampView();
      };
      mapWrap.addEventListener('wheel', event => {
        event.preventDefault();
        zoomAt(event.deltaY < 0 ? 1.18 : 1 / 1.18, event.clientX, event.clientY);
      }, { passive: false });
      mapWrap.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
        dragged = false; mapWrap.classList.add('is-dragging'); mapWrap.setPointerCapture(event.pointerId);
      });
      mapWrap.addEventListener('pointermove', event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        const rect = svg.getBoundingClientRect();
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        if (Math.hypot(dx, dy) > 3) dragged = true;
        view.x = pointer.vx - dx * view.width / Math.max(1, rect.width);
        view.y = pointer.vy - dy * view.height / Math.max(1, rect.height);
        clampView();
      });
      const stopDrag = event => {
        if (!pointer || pointer.id !== event.pointerId) return;
        pointer = null; mapWrap.classList.remove('is-dragging');
      };
      mapWrap.addEventListener('pointerup', stopDrag);
      mapWrap.addEventListener('pointercancel', stopDrag);
      for (const button of root.querySelectorAll('[data-map-action]')) button.addEventListener('click', () => {
        const action = button.dataset.mapAction;
        if (action === 'reset') Object.assign(view, baseView);
        else zoomAt(action === 'zoom-in' ? 1.25 : 0.8, svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2);
        clampView();
      });
      for (const object of objects) {
        object.addEventListener('click', event => { if (dragged) { event.preventDefault(); return; } selectObject(object); });
        object.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectObject(object); } });
      }
      window.addEventListener('openai:set_globals', event => {
        const next = event.detail && event.detail.globals && event.detail.globals.widgetState && event.detail.globals.widgetState.privateContent;
        if (!next || !next.filters) return;
        for (const input of controls) {
          const values = next.filters[input.dataset.filter];
          if (Array.isArray(values)) input.checked = values.includes(input.value);
        }
        applyFilters(false);
      });
      applyFilters(false);
      clampView();
    })();
  </script>
</main>
</body>
</html>`;

  return { ...rendered, html, mime_type: 'text/html', static_webpage: true, interaction: { pan: true, zoom: { min: 1, max: 10 }, reset: true } };
}
