#!/usr/bin/env node
// Fold the power-infrastructure rework into the bound plan file:
//   1. bld-066 coal plant + bld-011/012/013 extra substations -> demolitions[]
//   2. bld-010 remaining substation -> periphery position / road edge / HV link
//   3. the 3 new 'High-voltage Line' segments -> utility_connections[]
// and re-derive the content hash.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'plans/peiqi-hexagon-town-bound.json';
const doc = JSON.parse(readFileSync(PATH, 'utf8'));
const at = new Date().toISOString();

const KEEP_TRANSFORMER = 'bld-010';
const DEMOLISHED = {
  'bld-011': { refund: 15000, reason: '同型变电站冗余：全城只保留 1 座变电站（bld-010），其余 3 座变电设施拆除。' },
  'bld-012': { refund: 15000, reason: '同型变电站冗余：全城只保留 1 座变电站（bld-010），其余 3 座变电设施拆除。' },
  'bld-013': { refund: 15000, reason: '同型变电站冗余：全城只保留 1 座变电站（bld-010），其余 3 座变电设施拆除。' },
  'bld-066': { refund: 50000, reason: '小型燃煤电厂拆除：改由 3 座小型风力发电机（24,556 kW）供电，并把唯一变电站移到外围接入高压线入口。' },
};

const facilities = (await queryGame('list_utility_facilities', { kind: 'all' })).data.items || [];
const networks = (await queryGame('list_utility_networks', { kind: 'all' })).data.items || [];
const transformer = facilities.find((f) => f.kind === 'transformer');
if (!transformer) throw new Error('no live transformer found');
const ports = (await queryGame('list_utility_connection_points', { facility_id: transformer.facility_id, connection: 'auto' })).data.items || [];
const hvPort = ports.find((p) => String(p.connection) === 'high_voltage');
if (!hvPort) throw new Error('transformer has no high_voltage port');

// The outside connection is the far end of the map's pre-existing HV line.
const outside = ((await queryGame('query_entities', { category: 'all', all_components: ['Game.Objects.ElectricityOutsideConnection'], limit: 2 })).data.items || [])[0] || null;

// Identify the newly added HV segments geometrically: every network edge whose
// both endpoints lie on the straight corridor between the HV port and the
// pre-existing line's free end that the connection workflow targeted.
const a = { x: hvPort.position.x, z: hvPort.position.z };
const b = { x: -1374.687, z: -554.981 };
const abx = b.x - a.x, abz = b.z - a.z;
const len2 = abx * abx + abz * abz;
const onCorridor = (p) => {
  const t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  if (t < -0.02 || t > 1.02) return false;
  const cx = a.x + t * abx, cz = a.z + t * abz;
  return Math.hypot(p.x - cx, p.z - cz) <= 3;
};
const newSegments = networks.filter((n) => onCorridor(n.start) && onCorridor(n.end));
const newSegmentIds = newSegments.map((n) => n.edge_id ?? n.id ?? `${n.start_node_id}~${n.end_node_id}`);

// --- 1 & 2: rewrite plan.buildings -----------------------------------------
const demolitions = [];
const kept = [];
for (const bl of doc.plan.buildings) {
  const demo = DEMOLISHED[bl.id];
  if (demo) {
    demolitions.push({
      building_id: bl.id, prefab: bl.prefab, label: bl.label, at_utc: at,
      position: bl.position, rotation_degrees: bl.rotation_degrees ?? null,
      road_edge_id: bl.road_edge_id ?? null, refund: demo.refund, reason: demo.reason,
      verification: 'native preview_utility_facility_delete / preview_building_demolition reported preview_ready with preview_entity_count 1 (no dependent buildings) and the facility no longer appears in list_utility_facilities.',
    });
    continue;
  }
  kept.push(bl);
}
doc.plan.buildings = kept;

