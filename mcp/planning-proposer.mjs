const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const snap = (value, step = 8) => Math.round(value / step) * step;

function pointInBounds(point, bounds) {
  return point.x >= bounds.min_x && point.x <= bounds.max_x && point.z >= bounds.min_z && point.z <= bounds.max_z;
}

function pointInOwned(point, tiles, fallbackBounds) {
  return tiles.length ? tiles.some(tile => pointInBounds(point, tile.bounds)) : pointInBounds(point, fallbackBounds);
}

function unionBounds(tiles, fallback) {
  if (!tiles.length) return fallback;
  return {
    min_x: Math.min(...tiles.map(tile => tile.bounds.min_x)), max_x: Math.max(...tiles.map(tile => tile.bounds.max_x)),
    min_z: Math.min(...tiles.map(tile => tile.bounds.min_z)), max_z: Math.max(...tiles.map(tile => tile.bounds.max_z)),
  };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function roadSamples(road) {
  if (road.points?.length) return road.points;
  if (road.curve) return ['a', 'b', 'c', 'd'].map(key => road.curve[key]).filter(Boolean);
  return [];
}

function footprintSamples(origin, width, height, step = 32) {
  const points = [];
  for (let x = 0; x <= width; x += step) {
    points.push({ x: origin.x + Math.min(x, width), z: origin.z });
    points.push({ x: origin.x + Math.min(x, width), z: origin.z + height });
  }
  for (let z = 0; z <= height; z += step) {
    points.push({ x: origin.x, z: origin.z + Math.min(z, height) });
    points.push({ x: origin.x + width, z: origin.z + Math.min(z, height) });
  }
  points.push({ x: origin.x + width / 2, z: origin.z + height / 2 });
  return points;
}

function buildingEnvelope(building) {
  const halfX = finite(building.size_m?.x, 16) / 2;
  const halfZ = finite(building.size_m?.z, 16) / 2;
  return {
    min_x: finite(building.position?.x) - halfX, max_x: finite(building.position?.x) + halfX,
    min_z: finite(building.position?.z) - halfZ, max_z: finite(building.position?.z) + halfZ,
  };
}

function rectanglesOverlap(left, right, clearance) {
  return left.min_x - clearance < right.max_x && left.max_x + clearance > right.min_x && left.min_z - clearance < right.max_z && left.max_z + clearance > right.min_z;
}

function polygonEnvelope(polygon) {
  const points = polygon ?? [];
  if (!points.length) return null;
  const xs = points.map(point => finite(point.x));
  const zs = points.map(point => finite(point.z));
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}

export function proposeGridPlan(snapshotInput, request = {}) {
  const snapshot = snapshotInput ?? {};
  const tiles = snapshot.purchased_tiles ?? [];
  const bounds = unionBounds(tiles, snapshot.bounds);
  if (!bounds) throw new Error('Purchased-tile or planning bounds are required.');

  const columns = Math.max(1, Math.floor(finite(request.columns, 2)));
  const rows = Math.max(1, Math.floor(finite(request.rows, 3)));
  const blockWidth = finite(request.block_width_m, 96);
  const blockHeight = finite(request.block_height_m, 96);
  const width = columns * blockWidth;
  const height = rows * blockHeight;
  const searchStep = finite(request.search_step_m, 32);
  const clearance = finite(request.building_clearance_m, 12);
  const roadPoints = (snapshot.roads ?? []).flatMap(roadSamples);
  const buildings = (snapshot.buildings ?? []).filter(building => building.position).map(buildingEnvelope);
  const waterAreas = (snapshot.waters ?? []).flatMap(water => water.polygons ?? (water.polygon ? [water.polygon] : [])).map(polygonEnvelope).filter(Boolean);
  const terrainCells = snapshot.terrain?.cells ?? [];
  const candidates = [];

  const startX = snap(bounds.min_x, 8);
  const endX = bounds.max_x - width;
  const startZ = snap(bounds.min_z, 8);
  const endZ = bounds.max_z - height;

  for (let x = startX; x <= endX; x += searchStep) for (let z = startZ; z <= endZ; z += searchStep) {
    const origin = { x: snap(x, 8), z: snap(z, 8) };
    const samples = footprintSamples(origin, width, height);
    if (samples.some(point => !pointInOwned(point, tiles, bounds))) continue;
    const candidateBounds = { min_x: origin.x, max_x: origin.x + width, min_z: origin.z, max_z: origin.z + height };
    const buildingConflicts = buildings.filter(building => rectanglesOverlap(candidateBounds, building, clearance)).length;
    const surfaceWaterConflicts = waterAreas.filter(water => rectanglesOverlap(candidateBounds, water, 0)).length;
    const candidateTerrain = terrainCells.filter(cell => cell.center && cell.center.x >= candidateBounds.min_x && cell.center.x <= candidateBounds.max_x && cell.center.z >= candidateBounds.min_z && cell.center.z <= candidateBounds.max_z);
    const maximumSlope = candidateTerrain.length ? Math.max(...candidateTerrain.map(cell => finite(cell.slope_degrees))) : 0;
    const elevations = candidateTerrain.map(cell => finite(cell.elevation_m));
    const terrainRelief = elevations.length ? Math.max(...elevations) - Math.min(...elevations) : 0;
    const maximumSlopeAllowed = finite(request.maximum_slope_degrees, 12);
    const steepTerrainCells = candidateTerrain.filter(cell => finite(cell.slope_degrees) > maximumSlopeAllowed).length;
    const perimeter = samples.filter(point => point.x === origin.x || point.x === origin.x + width || point.z === origin.z || point.z === origin.z + height);
    let roadDistance = 1000;
    let connectionPoint = null;
    let nearestRoadPoint = null;
    for (const point of perimeter) for (const roadPoint of roadPoints) {
      const candidateDistance = distance(point, roadPoint);
      if (candidateDistance >= roadDistance) continue;
      roadDistance = candidateDistance;
      connectionPoint = point;
      nearestRoadPoint = roadPoint;
    }
    const connectionPenalty = Math.abs(roadDistance - 40);
    const centerPenalty = distance({ x: origin.x + width / 2, z: origin.z + height / 2 }, { x: (bounds.min_x + bounds.max_x) / 2, z: (bounds.min_z + bounds.max_z) / 2 }) * 0.02;
    const score = surfaceWaterConflicts * 1e9 + buildingConflicts * 1e8 + steepTerrainCells * 1e6 + terrainRelief * 100 + connectionPenalty + centerPenalty;
    candidates.push({ origin, score, building_conflicts: buildingConflicts, surface_water_conflicts: surfaceWaterConflicts, steep_terrain_cells: steepTerrainCells, maximum_slope_degrees: Number(maximumSlope.toFixed(1)), terrain_relief_m: Number(terrainRelief.toFixed(1)), nearest_road_distance_m: Number(roadDistance.toFixed(1)), connection_point: connectionPoint, nearest_road_point: nearestRoadPoint });
  }

  candidates.sort((left, right) => left.score - right.score || left.origin.x - right.origin.x || left.origin.z - right.origin.z);
  const selected = candidates[0];
  if (!selected) throw new Error('No grid footprint fits completely inside the purchased map tiles.');

  const districtKind = request.district_kind ?? 'residential';
  const grid = {
    origin: selected.origin, columns, rows, block_width_m: blockWidth, block_height_m: blockHeight,
    road_width_m: finite(request.road_width_m, 8), zone_kind: districtKind,
    ...(request.road_prefab ? { road_prefab: request.road_prefab } : {}),
    ...(request.zone_type ? { zone_type: request.zone_type } : {}),
  };
  const missingBindings = [];
  if (!request.road_prefab) missingBindings.push('road_prefab');
  if (!request.zone_type) missingBindings.push('zone_type');

  return {
    proposal_id: `grid-${columns}x${rows}-${Math.round(selected.origin.x)}-${Math.round(selected.origin.z)}`,
    plan: { grids: [grid], roads: [], buildings: [], zones: [], tracks: [], utilities: [] },
    placement: selected,
    evaluated_candidates: candidates.length,
    bindings_ready: missingBindings.length === 0,
    missing_bindings: missingBindings,
    construction_ready: false,
    notes: 'Read-only candidate. Bind exact live prefabs, then run native preview before construction.',
  };
}
