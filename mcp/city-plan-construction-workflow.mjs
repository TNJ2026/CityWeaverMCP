import { queryGame as liveQueryGame, BridgeError } from './bridge-client.mjs';
import { computeCityPlanId, expandCityPlan } from './planning-renderer.mjs';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired', 'outcome_unknown']);
const COMMIT_IN_PROGRESS = new Set(['commit_queued', 'applying']);
const NON_BUILDABLE_STATUSES = new Set(['built', 'completed', 'skipped']);
const BUILDING_DOMAINS = {
  building: { list: 'list_building_prefabs', preview: 'preview_building_placement', special_preview: 'preview_special_building_placement', get: 'get_building_operation', apply: 'apply_building_operation', cancel: 'cancel_building_preview', read: 'get_building_state', read_key: 'building_id' },
  city_service: { list: 'list_city_service_prefabs', preview: 'preview_city_service_placement', get: 'get_city_service_operation', apply: 'apply_city_service_operation', cancel: 'cancel_city_service_preview', read: 'get_city_service_facility', read_key: 'facility_id' },
  transport_facility: { list: 'list_transport_facility_prefabs', preview: 'preview_transport_facility_placement', get: 'get_transport_facility_operation', apply: 'apply_transport_facility_operation', cancel: 'cancel_transport_facility_preview', read: 'get_transport_facility', read_key: 'facility_id' },
  utility_facility: { list: 'list_utility_facility_prefabs', preview: 'preview_utility_facility_placement', get: 'get_utility_facility_operation', apply: 'apply_utility_facility_operation', cancel: 'cancel_utility_facility_preview', read: 'get_utility_facility', read_key: 'facility_id' },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionIdOf = envelope => envelope?.meta?.session_id || envelope?.data?.session_id || null;
const speedOf = status => status?.paused || status?.selected_speed === 0 ? 'paused'
  : status?.selected_speed === 4 ? 'fastest' : status?.selected_speed === 2 ? 'fast' : 'normal';
const textOf = value => typeof value === 'string' ? value : value?.message ?? value?.code ?? JSON.stringify(value);
const requestIdFor = (planId, roadId, suffix) => `${planId.replace('cplan-', 'cp_')}_${String(roadId).replace(/[^A-Za-z0-9_-]+/g, '_')}_${suffix}`.slice(0, 100);

function workflowError(code, message, details = {}) {
  const error = new BridgeError(code, message);
  Object.assign(error, details);
  return error;
}

function distance(a, b) { return Math.hypot(Number(b.x) - Number(a.x), Number(b.z) - Number(a.z)); }

function validateGridSeparation(grids = []) {
  const boxes = grids.map((grid, index) => ({
    id: grid.id ?? `grid-${index}`,
    min_x: Number(grid.origin.x), min_z: Number(grid.origin.z),
    max_x: Number(grid.origin.x) + Number(grid.columns) * Number(grid.block_width_m),
    max_z: Number(grid.origin.z) + Number(grid.rows) * Number(grid.block_height_m),
  }));
  for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++) {
    const a = boxes[left], b = boxes[right];
    const overlapX = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x);
    const overlapZ = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z);
    const sharedVerticalBoundary = Math.abs(overlapX) < 1e-6 && overlapZ > 0;
    const sharedHorizontalBoundary = Math.abs(overlapZ) < 1e-6 && overlapX > 0;
    if ((overlapX > 0 && overlapZ > 0) || sharedVerticalBoundary || sharedHorizontalBoundary) {
      throw workflowError('PLAN_GRID_OVERLAP', `Grids ${a.id} and ${b.id} overlap or generate the same perimeter road. Separate them with a collector corridor or represent the shared skeleton in plan.roads.`, { grid_ids: [a.id, b.id] });
    }
  }
}

function curvePoint(curve, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * Number(curve.a.x) + 3 * u ** 2 * t * Number(curve.b.x) + 3 * u * t ** 2 * Number(curve.c.x) + t ** 3 * Number(curve.d.x),
    z: u ** 3 * Number(curve.a.z) + 3 * u ** 2 * t * Number(curve.b.z) + 3 * u * t ** 2 * Number(curve.c.z) + t ** 3 * Number(curve.d.z),
  };
}

function pointSegmentDistance(point, start, end) {
  const dx = Number(end.x) - Number(start.x), dz = Number(end.z) - Number(start.z);
  const denominator = dx * dx + dz * dz;
  const ratio = denominator ? Math.max(0, Math.min(1, ((Number(point.x) - Number(start.x)) * dx + (Number(point.z) - Number(start.z)) * dz) / denominator)) : 0;
  return Math.hypot(Number(point.x) - (Number(start.x) + ratio * dx), Number(point.z) - (Number(start.z) + ratio * dz));
}

function pointCurveDistance(point, curve) {
  let minimum = Infinity, previous = curvePoint(curve, 0);
  for (let index = 1; index <= 32; index++) {
    const current = curvePoint(curve, index / 32);
    minimum = Math.min(minimum, pointSegmentDistance(point, previous, current));
    previous = current;
  }
  return minimum;
}

function interpolatePoint(a, b, ratio) {
  const result = {
    x: Number(a.x) + (Number(b.x) - Number(a.x)) * ratio,
    z: Number(a.z) + (Number(b.z) - Number(a.z)) * ratio,
  };
  if (a.elevation_m !== undefined || b.elevation_m !== undefined) {
    const start = Number(a.elevation_m ?? 0), end = Number(b.elevation_m ?? start);
    result.elevation_m = start + (end - start) * ratio;
  }
  return result;
}

// Keep generated native courses below the advertised 256 m hard limit. The
// live game can reject an exact 256 m course after endpoint snapping and
// float conversion, so 240 m leaves one 16 m zoning-cell of safety margin.
export function subdividePlannedRoad(points, maximumSegmentLength = 240) {
  if (!Array.isArray(points) || points.length < 2) throw workflowError('INVALID_PLAN_ROAD', 'A planned road requires at least two points.');
  const output = [{ ...points[0] }];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const length = distance(start, end);
    if (length < 16) throw workflowError('PLAN_SEGMENT_TOO_SHORT', `Planned road segment ${index - 1} is ${length.toFixed(2)}m; native roads require at least 16m.`);
    const pieces = Math.ceil(length / maximumSegmentLength);
    for (let piece = 1; piece < pieces; piece++) output.push(interpolatePoint(start, end, piece / pieces));
    output.push({ ...end });
  }
  return output;
}

