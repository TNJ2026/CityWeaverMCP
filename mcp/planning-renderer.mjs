import { createHash } from 'node:crypto';
import { validateCityPlan } from './planning-validator.mjs';

const COLORS = {
  road: '#4b5563', train: '#111827', subway: '#a855f7', tram: '#ef4444',
  surface_water: '#38bdf8',
  terrain_moderate: '#f59e0b', terrain_steep: '#ef4444',
  preview_ready: '#16a34a', preview_pending: '#f59e0b', preview_failed: '#dc2626', preview_inactive: '#64748b',
  electricity: '#f59e0b', water: '#2563eb', sewage: '#92400e', water_sewage: '#0f766e', stormwater: '#06b6d4', resource: '#7c3aed',
  residential: '#86efac', commercial: '#60a5fa', industrial: '#fbbf24', office: '#c084fc', service: '#fb7185', unknown: '#cbd5e1'
};

const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const classToken = value => String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

export function expandCityPlan(plan) {
  const roads = [...(plan.roads ?? [])];
  const zones = [...(plan.zones ?? [])];
  for (const [gridIndex, grid] of (plan.grids ?? []).entries()) {
    const ox = finite(grid.origin?.x), oz = finite(grid.origin?.z);
    const columns = finite(grid.columns, 1), rows = finite(grid.rows, 1);
    const width = finite(grid.block_width_m, 96), height = finite(grid.block_height_m, 96);
    const gridId = grid.id ?? `grid-${gridIndex}`;
    for (let column = 0; column <= columns; column++) roads.push({
      id: `${gridId}-v-${column}`, prefab: grid.vertical_road_prefab ?? grid.road_prefab,
      kind: 'road', level: 'surface', width_m: grid.road_width_m ?? 8,
      construction_order: grid.construction_order,
      depends_on: grid.depends_on,
      construction_status: grid.construction_status,
      native_preview: grid.native_preview,
      points: [{ x: ox + column * width, z: oz }, { x: ox + column * width, z: oz + rows * height }]
    });
    for (let row = 0; row <= rows; row++) roads.push({
      id: `${gridId}-h-${row}`, prefab: grid.horizontal_road_prefab ?? grid.road_prefab,
      kind: 'road', level: 'surface', width_m: grid.road_width_m ?? 8,
      construction_order: grid.construction_order,
      depends_on: grid.depends_on,
      construction_status: grid.construction_status,
      native_preview: grid.native_preview,
      points: [{ x: ox, z: oz + row * height }, { x: ox + columns * width, z: oz + row * height }]
    });
    if (grid.zone_type || grid.zone_kind) for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) zones.push({
      id: `grid-${gridIndex}-zone-${column}-${row}`, kind: grid.zone_kind ?? grid.zone_type,
      label: grid.zone_type ?? grid.zone_kind,
      polygon: [
        { x: ox + column * width, z: oz + row * height }, { x: ox + (column + 1) * width, z: oz + row * height },
        { x: ox + (column + 1) * width, z: oz + (row + 1) * height }, { x: ox + column * width, z: oz + (row + 1) * height }
      ]
    });
  }
  const withIds = (items, prefix) => items.map((item, index) => ({ ...item, id: item.id ?? `${prefix}-${index}` }));
  return { ...plan, roads: withIds(roads, 'road'), buildings: withIds(plan.buildings ?? [], 'building'), zones: withIds(zones, 'zone'), tracks: withIds(plan.tracks ?? [], 'track'), utilities: withIds(plan.utilities ?? [], 'utility') };
}

export function computeCityPlanId(bounds, planInput) {
  const plan = expandCityPlan(planInput ?? {});
  return `cplan-${createHash('sha256').update(JSON.stringify({ bounds, plan })).digest('hex').slice(0, 16)}`;
}

function zoneColor(kind) {
  const value = String(kind ?? '').toLowerCase();
  return value.includes('residential') ? COLORS.residential : value.includes('commercial') ? COLORS.commercial :
    value.includes('industrial') ? COLORS.industrial : value.includes('office') ? COLORS.office : value.includes('service') ? COLORS.service : COLORS.unknown;
}

function levelOf(item, fallback = 'surface') {
  return String(item.level ?? item.elevation_class ?? fallback).toLowerCase();
}

