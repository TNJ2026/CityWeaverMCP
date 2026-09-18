function unionBounds(tiles, fallback) {
  if (!tiles?.length) return fallback ?? null;
  return {
    min_x: Math.min(...tiles.map(tile => tile.bounds.min_x)), min_z: Math.min(...tiles.map(tile => tile.bounds.min_z)),
    max_x: Math.max(...tiles.map(tile => tile.bounds.max_x)), max_z: Math.max(...tiles.map(tile => tile.bounds.max_z)),
  };
}

function inside(point, tiles, bounds) {
  if (!tiles?.length) return point.x >= bounds.min_x && point.x <= bounds.max_x && point.z >= bounds.min_z && point.z <= bounds.max_z;
  return tiles.some(tile => point.x >= tile.bounds.min_x && point.x <= tile.bounds.max_x && point.z >= tile.bounds.min_z && point.z <= tile.bounds.max_z);
}

export function terrainCells(samples, columns, rows, cellSize, tiles, bounds) {
  const cells = [];
  const at = (x, z) => samples[z * columns + x];
  for (let z = 0; z < rows - 1; z++) for (let x = 0; x < columns - 1; x++) {
    const corners = [at(x, z), at(x + 1, z), at(x + 1, z + 1), at(x, z + 1)];
    if (corners.some(point => !point || !Number.isFinite(Number(point.height_m)))) continue;
    const center = { x: (corners[0].x + corners[2].x) / 2, z: (corners[0].z + corners[2].z) / 2 };
    if (!inside(center, tiles, bounds)) continue;
    const heights = corners.map(point => Number(point.height_m));
    const dx = ((heights[1] + heights[2]) - (heights[0] + heights[3])) / (2 * cellSize);
    const dz = ((heights[2] + heights[3]) - (heights[0] + heights[1])) / (2 * cellSize);
    const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
    cells.push({
      id: `terrain-${x}-${z}`, center, polygon: corners.map(point => ({ x: point.x, z: point.z })),
      elevation_m: heights.reduce((sum, value) => sum + value, 0) / 4,
      relief_m: Math.max(...heights) - Math.min(...heights),
      slope_degrees: slope,
      kind: slope > 12 ? 'steep_terrain' : slope > 5 ? 'moderate_terrain' : 'gentle_terrain',
    });
  }
  return cells;
}

export async function readPurchasedTerrain(query, purchasedTiles, options = {}) {
  const bounds = unionBounds(purchasedTiles, options.bounds);
  if (!bounds) return { terrain: null, metadata: { available: false, reason: 'bounds_unavailable' } };
  const cellSize = options.cell_size_m ?? 64;
  const minX = Math.floor(bounds.min_x / cellSize) * cellSize;
  const minZ = Math.floor(bounds.min_z / cellSize) * cellSize;
  const maxX = Math.ceil(bounds.max_x / cellSize) * cellSize;
  const maxZ = Math.ceil(bounds.max_z / cellSize) * cellSize;
  const columns = Math.round((maxX - minX) / cellSize) + 1;
  const rows = Math.round((maxZ - minZ) / cellSize) + 1;
  const points = [];
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) points.push({ x: minX + x * cellSize, z: minZ + z * cellSize });
  const samples = [];
  for (let offset = 0; offset < points.length; offset += 256) {
    const page = await query('sample_terrain', { points: points.slice(offset, offset + 256) });
    samples.push(...(page.items ?? []));
  }
  const cells = terrainCells(samples, columns, rows, cellSize, purchasedTiles, bounds);
  const elevations = cells.map(cell => cell.elevation_m);
  return {
    terrain: { cell_size_m: cellSize, cells },
    metadata: {
      available: true, source: 'TerrainSystem.GetHeightData(true)', sampled_points: samples.length,
      minimum_elevation_m: elevations.length ? Math.min(...elevations) : null,
      maximum_elevation_m: elevations.length ? Math.max(...elevations) : null,
      classification: 'Slope is estimated from sampled corner heights; native preview remains authoritative.',
    },
  };
}
