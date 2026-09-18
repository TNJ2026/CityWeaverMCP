const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function expandForValidation(planInput) {
  const plan = planInput ?? {};
  const roads = [...(plan.roads ?? [])];
  const zones = [...(plan.zones ?? [])];
  for (const [gridIndex, grid] of (plan.grids ?? []).entries()) {
    const ox = finite(grid.origin?.x), oz = finite(grid.origin?.z);
    const columns = finite(grid.columns), rows = finite(grid.rows);
    const width = finite(grid.block_width_m || 96), height = finite(grid.block_height_m || 96);
    for (let column = 0; column <= columns; column++) roads.push({ id: `grid-${gridIndex}-v-${column}`, width_m: grid.road_width_m ?? 8, points: [{ x: ox + column * width, z: oz }, { x: ox + column * width, z: oz + rows * height }] });
    for (let row = 0; row <= rows; row++) roads.push({ id: `grid-${gridIndex}-h-${row}`, width_m: grid.road_width_m ?? 8, points: [{ x: ox, z: oz + row * height }, { x: ox + columns * width, z: oz + row * height }] });
    if (grid.zone_type || grid.zone_kind) for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) zones.push({
      id: `grid-${gridIndex}-zone-${column}-${row}`,
      polygon: [
        { x: ox + column * width, z: oz + row * height }, { x: ox + (column + 1) * width, z: oz + row * height },
        { x: ox + (column + 1) * width, z: oz + (row + 1) * height }, { x: ox + column * width, z: oz + (row + 1) * height },
      ],
    });
  }
  const withIds = (items, prefix) => items.map((item, index) => ({ ...item, id: item.id ?? `${prefix}-${index}` }));
  return {
    roads: withIds(roads, 'road'), buildings: withIds(plan.buildings ?? [], 'building'), zones: withIds(zones, 'zone'),
    tracks: withIds(plan.tracks ?? [], 'track'), utilities: withIds(plan.utilities ?? [], 'utility'),
  };
}

function pointInBounds(point, bounds) {
  return finite(point?.x) >= bounds.min_x && finite(point?.x) <= bounds.max_x && finite(point?.z) >= bounds.min_z && finite(point?.z) <= bounds.max_z;
}

function buildingCorners(building) {
  const x = finite(building.position?.x), z = finite(building.position?.z);
  const halfX = Math.max(0.5, finite(building.size_m?.x || 8) / 2);
  const halfZ = Math.max(0.5, finite(building.size_m?.z || 8) / 2);
  const angle = finite(building.rotation_degrees) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]].map(([dx, dz]) => ({ x: x + dx * cos - dz * sin, z: z + dx * sin + dz * cos }));
}

function envelope(points) {
  const xs = points.map(point => finite(point.x));
  const zs = points.map(point => finite(point.z));
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}

function overlaps(left, right) {
  return left.min_x < right.max_x && left.max_x > right.min_x && left.min_z < right.max_z && left.max_z > right.min_z;
}

function roadCrossesBuilding(road, building) {
  const centerX = finite(building.position?.x), centerZ = finite(building.position?.z);
  const angle = -finite(building.rotation_degrees) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const halfRoad = Math.max(0, finite(road.width_m || 8)) / 2;
  const halfX = Math.max(0.5, finite(building.size_m?.x || 8) / 2) + halfRoad;
  const halfZ = Math.max(0.5, finite(building.size_m?.z || 8) / 2) + halfRoad;
  const local = point => {
    const dx = finite(point?.x) - centerX, dz = finite(point?.z) - centerZ;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  };
  const segmentHits = (start, end) => {
    let minimum = 0, maximum = 1;
    for (const [origin, delta, extent] of [[start.x, end.x - start.x, halfX], [start.z, end.z - start.z, halfZ]]) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < -extent || origin > extent) return false;
        continue;
      }
      let near = (-extent - origin) / delta, far = (extent - origin) / delta;
      if (near > far) [near, far] = [far, near];
      minimum = Math.max(minimum, near); maximum = Math.min(maximum, far);
      if (minimum > maximum) return false;
    }
    return true;
  };
  const points = road.points ?? [];
  for (let index = 1; index < points.length; index++) if (segmentHits(local(points[index - 1]), local(points[index]))) return true;
  return false;
}

function pointSegmentDistance(point, start, end) {
  const dx = finite(end?.x) - finite(start?.x), dz = finite(end?.z) - finite(start?.z);
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return Math.hypot(finite(point?.x) - finite(start?.x), finite(point?.z) - finite(start?.z));
  const t = Math.max(0, Math.min(1, ((finite(point?.x) - finite(start?.x)) * dx + (finite(point?.z) - finite(start?.z)) * dz) / lengthSquared));
  return Math.hypot(finite(point?.x) - (finite(start?.x) + t * dx), finite(point?.z) - (finite(start?.z) + t * dz));
}