function projector(bounds, x, y, width, height) {
  const worldWidth = bounds.max_x - bounds.min_x, worldHeight = bounds.max_z - bounds.min_z;
  const scale = Math.min(width / worldWidth, height / worldHeight);
  const usedWidth = worldWidth * scale, usedHeight = worldHeight * scale;
  const left = x + (width - usedWidth) / 2, top = y + (height - usedHeight) / 2;
  return point => ({ x: left + (finite(point?.x) - bounds.min_x) * scale, y: top + (bounds.max_z - finite(point?.z)) * scale, scale });
}

function curvePath(curve, project) {
  if (!curve?.a || !curve?.d) return '';
  const a = project(curve.a), b = project(curve.b ?? curve.a), c = project(curve.c ?? curve.d), d = project(curve.d);
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} C${b.x.toFixed(2)},${b.y.toFixed(2)} ${c.x.toFixed(2)},${c.y.toFixed(2)} ${d.x.toFixed(2)},${d.y.toFixed(2)}`;
}

function pointsPath(points, project) {
  if (!Array.isArray(points) || points.length < 2) return '';
  return points.map((point, index) => { const p = project(point); return `${index ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
}

function linearPath(item, project) { return item.curve ? curvePath(item.curve, project) : pointsPath(item.points, project); }

function previewColor(preview) {
  const state = preview?.state;
  if (state === 'preview_ready') return COLORS.preview_ready;
  if (['failed', 'outcome_unknown'].includes(state)) return COLORS.preview_failed;
  if (['cancelled', 'expired'].includes(state)) return COLORS.preview_inactive;
  return state ? COLORS.preview_pending : null;
}

function previewAttributes(preview) {
  if (!preview?.state) return '';
  const warnings = (preview.warnings ?? []).join('；');
  const errors = [...(preview.errors ?? []), ...(preview.error ? [preview.error] : [])].join('；');
  return ` data-native-state="${escapeXml(preview.state)}" data-native-cost="${escapeXml(preview.cost ?? 0)}" data-native-warnings="${escapeXml(warnings)}" data-native-errors="${escapeXml(errors)}" data-operation-id="${escapeXml(preview.operation_id ?? '')}"`;
}

function renderLine(item, project, color, planned, dash = '', layer = 'network') {
  const path = linearPath(item, project); if (!path) return '';
  const scale = project({ x: 0, z: 0 }).scale;
  const width = Math.max(planned ? 2.4 : 1.2, Math.min(12, finite(item.width_m, 4) * scale * .18));
  const status = planned ? 'planned' : 'existing';
  const kind = item.track_type ?? item.network_type ?? item.kind ?? layer;
  const label = item.label ?? item.name ?? item.prefab ?? item.id ?? `${status} ${kind}`;
  const nativeColor = previewColor(item.native_preview);
  const nativeClass = item.native_preview?.state ? ` native-preview-${classToken(item.native_preview.state)}` : '';
  return `<path class="${status} ${classToken(layer)} ${classToken(kind)}${nativeClass}" data-plan-object="true" data-layer="${escapeXml(layer)}" data-status="${status}" data-kind="${escapeXml(kind)}" data-object-id="${escapeXml(item.id ?? '')}"${previewAttributes(item.native_preview)} aria-label="${escapeXml(label)}" tabindex="0" d="${path}" fill="none" stroke="${nativeColor ?? color}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}><title>${escapeXml(label)}</title></path>`;
}

function renderPreviewMarker(grid, index, project) {
  const preview = grid.native_preview;
  const point = preview?.snapped_origin;
  if (!preview?.state || !point) return '';
  const center = project(point);
  const color = previewColor(preview) ?? COLORS.preview_pending;
  const label = `原生道路预检：${preview.state}`;
  return `<circle class="planned native-preview-marker native-preview-${classToken(preview.state)}" data-plan-object="true" data-layer="roads" data-status="planned" data-kind="native_preview" data-object-id="grid-${index}-native-preview"${previewAttributes(preview)} aria-label="${escapeXml(label)}" tabindex="0" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="7" fill="${color}" stroke="#ffffff" stroke-width="2"><title>${escapeXml(label)}</title></circle>`;
}

