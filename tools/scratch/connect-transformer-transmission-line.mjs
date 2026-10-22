// Connect the relocated transformer station to the existing high-voltage
// transmission line with an overhead High-voltage Line.
//
// Key constraint: 'High-voltage Line' allows edge_length_m 0..180, so the run
// must be split so EVERY segment is <= MAX_SEGMENT_M. A single 349.9 m span is
// rejected with INVALID_UTILITY_LENGTH.
//
// Usage:
//   node tools/scratch/connect-transformer-transmission-line.mjs --list
//   node tools/scratch/connect-transformer-transmission-line.mjs [--dry-run] [--facility <id>] [--max-seg 170] [--via x,z ...]
import { queryGame } from '../../mcp/bridge-client.mjs';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const LIST_ONLY = argv.includes('--list');
const DRY_RUN = argv.includes('--dry-run');
const MAX_SEG = Number(flag('max-seg', '170'));
const FACILITY_ARG = flag('facility', null);
// Optional extra waypoints: --via x,z --via x,z
const via = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--via') continue;
  const [x, z] = String(argv[i + 1] || '').split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(z)) via.push({ x, z });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const IN_FLIGHT = new Set(['queued', 'executing', 'pending', 'generating_preview', 'applying', 'committing', 'saving', 'building']);

async function call(tool, args, { retries = 8 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try { return await queryGame(tool, args); } catch (e) {
      last = e;
      if (String(e.code) !== 'TOOL_BUSY') throw e;
      await sleep(400 * (i + 1));
    }
  }
  throw last;
}

async function poll(opId) {
  let d;
  for (let i = 0; i < 400; i++) {
    d = (await call('get_utility_operation', { operation_id: opId })).data;
    if (d.state && !IN_FLIGHT.has(d.state)) break;
    await sleep(100);
  }
  return d;
}

/** Build a polyline from start to end whose every segment is <= maxSeg. */
function buildPath(start, end, maxSeg, extraVia = []) {
  const anchors = [start, ...extraVia, end];
  const path = [anchors[0]];
  for (let a = 0; a < anchors.length - 1; a++) {
    const from = anchors[a], to = anchors[a + 1];
    const n = Math.max(1, Math.ceil(dist(from, to) / maxSeg));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      path.push({ x: +(from.x + (to.x - from.x) * t).toFixed(3), z: +(from.z + (to.z - from.z) * t).toFixed(3) });
    }
  }
  // Drop duplicates that could create a <8 m segment.
  return path.filter((p, i) => i === 0 || dist(p, path[i - 1]) >= 8);
}

