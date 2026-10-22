#!/usr/bin/env node
// Move the three WaterTower01 facilities from the hexagon core out to the OUTERMOST periphery:
// the three alternating hexagon corners (60deg / 180deg / 300deg), roadside on the outer side of
// the ring road, lot frontage flush with the road edge so the road-embedded water main reaches them.
//
// Method (per BUILDING-GUIDE "道路绑定硬门禁"):
//   G1  fresh live candidate from plan_utility_facility_site -> pass its exact
//       position / rotation_degrees / road_edge_id into the preview, unmodified
//   G2  native preview must reach state=preview_ready with empty errors and can_commit
//   G3  after commit, read back the permanent entity: Game.Buildings.Building.m_RoadEdge must
//       point at the ring-road edge, and the water producer edge must be non-null
//
// Acceptance after the move: every water consumer with demand keeps WaterConnected (no consumer
// loses fresh water) and each tower keeps a non-null producer edge.
//
// Usage:
//   node tools/scratch/move-water-towers-to-perimeter.mjs --dry-run
//   node tools/scratch/move-water-towers-to-perimeter.mjs
//   node tools/scratch/move-water-towers-to-perimeter.mjs --skip-verify
import { queryGame } from '../../mcp/bridge-client.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const SKIP_VERIFY = argv.includes('--skip-verify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_FLIGHT = new Set(['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building']);

const CENTRE = { x: -400, z: -1248 };
const R_EDGE = 896 * Math.cos(Math.PI / 6); // 776 — apothem, the ring road at edge midpoints

// hexagon vertices, in plan order (V0 -> V1 -> ... -> V5)
const V = [
  { x: 496, z: -1248 },   // 0deg
  { x: 48, z: -472 },     // 60deg
  { x: -848, z: -472 },   // 120deg
  { x: -1296, z: -1248 }, // 180deg
  { x: -848, z: -2024 },  // 240deg
  { x: 48, z: -2024 },    // 300deg
];

// Three towers, each of which will be handed the free outer-rim site nearest to where it stands.
const TOWERS = [
  {
    planId: 'bld-005', label: '水塔 3',
    facilityId: 'fd537682d55349c282f74590a72dea69:391504:55',
    old: { x: -196.003326, z: -1026.121 },
  },
  {
    planId: 'bld-004', label: '水塔 2',
    facilityId: 'fd537682d55349c282f74590a72dea69:391421:57',
    old: { x: -88.0034, z: -1213.32117 },
  },
  {
    planId: 'bld-003', label: '水塔 1',
    facilityId: 'fd537682d55349c282f74590a72dea69:391396:55',
    old: { x: -141.010574, z: -1121.442 },
  },
];

async function call(tool, args, { retries = 8, backoffMs = 700 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await queryGame(tool, args); }
    catch (e) {
      lastErr = e;
      if (String(e.code) !== 'TOOL_BUSY') throw e;
      await sleep(backoffMs * (i + 1));
    }
  }
  throw lastErr;
}

async function paged(tool, baseArgs, pageSize = 100) {
  const items = [];
  let offset = 0, snapshotId;
  for (;;) {
    const d = (await call(tool, { ...baseArgs, offset, limit: pageSize, ...(snapshotId ? { snapshot_id: snapshotId } : {}) })).data;
    items.push(...(d.items ?? []));
    snapshotId = d.snapshot_id ?? snapshotId;
    if (d.next_offset == null || !(d.items ?? []).length) break;
    offset = d.next_offset;
  }
  return items;
}

async function poll(api, opId, { tries = 500 } = {}) {
  let d = null;
  for (let i = 0; i < tries; i++) {
    d = (await call(api, { operation_id: opId }, { retries: 4 })).data;
    if (d.state && !IN_FLIGHT.has(d.state)) return d;
    await sleep(100);
  }
  return d;
}

const distC = (p) => Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);
const flagName = (f) => (f && typeof f === 'object' ? f.name : f) ?? 'None';

async function facilities() {
  return (await call('list_utility_facilities', { kind: 'all' })).data.items ?? [];
}

