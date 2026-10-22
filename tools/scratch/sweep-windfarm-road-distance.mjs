#!/usr/bin/env node
// Preview sweep: find the closest allowed access-road distance on each turbine's entrance side.
// Rule discovered from the 66 bound buildings: forward = (sin rot, cos rot) faces the road,
// and the lot's front edge is flush with the road edge.
import { queryGame } from '../../mcp/bridge-client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TURBINES = [
  { id: 'bld-007', label: '小型风机 1', x: 634.0, z: -658.8, rot: 121.50721 },
  { id: 'bld-008', label: '小型风机 2', x: 694.4, z: -587.8, rot: 128.4051 },
  { id: 'bld-009', label: '小型风机 3', x: 681.6, z: -715.8, rot: 108.372574 },
];

const CANDIDATE_DISTANCES = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64];
const HALF_LEN = 40;

async function previewRoad(prefab, start, end) {
  const requestId = `wind-sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const q = await queryGame('preview_road', {
    request_id: requestId, response_detail: 'full', road_prefab: prefab, start, end,
  });
  const opId = q.data.operation_id;
  let d = null;
  for (let i = 0; i < 120; i++) {
    const r = await queryGame('get_road_operation', { operation_id: opId });
    d = r.data;
    if (d.state && !['queued', 'executing', 'pending', 'generating_preview'].includes(d.state)) break;
    await sleep(80);
  }
  const ok = d?.state === 'preview_ready';
  const errors = d?.errors ?? d?.error ?? [];
  await queryGame('cancel_road_preview', { operation_id: opId }).catch(() => {});
  return { ok, errors: Array.isArray(errors) ? errors : [errors], cost: d?.cost, state: d?.state };
}

const prefab = process.argv[2] ?? 'Small Road';
const only = process.argv[3]; // optional turbine id

for (const t of TURBINES) {
  if (only && t.id !== only) continue;
  const r = (t.rot * Math.PI) / 180;
  const f = { x: Math.sin(r), z: Math.cos(r) };      // entrance direction
  const n = { x: f.z, z: -f.x };                      // road runs perpendicular to the entrance
  console.log(`\n--- ${t.id} ${t.label} (${t.x}, ${t.z}) rot=${t.rot}`);
  console.log(`    entrance dir f=(${f.x.toFixed(4)}, ${f.z.toFixed(4)})  road axis n=(${n.x.toFixed(4)}, ${n.z.toFixed(4)})`);
  for (const dist of CANDIDATE_DISTANCES) {
    const c = { x: t.x + dist * f.x, z: t.z + dist * f.z };
    const start = { x: +(c.x - HALF_LEN * n.x).toFixed(2), z: +(c.z - HALF_LEN * n.z).toFixed(2) };
    const end = { x: +(c.x + HALF_LEN * n.x).toFixed(2), z: +(c.z + HALF_LEN * n.z).toFixed(2) };
    const res = await previewRoad(prefab, start, end);
    console.log(
      `    d=${String(dist).padStart(3)} m  centre(${c.x.toFixed(1)}, ${c.z.toFixed(1)})  ` +
      `${res.ok ? 'OK  ' : 'FAIL'} state=${res.state}${res.errors.length ? '  errors=' + JSON.stringify(res.errors).slice(0, 220) : ''}`,
    );
  }
}
