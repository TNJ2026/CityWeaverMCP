const finite = value => Number.isFinite(Number(value));
const number = value => Number(value);
const unique = values => [...new Set(values)];
const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

function roadAxis(road) {
  const points = road.points ?? [];
  if (points.length < 2 || points.some(point => !finite(point.x) || !finite(point.z))) return null;
  const sameX = points.every(point => close(number(point.x), number(points[0].x)));
  const sameZ = points.every(point => close(number(point.z), number(points[0].z)));
  if (sameX === sameZ) return null;
  return sameX ? 'x' : 'z';
}

function extent(road, axis) {
  const values = (road.points ?? []).map(point => number(point[axis]));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function spacing(values) {
  const sorted = unique(values).sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((value, index) => value - sorted[index]);
  return { sorted, gaps, uniform: gaps.length > 0 && gaps.every(gap => close(gap, gaps[0])) };
}

function addReason(reasons, code, message) {
  if (!reasons.some(reason => reason.code === code)) reasons.push({ code, message });
}

/**
 * Decide whether a group of explicit roads can be represented losslessly by one
 * native preview_road_grid call. This is intentionally conservative: a false
 * negative keeps exact road geometry, while a false positive could silently
 * change an approved plan.
 */
export function classifyNativeGrid(roadsInput, { scopeId = 'grid', maximumColumns = 5, maximumRows = 5 } = {}) {
  const roads = roadsInput ?? [];
  const reasons = [];
  const vertical = [], horizontal = [];

  for (const road of roads) {
    if (road.level && road.level !== 'surface') {
      addReason(reasons, 'NON_SURFACE_ROAD', '原生网格无法保留高架、地下或隧道道路层级。');
    }
    if ((road.points ?? []).some(point => point.y !== undefined)) {
      addReason(reasons, 'EXPLICIT_ROAD_ELEVATION', '原生网格无法保留道路控制点的显式高程。');
    }
    if ((road.points ?? []).some(point => point.node_id != null || point.edge_id != null)) {
      addReason(reasons, 'EXPLICIT_ROAD_ANCHOR', '原生网格无法保留道路控制点的既有节点或边绑定。');
    }
    const axis = roadAxis(road);
    if (!axis) {
      addReason(reasons, 'NON_AXIS_ALIGNED_ROAD', '存在非水平、非垂直或坐标无效的道路。');
      continue;
    }
    (axis === 'x' ? vertical : horizontal).push(road);
  }

  if (vertical.length < 2 || horizontal.length < 2) {
    addReason(reasons, 'INCOMPLETE_RECTANGULAR_LATTICE', '至少需要两条纵路和两条横路才能形成完整矩形网格。');
  }

  const xs = spacing(vertical.map(road => number(road.points[0].x)));
  const zs = spacing(horizontal.map(road => number(road.points[0].z)));
  if (xs.sorted.length !== vertical.length || zs.sorted.length !== horizontal.length) {
    addReason(reasons, 'SPLIT_OR_DUPLICATE_GRID_LINE', '同一网格线上存在分段或重复道路，不能无损合并为一次原生网格预览。');
  }
  if (xs.gaps.length && !xs.uniform) addReason(reasons, 'NON_UNIFORM_COLUMN_SPACING', '纵向网格线间距不一致。');
  if (zs.gaps.length && !zs.uniform) addReason(reasons, 'NON_UNIFORM_ROW_SPACING', '横向网格线间距不一致。');

  const minX = xs.sorted[0], maxX = xs.sorted.at(-1), minZ = zs.sorted[0], maxZ = zs.sorted.at(-1);
  if (finite(minZ) && finite(maxZ) && vertical.some(road => {
    const span = extent(road, 'z');
    return !close(span.min, minZ) || !close(span.max, maxZ);
  })) addReason(reasons, 'PARTIAL_OR_EXTENDED_VERTICAL_LINE', '纵路没有完整覆盖统一的网格南北边界，或包含额外延伸段。');
  if (finite(minX) && finite(maxX) && horizontal.some(road => {
    const span = extent(road, 'x');
    return !close(span.min, minX) || !close(span.max, maxX);
  })) addReason(reasons, 'PARTIAL_OR_EXTENDED_HORIZONTAL_LINE', '横路没有完整覆盖统一的网格东西边界，或包含额外延伸段。');

  const columns = Math.max(0, xs.sorted.length - 1), rows = Math.max(0, zs.sorted.length - 1);
  if (columns > maximumColumns || rows > maximumRows) {
    addReason(reasons, 'NATIVE_GRID_BATCH_LIMIT', `网格为 ${columns}×${rows}，超过单次原生 ${maximumColumns}×${maximumRows} 上限。`);
  }

  const internal = [
    ...vertical.filter(road => !close(number(road.points[0].x), minX) && !close(number(road.points[0].x), maxX)),
    ...horizontal.filter(road => !close(number(road.points[0].z), minZ) && !close(number(road.points[0].z), maxZ)),
  ];
  const internalWidths = unique(internal.map(road => number(road.width_m)).filter(finite));
  if (internalWidths.length > 1) addReason(reasons, 'INTERNAL_ROAD_WIDTH_MISMATCH', '网格内部道路实际宽度不一致。');

  const perimeter = [
    ...vertical.filter(road => close(number(road.points[0].x), minX) || close(number(road.points[0].x), maxX)),
    ...horizontal.filter(road => close(number(road.points[0].z), minZ) || close(number(road.points[0].z), maxZ)),
  ];
  const perimeterPrefabs = unique(perimeter.map(road => road.prefab).filter(Boolean));
  if (perimeterPrefabs.length > 1) addReason(reasons, 'PERIMETER_PREFAB_MISMATCH', '四条外围道路不是同一 prefab，当前原生网格工具无法无损表达。');

  const verticalPrefabs = unique(vertical.filter(road => !perimeter.includes(road)).map(road => road.prefab).filter(Boolean));
  const horizontalPrefabs = unique(horizontal.filter(road => !perimeter.includes(road)).map(road => road.prefab).filter(Boolean));
  if (verticalPrefabs.length > 1 || horizontalPrefabs.length > 1) {
    addReason(reasons, 'DIRECTION_PREFAB_MISMATCH', '同一方向的内部道路使用了多个 prefab。');
  }

  const roadPrefab = verticalPrefabs[0] ?? horizontalPrefabs[0] ?? perimeterPrefabs[0] ?? roads.find(road => road.prefab)?.prefab;
  if (!roadPrefab) addReason(reasons, 'ROAD_PREFAB_REQUIRED', '缺少精确道路 prefab。');

  return {
    scope_id: scopeId,
    eligible: reasons.length === 0,
    reason_codes: reasons.map(reason => reason.code),
    reasons,
    road_ids: roads.map(road => road.id).filter(Boolean),
    suggested_grid: reasons.length ? null : {
      id: scopeId,
      district: scopeId,
      origin: { x: minX, z: minZ },
      columns,
      rows,
      block_width_m: xs.gaps[0],
      block_height_m: zs.gaps[0],
      road_prefab: roadPrefab,
      ...(verticalPrefabs[0] ? { vertical_road_prefab: verticalPrefabs[0] } : {}),
      ...(horizontalPrefabs[0] ? { horizontal_road_prefab: horizontalPrefabs[0] } : {}),
      ...(perimeterPrefabs[0] ? { perimeter_road_prefab: perimeterPrefabs[0] } : {}),
      road_width_m: internalWidths[0] ?? number(roads[0]?.width_m ?? 8),
    },
  };
}

export function analyzePlanGridUsage(planInput) {
  const plan = planInput ?? {};
  const grouped = new Map();
  for (const road of plan.roads ?? []) {
    if (!road.district) continue;
    const list = grouped.get(road.district) ?? [];
    list.push(road);
    grouped.set(road.district, list);
  }
  const gridsByDistrict = new Map((plan.grids ?? []).filter(grid => grid.district).map(grid => [grid.district, grid]));
  const exceptionsByScope = new Map((plan.grid_exceptions ?? []).map(exception => [exception.scope_id, exception]));
  const groups = [], issues = [];
  for (const [scopeId, roads] of grouped) {
    const analysis = classifyNativeGrid(roads, { scopeId });
    groups.push(analysis);
    if (gridsByDistrict.has(scopeId)) continue;
    if (analysis.eligible) {
      issues.push({
        code: 'REGULAR_GRID_EXPANDED_AS_ROADS', severity: 'error', layer: 'roads', object_id: analysis.road_ids[0] ?? null,
        related_object_ids: analysis.road_ids.slice(1),
        message: `道路组 ${scopeId} 可由一次原生网格无损表达，必须使用 plan.grids 而不是逐路施工。`,
        suggested_grid: analysis.suggested_grid,
      });
    } else if (!exceptionsByScope.has(scopeId)) {
      issues.push({
        code: 'GRID_INELIGIBILITY_UNDECLARED', severity: 'warning', layer: 'roads', object_id: analysis.road_ids[0] ?? null,
        related_object_ids: analysis.road_ids.slice(1),
        message: `道路组 ${scopeId} 未使用 plan.grids，必须记录 grid_exceptions 说明不能无损使用网格工具的原因。`,
        reason_codes: analysis.reason_codes,
      });
    } else {
      const declared = exceptionsByScope.get(scopeId);
      const missingReasons = analysis.reason_codes.filter(code => !(declared.reason_codes ?? []).includes(code));
      const missingRoads = analysis.road_ids.filter(id => !(declared.road_ids ?? []).includes(id));
      if (missingReasons.length || missingRoads.length) issues.push({
        code: 'GRID_EXCEPTION_STALE', severity: 'warning', layer: 'roads', object_id: analysis.road_ids[0] ?? null,
        related_object_ids: analysis.road_ids.slice(1),
        message: `道路组 ${scopeId} 的 grid_exceptions 已与当前几何不一致，必须重新计算。`,
        missing_reason_codes: missingReasons,
        missing_road_ids: missingRoads,
      });
    }
  }
  return { groups, issues };
}

export function buildGridExceptions(planInput) {
  return analyzePlanGridUsage({ ...planInput, grid_exceptions: [] }).groups
    .filter(group => !group.eligible)
    .map(group => ({
      scope_id: group.scope_id,
      road_ids: group.road_ids,
      reason_codes: group.reason_codes,
      message: group.reasons.map(reason => reason.message).join('；'),
    }));
}

export function compactEligibleRoadGrids(planInput) {
  const plan = planInput ?? {};
  const analysis = analyzePlanGridUsage({ ...plan, grids: [], grid_exceptions: [] });
  const converted = [], retainedRoadIds = new Set((plan.roads ?? []).map(road => road.id));
  const grids = [...(plan.grids ?? [])];
  for (const group of analysis.groups.filter(item => item.eligible)) {
    const roads = (plan.roads ?? []).filter(road => group.road_ids.includes(road.id));
    const values = key => unique(roads.map(road => JSON.stringify(road[key] ?? null)));
    if (['construction_status', 'construction_order', 'depends_on', 'max_cost'].some(key => values(key).length > 1)) continue;
    const referenced = [
      ...(plan.roads ?? []), ...(plan.buildings ?? []), ...(plan.utilities ?? []),
    ].some(item => (item.depends_on ?? []).some(id => group.road_ids.includes(id)));
    if (referenced) continue;
    const first = roads[0] ?? {};
    grids.push({
      ...group.suggested_grid,
      construction_status: first.construction_status ?? 'planned',
      ...(first.construction_order === undefined ? {} : { construction_order: first.construction_order }),
      ...(first.depends_on === undefined ? {} : { depends_on: first.depends_on }),
      ...(first.max_cost === undefined ? {} : { max_cost: first.max_cost }),
    });
    group.road_ids.forEach(id => retainedRoadIds.delete(id));
    converted.push({ scope_id: group.scope_id, road_ids: group.road_ids, grid_id: group.suggested_grid.id });
  }
  const compacted = { ...plan, grids, roads: (plan.roads ?? []).filter(road => retainedRoadIds.has(road.id)) };
  compacted.grid_exceptions = buildGridExceptions(compacted);
  return { plan: compacted, converted };
}
