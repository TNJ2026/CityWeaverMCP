import { createSpatialIndex, footprintBounds } from './planning-spatial.mjs';

class MinHeap {
  items = [];
  push(item) {
    let i = this.items.length; this.items.push(item);
    while (i) { const p = (i - 1) >> 1; if (this.items[p].f <= item.f) break; this.items[i] = this.items[p]; i = p; }
    this.items[i] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.items.length && this.items[c + 1].f < this.items[c].f) c++;
        if (this.items[c].f >= last.f) break;
        this.items[i] = this.items[c]; i = c;
      }
      this.items[i] = last;
    }
    return first;
  }
}

export function segmentHitsBox(a, b, box) {
  let lo = 0, hi = 1;
  for (const axis of ['x', 'z']) {
    const delta = b[axis] - a[axis], min = box[`min_${axis}`], max = box[`max_${axis}`];
    if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) return false; continue; }
    let p = (min - a[axis]) / delta, q = (max - a[axis]) / delta;
    if (p > q) [p, q] = [q, p];
    lo = Math.max(lo, p); hi = Math.min(hi, q);
    if (lo > hi) return false;
  }
  return true;
}

// Bounded A* fallback for native-rejected straight/L paths. Geometry is a
// planning proxy; terrain, underground depth and actual clearance are previewed.
export function routeUtility(start, end, buildings, { detour = 128, cellSize = 16, clearance = 4, excludedId } = {}) {
  if (![start?.x, start?.z, end?.x, end?.z, detour, cellSize, clearance].every(Number.isFinite) || cellSize <= 0 || detour < 0 || clearance < 0) return null;
  return searchRoute(start, end, prepareObstacles(buildings, clearance, excludedId), { detour, cellSize });
}

function prepareObstacles(buildings, clearance, excludedId) {
  const boxes = buildings.filter(b => excludedId === undefined || b.id !== excludedId).map(footprintBounds).filter(Boolean)
    .map(b => ({ min_x: b.min_x-clearance, max_x: b.max_x+clearance, min_z: b.min_z-clearance, max_z: b.max_z+clearance }));
  const index = createSpatialIndex(boxes, b => b);
  const clear = (a, b) => !index.some({ min_x: Math.min(a.x,b.x), max_x: Math.max(a.x,b.x), min_z: Math.min(a.z,b.z), max_z: Math.max(a.z,b.z) },
    box => segmentHitsBox(a,b,box));
  return clear;
}

function searchRoute(start, end, clear, { detour, cellSize }) {
  const minX = Math.floor((Math.min(start.x,end.x)-detour)/cellSize)*cellSize;
  const minZ = Math.floor((Math.min(start.z,end.z)-detour)/cellSize)*cellSize;
  const cols = Math.ceil((Math.max(start.x,end.x)+detour-minX)/cellSize)+1;
  const rows = Math.ceil((Math.max(start.z,end.z)+detour-minZ)/cellSize)+1;
  if (cols*rows > 16000) return null;
  const cell = p => Math.round((p.x-minX)/cellSize)+Math.round((p.z-minZ)/cellSize)*cols;
  const first = cell(start), goal = cell(end);
  const point = c => c === first ? start : c === goal ? end : { x: minX+(c%cols)*cellSize, z: minZ+Math.floor(c/cols)*cellSize };
  if (first === goal) return clear(start,end) ? [start,end] : null;
  const open = new MinHeap(), scores = new Map(), previous = new Map();
  const initial = first*5+4;
  scores.set(initial,0); open.push({ id: initial, g: 0, f: 0 });
  const directions = [[1,0], [0,1], [-1,0], [0,-1]];
  const edgeClearance = new Map();
  let final;
  while (open.items.length) {
    const current = open.pop();
    if (scores.get(current.id) !== current.g) continue;
    const c = Math.floor(current.id/5), heading = current.id%5;
    if (c === goal) { final = current.id; break; }
    const a = point(c);
    for (const [direction,[dx,dz]] of directions.entries()) {
      const x = c%cols+dx, z = Math.floor(c/cols)+dz;
      if (x < 0 || x >= cols || z < 0 || z >= rows) continue;
      const n = x+z*cols, b = point(n), id = n*5+direction;
      const edgeKey = Math.min(c,n)*(cols*rows)+Math.max(c,n);
      if (!edgeClearance.has(edgeKey)) edgeClearance.set(edgeKey,clear(a,b));
      if (!edgeClearance.get(edgeKey)) continue;
      const g = current.g+Math.hypot(a.x-b.x,a.z-b.z)+(heading !== 4 && heading !== direction ? 8 : 0);
      if (g >= (scores.get(id) ?? Infinity)) continue;
      scores.set(id,g); previous.set(id,current.id);
      open.push({ id,g,f:g+Math.hypot(b.x-end.x,b.z-end.z) });
    }
  }
  if (final === undefined) return null;
  const raw = [];
  for (let id = final; id !== undefined; id = previous.get(id)) raw.push(point(Math.floor(id/5)));
  raw.reverse();
  const path = [raw[0]];
  for (let i = 0; i < raw.length-1;) {
    let next = raw.length-1;
    while (next > i+1 && !clear(raw[i],raw[next])) next--;
    path.push(raw[next]); i = next;
  }
  return path.length <= 16 ? path : null;
}

// At most six bounded searches. Every attempt uses the same complete snapshot.
export function routeUtilityAdaptive(start, end, buildings, options = {}) {
  if (![start?.x,start?.z,end?.x,end?.z].every(Number.isFinite)) return null;
  const { clearance = 4, excludedId } = options;
  if (!Number.isFinite(clearance) || clearance < 0) return null;
  const clear = prepareObstacles(buildings, clearance, excludedId);
  for (const detour of [128,256,512]) {
    let step = 16;
    const cells = size => (Math.ceil((Math.abs(end.x-start.x)+2*detour)/size)+2) * (Math.ceil((Math.abs(end.z-start.z)+2*detour)/size)+2);
    while (cells(step)>16000 && step<256) step*=2;
    for (const cellSize of [step,step/2]) {
      if(cells(cellSize)>16000) continue;
      const path=searchRoute(start,end,clear,{detour,cellSize});
      if(path) return path;
    }
  }
  return null;
}
