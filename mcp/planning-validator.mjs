const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function expandForValidation(planInput) {
  const plan = planInput ?? {};
  const roads = [...(plan.roads ?? [])];
  const zones = [...(plan.zones ?? [])];
  for (const [gridIndex, grid] of (plan.grids ?? []).entries()) {
    const ox = finite(grid.origin?.x), oz = finite(grid.origin?.z);
    const columns = finite(grid.columns), rows = finite(grid.rows);
    const width = finite(grid.block_width_m || 96), height = finite(grid.block_height_m || 96);
    for (let column = 0; column <= columns; column++) roads.push({ id: `grid-${gridIndex}-v-${column}`, points: [{ x: ox + column * width, z: oz }, { x: ox + column * width, z: oz + rows * height }] });
    for (let row = 0; row <= rows; row++) roads.push({ id: `grid-${gridIndex}-h-${row}`, points: [{ x: ox, z: oz + row * height }, { x: ox + columns * width, z: oz + row * height }] });
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