function renderBuilding(item, project, planned) {
  const center = project(item.position); const scale = center.scale;
  const width = Math.max(3, finite(item.size_m?.x, 8) * scale), height = Math.max(3, finite(item.size_m?.z, 8) * scale);
  const color = zoneColor(item.kind); const rotation = -finite(item.rotation_degrees);
  const label = item.label ?? item.name ?? (planned ? item.prefab : null);
  const status = planned ? 'planned' : 'existing';
  const visibleLabel = planned && item.kind === 'service' && label ? String(label).slice(0, 14) : '';
  return `<g class="${status} building ${classToken(item.kind)}" data-plan-object="true" data-layer="buildings" data-status="${status}" data-kind="${escapeXml(item.kind ?? 'building')}" data-category="${escapeXml(item.category ?? '')}" data-object-id="${escapeXml(item.id ?? '')}" aria-label="${escapeXml(label ?? 'building')}" tabindex="0" transform="translate(${center.x.toFixed(2)} ${center.y.toFixed(2)}) rotate(${rotation.toFixed(2)})"><rect x="${(-width / 2).toFixed(2)}" y="${(-height / 2).toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" fill="${color}" stroke="#334155" stroke-width="${planned ? 1.5 : .7}"/>${visibleLabel ? `<text x="0" y="3" text-anchor="middle" font-size="9" font-weight="700" fill="#3f1723" transform="rotate(${(-rotation).toFixed(2)})">${escapeXml(visibleLabel)}</text>` : ''}${label ? `<title>${escapeXml(label)}</title>` : ''}</g>`;
}

