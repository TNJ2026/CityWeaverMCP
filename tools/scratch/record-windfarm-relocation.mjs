#!/usr/bin/env node
// Record the wind-turbine relocation in the bound plan file and re-derive its content hash.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'plans/peiqi-hexagon-town-bound.json';
const doc = JSON.parse(readFileSync(PATH, 'utf8'));

const RING = 'hex-ring';
const ENTITIES = {
  'bld-007': 'fd537682d55349c282f74590a72dea69:361576:5',
  'bld-008': 'fd537682d55349c282f74590a72dea69:361829:3',
  'bld-009': 'fd537682d55349c282f74590a72dea69:362016:3',
};

const live = (await queryGame('list_utility_facilities', { kind: 'power_plant' })).data.items;
const relocations = [];
const at = new Date().toISOString();

for (const b of doc.plan.buildings) {
  const entity = ENTITIES[b.id];
  if (!entity) continue;
  const f = live.find((x) => x.facility_id === entity);
  if (!f) { console.log('!! live facility missing for', b.id); continue; }
  const from = { x: b.position.x, y: b.position.y, z: b.position.z };
  relocations.push({
    building_id: b.id, prefab: b.prefab, label: b.label, at_utc: at,
    from, to: { x: f.position.x, y: f.position.y, z: f.position.z },
    road_edge_id: f.road_edge_id, road_role: RING, road_prefab: 'Large Road',
    reason: '小型风力发电机必须接入道路：原址（东北风场）距最近道路 414-502 m，低压电网层为 "Road, PowerlineLow"，无路即无电，实测发电 0 kW。搬到六边形外环外侧贴路后发电恢复至满容量。',
    production_kw: f.last_electricity_production, capacity_kw: f.electricity_capacity,
  });
  b.position = { x: f.position.x, y: f.position.y, z: f.position.z };
  b.road_edge_id = f.road_edge_id;
  b.road_edge_side = 'right';
  b.placement_status = 'native_preview_verified';
  b.relocated_at_utc = at;
  b.relocation_note = '移至六边形外环（hex-ring）外侧，正面朝路，地块前缘与路缘齐平；原生 preview_building_move 校验通过。';
}

const oldId = doc.plan_id;
const newId = computeCityPlanId(doc.bounds, doc.plan);
doc.plan_id = newId;
doc.plan_id_history = [...(doc.plan_id_history ?? []), { from: oldId, to: newId, at_utc: at, reason: 'wind turbine relocation onto the hex-ring' }];
doc.relocations = [...(doc.relocations ?? []), ...relocations];
doc.updated_at_utc = at;

writeFileSync(PATH, JSON.stringify(doc, null, 2));
console.log('relocations recorded:', relocations.length);
for (const r of relocations) {
  console.log(`  ${r.building_id} ${r.label}: (${r.from.x.toFixed(1)}, ${r.from.z.toFixed(1)}) -> (${r.to.x.toFixed(1)}, ${r.to.z.toFixed(1)})  road=${r.road_edge_id}  ${r.production_kw}/${r.capacity_kw} kW`);
}
console.log('plan_id:', oldId, '->', newId);