export function chunkNativeRoute(points, maximumPoints = 16) {
  const chunks = [];
  for (let start = 0; start < points.length - 1; start += maximumPoints - 1) {
    chunks.push(points.slice(start, Math.min(points.length, start + maximumPoints)));
  }
  return chunks;
}

export function subdividePlannedNetwork(points, maximumSegmentLength = 240, minimumSegmentLength = 8) {
  if (!Array.isArray(points) || points.length < 2) throw workflowError('INVALID_PLAN_NETWORK', 'A planned network requires at least two points.');
  const output = [{ ...points[0] }];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1], end = points[index];
    const length = distance(start, end);
    if (length < minimumSegmentLength) throw workflowError('PLAN_SEGMENT_TOO_SHORT', `Planned network segment ${index - 1} is ${length.toFixed(2)}m; native utility networks require at least ${minimumSegmentLength}m.`);
    const pieces = Math.ceil(length / maximumSegmentLength);
    for (let piece = 1; piece < pieces; piece++) output.push(interpolatePoint(start, end, piece / pieces));
    output.push({ ...end });
  }
  return output;
}

const pointKey = point => `${Number(point.x).toFixed(3)}:${Number(point.z).toFixed(3)}`;
const aligned8 = value => Math.abs(Number(value) / 8 - Math.round(Number(value) / 8)) < 1e-6;

export function analyzeVirtualRoadNetwork(bounds, roads, batches) {
  const errors = [], warnings = [], endpointDegrees = new Map(), adjacency = new Map();
  const roadByEndpoint = new Map();
  for (const road of roads) adjacency.set(road.road_id, new Set());
  for (const road of roads) {
    const halfWidth = Number(road.width_m ?? 0) / 2;
    for (const point of road.source_points) {
      if (point.x - halfWidth < bounds.min_x || point.x + halfWidth > bounds.max_x || point.z - halfWidth < bounds.min_z || point.z + halfWidth > bounds.max_z) {
        errors.push({ code: 'ROAD_OUTSIDE_PLAN_BOUNDS', road_id: road.road_id, point: { x: point.x, z: point.z } });
      }
    }
    const unaligned = road.source_points.filter(point => !aligned8(point.x) || !aligned8(point.z));
    if (unaligned.length) warnings.push({ code: 'ROAD_NOT_ALIGNED_TO_8M_GRID', road_id: road.road_id, point_count: unaligned.length });
    const endpoints = [road.source_points[0], road.source_points.at(-1)];
    for (const endpoint of endpoints) {
      const key = pointKey(endpoint);
      endpointDegrees.set(key, (endpointDegrees.get(key) ?? 0) + 1);
      const attached = roadByEndpoint.get(key) ?? [];
      for (const other of attached) { adjacency.get(road.road_id).add(other); adjacency.get(other).add(road.road_id); }
      attached.push(road.road_id); roadByEndpoint.set(key, attached);
    }
  }
  let components = 0; const visited = new Set();
  for (const road of roads) if (!visited.has(road.road_id)) {
    components++; const stack = [road.road_id]; visited.add(road.road_id);
    while (stack.length) for (const next of adjacency.get(stack.pop()) ?? []) if (!visited.has(next)) { visited.add(next); stack.push(next); }
  }
  return {
    state: errors.length ? 'invalid' : 'valid', errors, warnings,
    metrics: {
      road_object_count: roads.length,
      native_batch_count: batches.length,
      connected_components_by_shared_endpoints: components,
      shared_endpoint_count: [...endpointDegrees.values()].filter(value => value > 1).length,
      maximum_endpoint_degree: Math.max(0, ...endpointDegrees.values()),
      eight_metre_alignment_warning_count: warnings.filter(item => item.code === 'ROAD_NOT_ALIGNED_TO_8M_GRID').length,
    },
    note: 'Virtual validation checks structured geometry only. Native preview at final coordinates remains mandatory for terrain, collision, clearance, snapping and cost.',
  };
}

function orderRoads(roads, knownPlanIds = new Set(roads.map(road => road.id).filter(Boolean))) {
  const byId = new Map();
  roads.forEach((road, index) => {
    if (!road.id) throw workflowError('PLAN_ROAD_ID_REQUIRED', `Planned road at index ${index} has no stable id.`);
    if (byId.has(road.id)) throw workflowError('DUPLICATE_PLAN_OBJECT_ID', `Planned road id ${road.id} is duplicated.`);
    byId.set(road.id, { ...road, _index: index });
  });
  for (const road of byId.values()) for (const dependency of road.depends_on ?? []) {
    if (!knownPlanIds.has(dependency)) throw workflowError('PLAN_DEPENDENCY_NOT_FOUND', `Road ${road.id} depends on missing plan object ${dependency}.`);
    if (dependency === road.id) throw workflowError('PLAN_DEPENDENCY_CYCLE', `Road ${road.id} cannot depend on itself.`);
  }
  const result = [], visiting = new Set(), visited = new Set();
  const sorted = [...byId.values()].sort((a, b) => Number(a.construction_order ?? a._index) - Number(b.construction_order ?? b._index) || a._index - b._index);
  const visit = road => {
    if (visited.has(road.id)) return;
    if (visiting.has(road.id)) throw workflowError('PLAN_DEPENDENCY_CYCLE', `A road dependency cycle includes ${road.id}.`);
    visiting.add(road.id);
    for (const dependency of road.depends_on ?? []) if (byId.has(dependency)) visit(byId.get(dependency));
    visiting.delete(road.id); visited.add(road.id); result.push(road);
  };
  sorted.forEach(visit);
  return result.map(({ _index, ...road }) => road);
}

