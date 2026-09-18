const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const pointKey = point => `${point.x.toFixed(4)},${point.z.toFixed(4)}`;

function unionBounds(tiles, fallback) {
  if (!tiles?.length) return fallback ?? null;
  return {
    min_x: Math.min(...tiles.map(tile => tile.bounds.min_x)),
    min_z: Math.min(...tiles.map(tile => tile.bounds.min_z)),
    max_x: Math.max(...tiles.map(tile => tile.bounds.max_x)),
    max_z: Math.max(...tiles.map(tile => tile.bounds.max_z)),
  };
}

function insidePurchased(cell, tiles, bounds) {
  if (!tiles?.length) return cell.x >= bounds.min_x && cell.x <= bounds.max_x && cell.z >= bounds.min_z && cell.z <= bounds.max_z;
  return tiles.some(tile => cell.x >= tile.bounds.min_x && cell.x <= tile.bounds.max_x && cell.z >= tile.bounds.min_z && cell.z <= tile.bounds.max_z);
}

function interpolate(a, b, threshold) {
  const denominator = b.depth - a.depth;
  const ratio = Math.abs(denominator) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (threshold - a.depth) / denominator));
  return { x: a.x + (b.x - a.x) * ratio, z: a.z + (b.z - a.z) * ratio };
}

function contourSegments(cells, cellSize, threshold) {
  if (!cells.length) return [];
  const samples = new Map();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const cell of cells) {
    const gx = Number(cell.grid_x), gz = Number(cell.grid_z);
    const depth = Math.max(0, finite(cell.water_depth_m) ?? (cell.water ? threshold * 2 : 0));
    samples.set(`${gx},${gz}`, { x: Number(cell.x), z: Number(cell.z), depth });
    minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
    minZ = Math.min(minZ, gz); maxZ = Math.max(maxZ, gz);
  }
  const origin = samples.get(`${minX},${minZ}`);
  const sample = (gx, gz) => samples.get(`${gx},${gz}`) ?? {
    x: gx < minX ? origin.x - cellSize / 2 : gx > maxX ? origin.x + (maxX - minX + 0.5) * cellSize : origin.x + (gx - minX) * cellSize,
    z: gz < minZ ? origin.z - cellSize / 2 : gz > maxZ ? origin.z + (maxZ - minZ + 0.5) * cellSize : origin.z + (gz - minZ) * cellSize,
    depth: 0,
  };
  const cases = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
    6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[2, 0]],
    11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
  };
  const segments = [];
  for (let gz = minZ - 1; gz <= maxZ; gz++) {
    for (let gx = minX - 1; gx <= maxX; gx++) {
      const corners = [sample(gx, gz), sample(gx + 1, gz), sample(gx + 1, gz + 1), sample(gx, gz + 1)];
      const mask = corners.reduce((value, corner, index) => value | (corner.depth >= threshold ? 1 << index : 0), 0);
      if (mask === 0 || mask === 15) continue;
      const edgePoints = [
        interpolate(corners[0], corners[1], threshold),
        interpolate(corners[1], corners[2], threshold),
        interpolate(corners[2], corners[3], threshold),
        interpolate(corners[3], corners[0], threshold),
      ];
      let pairs = cases[mask];
      if (mask === 5 || mask === 10) {
        const centerWet = corners.reduce((sum, corner) => sum + corner.depth, 0) / 4 >= threshold;
        pairs = mask === 5
          ? (centerWet ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]])
          : (centerWet ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]);
      }
      for (const [a, b] of pairs ?? []) segments.push([edgePoints[a], edgePoints[b]]);
    }
  }
  return segments;
}

function stitchSegments(segments) {
  const adjacency = new Map();
  const add = (point, index) => {
    const key = pointKey(point);
    const entries = adjacency.get(key) ?? [];
    entries.push(index);
    adjacency.set(key, entries);
  };
  segments.forEach((segment, index) => { add(segment[0], index); add(segment[1], index); });
  const used = new Set();
  const rings = [];
  for (let startIndex = 0; startIndex < segments.length; startIndex++) {
    if (used.has(startIndex)) continue;
    used.add(startIndex);
    const ring = [segments[startIndex][0], segments[startIndex][1]];
    const startKey = pointKey(ring[0]);
    let currentKey = pointKey(ring[1]);
    while (currentKey !== startKey) {
      const nextIndex = (adjacency.get(currentKey) ?? []).find(index => !used.has(index));
      if (nextIndex == null) break;
      used.add(nextIndex);
      const segment = segments[nextIndex];
      const next = pointKey(segment[0]) === currentKey ? segment[1] : segment[0];
      ring.push(next);
      currentKey = pointKey(next);
    }
    if (currentKey === startKey && ring.length >= 4) {
      ring.pop();
      rings.push(ring);
    }
  }
  return rings;
}

function signedArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index], b = ring[(index + 1) % ring.length];
    total += a.x * b.z - b.x * a.z;
  }
  return total / 2;
}

function perimeter(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index], b = ring[(index + 1) % ring.length];
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function classify(ring, area, cellSize) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
  }
  const width = maxX - minX, height = maxZ - minZ;
  const aspect = Math.max(width, height) / Math.max(cellSize, Math.min(width, height));
  if (area <= cellSize * cellSize * 4) return 'small_water';
  if (aspect >= 3 && area >= cellSize * cellSize * 6) return 'linear_water';
  return 'open_water';
}

