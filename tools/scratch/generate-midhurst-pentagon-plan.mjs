// Midhurst / Pentagon City structured plan generator (read-only; writes plans/midhurst-pentagon-city-plan.json)
//
// Morphology (per docs/reference/GAME-PHYSICS-RULES.md):
//   * Regular pentagon, vertices snapped to the global 8 m grid; five radial avenues link
//     center <-> vertices. The pentagon outline is the outer ring road.
//   * Concentric inner pentagons at 120 m apothem steps -> 96 m curb-to-curb between Small Roads
//     (golden block width) and 120 m bands wide enough for zoned depth on both sides.
//   * Spoke streets between rings, subdivided along the arc.
//   * Five sectors by use: north industry, north-east office, south-east/south/west housing.
//   * South civic band outside the pentagon (the purchased area is a 2.5 km square) carries every
//     large-footprint building; a regular pentagon of this size has no interior rectangle wide
//     enough for 100 m+ civic buildings.
// Zoning: 16 m grid cells within [0,48] m of a road curb, band x sector -> use table,
//         merged by greedy maximal rectangles.
//
// Run: node tools/scratch/generate-midhurst-pentagon-plan.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const { computeCityPlanId } = await import(new URL('../../mcp/planning-renderer.mjs', import.meta.url).href);

const survey = JSON.parse(await readFile(path.join(ROOT, 'mcp', 'pentagon-survey2.json'), 'utf8'));
const OWNED = survey.ownedBounds;

// Footprint source: the two prefab catalogues that actually return data in this city.
const sizeOf = new Map();
for (const item of [...(survey.services.items ?? []), ...(survey.utilityFacilities.items ?? [])]) {
  if (item?.name && item?.size_m) sizeOf.set(item.name, { x: item.size_m.x, z: item.size_m.z });
}
const SIZE_PATCH = {
  CityHall01: { x: 127.6, z: 159.6 }, Hospital01: { x: 183.6, z: 79.6 }, College01: { x: 175.6, z: 127.6 },
  HighSchool02: { x: 95.6, z: 63.6 }, FireStation01: { x: 111.6, z: 143.6 }, PoliceStation01: { x: 95.6, z: 55.6 },
  Cemetery01: { x: 127.6, z: 199.6 }, Crematorium01: { x: 63.6, z: 79.6 }, Landfill01: { x: 135.6, z: 119.6 },
  RecyclingCenter01: { x: 175.6, z: 143.6 }, WastewaterTreatmentPlant01: { x: 95.6, z: 79.6 },
  SmallCoalPowerPlant01: { x: 111.6, z: 127.6 }, EmergencyBatteryStation01: { x: 175.6, z: 79.6 },
  TransformerStation01: { x: 47.6, z: 55.6 }, TelecomTower01: { x: 55.6, z: 55.6 },
  WaterTower01: { x: 31.6, z: 31.6 }, WaterTower02: { x: 15.6, z: 15.6 },
  GroundwaterPumpingStation01: { x: 47.6, z: 47.6 }, EarlyDisasterWarningSystem01: { x: 79.6, z: 55.6 },
  ResearchInstitute01: { x: 143.6, z: 103.6 }, WelfareOffice01: { x: 119.6, z: 127.6 },
  MedicalClinic02: { x: 39.6, z: 39.6 }, ElementarySchool02: { x: 71.6, z: 47.6 }, FireHouse01: { x: 39.6, z: 39.6 },
  PoliceStation02: { x: 39.6, z: 39.6 }, RoadMaintenanceDepot01: { x: 79.6, z: 95.6 }, PostOffice02: { x: 23.6, z: 31.6 },
  ParkingLot01: { x: 39.6, z: 39.6 }, Playground01: { x: 15.6, z: 15.6 }, DogPark01: { x: 31.6, z: 23.6 },
  CommunityPool01: { x: 55.6, z: 55.6 }, CityPark01: { x: 31.6, z: 31.6 }, CityPark02: { x: 47.6, z: 47.6 },
  CityPark03: { x: 79.6, z: 63.6 }, CityPark04: { x: 95.6, z: 127.6 }, CityPark07: { x: 63.6, z: 127.6 },
  CityPark11: { x: 95.6, z: 95.6 }, ElementarySchool01: { x: 143.6, z: 63.6 },
};
for (const [name, size] of Object.entries(SIZE_PATCH)) if (!sizeOf.has(name)) sizeOf.set(name, size);

const DEG = Math.PI / 180;
const COS36 = Math.cos(36 * DEG);
const SQ_HALF = (OWNED.max_x - OWNED.min_x) / 2;
const R_OUT = 888;
const APOTHEM = R_OUT * COS36;
const CENTER = { x: -312, z: -936 };
const snap8 = (v) => Math.round(v / 8) * 8;
const P = (radius, deg) => ({ x: snap8(CENTER.x + radius * Math.cos(deg * DEG)), z: snap8(CENTER.z + radius * Math.sin(deg * DEG)) });
const polarOf = (x, z) => { const u = x - CENTER.x; const v = z - CENTER.z; return { radius: Math.hypot(u, v), angle: ((Math.atan2(v, u) / DEG) + 360) % 360 }; };

const VERTEX_ANG = [90, 18, 306, 234, 162];
const SECTOR_ID = ['n', 'ne', 'se', 's', 'w'];
const BISECTOR_ANG = [54, 342, 270, 198, 126];
const VERTS = VERTEX_ANG.map((a) => P(R_OUT, a));
const PENT = VERTS;
const RING_A = [120, 240, 360, 480, 600];
const RING_R = RING_A.map((a) => snap8(a / COS36));