async function towerState(facilityId) {
  const f = (await facilities()).find((x) => x.facility_id === facilityId);
  if (!f) return null;
  const comp = await call('get_entity_components', {
    entity_id: facilityId,
    components: ['Game.Buildings.Building', 'Game.Simulation.WaterPipeBuildingConnection', 'Game.Buildings.WaterTower'],
  }).then((r) => r.data).catch(() => null);
  return {
    facility: f,
    roadEdge: comp?.components?.['Game.Buildings.Building']?.fields?.m_RoadEdge ?? null,
    producerEdge: comp?.components?.['Game.Simulation.WaterPipeBuildingConnection']?.fields?.m_ProducerEdge ?? null,
    consumerEdge: comp?.components?.['Game.Simulation.WaterPipeBuildingConnection']?.fields?.m_ConsumerEdge ?? null,
    hasWaterTowerComponent: comp?.components?.['Game.Buildings.WaterTower']?.present ?? null,
  };
}

async function waterMetrics() {
  const consumers = await paged('query_entities', {
    all_components: ['Game.Buildings.WaterConsumer'],
    include_components: ['Game.Buildings.WaterConsumer'],
  });
  const issues = [];
  let wanted = 0, waterOk = 0, waterMissing = 0, sewageOk = 0;
  for (const it of consumers) {
    const c = it.components?.['Game.Buildings.WaterConsumer']?.fields ?? {};
    const w = Number(c.m_WantedConsumption ?? 0);
    const flags = flagName(c.m_Flags);
    if (w > 0) wanted++;
    if (flags.includes('WaterConnected')) waterOk++;
    else if (w > 0) { waterMissing++; if (issues.length < 8) issues.push({ id: it.entity_id, prefab: it.prefab_name, wanted: w, flags }); }
    if (flags.includes('SewageConnected')) sewageOk++;
  }
  const pipeEdges = await paged('query_entities', {
    all_components: ['Game.Simulation.WaterPipeEdge'],
    include_components: ['Game.Simulation.WaterPipeEdge'],
  });
  const flagCount = {};
  let freshFlow = 0, freshCap = 0, disconnectedInUse = 0;
  for (const it of pipeEdges) {
    const c = it.components?.['Game.Simulation.WaterPipeEdge']?.fields ?? {};
    const name = flagName(c.m_Flags);
    for (const f of name.split(/[,\s|]+/).filter((x) => x && x !== 'None')) flagCount[f] = (flagCount[f] ?? 0) + 1;
    freshFlow += Number(c.m_FreshFlow ?? 0);
    freshCap += Number(c.m_FreshCapacity ?? 0);
    // the map's outside-connection sentinel edges carry capacity 2^30-1 and are permanently
    // "disconnected" by design; exclude them from the health count
    if (name.includes('WaterDisconnected') && Number(c.m_FreshCapacity ?? 0) < 1 << 20) disconnectedInUse++;
  }
  return { consumers: consumers.length, wanted, waterOk, waterMissing, sewageOk, issues, pipeEdges: pipeEdges.length, pipeFlags: flagCount, freshFlow, freshCap, disconnectedInUse };
}

function anchorFor(t) {
  const A = V[t.anchorEdge], B = V[(t.anchorEdge + 1) % V.length];
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
  const nx = mx - CENTRE.x, nz = mz - CENTRE.z, nl = Math.hypot(nx, nz);
  const base = { x: A.x + (B.x - A.x) * t.anchorT, z: A.z + (B.z - A.z) * t.anchorT };
  return { x: +(base.x + (nx / nl) * 60).toFixed(1), z: +(base.z + (nz / nl) * 60).toFixed(1) };
}
const out = { at: new Date().toISOString(), dryRun: DRY, centre: CENTRE, rEdge: +R_EDGE.toFixed(2), towers: TOWERS };
let initialPaused = true;

