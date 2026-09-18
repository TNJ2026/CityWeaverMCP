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

const ELEVATION_COLORS = ['#dbe8c5', '#c8d8a4', '#d8c58c', '#bd9b6a', '#92745b', '#706b67', '#d1d5db'];

const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const classToken = value => String(value ?? 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
const chineseBuildingName = value => {
  const withoutNotes = String(value ?? '').replace(/（[^）]*）|\([^)]*\)/g, '');
  const chineseOnly = (withoutNotes.match(/[\u3400-\u9fff]+/g) ?? []).join('');
  return chineseOnly.replace(/^(?:已建|规划|预留)+/, '');
};

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
  const widthMeters = Math.max(.01, finite(item.width_m, layer === 'roads' ? 8 : 4));
  const width = widthMeters * scale;
  const hitWidth = Math.max(width, 10);
  const status = planned ? 'planned' : 'existing';
  const kind = item.track_type ?? item.network_type ?? item.kind ?? layer;
  const label = item.label ?? item.name ?? item.prefab ?? item.id ?? `${status} ${kind}`;
  const nativeColor = previewColor(item.native_preview);
  const nativeClass = item.native_preview?.state ? ` native-preview-${classToken(item.native_preview.state)}` : '';
  return `<g class="${status} ${classToken(layer)} ${classToken(kind)}${nativeClass}" data-plan-object="true" data-layer="${escapeXml(layer)}" data-status="${status}" data-kind="${escapeXml(kind)}" data-object-id="${escapeXml(item.id ?? '')}" data-width-m="${widthMeters}" data-width-svg="${width.toFixed(4)}"${previewAttributes(item.native_preview)} aria-label="${escapeXml(label)}" tabindex="0"><title>${escapeXml(label)}</title><path class="line-hit-area" d="${path}" fill="none" stroke="transparent" stroke-width="${hitWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/><path class="line-geometry" d="${path}" fill="none" stroke="${nativeColor ?? color}" stroke-width="${width.toFixed(4)}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/></g>`;
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
  const widthMeters = Math.max(.01, finite(item.size_m?.x, 8));
  const heightMeters = Math.max(.01, finite(item.size_m?.z, 8));
  const width = widthMeters * scale, height = heightMeters * scale;
  const zonedKinds = new Set(['residential', 'commercial', 'industrial', 'office']);
  const isZonedBuilding = zonedKinds.has(String(item.kind ?? '').toLowerCase());
  const removalCandidate = item.recommended_action === 'remove';
  const color = removalCandidate ? '#64748b' : (isZonedBuilding ? zoneColor(item.kind) : COLORS.service); const rotation = -finite(item.rotation_degrees);
  const kindLabels = { residential: '住宅建筑', commercial: '商业建筑', industrial: '工业建筑', office: '办公建筑', service: '公共服务建筑', power: '电力设施', water: '水务设施', education: '教育设施', healthcare: '医疗设施', transport: '交通设施', building: '建筑' };
  const label = item.name ?? item.label ?? item.prefab_name ?? item.prefab ?? kindLabels[String(item.kind ?? '').toLowerCase()] ?? '建筑';
  const status = planned ? 'planned' : 'existing';
  const fill = isZonedBuilding ? color : 'none';
  const stroke = isZonedBuilding ? '#334155' : color;
  const footprintClass = isZonedBuilding ? 'zoned-footprint' : 'exact-hollow-footprint';
  return `<g class="${status} building ${classToken(item.kind)} ${footprintClass}${removalCandidate ? ' removal-candidate' : ''}" data-plan-object="true" data-layer="buildings" data-status="${status}" data-kind="${escapeXml(item.kind ?? 'building')}" data-category="${escapeXml(item.category ?? '')}" data-object-id="${escapeXml(item.id ?? '')}" data-width-m="${widthMeters}" data-depth-m="${heightMeters}"${removalCandidate ? ' data-recommended-action="remove"' : ''} aria-label="${escapeXml(label)}" tabindex="0" transform="translate(${center.x.toFixed(2)} ${center.y.toFixed(2)})"><g class="building-footprint-geometry" transform="rotate(${rotation.toFixed(2)})"><rect x="${(-width / 2).toFixed(4)}" y="${(-height / 2).toFixed(4)}" width="${width.toFixed(4)}" height="${height.toFixed(4)}" rx="${isZonedBuilding ? 1.5 : 0}" fill="${fill}" stroke="${stroke}" stroke-width=".35"/></g><title>${escapeXml(label)}</title></g>`;
}