// ---------------------------------------------------------------- polygon helpers
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.z > pt.z) !== (b.z > pt.z)) { const t = (pt.z - a.z) / (b.z - a.z); if (pt.x < a.x + t * (b.x - a.x)) inside = !inside; }
  }
  return inside;
}
function distToPolyEdge(pt, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    const vx = b.x - a.x; const vz = b.z - a.z; const len2 = vx * vx + vz * vz;
    let t = len2 === 0 ? 0 : ((pt.x - a.x) * vx + (pt.z - a.z) * vz) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * vx), pt.z - (a.z + t * vz)));
  }
  return best;
}
function rayHitChord(deg, rB) {
  const ux = Math.cos(deg * DEG); const uz = Math.sin(deg * DEG);
  const verts = VERTEX_ANG.map((ang) => ({ x: CENTER.x + rB * Math.cos(ang * DEG), z: CENTER.z + rB * Math.sin(ang * DEG) }));
  for (let i = 0; i < 5; i += 1) {
    const p1 = verts[i]; const p2 = verts[(i + 1) % 5];
    const ex = p2.x - p1.x; const ez = p2.z - p1.z;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p1.x - CENTER.x) * ez - (p1.z - CENTER.z) * ex) / den;
    const s = ((p1.x - CENTER.x) * uz - (p1.z - CENTER.z) * ux) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) return { x: CENTER.x + ux * t, z: CENTER.z + uz * t };
  }
  return null;
}

const roads = []; const zones = []; const buildings = []; const reserves = []; const placementFailures = [];
const addRoad = (o) => { roads.push(o); return o; };

// ---- 1) pentagon outline (outer ring road)
for (let k = 0; k < 5; k += 1) {
  const a = VERTS[k]; const b = VERTS[(k + 1) % 5];
  addRoad({
    id: `edge-${k}`, label: `Outer ring ${k + 1}/5 (${SECTOR_ID[k].toUpperCase()} side)`, prefab: 'Medium Road', width_m: 24,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 100 + k,
    points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
  });
}
// ---- 2) concentric inner rings
for (let k = 0; k < RING_R.length; k += 1) {
  for (let s = 0; s < 5; s += 1) {
    const a = P(RING_R[k], VERTEX_ANG[s]); const b = P(RING_R[k], VERTEX_ANG[(s + 1) % 5]);
    addRoad({
      id: `ring${RING_A[k]}-${s}`, label: `Inner ring a=${RING_A[k]}m side ${s + 1}`, prefab: 'Small Road', width_m: 16,
      level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 114 + k * 5 + s,
      points: [{ x: a.x, z: a.z }, { x: b.x, z: b.z }],
    });
  }
}
// ---- 3) radial avenues center -> vertex, broken at every ring to create nodes
for (let k = 0; k < 5; k += 1) {
  const pts = [{ x: CENTER.x, z: CENTER.z }];
  for (const r of RING_R) { const p = rayHitChord(VERTEX_ANG[k], r); if (p) pts.push({ x: snap8(p.x), z: snap8(p.z) }); }
  pts.push({ x: VERTS[k].x, z: VERTS[k].z });
  const clean = [];
  for (const p of pts) { const last = clean[clean.length - 1]; if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= 24) clean.push(p); }
  addRoad({
    id: `radial-${SECTOR_ID[k]}`, label: `Radial avenue center -> vertex ${k + 1}`, prefab: 'Medium Road', width_m: 24,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 90 + k, points: clean,
  });
}
// ---- 4) spoke streets between rings
let spokeSeq = 0;
const GAP_A = [...RING_A, Math.round(APOTHEM)];
for (let g = 0; g + 1 < GAP_A.length; g += 1) {
  const aMid = (GAP_A[g] + GAP_A[g + 1]) / 2;
  const n = Math.max(1, Math.min(3, Math.round((aMid * 72 * DEG) / 200)));
  for (let w = 0; w < 5; w += 1) {
    for (let i = 0; i < n; i += 1) {
      const th = VERTEX_ANG[w] + ((i + 1) * 72) / (n + 1);
      const p1 = rayHitChord(th, GAP_A[g] / COS36); const p2 = rayHitChord(th, GAP_A[g + 1] / COS36);
      if (!p1 || !p2) continue;
      const A = { x: snap8(p1.x), z: snap8(p1.z) }; const B = { x: snap8(p2.x), z: snap8(p2.z) };
      if (Math.hypot(B.x - A.x, B.z - A.z) < 24) continue;
      spokeSeq += 1;
      addRoad({
        id: `spoke-${g}-${w}-${i}`, label: `Spoke g${g} ${SECTOR_ID[w]}`, prefab: 'Small Road', width_m: 16,
        level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 400 + spokeSeq, points: [A, B],
      });
    }
  }
}
// ---- 5) external gates (north + south of the purchased square); east side is steep terrain
const NORTH_HUB = VERTS[0]; const SOUTH_HUB = VERTS[3];
addRoad({
  id: 'gate-north', label: 'North gate connector to purchased boundary', prefab: 'Large Road', width_m: 32,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 60,
  points: [{ x: NORTH_HUB.x, z: NORTH_HUB.z }, { x: snap8(NORTH_HUB.x), z: snap8(OWNED.max_z - 48) }],
});
addRoad({
  id: 'gate-south', label: 'South gate connector to purchased boundary', prefab: 'Large Road', width_m: 32,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 61,
  points: [{ x: SOUTH_HUB.x, z: SOUTH_HUB.z }, { x: snap8(SOUTH_HUB.x), z: snap8(OWNED.min_z + 48) }],
});
// ---- 6) freight spine: north gate -> north industrial sector (heavy trucks avoid housing)
addRoad({
  id: 'freight-spine', label: 'Freight spine (north gate -> north industrial sector)', prefab: 'Large Road', width_m: 32,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 62,
  points: [{ x: NORTH_HUB.x, z: NORTH_HUB.z }, { x: 88, z: -160 }, { x: 248, z: -472 }],
});
// ---- 7) south civic band (outside the pentagon, inside the purchased square)
const CAMPUS = { min_x: snap8(-1504), max_x: snap8(896), min_z: snap8(OWNED.min_z + 16), max_z: snap8(-1848) };
addRoad({
  id: 'civic-spine', label: 'Civic band main street (east-west)', prefab: 'Medium Road', width_m: 24,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 70,
  points: [{ x: CAMPUS.min_x, z: -2024 }, { x: CAMPUS.max_x, z: -2024 }],
});
for (const [i, x] of [-1136, -640, 80].entries()) {
  addRoad({
    id: `civic-cross-${i + 1}`, label: `Civic band cross street ${i + 1}`, prefab: 'Medium Road', width_m: 24,
    level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 71 + i,
    points: [{ x, z: -2024 }, { x, z: -2144 }],
  });
}
addRoad({
  id: 'civic-link', label: 'Civic band link to south vertex', prefab: 'Medium Road', width_m: 24,
  level: 'surface', planning_status: 'bound', construction_status: 'planned', construction_order: 74,
  points: [{ x: CENTER.x, z: VERTS[3].z }, { x: CENTER.x, z: -2024 }],
});

