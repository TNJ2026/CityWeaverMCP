#!/usr/bin/env node
// Evaluate the WaterTower01 prefab requirements and the soil-water / pollution conditions at
// the current tower spots versus the proposed periphery sites.
import { queryGame } from '../../mcp/bridge-client.mjs';

const OLD = [
  { id: 'cur-1', x: -141.010574, z: -1121.442 },
  { id: 'cur-2', x: -196.003326, z: -1026.121 },
  { id: 'cur-3', x: -88.0034, z: -1213.32117 },
];

const SITES = [
  { id: 'A  180deg-corner', x: -1313.9, z: -1281.4, rot: 60.0, road: 'fd537682d55349c282f74590a72dea69:48957:3' },
  { id: 'B  -60deg-corner', x: 85.9, z: -2022.8, rot: -60.0, road: 'fd537682d55349c282f74590a72dea69:359087:1' },
  { id: 'C   60deg-corner', x: -44.0, z: -439.8, rot: -180.0, road: 'fd537682d55349c282f74590a72dea69:48949:3' },
  { id: 'C2  alt 60deg', x: 103.9, z: -504.4, rot: -120.0, road: 'fd537682d55349c282f74590a72dea69:48963:3' },
  { id: 'A2  alt 240deg', x: -885.9, z: -2022.8, rot: 60.0, road: 'fd537682d55349c282f74590a72dea69:359091:1' },
  { id: 'B2  alt 240deg', x: -810.0, z: -2056.2, rot: 0.0, road: 'fd537682d55349c282f74590a72dea69:359083:1' },
];

// ---------- 1. prefab requirements ----------
const prefabs = await queryGame('list_utility_facility_prefabs', { kind: 'all' }).catch((e) => {
  console.log('list_utility_facility_prefabs ERR', e.code, e.message);
  return null;
});
if (prefabs) {
  const items = prefabs.data?.items ?? prefabs.data?.prefabs ?? [];
  const wt = items.filter((p) => /WaterTower/i.test(`${p.id ?? ''} ${p.prefab ?? ''} ${p.name ?? ''}`));
  console.log('=== WaterTower prefab records ===');
  for (const p of wt) console.log(JSON.stringify(p, null, 2));
  if (!wt.length) console.log('  (none matched; sample record:)', JSON.stringify(items[0], null, 2));
}

// ---------- 2. soil water ----------
const pts = [...OLD, ...SITES].map((s) => ({ x: s.x, z: s.z }));
const ids = [...OLD, ...SITES].map((s) => s.id);
const soil = await queryGame('sample_soil_water', { points: pts });
console.log('\n=== soil water (raw game units) ===');
soil.data.items.forEach((it, i) => {
  const nc = it.nearest_cell ?? {};
  console.log(
    `${ids[i].padEnd(18)} amount=${String(it.amount).padStart(8)}  cellAmount=${String(nc.amount).padStart(8)}  ` +
      `max=${String(nc.maximum).padStart(8)}  sat=${Number(nc.saturation ?? 0).toFixed(4)}  surf=${nc.surface_height}`,
  );
});

// ---------- 3. pollution ----------
const pol = await queryGame('sample_pollution', { points: pts }).catch((e) => {
  console.log('\nsample_pollution ERR', e.code, e.message);
  return null;
});
if (pol) {
  console.log('\n=== pollution ===');
  console.log(JSON.stringify(pol.data).slice(0, 3000));
}