function orderConstructionBatches(batches, knownPlanIds) {
  const batchById = new Map(batches.map(batch => [batch.batch_id, batch]));
  const batchesByObject = new Map();
  for (const batch of batches) for (const objectId of batch.object_ids) {
    const list = batchesByObject.get(objectId) ?? [];
    list.push(batch); batchesByObject.set(objectId, list);
  }
  for (const list of batchesByObject.values()) list.sort((a, b) => Number(a.construction_order ?? 0) - Number(b.construction_order ?? 0) || String(a.batch_id).localeCompare(String(b.batch_id)));
  const dependenciesOf = batch => {
    const result = new Set();
    for (const dependency of batch.depends_on ?? []) {
      if (!knownPlanIds.has(dependency)) throw workflowError('PLAN_DEPENDENCY_NOT_FOUND', `Batch ${batch.batch_id} depends on missing plan object ${dependency}.`);
      const dependencyBatches = batchesByObject.get(dependency) ?? [];
      if (dependencyBatches.length) result.add(dependencyBatches.at(-1).batch_id);
    }
    const siblings = batchesByObject.get(batch.object_ids[0]) ?? [];
    const ownIndex = siblings.findIndex(item => item.batch_id === batch.batch_id);
    if (ownIndex > 0) result.add(siblings[ownIndex - 1].batch_id);
    result.delete(batch.batch_id);
    return [...result];
  };
  const result = [], visiting = new Set(), visited = new Set();
  const sorted = [...batches].sort((a, b) => Number(a.construction_order ?? 0) - Number(b.construction_order ?? 0) || String(a.batch_id).localeCompare(String(b.batch_id)));
  const visit = batch => {
    if (visited.has(batch.batch_id)) return;
    if (visiting.has(batch.batch_id)) throw workflowError('PLAN_DEPENDENCY_CYCLE', `A construction dependency cycle includes ${batch.batch_id}.`);
    visiting.add(batch.batch_id);
    for (const dependencyId of dependenciesOf(batch)) visit(batchById.get(dependencyId));
    visiting.delete(batch.batch_id); visited.add(batch.batch_id); result.push(batch);
  };
  sorted.forEach(visit);
  return result;
}