// ---------------------------------------------------------------- placement clearance
function reservedOf(prefab) {
  const s = sizeOf.get(prefab) ?? SIZE_PATCH[prefab] ?? { x: 40, z: 40 };
  return { x: Math.ceil((s.x + 12) / 8) * 8, z: Math.ceil((s.z + 12) / 8) * 8, raw: s };
}
const DEG2RAD = Math.PI / 180;
function obbCorners(center, hx, hz, deg) {
  const a = (deg ?? 0) * DEG2RAD; const cos = Math.cos(a); const sin = Math.sin(a);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([dx, dz]) => ({ x: center.x + dx * cos - dz * sin, z: center.z + dx * sin + dz * cos }));
}
function segIntersectsObb(p0, p1, center, hx, hz, deg, pad) {
  const a = -(deg ?? 0) * DEG2RAD; const cos = Math.cos(a); const sin = Math.sin(a);
  const local = (p) => { const dx = p.x - center.x; const dz = p.z - center.z; return { x: dx * cos - dz * sin, z: dx * sin + dz * cos }; };
  const s = local(p0); const e = local(p1); const HX = hx + pad; const HZ = hz + pad;
  let t0 = 0; let t1 = 1;
  for (const [o, d, lo, hi] of [[s.x, e.x - s.x, -HX, HX], [s.z, e.z - s.z, -HZ, HZ]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
    let a1 = (lo - o) / d; let b1 = (hi - o) / d;
    if (a1 > b1) { const t = a1; a1 = b1; b1 = t; }
    t0 = Math.max(t0, a1); t1 = Math.min(t1, b1);
    if (t0 > t1) return false;
  }
  return true;
}
function envelopeOf(corners) {
  const xs = corners.map((p) => p.x); const zs = corners.map((p) => p.z);
  return { min_x: Math.min(...xs), max_x: Math.max(...xs), min_z: Math.min(...zs), max_z: Math.max(...zs) };
}
function envelopeOverlap(a, b) { return a.min_x < b.max_x && a.max_x > b.min_x && a.min_z < b.max_z && a.max_z > b.min_z; }
function inPlaceArea(pos) {
  if (pointInPoly(pos, PENT)) return true;
  return pos.x > CAMPUS.min_x && pos.x < CAMPUS.max_x && pos.z > CAMPUS.min_z && pos.z < CAMPUS.max_z;
}
function isClear(pos, deg, prefab) {
  const r = reservedOf(prefab); const hx = r.x / 2; const hz = r.z / 2;
  const center = { x: snap8(pos.x), z: snap8(pos.z) };
  if (!inPlaceArea(center)) return false;
  for (const c of obbCorners(center, hx, hz, deg)) if (c.x < OWNED.min_x || c.x > OWNED.max_x || c.z < OWNED.min_z || c.z > OWNED.max_z) return false;
  for (const rd of roads) {
    const pad = Math.max(0, rd.width_m || 8) / 2;
    for (let i = 0; i + 1 < rd.points.length; i += 1) if (segIntersectsObb(rd.points[i], rd.points[i + 1], center, hx, hz, deg, pad)) return false;
  }
  const A = envelopeOf(obbCorners(center, hx, hz, deg));
  for (const b of buildings) {
    const bb = b.reserved_size_m;
    if (envelopeOverlap(A, envelopeOf(obbCorners(b.position, bb.x / 2, bb.z / 2, b.rotation_degrees ?? 0)))) return false;
  }
  for (const r2 of reserves) if (A.min_x < r2.x1 && A.max_x > r2.x0 && A.min_z < r2.z1 && A.max_z > r2.z0) return false;
  return true;
}
function addBuilding(o) {
  const r = reservedOf(o.prefab);
  buildings.push({
    id: o.id, label: o.label, prefab: o.prefab, name: o.label, kind: o.kind ?? 'service', category: o.category ?? 'city_service',
    planning_status: 'conceptual', placement_status: 'conceptual', rotation_source: 'unresolved', rotation_degrees: null,
    construction_status: 'planned', size_m: { x: r.raw.x, z: r.raw.z }, reserved_size_m: { x: r.x, z: r.z },
    position: { x: snap8(o.position.x), z: snap8(o.position.z) },
  });
  reserves.push({ x0: snap8(o.position.x - r.x / 2) - 8, x1: snap8(o.position.x + r.x / 2) + 8, z0: snap8(o.position.z - r.z / 2) - 8, z1: snap8(o.position.z + r.z / 2) + 8 });
}
function placeAlong(o) {
  const r = reservedOf(o.prefab); const hx = r.x / 2; const hz = r.z / 2;
  const cand = [];
  for (const rd of roads) {
    if (rd.id.startsWith('gate-')) continue;
    for (let i = 0; i + 1 < rd.points.length; i += 1) {
      const a = rd.points[i]; const b = rd.points[i + 1];
      const vx = b.x - a.x; const vz = b.z - a.z; const len2 = vx * vx + vz * vz || 1;
      let t = ((o.target.x - a.x) * vx + (o.target.z - a.z) * vz) / len2;
      t = Math.max(0, Math.min(1, t));
      cand.push({ rd, seg: [a, b], d: Math.hypot(o.target.x - (a.x + t * vx), o.target.z - (a.z + t * vz)), t });
    }
  }
  cand.sort((p, q) => p.d - q.d);
  const tOrder = [];
  for (let dt = 0; dt <= 560; dt += 8) { tOrder.push(dt); if (dt > 0) tOrder.push(-dt); }
  let best = null;
  for (const c of cand.slice(0, 50)) {
    const [a, b] = c.seg;
    const ux = (b.x - a.x); const uz = (b.z - a.z); const len = Math.hypot(ux, uz) || 1;
    const nx = -uz / len; const nz = ux / len;
    const latBase = (hx * Math.abs(nx) + hz * Math.abs(nz)) + c.rd.width_m / 2 + 8;
    for (const side of [1, -1]) {
      for (const dt of tOrder) {
        const tt = c.t * len + dt;
        if (tt < 32 || tt > len - 8) continue;
        const base = { x: a.x + (ux / len) * tt, z: a.z + (uz / len) * tt };
        for (let extra = 0; extra <= 220; extra += 8) {
          const pos = { x: base.x + nx * (latBase + extra) * side, z: base.z + nz * (latBase + extra) * side };
          if (!isClear(pos, 0, o.prefab)) continue;
          const dTarget = Math.hypot(pos.x - o.target.x, pos.z - o.target.z);
          if (!best || dTarget < best.dTarget) best = { pos, dTarget };
          break;
        }
      }
    }
    if (best && best.dTarget < 180) break;
  }
  if (!best) { placementFailures.push(`${o.id}(${o.prefab})`); return false; }
  addBuilding({ ...o, position: best.pos });
  return true;
}

// ---------------------------------------------------------------- core services (inside pentagon)
for (const o of [
  { id: 'core-plaza', prefab: 'CityPark01', label: 'Central plaza', target: { x: CENTER.x, z: CENTER.z } },
  { id: 'core-park-n', prefab: 'CityPark02', label: 'Central park north', target: P(160, 90) },
  { id: 'core-park-e', prefab: 'CityPark02', label: 'Central park east', target: P(160, 18) },
  { id: 'core-park-s', prefab: 'CityPark02', label: 'Central park south', target: P(160, 306) },
  { id: 'core-park-w', prefab: 'CityPark02', label: 'Central park west', target: P(160, 198) },
  { id: 'core-pool', prefab: 'CommunityPool01', label: 'Community pool', target: P(440, 270) },
  { id: 'core-clinic', prefab: 'MedicalClinic02', label: 'Downtown clinic', target: P(440, 126) },
  { id: 'core-post', prefab: 'PostOffice02', label: 'Downtown post office', target: P(440, 54) },
]) placeAlong(o);

// ---------------------------------------------------------------- sector services (small footprints only)
const WEDGE_NAME = { n: 'North industrial sector', ne: 'North-east office sector', se: 'South-east housing sector', s: 'South housing sector', w: 'West housing sector' };
const WEDGE_SVCS = {
  n: [
    { prefab: 'FireHouse01', label: 'Industrial fire station', r: 300, a: 36 },
    { prefab: 'PoliceStation02', label: 'Industrial police post', r: 300, a: 0 },
  ],
  ne: [
    { prefab: 'FireHouse01', label: 'Fire station', r: 300, a: 34 },
    { prefab: 'PoliceStation02', label: 'Police post', r: 300, a: 0 },
    { prefab: 'MedicalClinic02', label: 'Clinic', r: 440, a: 34 },
    { prefab: 'PostOffice02', label: 'Post office', r: 440, a: 0 },
    { prefab: 'ParkingLot01', label: 'Office parking', r: 560, a: 34 },
  ],
  se: [
    { prefab: 'ElementarySchool02', label: 'Primary school 1', r: 300, a: 34 },
    { prefab: 'MedicalClinic02', label: 'Clinic', r: 300, a: 0 },
    { prefab: 'FireHouse01', label: 'Fire station', r: 440, a: 34 },
    { prefab: 'PoliceStation02', label: 'Police post', r: 440, a: 0 },
    { prefab: 'CityPark03', label: 'Neighbourhood park', r: 560, a: 34 },
    { prefab: 'Playground01', label: 'Playground', r: 560, a: 0 },
  ],
  s: [
    { prefab: 'ElementarySchool02', label: 'Primary school 2', r: 300, a: 34 },
    { prefab: 'MedicalClinic02', label: 'Clinic', r: 300, a: 0 },
    { prefab: 'FireHouse01', label: 'Fire station', r: 440, a: 34 },
    { prefab: 'PoliceStation02', label: 'Police post', r: 440, a: 0 },
    { prefab: 'CityPark02', label: 'Neighbourhood park', r: 560, a: 34 },
    { prefab: 'DogPark01', label: 'Dog park', r: 560, a: 0 },
  ],
  w: [
    { prefab: 'ElementarySchool02', label: 'Primary school 3', r: 300, a: 34 },
    { prefab: 'MedicalClinic02', label: 'Clinic', r: 300, a: 0 },
    { prefab: 'FireHouse01', label: 'Fire station', r: 440, a: 34 },
    { prefab: 'PoliceStation02', label: 'Police post', r: 440, a: 0 },
    { prefab: 'CityPark02', label: 'Neighbourhood park', r: 560, a: 34 },
    { prefab: 'Playground01', label: 'Playground', r: 560, a: 0 },
  ],
};
for (const [sid, list] of Object.entries(WEDGE_SVCS)) {
  const ang = BISECTOR_ANG[SECTOR_ID.indexOf(sid)];
  list.forEach((s, i) => placeAlong({ id: `wed-${sid}-${i}`, label: `${WEDGE_NAME[sid]} / ${s.label}`, prefab: s.prefab, target: P(s.r, ang + s.a), category: 'city_service' }));
}

// ---------------------------------------------------------------- large facilities -> south civic band
for (const o of [
  { id: 'civic-hall', prefab: 'CityHall01', label: 'City hall', target: { x: -1360, z: -2064 } },
  { id: 'hospital', prefab: 'Hospital01', label: 'City hospital', target: { x: -1136, z: -2064 } },
  { id: 'college', prefab: 'College01', label: 'Community college', target: { x: -864, z: -2056 } },
  { id: 'highschool', prefab: 'HighSchool02', label: 'City high school', target: { x: -640, z: -2056 } },
  { id: 'welfare', prefab: 'WelfareOffice01', label: 'Welfare office', target: { x: -400, z: -2080 } },
  { id: 'police-hq', prefab: 'PoliceStation01', label: 'Police district HQ', target: { x: -64, z: -2064 } },
  { id: 'fire-station', prefab: 'FireStation01', label: 'Fire brigade HQ', target: { x: 304, z: -2144 } },
  { id: 'cemetery', prefab: 'Cemetery01', label: 'City cemetery', target: { x: -1344, z: -2144 } },
  { id: 'crematorium', prefab: 'Crematorium01', label: 'Crematorium', target: { x: -1504, z: -2032 } },
  { id: 'research', prefab: 'ResearchInstitute01', label: 'Research institute', target: { x: 564, z: -2096 } },
  { id: 'landfill', prefab: 'Landfill01', label: 'Landfill', target: { x: -1504, z: -2144 } },
  { id: 'recycle', prefab: 'RecyclingCenter01', label: 'Recycling centre', target: { x: 264, z: -2072 } },
  { id: 'wastewater', prefab: 'WastewaterTreatmentPlant01', label: 'Wastewater treatment plant', target: { x: 88, z: -2072 } },
  { id: 'power-1', prefab: 'SmallCoalPowerPlant01', label: 'Gas power plant', target: { x: -1136, z: -1928 } },
  { id: 'power-2', prefab: 'EmergencyBatteryStation01', label: 'Emergency battery station', target: { x: -864, z: -1936 } },
  { id: 'groundwater-1', prefab: 'GroundwaterPumpingStation01', label: 'Groundwater pump 1', target: { x: 784, z: -2056 } },
  { id: 'groundwater-2', prefab: 'GroundwaterPumpingStation01', label: 'Groundwater pump 2', target: { x: 624, z: -2144 } },
  { id: 'disaster', prefab: 'EarlyDisasterWarningSystem01', label: 'Disaster warning centre', target: { x: -400, z: -1936 } },
  { id: 'parking-civic', prefab: 'ParkingLot01', label: 'Civic parking', target: { x: 88, z: -1944 } },
  { id: 'road-depot', prefab: 'RoadMaintenanceDepot01', label: 'Road maintenance depot', target: { x: 400, z: -2072 } },
]) {
  if (!sizeOf.has(o.prefab)) { placementFailures.push(`${o.id}(${o.prefab}) not in live catalogue`); continue; }
  const utilityish = /Power|Battery|Transformer|Water|Wastewater|Groundwater/.test(o.prefab);
  placeAlong({ ...o, category: utilityish ? 'utility_facility' : 'city_service' });
}
// small utilities inside the pentagon (towers/transformers/telecom)
for (const o of [
  { id: 'watertower-1', prefab: 'WaterTower01', label: 'Water tower west', target: P(650, 198) },
  { id: 'watertower-2', prefab: 'WaterTower02', label: 'Water tower north', target: P(660, 54) },
  { id: 'watertower-3', prefab: 'WaterTower01', label: 'Water tower south-east', target: P(650, 306) },
  { id: 'transformer-1', prefab: 'TransformerStation01', label: 'Transformer station 1', target: P(545, 126) },
  { id: 'transformer-2', prefab: 'TransformerStation01', label: 'Transformer station 2', target: P(545, 234) },
  { id: 'telecom', prefab: 'TelecomTower01', label: 'Telecom tower', target: P(560, 306) },
]) placeAlong({ ...o, category: 'utility_facility' });

// ---------------------------------------------------------------- use table (band x sector)
const BAND_NAMES = ['core', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const USE = {
  core: { n: 'EU Commercial High', ne: 'EU Commercial High', se: 'EU Commercial High', s: 'EU Commercial High', w: 'EU Commercial High' },
  b1: { n: 'Office High', ne: 'Office High', se: 'EU Commercial High', s: 'EU Commercial High', w: 'EU Commercial High' },
  b2: { n: 'Office High', ne: 'Office High', se: 'EU Residential High', s: 'EU Residential High', w: 'EU Residential High' },
  b3: { n: 'Industrial Manufacturing', ne: 'Office Low', se: 'EU Residential Mixed', s: 'EU Residential Mixed', w: 'EU Residential Mixed' },
  b4: { n: 'Industrial Manufacturing', ne: 'Office Low', se: 'EU Residential Medium Row', s: 'EU Residential Medium Row', w: 'EU Residential Medium Row' },
  b5: { n: 'Industrial Manufacturing', ne: 'EU Commercial Low', se: 'EU Residential Medium', s: 'EU Residential Medium', w: 'EU Residential Medium' },
  b6: { n: 'Industrial Manufacturing', ne: 'EU Residential Low', se: 'EU Residential Low', s: 'EU Residential Low', w: 'EU Residential Low' },
};
const HH_M2 = {
  'EU Residential Low': 300, 'EU Residential Medium Row': 170, 'EU Residential Medium': 120,
  'EU Residential Mixed': 100, 'EU Residential High': 100,
};
const A_EDGES = [0, ...RING_A, Math.round(APOTHEM)];
function bandOf(aMetric) { for (let k = 0; k + 1 < A_EDGES.length; k += 1) if (aMetric < A_EDGES[k + 1]) return k; return 6; }
function sectorOf(angle) {
  let best = 0; let bd = Infinity;
  for (let k = 0; k < 5; k += 1) { const diff = Math.abs(((angle - VERTEX_ANG[k] + 540) % 360) - 180); if (diff < bd) { bd = diff; best = k; } }
  return best;
}
function useFor(aMetric, angle) {
  const band = BAND_NAMES[bandOf(aMetric)]; const sector = SECTOR_ID[sectorOf(angle)];
  if (band === 'core' && aMetric < 80) return { zone: null, district: 'core' };
  return { zone: USE[band][sector], district: `${sector}-${band}` };
}

// ---------------------------------------------------------------- zoning raster + greedy rectangle merge
const allSegs = [];
for (const rd of roads) for (let i = 0; i + 1 < rd.points.length; i += 1) allSegs.push({ a: rd.points[i], b: rd.points[i + 1], half: rd.width_m / 2 });
function segDist(px, pz, a, b) {
  const vx = b.x - a.x; const vz = b.z - a.z; const len2 = vx * vx + vz * vz || 1;
  let t = ((px - a.x) * vx + (pz - a.z) * vz) / len2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * vx), pz - (a.z + t * vz));
}
const CELL = 16;
const BOUNDS = { min_x: snap8(OWNED.min_x) + 8, min_z: snap8(OWNED.min_z) + 8, max_x: snap8(OWNED.max_x) - 8, max_z: snap8(OWNED.max_z) - 8 };
const NX = Math.ceil((BOUNDS.max_x - BOUNDS.min_x) / CELL);
const NZ = Math.ceil((BOUNDS.max_z - BOUNDS.min_z) / CELL);
const grid = new Array(NX * NZ).fill(null);
for (let iz = 0; iz < NZ; iz += 1) {
  for (let ix = 0; ix < NX; ix += 1) {
    const x = BOUNDS.min_x + ix * CELL + CELL / 2;
    const z = BOUNDS.min_z + iz * CELL + CELL / 2;
    if (!pointInPoly({ x, z }, PENT)) continue;
    if (distToPolyEdge({ x, z }, PENT) < 6) continue;
    let minCurb = Infinity;
    for (const s of allSegs) { const d = segDist(x, z, s.a, s.b) - s.half; if (d < minCurb) minCurb = d; if (minCurb < 0) break; }
    if (minCurb < 0 || minCurb > 48) continue;
    const { radius, angle } = polarOf(x, z);
    let phi = Infinity;
    for (const bA of BISECTOR_ANG) phi = Math.min(phi, Math.abs(((angle - bA + 540) % 360) - 180));
    const aMetric = radius * Math.cos(phi * DEG);
    if (aMetric > APOTHEM + 12) continue;
    let inReserve = false;
    for (const r of reserves) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) { inReserve = true; break; }
    if (inReserve) continue;
    const use = useFor(aMetric, angle);
    if (!use.zone) continue;
    grid[iz * NX + ix] = `${use.zone}|${use.district}`;
  }
}
const visited = new Array(NX * NZ).fill(false);
const rects = [];
for (let iz = 0; iz < NZ; iz += 1) {
  for (let ix = 0; ix < NX; ix += 1) {
    const idx = iz * NX + ix;
    if (visited[idx] || !grid[idx]) continue;
    const key = grid[idx];
    let ix2 = ix;
    while (ix2 + 1 < NX && !visited[iz * NX + ix2 + 1] && grid[iz * NX + ix2 + 1] === key) ix2 += 1;
    let iz2 = iz;
    outer: while (iz2 + 1 < NZ) {
      for (let i2 = ix; i2 <= ix2; i2 += 1) { const j = (iz2 + 1) * NX + i2; if (visited[j] || grid[j] !== key) break outer; }
      iz2 += 1;
    }
    for (let jz = iz; jz <= iz2; jz += 1) for (let jx = ix; jx <= ix2; jx += 1) visited[jz * NX + jx] = true;
    rects.push({ x0: BOUNDS.min_x + ix * CELL, x1: BOUNDS.min_x + (ix2 + 1) * CELL, z0: BOUNDS.min_z + iz * CELL, z1: BOUNDS.min_z + (iz2 + 1) * CELL, key });
  }
}
function unionPolygons(keyRects) {
  const xs = [...new Set(keyRects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const zs = [...new Set(keyRects.flatMap((r) => [r.z0, r.z1]))].sort((a, b) => a - b);
  const xi = new Map(xs.map((v, i) => [v, i])); const zi = new Map(zs.map((v, i) => [v, i]));
  const inside = new Set();
  for (const r of keyRects) for (let iz = zi.get(r.z0); iz < zi.get(r.z1); iz += 1) for (let ix = xi.get(r.x0); ix < xi.get(r.x1); ix += 1) inside.add(`${ix}:${iz}`);
  const isIn = (ix, iz) => ix >= 0 && ix < xs.length - 1 && iz >= 0 && iz < zs.length - 1 && inside.has(`${ix}:${iz}`);
  const edges = new Map();
  const addEdge = (a, b) => { const k = `${a.x},${a.z}`; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (let iz = 0; iz < zs.length - 1; iz += 1) for (let ix = 0; ix < xs.length - 1; ix += 1) {
    if (!isIn(ix, iz)) continue;
    const x0 = xs[ix]; const x1 = xs[ix + 1]; const z0 = zs[iz]; const z1 = zs[iz + 1];
    if (!isIn(ix, iz - 1)) addEdge({ x: x0, z: z0 }, { x: x1, z: z0 });
    if (!isIn(ix + 1, iz)) addEdge({ x: x1, z: z0 }, { x: x1, z: z1 });
    if (!isIn(ix, iz + 1)) addEdge({ x: x1, z: z1 }, { x: x0, z: z1 });
    if (!isIn(ix - 1, iz)) addEdge({ x: x0, z: z1 }, { x: x0, z: z0 });
  }
  const polygons = [];
  while (edges.size) {
    const [startKey, outs] = [...edges][0];
    const start = startKey.split(',').map(Number);
    const loop = [{ x: start[0], z: start[1] }];
    let cur = outs.shift(); if (!outs.length) edges.delete(startKey);
    while (cur.x !== start[0] || cur.z !== start[1]) {
      loop.push({ x: cur.x, z: cur.z });
      const k = `${cur.x},${cur.z}`; const nexts = edges.get(k);
      if (!nexts || !nexts.length) break;
      cur = nexts.shift(); if (!nexts.length) edges.delete(k);
    }
    if (loop.length >= 4) polygons.push(loop);
  }
  return polygons;
}
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i += 1) { const p = poly[i]; const q = poly[(i + 1) % poly.length]; a += p.x * q.z - q.x * p.z; } return a / 2; }
const areaByZone = new Map();
const keyRects = new Map();
for (const r of rects) { if (!keyRects.has(r.key)) keyRects.set(r.key, []); keyRects.get(r.key).push(r); }
let zoneSeq = 0;
for (const key of [...keyRects.keys()].sort()) {
  const [zone, district] = key.split('|');
  for (const poly of unionPolygons(keyRects.get(key))) {
    const a = signedArea(poly);
    if (a <= 0 || a < 1) continue;
    zoneSeq += 1;
    zones.push({ id: `z-${district}-${zoneSeq}`, kind: zone, label: `${district} / ${zone}`, district, area_m2: Math.round(a), polygon: poly });
    areaByZone.set(zone, (areaByZone.get(zone) ?? 0) + a);
  }
}
if (zones.length > 1000) throw new Error(`zone polygons ${zones.length} exceed the 1024 limit`);

// ---------------------------------------------------------------- population accounting
const peopleLo = 2.2; const peopleHi = 2.8;
let households = 0; const hhBreakdown = [];
for (const [zone, area] of [...areaByZone].sort((a, b) => b[1] - a[1])) {
  const m2 = HH_M2[zone]; if (!m2) continue;
  const hh = Math.round(area / m2); households += hh;
  hhBreakdown.push({ zone_type: zone, area_m2: Math.round(area), household_area_m2: m2, households: hh });
}
const populationMid = Math.round(households * (peopleLo + peopleHi) / 2);
const zoneableArea = Math.round([...areaByZone.values()].reduce((a, b) => a + b, 0));
const residentialArea = Math.round([...areaByZone].filter(([z]) => HH_M2[z]).reduce((a, [, v]) => a + v, 0));
const pentagonArea = 2.5 * R_OUT * R_OUT * Math.sin(72 * DEG);
const densityPerKm2 = Math.round(populationMid / (pentagonArea / 1e6));

// ---------------------------------------------------------------- assertions
for (const p of [...roads.flatMap((r) => r.points), ...buildings.map((b) => b.position)]) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error(`non-finite coordinate ${JSON.stringify(p)}`);
  if (p.x % 8 !== 0 || p.z % 8 !== 0) throw new Error(`not on the 8 m grid ${JSON.stringify(p)}`);
}
for (const r of roads) {
  if (r.points.length < 2) throw new Error(`road ${r.id} has too few points`);
  for (let i = 1; i < r.points.length; i += 1) {
    const d = Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].z - r.points[i - 1].z);
    if (d < 16) throw new Error(`road ${r.id} segment ${i} is ${d.toFixed(1)} m (<16 m minimum)`);
  }
  for (const p of r.points) if (p.x < OWNED.min_x || p.x > OWNED.max_x || p.z < OWNED.min_z || p.z > OWNED.max_z) throw new Error(`road ${r.id} outside the purchased area ${JSON.stringify(p)}`);
}
const ids = new Set();
for (const o of [...roads, ...buildings, ...zones]) { if (!o.id) throw new Error('missing id'); if (ids.has(o.id)) throw new Error(`duplicate id ${o.id}`); ids.add(o.id); }
if (placementFailures.length) throw new Error(`placement failed for ${placementFailures.length}: ${placementFailures.join('; ')}`);

