#!/usr/bin/env node
// List every live utility facility with radius/bearing from the hexagon centre, so the three
// new water-tower sites can be spaced away from what is already out there.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { readFileSync } from 'node:fs';

const CENTRE = { x: -400, z: -1248 };
const raw = readFileSync('plans/peiqi-hexagon-town-bound.json', 'utf8').replace(/^\uFEFF/, '');
const plan = JSON.parse(raw);

const r = await queryGame('list_utility_facilities', { kind: 'all' });
const items = r.data?.items ?? [];
console.log(`live facilities: ${items.length}\n`);
console.log('kind'.padEnd(13) + 'prefab'.padEnd(30) + 'position'.padEnd(26) + 'radius  bearing');
for (const it of items) {
  const p = it.position;
  const d = Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);
  const b = (Math.atan2(p.z - CENTRE.z, p.x - CENTRE.x) * 180) / Math.PI;
  console.log(
    String(it.kind).padEnd(13) + String(it.prefab).padEnd(30) +
      `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`.padEnd(26) +
      `${d.toFixed(0).padStart(5)}  ${b.toFixed(1).padStart(7)}deg`,
  );
}

// everything the plan considers a facility / special building out on the rim
console.log('\n--- plan buildings with plan radius > 700 ---');
for (const b of plan.plan.buildings) {
  const p = b.position;
  const d = Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z);
  if (d <= 700) continue;
  const bg = (Math.atan2(p.z - CENTRE.z, p.x - CENTRE.x) * 180) / Math.PI;
  console.log(
    `${b.id} ${String(b.prefab).padEnd(30)} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})  r=${d.toFixed(0)}  ${bg.toFixed(1)}deg`,
  );
}