export function compileCityPlanRoads(bounds, plan, approvedPlanId) {
  const planId = computeCityPlanId(bounds, plan);
  if (approvedPlanId && approvedPlanId !== planId) {
    throw workflowError('PLAN_APPROVAL_MISMATCH', `Approved plan ${approvedPlanId} does not match current structured plan ${planId}. Re-render and approve the changed plan before construction.`, { approved_plan_id: approvedPlanId, actual_plan_id: planId });
  }
  validateGridSeparation(plan?.grids ?? []);
  const expanded = expandCityPlan(plan ?? {});
  const knownPlanIds = new Set([
    ...(expanded.roads ?? []).map(item => item.id),
    ...(expanded.buildings ?? []).map(item => item.id),
    ...(expanded.utilities ?? []).map(item => item.id),
  ].filter(Boolean));
  const orderedRoads = orderRoads(expanded.roads ?? [], knownPlanIds);
  const skippedRoads = orderedRoads.filter(road => NON_BUILDABLE_STATUSES.has(road.construction_status));
  const roads = orderedRoads.filter(road => !NON_BUILDABLE_STATUSES.has(road.construction_status)).map((road, index) => {
    if (!road.prefab) throw workflowError('PLAN_ROAD_PREFAB_REQUIRED', `Planned road ${road.id} has no exact prefab binding.`);
    if (road.level && road.level !== 'surface') throw workflowError('UNSUPPORTED_PLAN_ROAD_LEVEL', `Planned road ${road.id} uses ${road.level}; the first construction version supports surface roads only.`);
    const nativePoints = subdividePlannedRoad(road.points);
    return {
      sequence: index + 1,
      road_id: road.id,
      label: road.label ?? road.id,
      road_prefab: road.prefab,
      width_m: road.width_m ?? 8,
      source_points: road.points,
      native_points: nativePoints,
      depends_on: road.depends_on ?? [],
      max_cost: road.max_cost ?? null,
      native_tool: nativePoints.length === 2 ? 'preview_road' : 'preview_road_route',
    };
  });
  const roadById = new Map(roads.map(road => [road.road_id, road]));
  const gridDefinitions = new Map();
  for (const [index, grid] of (plan?.grids ?? []).entries()) {
    const gridId = grid.id ?? `grid-${index}`;
    const objectIds = [
      ...Array.from({ length: Number(grid.columns) + 1 }, (_, column) => `${gridId}-v-${column}`),
      ...Array.from({ length: Number(grid.rows) + 1 }, (_, row) => `${gridId}-h-${row}`),
    ];
    gridDefinitions.set(gridId, { grid, objectIds });
  }
  const gridRoadToId = new Map();
  for (const [gridId, definition] of gridDefinitions) for (const objectId of definition.objectIds) gridRoadToId.set(objectId, gridId);
  const emittedGrids = new Set(), batches = [];
  for (const ordered of orderedRoads) {
    if (NON_BUILDABLE_STATUSES.has(ordered.construction_status)) continue;
    const gridId = gridRoadToId.get(ordered.id);
    if (gridId) {
      if (emittedGrids.has(gridId)) continue;
      emittedGrids.add(gridId);
      const { grid, objectIds } = gridDefinitions.get(gridId);
      if (Number(grid.columns) > 5 || Number(grid.rows) > 5) throw workflowError('PLAN_GRID_TOO_LARGE_FOR_NATIVE_BATCH', `Grid ${gridId} is ${grid.columns}x${grid.rows}; native atomic grid preview supports at most 5x5.`);
      if (!grid.road_prefab) throw workflowError('PLAN_ROAD_PREFAB_REQUIRED', `Grid ${gridId} has no exact default road prefab.`);
      const width = Number(grid.columns) * Number(grid.block_width_m), height = Number(grid.rows) * Number(grid.block_height_m);
      batches.push({
        batch_id: gridId, batch_type: 'grid', object_ids: objectIds, label: grid.label ?? gridId,
        native_tool: 'preview_road_grid', prefab_names: [...new Set([grid.road_prefab, grid.horizontal_road_prefab, grid.vertical_road_prefab, grid.perimeter_road_prefab, grid.connection_road_prefab].filter(Boolean))],
        native_args: {
          road_prefab: grid.road_prefab, origin: grid.origin, columns: grid.columns, rows: grid.rows,
          block_width_m: grid.block_width_m, block_height_m: grid.block_height_m,
          ...(grid.horizontal_road_prefab ? { horizontal_road_prefab: grid.horizontal_road_prefab } : {}),
          ...(grid.vertical_road_prefab ? { vertical_road_prefab: grid.vertical_road_prefab } : {}),
          ...(grid.perimeter_road_prefab ? { perimeter_road_prefab: grid.perimeter_road_prefab } : {}),
          ...(grid.auto_connect !== undefined ? { auto_connect: grid.auto_connect } : {}),
          ...(grid.connection_sides ? { connection_sides: grid.connection_sides } : {}),
          ...(grid.connection_search_radius_m ? { connection_search_radius_m: grid.connection_search_radius_m } : {}),
          ...(grid.connection_road_prefab ? { connection_road_prefab: grid.connection_road_prefab } : {}),
          ...(grid.minimum_connections ? { minimum_connections: grid.minimum_connections } : {}),
          ...(grid.maximum_connections ? { maximum_connections: grid.maximum_connections } : {}),
        },
        geometry_points: [grid.origin, { x: Number(grid.origin.x) + width, z: grid.origin.z }, { x: Number(grid.origin.x) + width, z: Number(grid.origin.z) + height }, { x: grid.origin.x, z: Number(grid.origin.z) + height }],
        max_cost: grid.max_cost ?? null, depends_on: grid.depends_on ?? [], construction_order: grid.construction_order,
      });
      continue;
    }
    const road = roadById.get(ordered.id);
    if (!road) continue;
    const chunks = chunkNativeRoute(road.native_points);
    chunks.forEach((points, partIndex) => batches.push({
      batch_id: chunks.length === 1 ? road.road_id : `${road.road_id}-part-${partIndex + 1}`,
      batch_type: 'route', object_ids: [road.road_id], label: chunks.length === 1 ? road.label : `${road.label} (${partIndex + 1}/${chunks.length})`,
      native_tool: points.length === 2 ? 'preview_road' : 'preview_road_route', prefab_names: [road.road_prefab],
      native_args: points.length === 2 ? { road_prefab: road.road_prefab, start: points[0], end: points[1] } : { road_prefab: road.road_prefab, points },
      geometry_points: points, max_cost: road.max_cost, depends_on: road.depends_on ?? [], construction_order: ordered.construction_order,
    }));
  }
  const skippedBuildings = (expanded.buildings ?? []).filter(item => NON_BUILDABLE_STATUSES.has(item.construction_status));
  for (const [index, building] of (expanded.buildings ?? []).entries()) {
    if (NON_BUILDABLE_STATUSES.has(building.construction_status)) continue;
    if (!building.prefab) throw workflowError('PLAN_BUILDING_PREFAB_REQUIRED', `Planned building ${building.id} has no exact prefab binding.`);
    if (building.placement_status === 'failed' || building.planning_status === 'preview_failed') throw workflowError('PLAN_BUILDING_PREVIEW_FAILED', `Planned building ${building.id} has a failed native placement preview and cannot be compiled for construction.`);
    if (!Number.isFinite(building.rotation_degrees) || building.rotation_source === 'unresolved') throw workflowError('PLAN_BUILDING_ROTATION_REQUIRED', `Planned building ${building.id} has no resolved rotation. Run bind_city_plan_buildings or provide an explicitly verified angle before construction.`);
    batches.push({
      batch_id: building.id, batch_type: 'building', object_ids: [building.id], label: building.label ?? building.name ?? building.id,
      prefab_names: [building.prefab], building_prefab: building.prefab, building_category: building.category ?? 'auto',
      native_args: {
        building_prefab: building.prefab,
        position: { x: Number(building.position.x), ...(building.position.y === undefined ? {} : { y: Number(building.position.y) }), z: Number(building.position.z) },
        rotation_degrees: Number(building.rotation_degrees),
        ...(building.road_edge_id ?? building.position.edge_id ? { road_edge_id: building.road_edge_id ?? building.position.edge_id } : {}),
        ...(building.snap_target_id ?? building.position.node_id ? { snap_target_id: building.snap_target_id ?? building.position.node_id } : {}),
      },
      geometry_points: [building.position], size_m: building.size_m, road_edge_id: building.road_edge_id ?? building.position.edge_id ?? null,
      placement_status: building.placement_status ?? null, rotation_source: building.rotation_source ?? 'manual',
      max_cost: building.max_cost ?? null, depends_on: building.depends_on ?? [],
      construction_order: building.construction_order ?? 100000 + index,
    });
  }
  const skippedUtilities = (expanded.utilities ?? []).filter(item => NON_BUILDABLE_STATUSES.has(item.construction_status));
  for (const [index, utility] of (expanded.utilities ?? []).entries()) {
    if (NON_BUILDABLE_STATUSES.has(utility.construction_status)) continue;
    if (!utility.prefab) throw workflowError('PLAN_UTILITY_PREFAB_REQUIRED', `Planned utility ${utility.id} has no exact prefab binding.`);
    const nativePoints = subdividePlannedNetwork(utility.points);
    const chunks = chunkNativeRoute(nativePoints);
    chunks.forEach((points, partIndex) => batches.push({
      batch_id: chunks.length === 1 ? utility.id : `${utility.id}-part-${partIndex + 1}`,
      batch_type: 'utility', object_ids: [utility.id], label: chunks.length === 1 ? (utility.label ?? utility.id) : `${utility.label ?? utility.id} (${partIndex + 1}/${chunks.length})`,
      prefab_names: [utility.prefab], utility_prefab: utility.prefab, network_type: utility.network_type, level: utility.level,
      native_args: { utility_prefab: utility.prefab, points }, geometry_points: points,
      max_cost: utility.max_cost ?? null, depends_on: utility.depends_on ?? [], construction_order: utility.construction_order ?? 200000 + index,
    }));
  }
  const orderedBatches = orderConstructionBatches(batches, knownPlanIds);
  orderedBatches.forEach((batch, index) => { batch.sequence = index + 1; });
  const roadBatches = orderedBatches.filter(batch => ['grid', 'route'].includes(batch.batch_type));
  const sandbox = analyzeVirtualRoadNetwork(bounds, roads, roadBatches);
  return {
    plan_id: planId, roads, batches: orderedBatches, virtual_sandbox: sandbox,
    skipped_roads: skippedRoads.map(road => ({ road_id: road.id, construction_status: road.construction_status })),
    skipped_buildings: skippedBuildings.map(item => ({ building_id: item.id, construction_status: item.construction_status })),
    skipped_utilities: skippedUtilities.map(item => ({ utility_id: item.id, construction_status: item.construction_status })),
  };
}