const target = kept.find((bl) => bl.id === KEEP_TRANSFORMER);
if (!target) throw new Error(`${KEEP_TRANSFORMER} missing from plan.buildings`);
const relocations = [{
  building_id: target.id, prefab: target.prefab, label: target.label, at_utc: at,
  from: { x: target.position.x, y: target.position.y, z: target.position.z },
  to: { x: transformer.position.x, y: transformer.position.y, z: transformer.position.z },
  road_edge_id: transformer.road_edge_id, road_role: 'hex-ring', road_prefab: 'Large Road',
  reason: '唯一保留的变电站移到六边形外环外侧，既接入外环（低压层 "Road, PowerlineLow"）又靠近高压线东端，便于用输电线接入地图西侧的高压线入口。',
}];
target.position = { x: transformer.position.x, y: transformer.position.y, z: transformer.position.z };
target.road_edge_id = transformer.road_edge_id;
target.road_edge_side = 'right';
target.placement_status = 'native_preview_verified';
target.relocated_at_utc = at;
target.utility_links = {
  high_voltage: {
    connection: 'high_voltage', layers: hvPort.layers,
    port_node_id: hvPort.node_id, port_position: hvPort.position,
    connected_edge_count: hvPort.connected_edge_count,
    segments: newSegmentIds, prefab: 'High-voltage Line',
    target_node_id: 'fd537682d55349c282f74590a72dea69:72519:1',
    target_position: { x: -1374.687, y: 617, z: -554.981 },
  },
  low_voltage: { connection: 'low_voltage', layers: 'Road, PowerlineLow', via: 'road_edge_id' },
};

// --- 3: the transmission line itself ---------------------------------------
doc.utility_connections = [...(doc.utility_connections ?? []), {
  id: 'hvlink-transformer-to-outside-connection',
  at_utc: at,
  kind: 'high_voltage_transmission_line',
  utility_prefab: 'High-voltage Line',
  from: { x: hvPort.position.x, y: hvPort.position.y, z: hvPort.position.z, node_id: hvPort.node_id, what: '变电站高压端口（TransformerStation01 high_voltage）' },
  to: { x: -1374.687, y: 617, z: -554.981, node_id: 'fd537682d55349c282f74590a72dea69:72519:1', what: '既有高压线东端自由端点' },
  chain: '变电站高压端口 -> 3 段新建高压线 -> 既有 33 段高压线 -> 地图西侧「外部连接点 - 电力」',
  outside_connection: outside ? { entity_id: outside.entity_id, name: outside.name, position: outside.position } : null,
  segment_lengths_m: [116.6, 116.6, 116.6],
  total_length_m: 349.8,
  segment_limit_m: 180,
  created_utility_edge_ids: newSegmentIds,
  cost: 900,
  operation_id: 'd57df7eeae8f42a498eca26f8c2bb4e7',
  validation: {
    hv_port_connected_edge_count: hvPort.connected_edge_count,
    hv_network_edges: networks.length,
    hv_network_connected_components: 1,
  },
}];
doc.relocations = [...(doc.relocations ?? []), ...relocations];
doc.demolitions = [...(doc.demolitions ?? []), ...demolitions];

const oldId = doc.plan_id;
const newId = computeCityPlanId(doc.bounds, doc.plan);
doc.plan_id = newId;
doc.plan_id_history = [...(doc.plan_id_history ?? []), { from: oldId, to: newId, at_utc: at, reason: 'coal plant + 3 extra substations demolished, remaining substation moved to the hex-ring and joined to the high-voltage line' }];
doc.updated_at_utc = at;

writeFileSync(PATH, JSON.stringify(doc, null, 2));

console.log(`demolitions recorded: ${demolitions.length}`);
for (const d of demolitions) console.log(`  ${d.building_id} ${d.label} (${d.prefab}) refund ₡${d.refund}`);
console.log(`buildings in plan: ${kept.length}`);
console.log(`relocation: ${target.id} -> (${target.position.x.toFixed(1)}, ${target.position.z.toFixed(1)}) road=${target.road_edge_id}`);
console.log(`new HV segments (${newSegmentIds.length}): ${newSegmentIds.join(', ')}`);
console.log(`HV port connected_edge_count = ${hvPort.connected_edge_count}; HV network edges = ${networks.length}`);
console.log(`outside connection: ${outside ? outside.name + ' @ (' + outside.position.x.toFixed(0) + ', ' + outside.position.z.toFixed(0) + ')' : 'n/a'}`);
console.log(`plan_id: ${oldId} -> ${newId}`);
