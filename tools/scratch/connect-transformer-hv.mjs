// Connect the relocated transformer station's high-voltage port to the map's
// high-voltage line by building a short overhead line across the open field.
//
//   HV line east free end (node ...:72519:1) : (-1374.687, -554.981)
//   transformer HV marker  (node ...405011:27): (-1041.949, -663.372)
//   distance ~350 m  -> 3 segments of ~117 m (prefab max edge length 180 m)
//
// Usage:
//   node tools/scratch/connect-transformer-hv.mjs --dry-run
//   node tools/scratch/connect-transformer-hv.mjs

import { queryGame } from '../../mcp/bridge-client.mjs';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');

const P0 = { x: -1374.687, z: -554.981, node_id: 'fd537682d55349c282f74590a72dea69:72519:1' };
const P3 = { x: -1041.94873, z: -663.371765 };

const points = [];
const N = 3;
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const p = { x: +(P0.x + (P3.x - P0.x) * t).toFixed(3), z: +(P0.z + (P3.z - P0.z) * t).toFixed(3) };
  if (i === 0) p.node_id = P0.node_id;
  points.push(p);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IN_FLIGHT = new Set(['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building']);

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

async function poll(opId) {
  let d = null;
  for (let i = 0; i < 400; i++) {
    d = (await call('get_utility_operation', { operation_id: opId }, { retries: 4 })).data;
    if (d.state && !IN_FLIGHT.has(d.state)) return d;
    await sleep(100);
  }
  return d;
}

async function hvCount() {
  const n = await call('list_utility_networks', { kind: 'all' });
  const items = n.data.items || [];
  return { total: items.length, hv: items.filter((e) => /high-voltage line/i.test(e.prefab)).length, items };
}

try {
  const netBefore = await hvCount();
  console.log('=== before ===  hv edges =', netBefore.hv, ' total =', netBefore.total);
  console.log('new line points:');
  for (const p of points) console.log('  ', JSON.stringify(p));

  await call('set_simulation_speed', { speed: 'paused' });
  await sleep(600);
  console.log('paused:', (await call('get_game_status', {})).data.paused);

  const rid = 'hv-link-' + Date.now();
  const q = await call('preview_utility_network', { request_id: rid, utility_prefab: 'High-voltage Line', points });
  const opId = q.data.operation_id;
  const d = await poll(opId);
  console.log('\npreview:', d.state, '| cost:', d.cost, '| errors:', JSON.stringify(d.errors ?? []), '| warnings:', JSON.stringify(d.warnings ?? []));
  for (const k of Object.keys(d)) {
    if (/result|edge|node|length|entity/i.test(k)) console.log('  ', k, '=', JSON.stringify(d[k]).slice(0, 400));
  }

  if (d.state !== 'preview_ready') {
    console.log('\n!! preview not ready');
    await call('cancel_utility_preview', { operation_id: opId }).catch(() => {});
    await call('set_simulation_speed', { speed: 'normal' });
    process.exit(1);
  }

  if (DRY) {
    await call('cancel_utility_preview', { operation_id: opId }).catch(() => {});
    console.log('\n(dry-run) preview ok, cancelled');
    await call('set_simulation_speed', { speed: 'normal' });
    process.exit(0);
  }

  await call('apply_utility_operation', { operation_id: opId, request_id: rid, max_cost: Math.max(Number(d.cost ?? 0), 0) + 1000 });
  const done = await poll(opId);
  console.log('\ncommit:', done.state, '| cost:', done.cost, '| errors:', JSON.stringify(done.errors ?? []));
  for (const k of Object.keys(done)) {
    if (/result|edge|node|entity/i.test(k)) console.log('  ', k, '=', JSON.stringify(done[k]).slice(0, 500));
  }

  await sleep(800);
  const netAfter = await hvCount();
  console.log('\n=== after ===  hv edges =', netAfter.hv, ' total =', netAfter.total, ' (was', netBefore.hv + ')');

  // which edges are new?
  const beforeIds = new Set(netBefore.items.map((e) => e.utility_edge_id));
  const added = netAfter.items.filter((e) => !beforeIds.has(e.utility_edge_id));
  console.log('=== newly added HV edges (' + added.length + ') ===');
  for (const e of added) {
    console.log('  ' + e.utility_edge_id + '  len=' + Number(e.length_m).toFixed(1) +
      '  (' + e.start.x.toFixed(1) + ',' + e.start.z.toFixed(1) + ') -> (' + e.end.x.toFixed(1) + ',' + e.end.z.toFixed(1) + ')');
  }

  const ports = await call('list_utility_connection_points', { facility_id: 'fd537682d55349c282f74590a72dea69:362206:3', connection: 'auto' });
  console.log('=== transformer ports now ===');
  for (const p of ports.data.items) {
    console.log('  ' + String(p.connection).padEnd(14) + String(p.layers).padEnd(24) +
      ' edges=' + p.connected_edge_count + ' ext=' + p.externally_connected +
      ' (' + p.position.x.toFixed(1) + ',' + p.position.z.toFixed(1) + ')');
  }

  await call('set_simulation_speed', { speed: 'normal' });
  await sleep(400);
  console.log('\nsimulation resumed: paused =', (await call('get_game_status', {})).data.paused);
} catch (e) {
  console.error('FATAL', e.code ?? '', e.message ?? e);
  try { await queryGame('set_simulation_speed', { speed: 'normal' }); } catch { /* ignore */ }
  process.exit(1);
}