function operationSummary(operation) {
  return {
    operation_id: operation?.operation_id ?? null,
    state: operation?.state ?? 'unknown',
    cost: Number(operation?.cost ?? 0),
    warnings: (operation?.warnings ?? []).map(textOf),
    errors: (operation?.errors ?? []).map(textOf),
    error: operation?.error ? textOf(operation.error) : null,
    created_road_ids: operation?.created_road_ids ?? [],
    created_utility_edge_ids: operation?.created_utility_edge_ids ?? [],
    result_entity_ids: operation?.result_entity_ids ?? [],
  };
}

export function createCityPlanConstructionWorkflow(queryGame = liveQueryGame) {
  let mutationTail = Promise.resolve();
  const buildingBindingCache = new Map();
  const exclusive = async fn => {
    const previous = mutationTail;
    let release;
    mutationTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };

  const checkSession = (expected, envelope) => {
    const actual = sessionIdOf(envelope);
    if (expected && actual && expected !== actual) throw workflowError('CITY_SESSION_CHANGED', 'The loaded city session changed; re-render and approve a fresh plan.');
  };

  async function waitFor(getTool, operationId, target, timeoutMs, sessionId) {
    const started = Date.now(); let delay = 50; let operation;
    while (Date.now() - started < timeoutMs) {
      const envelope = await queryGame(getTool, { operation_id: operationId });
      checkSession(sessionId, envelope); operation = envelope.data ?? {};
      if (operation.state === target || TERMINAL_FAILURES.has(operation.state)) return operation;
      await sleep(delay); delay = Math.min(500, Math.round(delay * 1.7));
    }
    throw workflowError('WORKFLOW_TIMEOUT', `Operation ${operationId} did not reach ${target} within the bounded wait.`, { operation_id: operationId, last_state: operation?.state });
  }

  async function resolveBuildingBinding(batch, sessionId) {
    const cacheKey = `${sessionId}:${batch.building_category}:${batch.building_prefab}`;
    if (buildingBindingCache.has(cacheKey)) return buildingBindingCache.get(cacheKey);
    const categories = batch.building_category === 'auto' ? Object.keys(BUILDING_DOMAINS) : [batch.building_category];
    const found = [];
    for (const category of categories) {
      const config = BUILDING_DOMAINS[category];
      const input = category === 'building'
        ? { search: batch.building_prefab, kind: 'building', unlocked_only: true, offset: 0, limit: 100 }
        : { search: batch.building_prefab, kind: 'all', unlocked_only: true, offset: 0, limit: 100 };
      const response = await queryGame(config.list, input); checkSession(sessionId, response);
      const prefab = response.data?.items?.find(item => item.name === batch.building_prefab);
      if (prefab) found.push({ category, config, prefab });
    }
    const specialized = found.filter(item => item.category !== 'building');
    if (specialized.length > 1) throw workflowError('AMBIGUOUS_BUILDING_CATEGORY', `Prefab ${batch.building_prefab} appears in multiple specialized categories; set plan.buildings[].category explicitly.`);
    const binding = specialized[0] ?? found[0];
    if (!binding) throw workflowError('BUILDING_PREFAB_NOT_FOUND', `No exact unlocked building prefab named ${batch.building_prefab} was found.`);
    const placement = String(binding.prefab.placement_flags ?? binding.prefab.placement_mode ?? '');
    const result = {
      ...binding,
      special: binding.category === 'building' && /Shoreline|Floating|RoadEdge|RoadNode|shoreline|floating|road_edge|road_node/.test(placement),
      requires_road_edge: /RoadSide/i.test(placement),
    };
    buildingBindingCache.set(cacheKey, result);
    return result;
  }

  async function resolveBatchRuntime(batch, sessionId, validatePrefab = true) {
    if (batch.batch_type === 'building') {
      if (!validatePrefab && batch.building_category !== 'auto') {
        const config = BUILDING_DOMAINS[batch.building_category];
        return { get: config.get, apply: config.apply, cancel: config.cancel, read: config.read, read_key: config.read_key, preview: config.preview, binding: { category: batch.building_category } };
      }
      const binding = await resolveBuildingBinding(batch, sessionId);
      return { get: binding.config.get, apply: binding.config.apply, cancel: binding.config.cancel, read: binding.config.read, read_key: binding.config.read_key, preview: binding.special ? binding.config.special_preview : binding.config.preview, binding };
    }
    if (batch.batch_type === 'utility') {
      if (!validatePrefab) return { preview: 'preview_utility_network', get: 'get_utility_operation', apply: 'apply_utility_operation', cancel: 'cancel_utility_preview', read: 'get_utility_network', read_key: 'utility_edge_id', binding: null };
      const response = await queryGame('list_utility_network_prefabs', { search: batch.utility_prefab, network_type: 'all', unlocked_only: true, include_markers: false });
      checkSession(sessionId, response);
      const prefab = response.data?.items?.find(item => item.name === batch.utility_prefab);
      if (!prefab) throw workflowError('UTILITY_PREFAB_NOT_FOUND', `No exact unlocked utility prefab named ${batch.utility_prefab} was found.`);
      if (prefab.network_type !== batch.network_type) throw workflowError('UTILITY_NETWORK_TYPE_MISMATCH', `Utility prefab ${batch.utility_prefab} is ${prefab.network_type}, not planned ${batch.network_type}.`);
      return { preview: 'preview_utility_network', get: 'get_utility_operation', apply: 'apply_utility_operation', cancel: 'cancel_utility_preview', read: 'get_utility_network', read_key: 'utility_edge_id', binding: { prefab } };
    }
    if (!validatePrefab) return { preview: batch.native_tool, get: 'get_road_operation', apply: 'build_road', cancel: 'cancel_road_preview', read: null, binding: null };
    for (const prefabName of batch.prefab_names) {
      const response = await queryGame('list_road_prefabs', { search: prefabName, offset: 0, limit: 100 }); checkSession(sessionId, response);
      const prefab = response.data?.items?.find(item => item.name === prefabName);
      if (!prefab) throw workflowError('ROAD_PREFAB_NOT_FOUND', `No exact live road prefab named ${prefabName} was found.`);
      if (prefab.locked) throw workflowError('ROAD_PREFAB_LOCKED', `Road prefab ${prefabName} is locked in the loaded city.`);
    }
    return { preview: batch.native_tool, get: 'get_road_operation', apply: 'build_road', cancel: 'cancel_road_preview', read: null, binding: null };
  }

  async function inspect(args) {
    const statusEnvelope = await queryGame('get_game_status', {});
    const status = statusEnvelope.data ?? {};
    if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
    const sessionId = sessionIdOf(statusEnvelope);
    const compiled = compileCityPlanRoads(args.bounds, args.plan, args.approved_plan_id);
    const bindingByBatch = [];
    for (const batch of compiled.batches) {
      const runtime = await resolveBatchRuntime(batch, sessionId);
      bindingByBatch.push({ batch_id: batch.batch_id, batch_type: batch.batch_type, prefab: batch.building_prefab ?? batch.utility_prefab ?? batch.prefab_names?.[0], category: runtime.binding?.category ?? null, found: true, locked: false });
    }
    const bindings = bindingByBatch.filter(item => ['grid', 'route'].includes(item.batch_type));
    return {
      workflow: 'prepare_city_plan_construction',
      state: args.approved_plan_id ? 'approved_ready_for_native_preview' : 'awaiting_user_confirmation',
      plan_id: compiled.plan_id,
      approved_plan_id: args.approved_plan_id ?? null,
      city: status.city_name,
      session_id: sessionId,
      permanent_changes: false,
      construction_ready: Boolean(args.approved_plan_id) && compiled.batches.length > 0 && compiled.virtual_sandbox.state === 'valid',
      road_bindings: bindings,
      prefab_bindings: bindingByBatch,
      road_count: compiled.roads.length,
      building_batch_count: compiled.batches.filter(batch => batch.batch_type === 'building').length,
      utility_batch_count: compiled.batches.filter(batch => batch.batch_type === 'utility').length,
      native_batch_count: compiled.batches.length,
      skipped_road_count: compiled.skipped_roads.length,
      skipped_roads: compiled.skipped_roads,
      skipped_buildings: compiled.skipped_buildings,
      skipped_utilities: compiled.skipped_utilities,
      virtual_sandbox: compiled.virtual_sandbox,
      execution_order: compiled.batches,
      next_action: args.approved_plan_id && compiled.batches.length && compiled.virtual_sandbox.state === 'valid' ? {
        tool: 'advance_city_plan_construction',
        arguments: { action: 'preview_batch', bounds: args.bounds, plan: args.plan, batch_id: compiled.batches[0].batch_id, approved_plan_id: compiled.plan_id, expected_session_id: sessionId, request_id: requestIdFor(compiled.plan_id, compiled.batches[0].batch_id, 'preview') },
      } : null,
    };
  }

  async function previewBatch(args, status, sessionId, compiled, batch) {
    const runtime = await resolveBatchRuntime(batch, sessionId);
    const nativeArgs = structuredClone(batch.native_args);
    if (batch.batch_type === 'building' && runtime.binding?.requires_road_edge && !nativeArgs.road_edge_id) {
      throw workflowError('PLAN_BUILDING_ROAD_BINDING_REQUIRED', `Planned building ${batch.batch_id} requires a precise road_edge_id. Run bind_city_plan_buildings and approve the updated plan before construction.`);
    }
    if (batch.batch_type === 'utility') {
      const range = runtime.binding.prefab.elevation_range_m ?? {};
      const preferred = ['underground', 'tunnel'].includes(batch.level) ? -10 : 0;
      const minimum = Number.isFinite(Number(range.min)) ? Number(range.min) : -50;
      const maximum = Number.isFinite(Number(range.max)) ? Number(range.max) : 50;
      nativeArgs.points = nativeArgs.points.map(point => {
        if (point.node_id || point.edge_id || point.elevation_m !== undefined) return point;
        return { ...point, elevation_m: Math.max(minimum, Math.min(maximum, preferred)) };
      });
    }
    const anchorPoints = ['grid', 'route'].includes(batch.batch_type) ? (nativeArgs.points ?? [nativeArgs.start, nativeArgs.end].filter(Boolean)) : [];
    const networkAnchors = anchorPoints.filter(point => point?.edge_id || point?.node_id);
    const anchorRebindings = [];
    if (networkAnchors.length) {
      const xs = batch.geometry_points.map(point => Number(point.x)), zs = batch.geometry_points.map(point => Number(point.z));
      const snapshot = await queryGame('get_planning_map_snapshot', {
        bounds: { min_x: Math.max(-7168, Math.min(...xs) - 16), min_z: Math.max(-7168, Math.min(...zs) - 16), max_x: Math.min(7168, Math.max(...xs) + 16), max_z: Math.min(7168, Math.max(...zs) + 16) },
        include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false, max_features_per_layer: 5000,
      });
      checkSession(sessionId, snapshot);
      const roads = snapshot.data?.roads ?? [];
      for (const point of networkAnchors) {
        if (point.edge_id && roads.some(road => (road.id ?? road.edge_id) === point.edge_id)) continue;
        const candidate = roads
          .filter(road => road.curve)
          .map(road => ({ road, distance: pointCurveDistance(point, road.curve) }))
          .filter(item => item.distance <= 2)
          .sort((a, b) => a.distance - b.distance || String(a.road.id ?? a.road.edge_id).localeCompare(String(b.road.id ?? b.road.edge_id)))[0];
        if (!candidate) throw workflowError('ROAD_ANCHOR_NOT_FOUND', `No permanent road exists within 2m of the approved anchor at (${point.x}, ${point.z}). Re-render and approve a corrected plan.`);
        const previousEdgeId = point.edge_id ?? null;
        const previousNodeId = point.node_id ?? null;
        delete point.node_id;
        point.edge_id = candidate.road.id ?? candidate.road.edge_id;
        anchorRebindings.push({ x: point.x, z: point.z, previous_edge_id: previousEdgeId, previous_node_id: previousNodeId, current_edge_id: point.edge_id, distance_m: candidate.distance });
      }
    }
    if (!status.paused) await queryGame('set_simulation_speed', { speed: 'paused' });
    const queued = await queryGame(runtime.preview, { request_id: args.request_id, ...nativeArgs });
    checkSession(sessionId, queued);
    const operation = queued.data?.state === 'preview_ready' || TERMINAL_FAILURES.has(queued.data?.state)
      ? queued.data : await waitFor(runtime.get, queued.data?.operation_id, 'preview_ready', args.operation_timeout_ms, sessionId);
    const ready = operation.state === 'preview_ready';
    return {
      workflow: 'advance_city_plan_construction', action: 'preview_batch', plan_id: compiled.plan_id,
      batch_id: batch.batch_id, batch_type: batch.batch_type, object_ids: batch.object_ids, sequence: batch.sequence, state: operation.state, success: ready,
      permanent_changes: false, native_preview: operationSummary(operation), recovery_required: operation.state === 'outcome_unknown',
      anchor_rebindings: anchorRebindings,
      simulation: { before_speed: speedOf(status), current_speed: 'paused' },
      cancel_action: ready ? { tool: runtime.cancel, arguments: { operation_id: operation.operation_id } } : null,
      next_action: ready ? { tool: 'advance_city_plan_construction', arguments: { action: 'commit_batch', bounds: args.bounds, plan: args.plan, batch_id: batch.batch_id, approved_plan_id: compiled.plan_id, expected_session_id: sessionId, request_id: requestIdFor(compiled.plan_id, batch.batch_id, 'commit'), operation_id: operation.operation_id, max_cost: Number(operation.cost ?? 0) } } : null,
    };
  }

  async function readBackRoads(args, batch, createdIds, sessionId) {
    const xs = batch.geometry_points.map(point => Number(point.x)), zs = batch.geometry_points.map(point => Number(point.z));
    const padding = 32 + Number(batch.native_args.connection_search_radius_m ?? 0);
    const bounds = {
      min_x: Math.max(-7168, Math.min(...xs) - padding), min_z: Math.max(-7168, Math.min(...zs) - padding),
      max_x: Math.min(7168, Math.max(...xs) + padding), max_z: Math.min(7168, Math.max(...zs) + padding),
    };
    const snapshot = await queryGame('get_planning_map_snapshot', { bounds, include_roads: true, include_buildings: false, include_tracks: false, include_utilities: false, max_features_per_layer: 5000 });
    checkSession(sessionId, snapshot);
    const present = new Set((snapshot.data?.roads ?? []).map(item => item.id ?? item.edge_id));
    const missing = createdIds.filter(id => !present.has(id));
    return { bounds, created_road_ids: createdIds, verified_road_ids: createdIds.filter(id => present.has(id)), missing_road_ids: missing, verified: createdIds.length > 0 && missing.length === 0, snapshot_truncated: Boolean(snapshot.data?.truncated) };
  }

  async function readBackBatch(args, batch, operation, runtime, sessionId) {
    if (['grid', 'route'].includes(batch.batch_type)) return readBackRoads(args, batch, operation.created_road_ids ?? [], sessionId);
    const ids = batch.batch_type === 'utility' ? (operation.created_utility_edge_ids ?? []) : (operation.result_entity_ids ?? []);
    if (batch.batch_type === 'building') {
      const expected = batch.geometry_points[0];
      const padding = Math.max(32, Number(batch.size_m?.x ?? 8), Number(batch.size_m?.z ?? 8));
      const snapshot = await queryGame('get_planning_map_snapshot', {
        bounds: { min_x: expected.x - padding, min_z: expected.z - padding, max_x: expected.x + padding, max_z: expected.z + padding },
        include_roads: true, include_buildings: true, include_tracks: false, include_utilities: false, max_features_per_layer: 5000,
      });
      checkSession(sessionId, snapshot);
      const byId = new Map((snapshot.data?.buildings ?? []).map(item => [item.id, item]));
      const objects = ids.map(id => byId.get(id)).filter(Boolean);
      const missing = ids.filter(id => !byId.has(id));
      const geometry_mismatches = objects.map(item => ({
        building_id: item.id,
        position_error_m: distance(expected, item.position),
        rotation_error_degrees: Math.abs((((Number(item.rotation_degrees ?? 0) - Number(batch.native_args.rotation_degrees ?? 0)) + 540) % 360) - 180),
      })).filter(item => item.position_error_m > 2 || item.rotation_error_degrees > 2);
      const roadIds = new Set((snapshot.data?.roads ?? []).map(item => item.id ?? item.edge_id));
      const road_binding_mismatches = batch.road_edge_id ? objects.filter(item => item.road_edge_id !== batch.road_edge_id).map(item => ({
        building_id: item.id, expected_road_edge_id: batch.road_edge_id, actual_road_edge_id: item.road_edge_id ?? null,
      })) : [];
      const expectedRoadMissing = batch.road_edge_id ? !roadIds.has(batch.road_edge_id) : false;
      return {
        building_ids: ids, verified_ids: ids.filter(id => byId.has(id)), missing_ids: missing, objects, geometry_mismatches,
        expected_road_edge_id: batch.road_edge_id, expected_road_present: batch.road_edge_id ? !expectedRoadMissing : null,
        road_binding_mismatches,
        road_binding_verified: batch.road_edge_id ? !expectedRoadMissing && road_binding_mismatches.length === 0 : null,
        verified: ids.length > 0 && missing.length === 0 && geometry_mismatches.length === 0 && !expectedRoadMissing && road_binding_mismatches.length === 0,
        snapshot_truncated: Boolean(snapshot.data?.truncated),
      };
    }
    const verified = [], missing = [], objects = [];
    for (const id of ids) {
      try {
        const response = await queryGame(runtime.read, { [runtime.read_key]: id }); checkSession(sessionId, response);
        verified.push(id); objects.push(response.data);
      } catch { missing.push(id); }
    }
    const key = batch.batch_type === 'utility' ? 'utility_edge_ids' : 'building_ids';
    return { [key]: ids, verified_ids: verified, missing_ids: missing, objects, verified: ids.length > 0 && missing.length === 0 };
  }

  async function commitBatch(args, status, sessionId, compiled, batch) {
    const runtime = await resolveBatchRuntime(batch, sessionId, false);
    const envelope = await queryGame(runtime.get, { operation_id: args.operation_id });
    checkSession(sessionId, envelope); let operation = envelope.data ?? {};
    if (COMMIT_IN_PROGRESS.has(operation.state)) operation = await waitFor(runtime.get, args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
    else if (operation.state === 'preview_ready') {
      const quotedCost = Number(operation.cost ?? 0);
      const authorized = Math.min(Number(args.max_cost), batch.max_cost ?? Number(args.max_cost));
      if (quotedCost > authorized) throw workflowError('BUDGET_EXCEEDED', `Preview cost ${quotedCost} exceeds the authorized limit ${authorized}.`);
      const committed = await queryGame(runtime.apply, { operation_id: args.operation_id, request_id: args.request_id, max_cost: authorized });
      checkSession(sessionId, committed);
      operation = committed.data?.state === 'completed' || TERMINAL_FAILURES.has(committed.data?.state)
        ? committed.data : await waitFor(runtime.get, args.operation_id, 'completed', args.operation_timeout_ms, sessionId);
    }
    if (operation.state !== 'completed') return {
      workflow: 'advance_city_plan_construction', action: 'commit_batch', plan_id: compiled.plan_id,
      batch_id: batch.batch_id, object_ids: batch.object_ids, state: operation.state ?? 'unknown', success: false,
      permanent_changes: operation.state === 'outcome_unknown' ? null : false,
      native_operation: operationSummary(operation), recovery_required: operation.state === 'outcome_unknown',
      simulation: { before_speed: speedOf(status), current_speed: 'paused', kept_paused_for_recovery: operation.state === 'outcome_unknown' }, next_action: null,
    };
    const readback = await readBackBatch(args, batch, operation, runtime, sessionId);
    const nextBatch = compiled.batches.find(item => item.sequence === batch.sequence + 1) ?? null;
    return {
      workflow: 'advance_city_plan_construction', action: 'commit_batch', plan_id: compiled.plan_id,
      batch_id: batch.batch_id, batch_type: batch.batch_type, object_ids: batch.object_ids, sequence: batch.sequence, state: readback.verified ? 'completed_verified' : 'completed_readback_incomplete',
      success: readback.verified, permanent_changes: true, native_operation: operationSummary(operation), permanent_readback: readback,
      recovery_required: !readback.verified,
      simulation: { before_speed: speedOf(status), current_speed: 'paused', kept_paused_for_recovery: !readback.verified },
      next_action: readback.verified && nextBatch ? { tool: 'advance_city_plan_construction', arguments: { action: 'preview_batch', bounds: args.bounds, plan: args.plan, batch_id: nextBatch.batch_id, approved_plan_id: compiled.plan_id, expected_session_id: sessionId, request_id: requestIdFor(compiled.plan_id, nextBatch.batch_id, 'preview') } } : null,
      plan_complete: readback.verified && !nextBatch,
    };
  }

  async function advance(args) {
    return exclusive(async () => {
      const statusEnvelope = await queryGame('get_game_status', {});
      const status = statusEnvelope.data ?? {};
      if (!status.city_loaded) throw workflowError('CITY_NOT_READY', 'No playable city is loaded.');
      const sessionId = sessionIdOf(statusEnvelope); checkSession(args.expected_session_id, statusEnvelope);
      const compiled = compileCityPlanRoads(args.bounds, args.plan, args.approved_plan_id);
      if (compiled.virtual_sandbox.state !== 'valid') throw workflowError('VIRTUAL_PLAN_INVALID', 'The virtual road sandbox found blocking geometry errors. Re-render and approve a corrected plan.', { errors: compiled.virtual_sandbox.errors });
      const batch = args.batch_id
        ? compiled.batches.find(item => item.batch_id === args.batch_id)
        : compiled.batches.find(item => item.object_ids.includes(args.road_id));
      if (!batch) throw workflowError('PLAN_BATCH_NOT_FOUND', `The requested construction batch is not present in approved plan ${compiled.plan_id}.`);
      if (args.action === 'preview_batch' || args.action === 'preview_road') return previewBatch(args, status, sessionId, compiled, batch);
      if (!args.operation_id || args.max_cost === undefined) throw workflowError('INVALID_WORKFLOW_INPUT', 'commit_batch requires operation_id and max_cost from the native preview result.');
      if (!status.paused) await queryGame('set_simulation_speed', { speed: 'paused' });
      return commitBatch(args, status, sessionId, compiled, batch);
    });
  }

  return { inspect, advance };
}

const liveWorkflow = createCityPlanConstructionWorkflow();
export const prepareCityPlanConstruction = args => liveWorkflow.inspect(args);
export const advanceCityPlanConstruction = args => liveWorkflow.advance(args);
