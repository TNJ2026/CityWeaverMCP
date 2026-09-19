export function footprint(building) {
  const size = building.size_m;
  if (!Number.isFinite(building.position?.x) || !Number.isFinite(building.position?.z) || !Number.isFinite(building.rotation_degrees ?? 0)) return null;
  if (!size || !Number.isFinite(size.x) || !Number.isFinite(size.z) || size.x <= 0 || size.z <= 0) return null;
  const angle = (building.rotation_degrees ?? 0) * Math.PI / 180;
  return { center: building.position, half: [size.x / 2, size.z / 2],
    axes: [[Math.cos(angle), -Math.sin(angle)], [Math.sin(angle), Math.cos(angle)]] };
}

export function footprintsOverlap(a, b, clearance = .25) {
  const delta = [b.center.x - a.center.x, b.center.z - a.center.z];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  return [...a.axes, ...b.axes].every(axis => Math.abs(dot(delta, axis)) <
    a.half.reduce((sum, half, i) => sum + half * Math.abs(dot(a.axes[i], axis)), 0) +
    b.half.reduce((sum, half, i) => sum + half * Math.abs(dot(b.axes[i], axis)), 0) + clearance);
}

export function footprintBounds(building) {
  const box = footprint(building);
  if (!box) return null;
  const x = Math.abs(box.axes[0][0]) * box.half[0] + Math.abs(box.axes[1][0]) * box.half[1];
  const z = Math.abs(box.axes[0][1]) * box.half[0] + Math.abs(box.axes[1][1]) * box.half[1];
  return { min_x: box.center.x - x, max_x: box.center.x + x, min_z: box.center.z - z, max_z: box.center.z + z };
}

export function createSpatialIndex(items, boundsOf, cellSize = 128) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Spatial cell size must be positive.');
  const cells = new Map();
  const visit = (b, fn) => {
    for (let x = Math.floor(b.min_x / cellSize); x <= Math.floor(b.max_x / cellSize); x++)
      for (let z = Math.floor(b.min_z / cellSize); z <= Math.floor(b.max_z / cellSize); z++) fn(`${x},${z}`);
  };
  for (const item of items) {
    const bounds = boundsOf(item);
    if (!bounds) continue;
    visit(bounds, key => { if (!cells.has(key)) cells.set(key, []); cells.get(key).push(item); });
  }
  const scan = (bounds, predicate) => {
    if (!cells.size) return false;
    const x0 = Math.floor(bounds.min_x/cellSize), x1 = Math.floor(bounds.max_x/cellSize);
    const z0 = Math.floor(bounds.min_z/cellSize), z1 = Math.floor(bounds.max_z/cellSize);
    const found = new Set();
    const test = bucket => {
      for (const item of bucket ?? []) if (!found.has(item)) {
        found.add(item); if (predicate(item)) return true;
      }
      return false;
    };
    if ((x1-x0+1)*(z1-z0+1) > cells.size) {
      for (const [key,bucket] of cells) {
        const [x,z] = key.split(',').map(Number);
        if (x>=x0 && x<=x1 && z>=z0 && z<=z1 && test(bucket)) return true;
      }
    } else for (let x=x0;x<=x1;x++) for(let z=z0;z<=z1;z++) if(test(cells.get(`${x},${z}`))) return true;
    return false;
  };
  return {
    query(bounds) { const result=[]; scan(bounds,item=>{result.push(item);return false;}); return result; },
    some(bounds,predicate) { return scan(bounds,predicate); },
  };
}

// Length-based sampling evaluates points ON a cubic Bezier, never its control polygon.
export function sampleRoad(road, step = 16) {
  if (road.curve && ['a', 'b', 'c', 'd'].every(k => road.curve[k])) {
    const { a, b, c, d } = road.curve;
    const length = Math.hypot(b.x-a.x,b.z-a.z) + Math.hypot(c.x-b.x,c.z-b.z) + Math.hypot(d.x-c.x,d.z-c.z);
    const n = Math.max(2, Math.min(512, Math.ceil(length / step)));
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n, u = 1 - t;
      return { x: u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x,
        z: u*u*u*a.z + 3*u*u*t*b.z + 3*u*t*t*c.z + t*t*t*d.z };
    });
  }
  const points = road.points ?? [];
  return points.flatMap((p, i) => {
    if (!i) return [p];
    const a = points[i-1], n = Math.max(1, Math.min(512, Math.ceil(Math.hypot(p.x-a.x,p.z-a.z)/step)));
    return Array.from({ length: n }, (_, j) => ({ x: a.x + (p.x-a.x)*(j+1)/n, z: a.z + (p.z-a.z)*(j+1)/n }));
  });
}

// Exact nearest pair with x-axis lower-bound pruning. Original iteration order
// breaks distance ties, including ties encountered after a nearer x neighbor.
export function nearestPointPair(sources, targets, limit = 1000) {
  const sorted = targets.map((point, order) => ({ point, order })).sort((a,b) => a.point.x-b.point.x || a.order-b.order);
  let distance = limit, source = null, target = null;
  for (const origin of sources) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo+hi) >>> 1; if (sorted[mid].point.x < origin.x) lo=mid+1; else hi=mid; }
    let left = lo-1, right = lo, bestOrder = Infinity;
    while (left >= 0 || right < sorted.length) {
      const dl = left >= 0 ? Math.abs(sorted[left].point.x-origin.x) : Infinity;
      const dr = right < sorted.length ? Math.abs(sorted[right].point.x-origin.x) : Infinity;
      if (Math.min(dl,dr) > distance) break;
      const row = dl <= dr ? sorted[left--] : sorted[right++];
      if (Math.abs(row.point.z-origin.z) > distance) continue;
      const d = Math.hypot(origin.x-row.point.x, origin.z-row.point.z);
      if (d < distance || (d === distance && bestOrder !== Infinity && row.order < bestOrder)) {
        distance = d; source = origin; target = row.point; bestOrder = row.order;
      }
    }
  }
  return { distance, source, target };
}