function renderWater(item, project) {
  const polygons = item.polygons ?? (item.polygon ? [item.polygon] : []);
  const holes = item.holes ?? [];
  const label = item.label ?? '地表水体';
  const pathFor = ring => ring.map((point, index) => {
    const p = project(point);
    return `${index ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(' ') + ' Z';
  const path = [...polygons, ...holes].filter(ring => ring?.length >= 3).map(pathFor).join(' ');
  if (!path) return '';
  return `<g class="existing water ${classToken(item.kind)}" data-plan-object="true" data-layer="waters" data-status="existing" data-kind="${escapeXml(item.kind ?? 'surface_water')}" data-object-id="${escapeXml(item.id ?? '')}" aria-label="${escapeXml(label)}" tabindex="0" fill="${COLORS.surface_water}" fill-opacity=".34" stroke="none"><title>${escapeXml(label)}</title><path d="${path}" fill-rule="evenodd"/></g>`;
}

function renderTerrain(terrain, project) {
  const groups = [
    ['moderate_terrain', COLORS.terrain_moderate, '中等坡度地形'],
    ['steep_terrain', COLORS.terrain_steep, '陡坡地形'],
  ];
  return groups.map(([kind, color, label]) => {
    const cells = (terrain?.cells ?? []).filter(cell => cell.kind === kind);
    if (!cells.length) return '';
    const polygons = cells.map(cell => {
      const points = cell.polygon.map(point => { const p = project(point); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
      return `<polygon points="${points}"/>`;
    }).join('');
    return `<g class="existing terrain ${kind}" data-plan-object="true" data-layer="terrain" data-status="existing" data-kind="${kind}" data-object-id="terrain-${kind}" aria-label="${label}" tabindex="0" fill="${color}" fill-opacity="${kind === 'steep_terrain' ? '.16' : '.08'}" stroke="none"><title>${label}</title>${polygons}</g>`;
  }).join('');
}

function panelSvg({ snapshot, plan, mode, title, x, y, width, height, bounds }) {
  const project = projector(bounds, x, y, width, height);
  const underground = mode === 'underground';
  const combined = mode === 'combined';
  const purchasedTiles = snapshot.purchased_tiles ?? [];
  const ownedClipId = `clip-owned-${mode}`;
  const tileRects = purchasedTiles.map((tile) => {
    const topLeft = project({ x: tile.bounds.min_x, z: tile.bounds.max_z });
    const bottomRight = project({ x: tile.bounds.max_x, z: tile.bounds.min_z });
    return `<rect x="${topLeft.x.toFixed(2)}" y="${topLeft.y.toFixed(2)}" width="${(bottomRight.x - topLeft.x).toFixed(2)}" height="${(bottomRight.y - topLeft.y).toFixed(2)}"/>`;
  });
  const mapFill = underground ? '#111827' : '#f8fafc';
  const outsideFill = underground ? '#030712' : '#e2e8f0';
  const parts = [`<g id="${mode}" clip-path="url(#clip-${mode})">`, `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${purchasedTiles.length ? outsideFill : mapFill}"/>`];
  if (purchasedTiles.length) {
    parts.push(`<defs><clipPath id="${ownedClipId}">${tileRects.join('')}</clipPath></defs>`);
    parts.push(`<g fill="${mapFill}" stroke="none">${tileRects.join('')}</g>`);
    parts.push(`<g clip-path="url(#${ownedClipId})">`);
  }
  const gridStep = 100; const firstX = Math.ceil(bounds.min_x / gridStep) * gridStep, firstZ = Math.ceil(bounds.min_z / gridStep) * gridStep;
  for (let gx = firstX; gx <= bounds.max_x; gx += gridStep) { const a = project({ x: gx, z: bounds.min_z }), b = project({ x: gx, z: bounds.max_z }); parts.push(`<path d="M${a.x},${a.y} L${b.x},${b.y}" stroke="${underground ? '#1f2937' : '#e2e8f0'}" stroke-width=".6"/>`); }
  for (let gz = firstZ; gz <= bounds.max_z; gz += gridStep) { const a = project({ x: bounds.min_x, z: gz }), b = project({ x: bounds.max_x, z: gz }); parts.push(`<path d="M${a.x},${a.y} L${b.x},${b.y}" stroke="${underground ? '#1f2937' : '#e2e8f0'}" stroke-width=".6"/>`); }

  if (!underground && snapshot.terrain) parts.push(renderTerrain(snapshot.terrain, project));
  if (!underground) for (const water of snapshot.waters ?? []) parts.push(renderWater(water, project));

  if (!underground) for (const zone of plan.zones ?? []) {
    const points = (zone.polygon ?? []).map(point => { const p = project(point); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
    if (points) parts.push(`<polygon class="planned zone ${classToken(zone.kind)}" data-plan-object="true" data-layer="zones" data-status="planned" data-kind="${escapeXml(zone.kind ?? 'zone')}" data-object-id="${escapeXml(zone.id ?? '')}" aria-label="${escapeXml(zone.label ?? zone.kind ?? 'planned zone')}" tabindex="0" points="${points}" fill="${zoneColor(zone.kind)}" fill-opacity=".22" stroke="${zoneColor(zone.kind)}" stroke-width="1" stroke-dasharray="5 4"><title>${escapeXml(zone.label ?? zone.kind ?? 'planned zone')}</title></polygon>`);
  }

  const isUnderground = item => ['underground', 'tunnel'].includes(levelOf(item));
  const visible = item => combined ? true : underground ? isUnderground(item) : !isUnderground(item);
  const dashFor = (item, undergroundDash) => combined && isUnderground(item) ? undergroundDash : underground ? undergroundDash : '';
  if (!underground) for (const item of snapshot.buildings ?? []) parts.push(renderBuilding(item, project, false));
  if (!underground) for (const item of plan.buildings ?? []) parts.push(renderBuilding(item, project, true));
  for (const item of snapshot.roads ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS.road, false, dashFor(item, '5 4'), 'roads'));
  for (const item of plan.roads ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS.road, true, dashFor(item, '7 4'), 'roads'));
  for (const item of snapshot.tracks ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS[String(item.track_type).toLowerCase()] ?? COLORS.train, false, dashFor(item, '3 3'), 'tracks'));
  for (const item of plan.tracks ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS[String(item.track_type).toLowerCase()] ?? COLORS.train, true, dashFor(item, '6 3'), 'tracks'));
  for (const item of snapshot.utilities ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS[item.network_type] ?? COLORS.resource, false, dashFor(item, '4 3'), 'utilities'));
  for (const item of plan.utilities ?? []) if (visible(item)) parts.push(renderLine(item, project, COLORS[item.network_type] ?? COLORS.resource, true, dashFor(item, '6 3'), 'utilities'));
  if (!underground) for (const [index, grid] of (plan.grids ?? []).entries()) parts.push(renderPreviewMarker(grid, index, project));
  if (purchasedTiles.length) parts.push('</g>');
  parts.push('</g>', `<text x="${x + 12}" y="${y + 24}" font-size="18" font-weight="700" fill="${underground ? '#f8fafc' : '#0f172a'}">${escapeXml(title)}</text>`, `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#64748b" stroke-width="1"/>`);
  return parts.join('');
}