function renderBuildingLabel(item, project) {
  const zonedKinds = new Set(['residential', 'commercial', 'industrial', 'office']);
  if (zonedKinds.has(String(item.kind ?? '').toLowerCase())) return '';
  const source = item.name ?? item.label ?? item.prefab_name ?? item.prefab;
  const visibleLabel = chineseBuildingName(source);
  if (!visibleLabel) return '';
  const center = project(item.position); const scale = center.scale;
  const width = Math.max(.01, finite(item.size_m?.x, 8)) * scale;
  const height = Math.max(.01, finite(item.size_m?.z, 8)) * scale;
  const fontSize = Math.min(3.5, height * .36, width * .88 / visibleLabel.length);
  return `<text class="building-type-label" data-label-for="${escapeXml(item.id ?? '')}" x="${center.x.toFixed(2)}" y="${center.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize.toFixed(4)}" fill="#0f172a" stroke="#ffffff" stroke-width="${Math.max(.18, fontSize * .22).toFixed(4)}" paint-order="stroke" pointer-events="none">${escapeXml(visibleLabel)}</text>`;
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

function contourInterval(range) {
  const choices = [10, 20, 50, 100, 200, 500, 1000];
  return choices.find(value => range / value <= 30) ?? 1000;
}

function contourSegments(cells, level, cellSize) {
  const keyed = new Map();
  for (const cell of cells) keyed.set(`${Math.round(cell.center.x / cellSize)},${Math.round(cell.center.z / cellSize)}`, cell);
  const interpolate = (left, right) => {
    const delta = right.elevation_m - left.elevation_m;
    const ratio = Math.abs(delta) < 1e-9 ? .5 : (level - left.elevation_m) / delta;
    return { x: left.center.x + (right.center.x - left.center.x) * ratio, z: left.center.z + (right.center.z - left.center.z) * ratio };
  };
  const crosses = (left, right) => (left.elevation_m < level && right.elevation_m >= level) || (right.elevation_m < level && left.elevation_m >= level);
  const segments = [];
  for (const [key, a] of keyed) {
    const [ix, iz] = key.split(',').map(Number);
    const b = keyed.get(`${ix + 1},${iz}`), c = keyed.get(`${ix + 1},${iz + 1}`), d = keyed.get(`${ix},${iz + 1}`);
    if (!b || !c || !d) continue;
    const intersections = [];
    for (const [left, right] of [[a, b], [b, c], [c, d], [d, a]]) if (crosses(left, right)) intersections.push(interpolate(left, right));
    if (intersections.length === 2) segments.push(intersections);
    else if (intersections.length === 4) segments.push([intersections[0], intersections[1]], [intersections[2], intersections[3]]);
  }
  return segments;
}

function renderTerrain(terrain, project) {
  const cells = terrain?.cells ?? [];
  if (!cells.length) return '';
  const elevations = cells.map(cell => finite(cell.elevation_m)).filter(Number.isFinite);
  const minimum = Math.min(...elevations), maximum = Math.max(...elevations), range = Math.max(1, maximum - minimum);
  const elevationPaths = Array.from({ length: ELEVATION_COLORS.length }, () => []);
  for (const cell of cells) {
    const normalized = Math.max(0, Math.min(.999999, (finite(cell.elevation_m) - minimum) / range));
    const band = Math.floor(normalized * ELEVATION_COLORS.length);
    const points = cell.polygon.map(point => { const p = project(point); return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`; });
    elevationPaths[band].push(`M${points.join(' L')} Z`);
  }
  const elevation = `<g class="existing terrain elevation-tint" data-plan-object="true" data-layer="terrain" data-status="existing" data-kind="elevation" data-object-id="terrain-elevation" aria-label="地形高程 ${minimum.toFixed(1)}–${maximum.toFixed(1)} 米" tabindex="0"><title>地形高程 ${minimum.toFixed(1)}–${maximum.toFixed(1)} 米</title>${elevationPaths.map((paths, index) => paths.length ? `<path d="${paths.join(' ')}" fill="${ELEVATION_COLORS[index]}" fill-opacity=".42" stroke="none"/>` : '').join('')}</g>`;
  const interval = contourInterval(range);
  const contourParts = [];
  for (let level = Math.ceil(minimum / interval) * interval; level <= maximum; level += interval) {
    const segments = contourSegments(cells, level, finite(terrain.cell_size_m, 64));
    if (!segments.length) continue;
    const path = segments.map(segment => { const a = project(segment[0]), b = project(segment[1]); return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`; }).join(' ');
    const major = Math.round(level / interval) % 5 === 0;
    contourParts.push(`<path class="contour-line${major ? ' major' : ''}" data-elevation-m="${level}" d="${path}" fill="none" stroke="#6b4f3a" stroke-opacity="${major ? '.72' : '.42'}" stroke-width="${major ? 1.15 : .55}"/>`);
  }
  const contours = `<g class="existing terrain contours" data-plan-object="true" data-layer="terrain" data-status="existing" data-kind="contours" data-object-id="terrain-contours" data-contour-interval-m="${interval}" aria-label="等高线，间距 ${interval} 米" tabindex="0"><title>等高线，间距 ${interval} 米</title>${contourParts.join('')}</g>`;
  const groups = [
    ['moderate_terrain', COLORS.terrain_moderate, '中等坡度地形'],
    ['steep_terrain', COLORS.terrain_steep, '陡坡地形'],
  ];
  const slopeOverlays = groups.map(([kind, color, label]) => {
    const matchingCells = cells.filter(cell => cell.kind === kind);
    if (!matchingCells.length) return '';
    const polygons = matchingCells.map(cell => {
      const points = cell.polygon.map(point => { const p = project(point); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
      return `<polygon points="${points}"/>`;
    }).join('');
    return `<g class="existing terrain ${kind}" data-plan-object="true" data-layer="terrain" data-status="existing" data-kind="${kind}" data-object-id="terrain-${kind}" aria-label="${label}" tabindex="0" fill="${color}" fill-opacity="${kind === 'steep_terrain' ? '.16' : '.08'}" stroke="none"><title>${label}</title>${polygons}</g>`;
  }).join('');
  return elevation + contours + slopeOverlays;
}

function panelSvg({ snapshot, plan, mode, title, x, y, width, height, bounds }) {
  const project = projector(bounds, x, y, width, height);
  const underground = mode === 'underground';
  const combined = mode === 'combined';
  const mapTiles = snapshot.map_tiles ?? snapshot.purchased_tiles ?? [];
  const tileRects = mapTiles.map((tile) => {
    const topLeft = project({ x: tile.bounds.min_x, z: tile.bounds.max_z });
    const bottomRight = project({ x: tile.bounds.max_x, z: tile.bounds.min_z });
    const owned = tile.owned !== false && (tile.owned === true || !(snapshot.map_tiles?.length));
    const fill = underground ? (owned ? '#111827' : '#0b1220') : (owned ? '#f8fafc' : '#e2e8f0');
    const label = `${owned ? '已购买' : '未购买'}地图格 ${tile.tile_id ?? ''}`.trim();
    return `<rect class="map-tile ${owned ? 'owned' : 'unowned'}" data-map-tile="true" data-owned="${owned}" aria-label="${escapeXml(label)}" x="${topLeft.x.toFixed(2)}" y="${topLeft.y.toFixed(2)}" width="${(bottomRight.x - topLeft.x).toFixed(2)}" height="${(bottomRight.y - topLeft.y).toFixed(2)}" fill="${fill}" stroke="${underground ? '#334155' : '#94a3b8'}" stroke-width=".8" stroke-opacity=".32"><title>${escapeXml(label)}</title></rect>`;
  });
  const mapFill = underground ? '#111827' : '#f8fafc';
  const parts = [`<g id="${mode}" clip-path="url(#clip-${mode})">`, `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${mapFill}"/>`];
  if (tileRects.length) parts.push(`<g class="map-tile-grid" data-layer="map_tiles">${tileRects.join('')}</g>`);
  const gridStep = 100; const firstX = Math.ceil(bounds.min_x / gridStep) * gridStep, firstZ = Math.ceil(bounds.min_z / gridStep) * gridStep;
  for (let gx = firstX; gx <= bounds.max_x; gx += gridStep) { const a = project({ x: gx, z: bounds.min_z }), b = project({ x: gx, z: bounds.max_z }); parts.push(`<path class="metric-grid-line" d="M${a.x},${a.y} L${b.x},${b.y}" stroke="${underground ? '#1f2937' : '#e2e8f0'}" stroke-width=".6" stroke-opacity=".35"/>`); }
  for (let gz = firstZ; gz <= bounds.max_z; gz += gridStep) { const a = project({ x: bounds.min_x, z: gz }), b = project({ x: bounds.max_x, z: gz }); parts.push(`<path class="metric-grid-line" d="M${a.x},${a.y} L${b.x},${b.y}" stroke="${underground ? '#1f2937' : '#e2e8f0'}" stroke-width=".6" stroke-opacity=".35"/>`); }

  if (!underground && snapshot.terrain) parts.push(renderTerrain(snapshot.terrain, project));
  if (!underground) for (const water of snapshot.waters ?? []) parts.push(renderWater(water, project));

  if (!underground) for (const zone of plan.zones ?? []) {
    const points = (zone.polygon ?? []).map(point => { const p = project(point); return `${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(' ');
    if (points) parts.push(`<polygon class="planned zone ${classToken(zone.kind)}" data-plan-object="true" data-layer="zones" data-status="planned" data-kind="${escapeXml(zone.kind ?? 'zone')}" data-object-id="${escapeXml(zone.id ?? '')}" aria-label="${escapeXml(zone.label ?? zone.kind ?? 'planned zone')}" tabindex="0" points="${points}" fill="${zoneColor(zone.kind)}" fill-opacity=".18" stroke="${zoneColor(zone.kind)}" stroke-width="1" stroke-opacity=".38" stroke-dasharray="5 4"><title>${escapeXml(zone.label ?? zone.kind ?? 'planned zone')}</title></polygon>`);
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
  if (!underground) parts.push(`<g class="building-label-layer" data-layer="building-labels">${[...(snapshot.buildings ?? []).map(item => renderBuildingLabel(item, project)), ...(plan.buildings ?? []).map(item => renderBuildingLabel(item, project))].join('')}</g>`);
  parts.push('</g>', `<text x="${x + 12}" y="${y + 24}" font-size="18" font-weight="700" fill="${underground ? '#f8fafc' : '#0f172a'}">${escapeXml(title)}</text>`, `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#64748b" stroke-width="1"/>`);
  return parts.join('');
}

export function renderCityPlan(snapshotInput, planInput, options = {}) {
  const snapshot = snapshotInput ?? {}; const plan = expandCityPlan(planInput ?? {});
  const bounds = options.bounds ?? snapshot.bounds;
  const planningBounds = options.planning_bounds ?? bounds;
  if (!bounds || finite(bounds.min_x) >= finite(bounds.max_x) || finite(bounds.min_z) >= finite(bounds.max_z)) throw new Error('Valid render bounds are required.');
  const legendEntries = [
    ['已购地图格', '#f8fafc'], ['未购地图格', '#94a3b8'], ['地表水体', COLORS.surface_water], ['高程底色', '#bd9b6a'], ['等高线', '#6b4f3a'], ['中坡', COLORS.terrain_moderate], ['陡坡', COLORS.terrain_steep], ['道路', COLORS.road], ['火车', COLORS.train], ['地铁', COLORS.subway], ['高压/电力', COLORS.electricity], ['清水', COLORS.water], ['污水', COLORS.sewage],
    ['住宅', COLORS.residential], ['商业', COLORS.commercial], ['工业', COLORS.industrial], ['办公', COLORS.office], ['公共设施', COLORS.service]
  ];
  const width = finite(options.width, 1600), height = finite(options.height, 1000), margin = 32, header = 68, gap = 24;
  const legendColumns = Math.max(3, Math.floor((width - margin * 2) / 145));
  const legendRows = Math.ceil(legendEntries.length / legendColumns);
  const footer = 30 + legendRows * 24;
  const view = options.view ?? 'surface_and_underground'; const split = view === 'surface_and_underground';
  const panelWidth = split ? (width - margin * 2 - gap) / 2 : width - margin * 2, panelHeight = height - header - footer;
  const renderedSnapshot = options.include_existing === false
    ? { ...snapshot, roads: [], buildings: [], tracks: [], utilities: [] }
    : snapshot;
  const panels = [];
  if (view === 'combined') panels.push(panelSvg({ snapshot: renderedSnapshot, plan, mode: 'combined', title: '综合规划（地下设施以虚线表示）', x: margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  else if (view !== 'underground') panels.push(panelSvg({ snapshot: renderedSnapshot, plan, mode: 'surface', title: '地表规划', x: margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  if (view !== 'surface' && view !== 'combined') panels.push(panelSvg({ snapshot: renderedSnapshot, plan, mode: 'underground', title: '地下规划', x: split ? margin + panelWidth + gap : margin, y: header, width: panelWidth, height: panelHeight, bounds }));
  const title = options.title ?? '城市综合规划图';
  const nativePreviews = (plan.grids ?? []).map(grid => grid.native_preview).filter(preview => preview?.state);
  const nativePreview = nativePreviews[0] ?? null;
  const nativeSummary = nativePreview
    ? `原生道路预检：${nativePreview.state} · 费用 ${finite(nativePreview.cost).toLocaleString('en-US')} · 警告 ${(nativePreview.warnings ?? []).length} · 错误 ${(nativePreview.errors ?? []).length + (nativePreview.error ? 1 : 0)}`
    : '规划为只读方案；施工仍需原生 preview 验证';
  const legendStartY = height - footer + 22;
  const legend = legendEntries.map(([label, color], index) => { const lx = margin + (index % legendColumns) * 145, ly = legendStartY + Math.floor(index / legendColumns) * 24; return `<g><line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="${color}" stroke-width="5"/><text x="${lx + 31}" y="${ly + 5}" font-size="13" fill="#334155">${label}</text></g>`; }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="clip-surface"><rect x="${margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath><clipPath id="clip-underground"><rect x="${split ? margin + panelWidth + gap : margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath><clipPath id="clip-combined"><rect x="${margin}" y="${header}" width="${panelWidth}" height="${panelHeight}"/></clipPath></defs><rect width="100%" height="100%" fill="#ffffff"/><text x="${margin}" y="38" font-size="25" font-weight="700" fill="#0f172a">${escapeXml(title)}</text><text x="${width - margin}" y="36" text-anchor="end" font-size="12" fill="${nativePreview ? previewColor(nativePreview) : '#64748b'}">${escapeXml(nativeSummary)}</text>${panels.join('')}${legend}</svg>`;
  const planId = `cplan-${createHash('sha256').update(JSON.stringify({ bounds: planningBounds, plan })).digest('hex').slice(0, 16)}`;
  const validation = validateCityPlan(snapshot, { ...plan, grids: [] }, planningBounds);
  return {
    plan_id: planId, svg, mime_type: 'image/svg+xml', bounds, planning_bounds: planningBounds,
    counts: { roads: plan.roads?.length ?? 0, buildings: plan.buildings?.length ?? 0, zones: plan.zones?.length ?? 0, tracks: plan.tracks?.length ?? 0, utilities: plan.utilities?.length ?? 0, waters: snapshot.waters?.length ?? 0, terrain_cells: snapshot.terrain?.cells?.length ?? 0, map_tiles: (snapshot.map_tiles ?? snapshot.purchased_tiles ?? []).length, purchased_tiles: (snapshot.map_tiles ?? snapshot.purchased_tiles ?? []).filter(tile => tile.owned !== false).length },
    coordinate_mapping: { axis: 'world_xz', aspect_ratio: '1:1', world_width_m: bounds.max_x - bounds.min_x, world_height_m: bounds.max_z - bounds.min_z },
    validation, native_preview_summary: nativePreview ? { state: nativePreview.state, cost: nativePreview.cost ?? 0, warnings: nativePreview.warnings ?? [], errors: nativePreview.errors ?? [], error: nativePreview.error ?? null, operation_id: nativePreview.operation_id ?? null, snapped_origin: nativePreview.snapped_origin ?? null } : null, snapshot_session_id: snapshot.session_id ?? null, snapshot_truncated: snapshot.truncated === true,
    notes: 'Read-only full-map schematic with equal X/Z scale. Unowned tiles are context only and remain invalid for construction. Planned geometry has not passed native construction preview.'
  };
}
