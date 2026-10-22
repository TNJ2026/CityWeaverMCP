#!/usr/bin/env node
// Experiment: how close can the small wind turbine sit to the ring road (outer side)?
// The 48 m the generic planner picked equals reserved-half-footprint(31.8) + road-half-width(16);
// the building lot itself is only 2x2 cells (8 m half depth), so a flush lot would be 24 m.
import { queryGame } from '../../mcp/bridge-client.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENTITY = 'fd537682d55349c282f74590a72dea69:362016:3'; // bld-009, southern turbine
const X = -435.8;
const RING_Z = -2024;               // ring road centreline (south edge, horizontal)
const ROAD_EDGE = 'fd537682d55349c282f74590a72dea69:359093:1';
const DISTANCES = [24, 28, 32, 36, 40, 44];

const IN_FLIGHT = ['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building'];
async function poll(opId) {
  let d = null;
  for (let i = 0; i < 300; i++) {
    d = (await queryGame('get_building_operation', { operation_id: opId })).data;
    if (d.state && !IN_FLIGHT.includes(d.state)) break;
    await sleep(100);
  }
  return d;
}

for (const d of DISTANCES) {
  const z = RING_Z - d;
  const rid = `wind-close-${d}-${Date.now()}`;
  let q;
  try {
    q = await queryGame('preview_building_move', {
      request_id: rid, building_id: ENTITY, position: { x: X, z }, rotation_degrees: 0, road_edge_id: ROAD_EDGE,
    });
  } catch (e) {
    console.log(`d=${String(d).padStart(3)} m  ERR ${e.code} ${String(e.message).slice(0, 150)}`);
    await sleep(700);
    continue;
  }
  const op = await poll(q.data.operation_id);
  const errs = op.errors ?? op.error ?? [];
  console.log(
    `d=${String(d).padStart(3)} m  z=${z.toFixed(1)}  state=${op.state}${op.state === 'preview_ready' ? ' (OK)' : ''} ` +
    `cost=${op.cost} errors=${JSON.stringify(errs).slice(0, 240)}`,
  );
  await queryGame('cancel_building_preview', { operation_id: q.data.operation_id }).catch(() => {});
  await sleep(800);
}
