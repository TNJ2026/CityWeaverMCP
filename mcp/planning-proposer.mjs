import { contentHash } from './planning-store.mjs';
import { BoundedCache } from './bounded-cache.mjs';
const derivedCache = new BoundedCache(32 * 1024 * 1024, 8);
export const inspectPlanningDerivedCache = () => derivedCache.inspect();
import { createSpatialIndex, footprintBounds, sampleRoad, nearestPointPair } from './planning-spatial.mjs';
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
  return footprintBounds({ ...building, size_m: building.size_m ?? { x: 16, z: 16 } });
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

function snapshotIndexes(snapshot) {
  const layers = { roads: snapshot.roads ?? [], buildings: snapshot.buildings ?? [], waters: snapshot.waters ?? [], terrain: snapshot.terrain ?? null };
  const key = contentHash(layers);
  const cached = derivedCache.get(key);
  if (cached) return cached;
  snapshot = structuredClone(layers);
  const roadPoints = (snapshot.roads ?? []).flatMap(road => sampleRoad(road));
  const buildings = (snapshot.buildings ?? []).filter(building => building.position).map(buildingEnvelope).filter(Boolean);
  const waterAreas = (snapshot.waters ?? []).flatMap(water => water.polygons ?? (water.polygon ? [water.polygon] : [])).map(polygonEnvelope).filter(Boolean);
  const terrainCells = snapshot.terrain?.cells ?? [];
  const buildingIndex = createSpatialIndex(buildings, b => b);
  const waterIndex = createSpatialIndex(waterAreas, b => b);
  const pointBounds = p => ({ min_x: p.x, max_x: p.x, min_z: p.z, max_z: p.z });
  const terrainIndex = createSpatialIndex(terrainCells.filter(c => c.center), c => pointBounds(c.center));
  const roadIndex = createSpatialIndex(roadPoints, pointBounds);
  const result = { roadPoints, buildings, waterAreas, terrainCells, buildingIndex, waterIndex, terrainIndex, roadIndex };
  derivedCache.set(key, result, Buffer.byteLength(JSON.stringify(layers)) * 16);
  return result;
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
  const searchStep = Math.max(8, finite(request.search_step_m, 32));
  const clearance = finite(request.building_clearance_m, 12);
  const { roadPoints, buildings, waterAreas, terrainCells, buildingIndex, waterIndex, terrainIndex, roadIndex } = snapshotIndexes(snapshot);
  const candidates = [];
  const regionSeeds = new Map();
  const visited = new Set();
  let evaluated = 0;
  const compare = (a, b) => a.score - b.score || a.origin.x - b.origin.x || a.origin.z - b.origin.z;

  const startX = snap(bounds.min_x, 8);
  const endX = bounds.max_x - width;
  const startZ = snap(bounds.min_z, 8);
  const endZ = bounds.max_z - height;

  const evaluate = (x, z) => {
    if (x < startX || x > endX || z < startZ || z > endZ) return;
    const key = `${snap(x, 8)},${snap(z, 8)}`;
    if (visited.has(key)) return;
    visited.add(key);
    const origin = { x: snap(x, 8), z: snap(z, 8) };
    const samples = footprintSamples(origin, width, height);
    if (samples.some(point => !pointInOwned(point, tiles, bounds))) return;
    const candidateBounds = { min_x: origin.x, max_x: origin.x + width, min_z: origin.z, max_z: origin.z + height };
    const buildingConflicts = buildingIndex.query({ min_x: candidateBounds.min_x - clearance, max_x: candidateBounds.max_x + clearance, min_z: candidateBounds.min_z - clearance, max_z: candidateBounds.max_z + clearance }).filter(building => rectanglesOverlap(candidateBounds, building, clearance)).length;
    const surfaceWaterConflicts = waterIndex.query(candidateBounds).filter(water => rectanglesOverlap(candidateBounds, water, 0)).length;
    let terrainCount = 0, terrainKnown = true, maximumSlope = -Infinity;
    let minimumElevation = Infinity, maximumElevation = -Infinity, steepTerrainCells = 0;
    const maximumSlopeAllowed = finite(request.maximum_slope_degrees, 12);
    for (const cell of terrainIndex.query(candidateBounds)) {
      if (!cell.center || !pointInBounds(cell.center, candidateBounds)) continue;
      terrainCount++;
      terrainKnown &&= Number.isFinite(cell.slope_degrees) && Number.isFinite(cell.elevation_m);
      const slope = finite(cell.slope_degrees), elevation = finite(cell.elevation_m);
      maximumSlope = Math.max(maximumSlope, slope);
      minimumElevation = Math.min(minimumElevation, elevation);
      maximumElevation = Math.max(maximumElevation, elevation);
      if (slope > maximumSlopeAllowed) steepTerrainCells++;
    }
    terrainKnown &&= terrainCount > 0;
    if (!terrainCount) maximumSlope = 0;
    const terrainRelief = terrainCount ? maximumElevation - minimumElevation : 0;
    const perimeter = samples.filter(point => point.x === origin.x || point.x === origin.x + width || point.z === origin.z || point.z === origin.z + height);
    const nearbyRoadPoints = roadIndex.query({ min_x: candidateBounds.min_x - 1000, max_x: candidateBounds.max_x + 1000,
      min_z: candidateBounds.min_z - 1000, max_z: candidateBounds.max_z + 1000 });
    const { distance: roadDistance, source: connectionPoint, target: nearestRoadPoint } = nearestPointPair(perimeter, nearbyRoadPoints, 1000);
    const connectionPenalty = Math.abs(roadDistance - 40);
    const centerPenalty = distance({ x: origin.x + width / 2, z: origin.z + height / 2 }, { x: (bounds.min_x + bounds.max_x) / 2, z: (bounds.min_z + bounds.max_z) / 2 }) * 0.02;
    const score = surfaceWaterConflicts * 1e9 + buildingConflicts * 1e8 + steepTerrainCells * 1e6 + terrainRelief * 100 + (terrainKnown ? 0 : 1e7) + connectionPenalty + centerPenalty;
    const candidate = { origin, score, terrain_known: terrainKnown, building_conflicts: buildingConflicts, surface_water_conflicts: surfaceWaterConflicts, steep_terrain_cells: steepTerrainCells, maximum_slope_degrees: Number(maximumSlope.toFixed(1)), terrain_relief_m: Number(terrainRelief.toFixed(1)), nearest_road_distance_m: Number(roadDistance.toFixed(1)), connection_point: connectionPoint, nearest_road_point: nearestRoadPoint };
    if (!terrainKnown) { candidate.maximum_slope_degrees = null; candidate.terrain_relief_m = null; }
    candidates.push(candidate);
    const region = `${Math.floor((origin.x-startX)/Math.max(searchStep,(endX-startX+searchStep)/4))},${Math.floor((origin.z-startZ)/Math.max(searchStep,(endZ-startZ+searchStep)/4))}`;
    if (!regionSeeds.has(region) || compare(candidate, regionSeeds.get(region)) < 0) regionSeeds.set(region,candidate);
    evaluated++;
    candidates.sort(compare);
    if (candidates.length > 8) candidates.length = 8;
  };
  const coarseStep = ((endX-startX)/searchStep + 1) * ((endZ-startZ)/searchStep + 1) > 4096 ? searchStep * 4 : searchStep;
  for (let x = startX; x <= endX; x += coarseStep) for (let z = startZ; z <= endZ; z += coarseStep) evaluate(x, z);
  if (coarseStep > searchStep) {
    const seeds = [...regionSeeds.values()].sort(compare);
    if (!seeds.length) {
      for (let x = startX; x <= endX; x += searchStep) for (let z = startZ; z <= endZ; z += searchStep) evaluate(x, z);
    } else for (const seed of seeds) {
      for (let x = seed.origin.x-coarseStep; x <= seed.origin.x+coarseStep; x += searchStep)
        for (let z = seed.origin.z-coarseStep; z <= seed.origin.z+coarseStep; z += searchStep) evaluate(x, z);
    }
  }
  const clearCandidate = c => c.building_conflicts === 0 && c.surface_water_conflicts === 0 && c.steep_terrain_cells === 0;
  let fallbackFineSearch = false;
  if (coarseStep > searchStep && !candidates.some(clearCandidate)) {
    fallbackFineSearch = true;
    for (let x = startX; x <= endX; x += searchStep) for (let z = startZ; z <= endZ; z += searchStep) evaluate(x,z);
  }
  candidates.sort(compare);
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
    evaluated_candidates: evaluated,
    fallback_fine_search: fallbackFineSearch,
    search_strategy: coarseStep > searchStep ? 'coarse_to_fine' : 'indexed_grid',
    bindings_ready: missingBindings.length === 0,
    missing_bindings: missingBindings,
    construction_ready: false,
    notes: 'Read-only candidate. Bind exact live prefabs, then run native preview before construction.',
  };
}