// ---------------------------------------------------------------- output
const plan = { roads, buildings, zones, grid_exceptions: [], tracks: [], utilities: [] };
const planId = computeCityPlanId(BOUNDS, plan);
const doc = {
  plan_id: planId, city: 'Midhurst', name: 'Pentagon City master plan', target_population: 20000,
  bounds: BOUNDS,
  render: { title: 'Midhurst / Pentagon City master plan (radial avenues, concentric rings, south civic band)', width: 1600, height: 1600, view: 'combined', format: 'static_html' },
  water_cell_size_m: 32, terrain_cell_size_m: 64,
  morphology: {
    shape: 'regular pentagon, vertices snapped to the 8 m grid', center: CENTER, outer_radius_m: R_OUT,
    apothem_m: Math.round(APOTHEM), boundary_clearance_m: Math.round(SQ_HALF - R_OUT),
    ring_apothems_m: RING_A, pentagon_area_m2: Math.round(pentagonArea),
    purchased_area_m2: Math.round((OWNED.max_x - OWNED.min_x) * (OWNED.max_z - OWNED.min_z)),
  },
  golden_block: {
    curb_to_curb_m: 96,
    ring_road: { prefab: 'Small Road', width_m: 16, apothem_step_m: 120, note: '120 m centre spacing -> 96 m curb to curb' },
    radial_road: { prefab: 'Medium Road', width_m: 24 },
  },
  districts: [
    { id: 'core', name: 'Central commercial core', kind: 'commercial' },
    { id: 'n', name: 'North industrial sector', kind: 'industrial' },
    { id: 'ne', name: 'North-east office sector', kind: 'office' },
    { id: 'se', name: 'South-east housing sector', kind: 'residential' },
    { id: 's', name: 'South housing sector', kind: 'residential' },
    { id: 'w', name: 'West housing sector', kind: 'residential' },
    { id: 'campus', name: 'South civic band', kind: 'civic' },
  ],
  access_points: [
    { id: 'gate-north', position: { x: snap8(NORTH_HUB.x), z: snap8(OWNED.max_z - 48) }, note: 'Primary external connection, also the freight entrance.' },
    { id: 'gate-south', position: { x: snap8(SOUTH_HUB.x), z: snap8(OWNED.min_z + 48) }, note: 'Second motor-vehicle exit for service vehicles and incident diversion.' },
  ],
  accounting: {
    pentagon_area_m2: Math.round(pentagonArea),
    zoneable_area_m2: zoneableArea, residential_zone_area_m2: residentialArea,
    effective_zoneable_ratio: Number((zoneableArea / pentagonArea).toFixed(4)),
    zone_area_by_type: [...areaByZone].map(([zone_type, area_m2]) => ({ zone_type, area_m2: Math.round(area_m2) })).sort((a, b) => b.area_m2 - a.area_m2),
    household_breakdown: hhBreakdown, households, people_per_household: [peopleLo, peopleHi],
    population_range: [Math.round(households * peopleLo), Math.round(households * peopleHi)],
    population_midpoint: populationMid, implied_density_per_km2: densityPerKm2,
  },
  basis: 'Zone areas are measured by the generator on a 16 m raster (only cells within 0-48 m of a road curb, building reserves excluded). Household footprints follow the project convention (low 300 / medium-row 170 / medium 120 / mixed 100 / high 100 m2 per household) at 2.2-2.8 people per household.',
  notes: [
    { scope: 'buildings', text: 'Every building is a conceptual reserve: no road edge, rotation or native candidate is bound yet and rotation_degrees is null. After the roads exist, bind each one with bind_city_plan_buildings and re-render before construction.' },
    { scope: 'roads', text: 'The pentagon outline (24 m Medium) is the outer ring road; five 24 m radial avenues link center and vertices; inner rings are 16 m Small Roads at 120 m apothem steps (96 m curb to curb). The polar layout does not share the global 8 m phase; measured curb spacing lands in 96-120 m. Segments over 256 m are split by the construction executor at a 240 m safety line.' },
    { scope: 'layout', text: 'The north sector is industry with a dedicated 32 m freight spine from the north gate, so heavy trucks never cross housing. The north-east sector is office; south-east, south and west are housing. The civic band south of the pentagon holds the city hall, hospital, college, high school, welfare office, police and fire headquarters, cemetery, crematorium, research institute, landfill, recycling centre, wastewater plant, power plant and battery station.' },
    { scope: 'geometry', text: 'The largest clear rectangle inside the pentagon between two adjacent radial avenues is roughly 84-130 m, so no 100 m+ civic building fits inside; every large footprint is therefore placed in the south civic band. Small community facilities (clinic, police post, primary school, parks) stay inside.' },
    { scope: 'terrain', text: 'The purchased square is flat (about 617.7 m) in the west and centre but rises steeply to 772 m on the east edge. Gates and industry avoid that slope; the plan stays on the flat band.' },
    { scope: 'utilities', text: 'Sampled surface water across all 16 purchased tiles is zero, so supply uses groundwater pumps plus water towers and sewage uses a treatment plant with no outfall. Verify ports and connection layers with list_utility_connection_points before construction.' },
    { scope: 'validation', text: 'BUILDING_ROTATION_UNRESOLVED is expected while placement_status is conceptual. Out-of-bounds, road overlap and building overlap issues must remain zero.' },
  ],
  disclaimer: 'Read-only construction draft. All buildings are conceptual reserves without native candidates, rotations or road edges; construction must go batch by batch through native preview. The plan is drawn for this save (Midhurst) and its 16 purchased tiles only.',
  plan,
};
await mkdir(path.join(ROOT, 'plans'), { recursive: true });
const outPath = path.join(ROOT, 'plans', 'midhurst-pentagon-city-plan.json');
await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({
  plan_id: planId, roads: roads.length, zones: zones.length, buildings: buildings.length,
  households, population_range: doc.accounting.population_range, population_midpoint: populationMid,
  zoneable_area_m2: zoneableArea, residential_zone_area_m2: residentialArea,
  effective_zoneable_ratio: doc.accounting.effective_zoneable_ratio, implied_density_per_km2: densityPerKm2,
  zone_area_by_type: doc.accounting.zone_area_by_type, out: outPath,
}, null, 2));
