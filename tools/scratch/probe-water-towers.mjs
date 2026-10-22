#!/usr/bin/env node
// Locate every water tower in the live city: entity id, position, road binding, operational state.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const p = JSON.parse(raw);

const TARGETS = [
  { planId: 'bld-003', label: 'water tower 1', x: -141.010574, z: -1121.442 },
  { planId: 'bld-004', label: 'water tower 2', x: -88.0034, z: -1213.32117 },
  { planId: 'bld-005', label: 'water tower 3', x: -196.003326, z: -1026.121 },
];

const kinds = await queryGame('list_utility_facilities', {});
const items = kinds.data?.items ?? [];
console.log(`live utility facilities: ${items.length}`);
const byKind = {};
for (const it of items) (byKind[it.kind] ??= []).push(it);
for (const [k, v] of Object.entries(byKind)) console.log(`  kind ${k}: ${v.length}`);

console.log('\n--- facilities whose prefab matches Water ---');
for (const it of items) {
  if (!/water/i.test(`${it.prefab} ${it.kind} ${it.name ?? ''}`)) continue;
  console.log(JSON.stringify(it, null, 2));
}

console.log('\n--- nearest facility to each plan target ---');
for (const t of TARGETS) {
  let best = null;
  for (const it of items) {
    const q = it.position;
    if (!q) continue;
    const d = Math.hypot(q.x - t.x, q.z - t.z);
    if (!best || d < best.d) best = { d, it };
  }
  console.log(`\n${t.planId} ${t.label} plan=(${t.x}, ${t.z})`);
  console.log(`   nearest: ${best.it.facility_id} ${best.it.prefab} ${best.it.kind} d=${best.d.toFixed(2)}`);
  console.log(`   pos=(${best.it.position.x}, ${best.it.position.z}) road=${best.it.road_edge_id ?? 'null'}`);
}