try {
  // ---------- preflight ----------
  console.log('=== preflight ===');
  const status = (await call('get_game_status', {})).data;
  initialPaused = !!status.paused;
  const summary = await call('get_city_summary', {}).then((r) => r.data).catch(() => null);
  console.log(`  city="${status.city_name}" bridge=${status.bridge_version} paused=${status.paused}` +
    (summary ? `  money=${summary.money ?? summary.city_money ?? '—'} pop=${summary.population ?? '—'}` : ''));
  out.before = { paused: status.paused, summary };

  const plan = JSON.parse(fs.readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, ''));
  const snap = await call('get_planning_map_snapshot', { bounds: plan.bounds, include_roads: true, max_features_per_layer: 4000 });
  const roads = snap.data.roads ?? [];
  const ringIds = new Set(roads.filter((r) => /large/i.test(r.prefab)).map((r) => r.id));
  const liveBuildings = snap.data.buildings ?? [];
  console.log(`  live roads ${roads.length} (ring ${ringIds.size}); live buildings ${liveBuildings.length}`);

  const bez = (c, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * c.a.x + 3 * u * u * t * c.b.x + 3 * u * t * t * c.c.x + t * t * t * c.d.x,
      z: u * u * u * c.a.z + 3 * u * u * t * c.b.z + 3 * u * t * t * c.c.z + t * t * t * c.d.z,
    };
  };
  const ringPts = [];
  for (const r of roads) if (ringIds.has(r.id)) for (let i = 0; i <= 24; i++) ringPts.push(bez(r.curve, i / 24));
  const gapToRing = (p) => ringPts.reduce((b, q) => Math.min(b, Math.hypot(q.x - p.x, q.z - p.z)), Infinity);
  const nearestBuilding = (p) => liveBuildings.reduce((b, e) => {
    const q = e.position; if (!q) return b;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    return d < b.d ? { d, e } : b;
  }, { d: Infinity, e: null });

  // Stay on the hexagon ring itself. Large Road edges whose closest approach to the centre is
  // 870 m or less are the six sides of the ring (apothem 776 .. corner 846); anything farther out
  // is a separate spur poking beyond the hexagon, which we do not want to hang water towers on.
  const ringEdgeIds = new Set();
  for (const r of roads) {
    if (!ringIds.has(r.id)) continue;
    let min = Infinity;
    for (let i = 0; i <= 40; i++) { const q = bez(r.curve, i / 40); const d = distC(q); if (d < min) min = d; }
    if (min <= 870) ringEdgeIds.add(r.id);
  }
  console.log(`  ring sides: ${ringEdgeIds.size} of ${ringIds.size} Large Road edges (excluded ${ringIds.size - ringEdgeIds.size} outer spur edge(s))`);

  const wm = await waterMetrics();
  console.log(`  water baseline: consumers=${wm.consumers} wanted=${wm.wanted} WaterConnected=${wm.waterOk} missing=${wm.waterMissing} ` +
    `sewageOk=${wm.sewageOk} pipeEdges=${wm.pipeEdges} flags=${JSON.stringify(wm.pipeFlags)} freshFlow=${wm.freshFlow}`);
  out.before.water = wm;

  console.log('\n=== current tower state ===');
  for (const t of TOWERS) {
    const st = await towerState(t.facilityId);
    console.log(`  ${t.planId} ${t.label}  (${st.facility.position.x.toFixed(1)}, ${st.facility.position.z.toFixed(1)}) r=${distC(st.facility.position).toFixed(0)}` +
      `  production=${st.facility.last_water_production}  road_edge=${st.facility.road_edge_id}  producerEdge=${st.producerEdge}`);
    t.before = {
      position: st.facility.position, road_edge_id: st.facility.road_edge_id, m_RoadEdge: st.roadEdge,
      producerEdge: st.producerEdge, last_water_production: st.facility.last_water_production,
    };
  }

  // ---------- G1: plan fresh candidates around the whole ring, then pick three ----------
  // The planner's sampler is local and stochastic, so sweep anchors around the entire ring and
  // pick from the union: outermost first, spread roughly 120deg apart, clear of everything else.
  console.log('\n=== G1 ring scan (fresh live candidates) ===');
  const pool = new Map();
  const anchors = [];
  for (let e = 0; e < 6; e++) {
    for (let t = 0.05; t <= 0.95; t += 0.06) {
      const tt = +t.toFixed(2);
      const anchor = anchorFor({ anchorEdge: e, anchorT: tt });
      anchors.push({ edge: e, t: tt, anchor });
      try {
        const r = await call('plan_utility_facility_site', {
          building_prefab: 'WaterTower01', near: anchor, mode: 'road_edge',
          search_radius_m: 120, road_side: 'either', candidate_count: 12,
        });
        for (const c of r.data?.candidates ?? []) {
          const key = `${c.position.x.toFixed(1)}|${c.position.z.toFixed(1)}`;
          if (!pool.has(key)) pool.set(key, { ...c, anchorEdge: e });
        }
      } catch (err) {
        console.log(`   anchor e${e} t${tt} ERR ${err.code}: ${String(err.message).slice(0, 110)}`);
      }
      await sleep(90);
    }
  }
  const all = [...pool.values()];
  const viable = all.filter((c) => ringEdgeIds.has(c.road_edge_id) && distC(c.position) > R_EDGE && !c.approximate_collision);
  console.log(`  ${anchors.length} anchors -> ${all.length} distinct candidates -> ${viable.length} usable (on ring, outside, no collision)`);

  // clear of everything already built: water towers are 31.6 m square, so 40 m is a safe margin
  const CLEARANCE_M = 40;
  for (const c of viable) c.nearest = nearestBuilding(c.position);
  const clear = viable.filter((c) => c.nearest.d >= CLEARANCE_M);
  console.log(`  ${clear.length} of them are at least ${CLEARANCE_M} m from any existing building`);

  // greedy: outermost first, then keep at least 100deg of angular separation
  const bearing = (p) => (Math.atan2(p.z - CENTRE.z, p.x - CENTRE.x) * 180) / Math.PI;
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const picked = [];
  for (const c of [...clear].sort((a, b) => distC(b.position) - distC(a.position))) {
    const b = bearing(c.position);
    if (picked.every((p) => angDiff(p.bearing, b) >= 100)) picked.push({ ...c, bearing: b });
    if (picked.length === 3) break;
  }
  if (picked.length < 3) throw new Error(`only ${picked.length} spread-out outer sites found`);
  picked.sort((a, b) => b.bearing - a.bearing);

  // hand each tower the site closest to where it stands now, so no tower crosses the city,
  // and give it a fallback ladder: every other clear candidate in the same +-45deg sector,
  // outermost first. The native preview is the final judge, so the ladder is what saves a
  // tower when the sampler's candidate later turns out to collide with a non-ring road.
  const free = new Set(picked);
  for (const t of TOWERS) {
    let best = null;
    for (const p of free) {
      const d = Math.hypot(p.position.x - t.old.x, p.position.z - t.old.z);
      if (!best || d < best.d) best = { d, p };
    }
    free.delete(best.p);
    const siteRec = (p) => ({
      position: p.position, rotation_degrees: p.rotation_degrees,
      road_edge_id: p.road_edge_id, road_prefab: p.road_prefab, road_side: p.road_side,
      index: p.index, dCentre: +distC(p.position).toFixed(1),
      gapToRing: +gapToRing(p.position).toFixed(1),
      bearing: +bearing(p.position).toFixed(1),
      nearestBuilding: { id: p.nearest.e?.id ?? p.nearest.e?.entity_id, prefab: p.nearest.e?.prefab, d: +p.nearest.d.toFixed(1) },
    });
    t.site = siteRec(best.p);
    t.nearestBuilding = t.site.nearestBuilding;
    t.ladder = [t.site, ...clear
      .filter((c) => c !== best.p && angDiff(bearing(c.position), t.site.bearing) <= 45)
      .sort((a, b) => distC(b.position) - distC(a.position))
      .slice(0, 14)
      .map(siteRec)];
    t.candidateCount = all.length;
    t.viableCount = viable.length;
    console.log(
      `  ${t.planId} ${t.label}  from (${t.old.x.toFixed(1)}, ${t.old.z.toFixed(1)}) r=${distC(t.old).toFixed(0)}` +
      `  ->  (${t.site.position.x.toFixed(1)}, ${t.site.position.z.toFixed(1)}) rot=${Number(t.site.rotation_degrees).toFixed(1)}` +
      `  r=${t.site.dCentre} bearing=${t.site.bearing}deg  gap=${t.site.gapToRing}  side=${t.site.road_side}  ${t.site.road_edge_id}`,
    );
    console.log(`      nearest building ${t.nearestBuilding.prefab} @ ${t.nearestBuilding.d} m | fallback ladder: ${t.ladder.length - 1} more sites in the same +-45deg sector`);
  }

  if (TOWERS.some((t) => !t.site)) throw new Error('site planning failed for at least one tower');
  if (DRY) {
    console.log('\n(dry-run) — no previews raised, nothing committed');
    fs.writeFileSync('tools/scratch/_water-tower-relocation.json', JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // ---------- pause ----------
  if (!initialPaused) await call('set_simulation_speed', { speed: 'paused' });
  await sleep(800);
  console.log(`\nsimulation paused: ${(await call('get_game_status', {})).data.paused}`);

  // ---------- G2 + commit ----------
  // Preview all three first (previews only stage temporary entities), then commit them together,
  // so a bad preview cannot leave a half-finished relocation. For each tower, walk its ladder
  // until the native preview comes back clean — the preview, not the sampler, is the judge.
  console.log('\n=== G2 preview (walk the ladder until the native preview is clean) ===');
  for (const t of TOWERS) {
    t.attempts = [];
    for (const s of t.ladder) {
      const rid = `water-move-${t.planId}-${Date.now()}`;
      let d = null, opId = null;
      try {
        const q = await call('preview_utility_facility_move', {
          request_id: rid, facility_id: t.facilityId,
          position: { x: s.position.x, z: s.position.z },
          rotation_degrees: s.rotation_degrees,
          road_edge_id: s.road_edge_id,
        });
        opId = q.data.operation_id;
        d = await poll('get_utility_facility_operation', opId);
      } catch (err) {
        console.log(`  ${t.planId} (${s.position.x.toFixed(1)}, ${s.position.z.toFixed(1)}) preview ERR ${err.code}: ${String(err.message).slice(0, 110)}`);
        t.attempts.push({ site: s, error: `${err.code}: ${err.message}` });
        await sleep(300);
        continue;
      }
      const ok = d.state === 'preview_ready' && d.can_commit !== false && !(d.errors ?? []).length;
      console.log(`  ${t.planId} ${t.label}  (${s.position.x.toFixed(1)}, ${s.position.z.toFixed(1)}) r=${s.dCentre}  ` +
        `state=${d.state} can_commit=${d.can_commit} cost=${d.cost} errors=${JSON.stringify(d.errors ?? [])}${ok ? '  ACCEPT' : '  reject'}`);
      t.attempts.push({ site: s, state: d.state, can_commit: d.can_commit, cost: d.cost, errors: d.errors ?? [], ok });
      if (ok) {
        t.site = s;
        t.nearestBuilding = s.nearestBuilding;
        t.preview = { state: d.state, can_commit: d.can_commit, cost: d.cost, errors: [], operation_id: opId, request_id: rid, ok: true };
        break;
      }
      await call('cancel_utility_facility_preview', { operation_id: opId }).catch(() => {});
      await sleep(400);
    }
    if (!t.preview?.ok) throw new Error(`${t.planId} ${t.label}: no clean preview across ${t.ladder.length} candidate sites — nothing committed`);
    await sleep(300);
  }

  // water towers must avoid pollution, so record the native pollution at the accepted sites
  const pol = await call('sample_pollution', { points: TOWERS.map((t) => ({ x: t.site.position.x, z: t.site.position.z })) })
    .then((r) => r.data.items ?? []).catch(() => []);
  console.log('\n=== pollution at the accepted sites (raw 0..32767) ===');
  TOWERS.forEach((t, i) => {
    const p = pol[i] ?? {};
    t.pollution = { air: p.air ?? null, ground: p.ground ?? null, noise: p.noise ?? null };
    console.log(`  ${t.planId} ${t.label}  air=${p.air} ground=${p.ground} noise=${p.noise}`);
  });

  console.log('\n=== G2 commit ===');
  for (const t of TOWERS) {
    await call('apply_utility_facility_operation', { operation_id: t.preview.operation_id, request_id: t.preview.request_id, max_cost: Math.max(Number(t.preview.cost ?? 0), 0) + 1000 });
    const done = await poll('get_utility_facility_operation', t.preview.operation_id);
    console.log(`  ${t.planId} ${t.label}  state=${done.state} cost=${done.cost ?? t.preview.cost} errors=${JSON.stringify(done.errors ?? [])}`);
    t.commit = { state: done.state, cost: done.cost ?? t.preview.cost, errors: done.errors ?? [] };
    if (done.state !== 'completed') throw new Error(`${t.planId} move did not complete: ${done.state}`);
    const after = await towerState(t.facilityId);
    console.log(`      now at (${after.facility.position.x.toFixed(1)}, ${after.facility.position.z.toFixed(1)}) road=${after.facility.road_edge_id}`);
    await sleep(700);
  }

  // ---------- resume so the water network can re-solve ----------
  await call('set_simulation_speed', { speed: 'normal' });
  console.log(`\nsimulation resumed: paused=${(await call('get_game_status', {})).data.paused}`);

  if (SKIP_VERIFY) {
    fs.writeFileSync('tools/scratch/_water-tower-relocation.json', JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // ---------- G3 + domain acceptance ----------
  console.log('\n=== waiting for the water network to re-solve ===');
  let last = null;
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const m = await waterMetrics();
    const towers = await facilities();
    const waterTowers = towers.filter((f) => f.kind === 'water_tower');
    const producing = waterTowers.filter((f) => Number(f.last_water_production ?? 0) > 0).length;
    const totalProd = waterTowers.reduce((a, f) => a + Number(f.last_water_production ?? 0), 0);
    console.log(`  t+${(i + 1) * 5}s  WaterConnected=${m.waterOk}/${m.wanted} missing=${m.waterMissing} ` +
      `pipeFlags=${JSON.stringify(m.pipeFlags)} freshFlow=${m.freshFlow} towersProducing=${producing}/${waterTowers.length} production=${totalProd}`);
    last = { ...m, waterTowers: waterTowers.length, producing, totalProduction: totalProd };
    if (m.waterMissing === 0 && m.freshFlow > 0 && producing === 3) break;
  }
  out.after = { water: last };

  console.log('\n=== G3 readback per tower ===');
  for (const t of TOWERS) {
    const st = await towerState(t.facilityId);
    if (!st) { console.log(`  ${t.planId}: FAILED — facility missing`); t.after = { missing: true }; continue; }
    const f = st.facility;
    const roadOk = String(st.roadEdge) === String(t.site.road_edge_id);
    console.log(
      `  ${t.planId} ${t.label}  pos=(${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)})  r=${distC(f.position).toFixed(1)}\n` +
      `      road_edge_id    = ${f.road_edge_id}\n` +
      `      m_RoadEdge      = ${st.roadEdge}   ${roadOk ? 'MATCH ✓' : 'MISMATCH ✗'}\n` +
      `      producerEdge    = ${st.producerEdge}   consumerEdge=${st.consumerEdge}\n` +
      `      water production= ${f.last_water_production}   capacity=${f.water_capacity}   pollution=${f.water_pollution}`,
    );
    t.after = {
      position: f.position, road_edge_id: f.road_edge_id, m_RoadEdge: st.roadEdge, roadMatch: roadOk,
      producerEdge: st.producerEdge, last_water_production: f.last_water_production,
      water_capacity: f.water_capacity, water_pollution: f.water_pollution,
    };
  }

  console.log('\n=== water connection ports ===');
  for (const t of TOWERS) {
    const ports = await call('list_utility_connection_points', { facility_id: t.facilityId, connection: 'auto' })
      .then((r) => r.data.items ?? []).catch(() => []);
    for (const p of ports) {
      console.log(`  ${t.planId}  ${String(p.connection).padEnd(14)} ${String(p.layers).padEnd(26)} edges=${p.connected_edge_count} ext=${p.externally_connected}`);
    }
    t.ports = ports.map((p) => ({ connection: p.connection, layers: p.layers, edges: p.connected_edge_count, external: p.externally_connected }));
  }

  fs.writeFileSync('tools/scratch/_water-tower-relocation.json', JSON.stringify(out, null, 2));
  console.log('\nrecord written: tools/scratch/_water-tower-relocation.json');
} catch (e) {
  console.error('\nFATAL', e.code ?? '', e.message ?? e);
  for (const k of ['details', 'data', 'cause']) if (e[k]) console.error('  ', k, JSON.stringify(e[k]).slice(0, 800));
  try { await queryGame('set_simulation_speed', { speed: initialPaused ? 'paused' : 'normal' }); } catch { /* ignore */ }
  fs.writeFileSync('tools/scratch/_water-tower-relocation.json', JSON.stringify({ ...out, fatal: { code: e.code, message: e.message } }, null, 2));
  process.exit(1);
}