export function renderCityPlan(snapshotInput, planInput, options = {}) {
  const snapshot = snapshotInput ?? {}; const plan = expandCityPlan(planInput ?? {});
  const bounds = options.bounds ?? snapshot.bounds;
  if (!bounds || finite(bounds.min_x) >= finite(bounds.max_x) || finite(bounds.min_z) >= finite(bounds.max_z)) throw new Error('Valid render bounds are required.');
  const width = finite(options.width, 1600), height = finite(options.height, 1000), margin = 32, header = 68, footer = 78, gap = 24;
  const view = options.view ?? 'surface_and_underground'; const split = view === 'surface_and_underground';
  const panelWidth = split ? (width - margin * 2 - gap) / 2 : width - margin * 2, panelHeight = height - header - footer;
  const panels = [];
  if (view === 'combined') panels.push(panelSvg({ snapshot: options.include_existing === false ? {} : snapshot, plan, mode: 'combined', title: '综合规划（地下设施以虚线表示）', x: margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  else if (view !== 'underground') panels.push(panelSvg({ snapshot: options.include_existing === false ? {} : snapshot, plan, mode: 'surface', title: '地表规划', x: margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  if (view !== 'surface' && view !== 'combined') panels.push(panelSvg({ snapshot: options.include_existing === false ? {} : snapshot, plan, mode: 'underground', title: '地下规划', x: split ? margin + panelWidth + gap : margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  const title = options.title ?? '城市综合规划图';
  const nativePreviews = (plan.grids ?? []).map(grid => grid.native_preview).filter(preview => preview?.state);
  const nativePreview = nativePreviews[0] ?? null;
  const nativeSummary = nativePreview
    ? `原生道路预检：${nativePreview.state} · 费用 ${finite(nativePreview.cost).toLocaleString('en-US')} · 警告 ${(nativePreview.warnings ?? []).length} · 错误 ${(nativePreview.errors ?? []).length + (nativePreview.error ? 1 : 0)}`
    : '规划为只读方案；施工仍需原生 preview 验证';
  const legend = [
    ['地表水体', COLORS.surface_water], ['中坡', COLORS.terrain_moderate], ['陡坡', COLORS.terrain_steep], ['道路', COLORS.road], ['火车', COLORS.train], ['地铁', COLORS.subway], ['高压/电力', COLORS.electricity], ['清水', COLORS.water], ['污水', COLORS.sewage],
    ['住宅', COLORS.residential], ['商业', COLORS.commercial], ['工业', COLORS.industrial], ['办公', COLORS.office], ['公共设施', COLORS.service]
  ].map(([label, color], index) => { const lx = margin + (index % 7) * 145, ly = height - 46 + Math.floor(index / 7) * 24; return `<g><line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="${color}" stroke-width="5"/><text x="${lx + 31}" y="${ly + 5}" font-size="13" fill="#334155">${label}</text></g>`; }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="clip-surface"><rect x="${margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath><clipPath id="clip-underground"><rect x="${split ? margin + panelWidth + gap : margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath><clipPath id="clip-combined"><rect x="${margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath></defs><rect width="100%" height="100%" fill="#ffffff"/><text x="${margin}" y="38" font-size="25" font-weight="700" fill="#0f172a">${escapeXml(title)}</text><text x="${width - margin}" y="36" text-anchor="end" font-size="12" fill="${nativePreview ? previewColor(nativePreview) : '#64748b'}">${escapeXml(nativeSummary)}</text>${panels.join('')}${legend}</svg>`;
  const planId = `cplan-${createHash('sha256').update(JSON.stringify({ bounds, plan })).digest('hex').slice(0, 16)}`;
  const validation = validateCityPlan(snapshot, { ...plan, grids: [] }, bounds);
  return {
    plan_id: planId, svg, mime_type: 'image/svg+xml', bounds,
    counts: { roads: plan.roads?.length ?? 0, buildings: plan.buildings?.length ?? 0, zones: plan.zones?.length ?? 0, tracks: plan.tracks?.length ?? 0, utilities: plan.utilities?.length ?? 0, waters: snapshot.waters?.length ?? 0, terrain_cells: snapshot.terrain?.cells?.length ?? 0 },
    validation, native_preview_summary: nativePreview ? { state: nativePreview.state, cost: nativePreview.cost ?? 0, warnings: nativePreview.warnings ?? [], errors: nativePreview.errors ?? [], error: nativePreview.error ?? null, operation_id: nativePreview.operation_id ?? null, snapped_origin: nativePreview.snapped_origin ?? null } : null, snapshot_session_id: snapshot.session_id ?? null, snapshot_truncated: snapshot.truncated === true,
    notes: 'Read-only schematic. Planned geometry has not passed native construction preview.'
  };
}