function shorelineBodies(rings) {
  const records = rings.map(ring => ({ ring, absoluteArea: Math.abs(signedArea(ring)), depth: 0 }));
  for (const record of records) {
    record.depth = records.filter(other => other !== record && other.absoluteArea > record.absoluteArea && pointInPolygon(record.ring[0], other.ring)).length;
  }
  const outers = records.filter(record => record.depth % 2 === 0).sort((a, b) => b.absoluteArea - a.absoluteArea);
  const holes = records.filter(record => record.depth % 2 === 1);
  return outers.map(outer => ({
    outer: outer.ring,
    holes: holes
      .filter(hole => pointInPolygon(hole.ring[0], outer.ring))
      .filter(hole => !outers.some(candidate => candidate !== outer && candidate.absoluteArea < outer.absoluteArea && candidate.absoluteArea > hole.absoluteArea && pointInPolygon(hole.ring[0], candidate.ring)))
      .map(hole => hole.ring),
  }));
}

export function vectorizeSurfaceWater(cells, cellSize, options = {}) {
  const threshold = options.water_threshold_m ?? 0.03;
  const rings = stitchSegments(contourSegments(cells, cellSize, threshold));
  return shorelineBodies(rings).map((body, index) => {
    const outerArea = Math.abs(signedArea(body.outer));
    const holeArea = body.holes.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0);
    const area = Math.max(0, outerArea - holeArea);
    const wetCells = cells.filter(cell => (finite(cell.water_depth_m) ?? 0) >= threshold && pointInPolygon(cell, body.outer) && !body.holes.some(hole => pointInPolygon(cell, hole)));
    const depths = wetCells.map(cell => finite(cell.water_depth_m)).filter(value => value != null);
    const kind = classify(body.outer, area, cellSize);
    return {
      id: `surface-water-${index}`,
      kind,
      label: kind === 'small_water' ? '小型积水' : kind === 'linear_water' ? '线性水体（河流/水道形态）' : '开阔水体（湖泊/河湾形态）',
      polygons: [body.outer],
      holes: body.holes,
      cell_count: wetCells.length,
      area_m2: area,
      shoreline_length_m: perimeter(body.outer) + body.holes.reduce((sum, ring) => sum + perimeter(ring), 0),
      shoreline_vertices: body.outer.length + body.holes.reduce((sum, ring) => sum + ring.length, 0),
      maximum_depth_m: depths.length ? Math.max(...depths) : null,
      geometry_method: 'marching_squares_depth_interpolation',
      status: 'existing',
    };
  });
}

export async function readPurchasedSurfaceWater(query, purchasedTiles, options = {}) {
  const requestedBounds = unionBounds(purchasedTiles, options.bounds);
  if (!requestedBounds) return { waters: [], metadata: { available: false, reason: 'bounds_unavailable' } };
  const requestedCellSize = options.cell_size_m ?? 8;
  const threshold = options.water_threshold_m ?? 0.03;
  const maxSampledCells = options.max_sampled_cells ?? 750000;
  let cellSize = requestedCellSize;
  let baseArgs = { bounds: requestedBounds, cell_size_m: cellSize, water_threshold_m: threshold };
  let first = await query('read_surface_water_mask', { ...baseArgs, offset: 0, limit: 1 });
  let totalCells = Number(first.total_cells ?? Number(first.resolution?.x) * Number(first.resolution?.z));
  if (Number.isFinite(totalCells) && totalCells > maxSampledCells) {
    cellSize = Math.max(requestedCellSize, Math.ceil(requestedCellSize * Math.sqrt(totalCells / maxSampledCells)));
    baseArgs = { bounds: requestedBounds, cell_size_m: cellSize, water_threshold_m: threshold };
    first = await query('read_surface_water_mask', { ...baseArgs, offset: 0, limit: 1 });
    totalCells = Number(first.total_cells ?? Number(first.resolution?.x) * Number(first.resolution?.z));
  }
  cellSize = finite(first.cell_size_m) ?? cellSize;
  const columns = Number(first.resolution?.x), rows = Number(first.resolution?.z);
  if (!Number.isInteger(columns) || !Number.isInteger(rows)) throw new Error('Surface-water mask returned invalid grid metadata.');
  totalCells = Number.isFinite(totalCells) ? totalCells : columns * rows;
  const cells = [];
  const pageSize = 1024;
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const requests = [];
  for (let offset = 0; offset < totalCells; offset += pageSize) requests.push({ offset, limit: Math.min(pageSize, totalCells - offset) });
  for (let start = 0; start < requests.length; start += concurrency) {
    const pages = await Promise.all(requests.slice(start, start + concurrency).map(page => query('read_surface_water_mask', { ...baseArgs, ...page })));
    for (const page of pages) for (const cell of page.cells ?? []) {
      const purchased = insidePurchased(cell, purchasedTiles, requestedBounds);
      cells.push(purchased ? cell : { ...cell, water: false, water_depth_m: 0 });
    }
  }
  const wetCells = cells.filter(cell => (finite(cell.water_depth_m) ?? 0) >= threshold).length;
  const waters = vectorizeSurfaceWater(cells, cellSize, { water_threshold_m: threshold });
  return {
    waters,
    metadata: {
      available: true,
      source: 'native_surface_water_depth',
      requested_cell_size_m: requestedCellSize,
      cell_size_m: cellSize,
      adaptive_resolution: cellSize > requestedCellSize,
      water_threshold_m: threshold,
      sampled_cells: cells.length,
      wet_cells: wetCells,
      shoreline_vertices: waters.reduce((sum, water) => sum + water.shoreline_vertices, 0),
      geometry_method: 'marching_squares_depth_interpolation',
      classification: 'Waterbody labels are inferred from contour morphology; shoreline geometry is interpolated from native water depth.',
    },
  };
}