const main = async () => {
  const facilities = (await call('list_utility_facilities', { kind: 'all' })).data.items || [];
  const transformers = facilities.filter(f => f.kind === 'transformer' || /Transformer/i.test(String(f.prefab)));
  if (!transformers.length) throw new Error('No transformer facility found in the live city.');

  console.log(`transformer stations in city: ${transformers.length}`);
  for (const t of transformers) {
    const r = dist(t.position, { x: -400, z: -1248 });
    console.log(`  ${t.facility_id}  ${String(t.prefab).padEnd(22)} (${t.position.x.toFixed(1)}, ${t.position.z.toFixed(1)})  r=${r.toFixed(0)}m  road=${t.road_edge_id ? 'YES' : 'NONE'}`);
  }
  const chosen = (FACILITY_ARG ? transformers.find(t => t.facility_id === FACILITY_ARG) : transformers[0]);
  if (!chosen) throw new Error(`facility ${FACILITY_ARG} is not a transformer.`);

  const networks = (await call('list_utility_networks', { kind: 'all' })).data.items || [];
  const prefabInfo = ((await call('list_utility_network_prefabs', { network_type: 'all' })).data.items || [])
    .find(p => p.name === 'High-voltage Line');
  console.log(`\nexisting networks: ${networks.length}  prefabs=${JSON.stringify([...new Set(networks.map(n => n.prefab))])}`);
  console.log(`High-voltage Line segment limit: ${prefabInfo?.edge_length_m?.min}..${prefabInfo?.edge_length_m?.max} m  cost=${prefabInfo?.construction_cost_per_m}/m`);

  // The transformer's own HV port already carries a node_id once it exists;
  // fall back to the facility position when no port entity is reported.
  const ports = (await call('list_utility_connection_points', { facility_id: chosen.facility_id, connection: 'auto' })).data.items || [];
  const hvPort = ports.find(p => String(p.connection) === 'high_voltage');
  if (!hvPort) throw new Error('Transformer exposes no high_voltage port.');
  console.log(`\nHV port: node=${hvPort.node_id}  at (${hvPort.position.x.toFixed(2)}, ${hvPort.position.z.toFixed(2)})  layers=${hvPort.layers}`);

  const endpoints = networks.flatMap(n => [
    { node_id: n.start_node_id, position: n.start, edge_id: n.edge_id ?? n.id },
    { node_id: n.end_node_id, position: n.end, edge_id: n.edge_id ?? n.id },
  ]);
  const nearest = endpoints.map(e => ({ ...e, distance_m: dist(hvPort.position, e.position) })).sort((a, b) => a.distance_m - b.distance_m)[0];
  console.log(`nearest existing HV endpoint: ${nearest.node_id} at (${nearest.position.x.toFixed(1)}, ${nearest.position.z.toFixed(1)}) -> ${nearest.distance_m.toFixed(1)} m`);

  // Prefer the transformer's own HV port as the start so no dangling stub is left,
  // then run to the existing network's free end.
  const start = { x: hvPort.position.x, z: hvPort.position.z, node_id: hvPort.node_id };
  const end = { x: nearest.position.x, z: nearest.position.z, node_id: nearest.node_id };

  const path = buildPath(start, end, MAX_SEG, via);
  const segLens = path.slice(1).map((p, i) => +dist(p, path[i]).toFixed(1));
  console.log(`\nplanned polyline: ${path.length} points, ${path.length - 1} segments`);
  console.log(`  segments: ${segLens.join(', ')} m  (max ${Math.max(...segLens).toFixed(1)} / limit ${prefabInfo?.edge_length_m?.max}, min ${Math.min(...segLens).toFixed(1)} / limit >=8)`);
  if (Math.max(...segLens) > (prefabInfo?.edge_length_m?.max ?? 180)) throw new Error('segment plan still exceeds the prefab limit');
  if (Math.min(...segLens) < 8) throw new Error('segment plan has a segment shorter than 8 m');

  const st = (await call('get_game_status', {})).data;
  if (!st.paused) { await call('set_simulation_speed', { speed: 'paused' }); await sleep(500); }
  console.log(`  total ${segLens.reduce((a, b) => a + b, 0).toFixed(1)} m, estimated cost ~₡${Math.round(segLens.reduce((a, b) => a + b, 0) * (prefabInfo?.construction_cost_per_m ?? 20)).toLocaleString('en-US')}`);

  const requestId = `tx-hvline-${Date.now().toString(36)}`;
  const queued = await call('preview_utility_network', { request_id: requestId, utility_prefab: 'High-voltage Line', points: path });
  const opId = queued.data.operation_id;
  const preview = await poll(opId);
  console.log(`\npreview: state=${preview.state} cost=${preview.cost} errors=${JSON.stringify(preview.errors)} error=${JSON.stringify(preview.error)}`);
  if (preview.state !== 'preview_ready') {
    await call('cancel_utility_preview', { operation_id: opId }).catch(() => {});
    throw new Error(`preview not ready: ${preview.state} ${preview.error || ''}`);
  }
  if (DRY_RUN) {
    await call('cancel_utility_preview', { operation_id: opId }).catch(() => {});
    console.log('dry-run: preview cancelled, nothing committed.');
    return;
  }
  await call('apply_utility_operation', { operation_id: opId, request_id: requestId, max_cost: Number(preview.cost ?? 0) + 100000 });
  const done = await poll(opId);
  console.log(`commit: state=${done.state} cost=${done.cost} edges=${JSON.stringify(done.created_utility_edge_ids || done.result_edge_ids || [])}`);
  console.log(JSON.stringify({ state: done.state, operation_id: opId, segments: segLens.length, cost: done.cost }, null, 1));
};

main().catch(e => { console.error(`ERR ${e.code || ''}: ${e.message}`); process.exit(1); });