function utilityGeometryCoverage(planned, existingUtilities, tolerance = 4) {
  const candidates = existingUtilities.filter(existing => {
    if (String(existing.network_type ?? '') !== String(planned.network_type ?? '')) return false;
    return !planned.prefab || !existing.prefab || String(existing.prefab) === String(planned.prefab);
  });
  const segments = candidates.flatMap(item => (item.points ?? []).slice(1).map((point, index) => [item.points[index], point]));
  let samples = 0, matched = 0;
  for (let index = 1; index < (planned.points ?? []).length; index++) {
    const start = planned.points[index - 1], end = planned.points[index];
    const length = Math.hypot(finite(end?.x) - finite(start?.x), finite(end?.z) - finite(start?.z));
    const steps = Math.max(1, Math.ceil(length / 8));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const point = { x: finite(start?.x) + (finite(end?.x) - finite(start?.x)) * t, z: finite(start?.z) + (finite(end?.z) - finite(start?.z)) * t };
      samples++;
      if (segments.some(([left, right]) => pointSegmentDistance(point, left, right) <= tolerance)) matched++;
    }
  }
  return samples ? matched / samples : 0;
}

export function validateCityPlan(snapshotInput, planInput, boundsInput) {
  const snapshot = snapshotInput ?? {};
  const bounds = boundsInput ?? snapshot.bounds;
  const plan = expandForValidation(planInput);
  const ownedBounds = (snapshot.purchased_tiles ?? []).map(tile => tile.bounds).filter(Boolean);
  const allowed = point => ownedBounds.length ? ownedBounds.some(tile => pointInBounds(point, tile)) : pointInBounds(point, bounds);
  const issues = [];

  const checkPoints = (items, layer, field) => {
    for (const item of items) {
      const points = item[field] ?? [];
      if (points.some(point => !allowed(point))) issues.push({
        code: 'OUTSIDE_PURCHASED_AREA', severity: 'error', layer, object_id: item.id,
        message: '规划对象有部分几何超出当前已购区域。',
      });
    }
  };

  checkPoints(plan.roads, 'roads', 'points');
  checkPoints(plan.zones, 'zones', 'polygon');
  checkPoints(plan.tracks, 'tracks', 'points');
  checkPoints(plan.utilities, 'utilities', 'points');

  const buildingBoxes = plan.buildings.map(building => ({ building, corners: buildingCorners(building) }));
  for (const { building, corners } of buildingBoxes) if (corners.some(point => !allowed(point))) issues.push({
    code: 'OUTSIDE_PURCHASED_AREA', severity: 'error', layer: 'buildings', object_id: building.id,
    message: '规划建筑占地超出当前已购区域。',
  });

  for (let left = 0; left < buildingBoxes.length; left++) for (let right = left + 1; right < buildingBoxes.length; right++) {
    if (!overlaps(envelope(buildingBoxes[left].corners), envelope(buildingBoxes[right].corners))) continue;
    issues.push({
      code: 'PLANNED_BUILDING_OVERLAP', severity: 'warning', layer: 'buildings', object_id: buildingBoxes[left].building.id,
      related_object_ids: [buildingBoxes[right].building.id], message: '规划建筑占地与另一栋规划建筑重叠。',
    });
    issues.push({
      code: 'PLANNED_BUILDING_OVERLAP', severity: 'warning', layer: 'buildings', object_id: buildingBoxes[right].building.id,
      related_object_ids: [buildingBoxes[left].building.id], message: '规划建筑占地与另一栋规划建筑重叠。',
    });
  }

  for (const { building } of buildingBoxes) for (const road of plan.roads) {
    if (!roadCrossesBuilding(road, building)) continue;
    issues.push({
      code: 'PLANNED_BUILDING_ROAD_OVERLAP', severity: 'warning', layer: 'buildings', object_id: building.id,
      related_object_ids: [road.id], message: '规划建筑占地（含道路宽度净空）与规划道路相交。',
    });
  }

  const existingUtilities = snapshot.utilities ?? [];
  for (const utility of plan.utilities) {
    const claimsBuilt = utility.construction_status === 'built' || /^已建[｜|]/.test(String(utility.label ?? ''));
    if (!claimsBuilt) continue;
    const coverage = utilityGeometryCoverage(utility, existingUtilities);
    if (coverage >= .98) continue;
    issues.push({
      code: 'BUILT_UTILITY_GEOMETRY_MISMATCH', severity: 'warning', layer: 'utilities', object_id: utility.id,
      message: `施工图标记为已建，但当前永久管网仅匹配 ${(coverage * 100).toFixed(0)}% 的规划路径。`,
      geometry_coverage: coverage,
    });
  }

  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  const warningCount = issues.filter(issue => issue.severity === 'warning').length;
  return {
    valid: errorCount === 0,
    issue_count: issues.length,
    error_count: errorCount,
    warning_count: warningCount,
    issues,
    notes: 'Geometry checks are advisory and do not replace native game preview.',
  };
}
