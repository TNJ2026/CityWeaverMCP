#!/usr/bin/env node
// Fold the water-tower relocation into the bound plan file and re-derive its content hash.
// Reads the run record written by move-water-towers-to-perimeter.mjs.
import { queryGame } from '../../mcp/bridge-client.mjs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'plans/peiqi-hexagon-town-bound.json';
const RUN = JSON.parse(readFileSync('tools/scratch/_water-tower-relocation.json', 'utf8'));
if (RUN.fatal) throw new Error('the relocation run failed: ' + JSON.stringify(RUN.fatal));

const doc = JSON.parse(readFileSync(PATH, 'utf8').replace(/^\uFEFF/, ''));
const at = RUN.at ?? new Date().toISOString();

const towers = (await queryGame('list_utility_facilities', { kind: 'water_tower' })).data.items ?? [];
const relocations = [];

for (const t of RUN.towers) {
  const b = doc.plan.buildings.find((x) => x.id === t.planId);
  if (!b) { console.log('!! plan building missing for', t.planId); continue; }
  const live = towers.find((f) => f.facility_id === t.facilityId);
  if (!live) { console.log('!! live facility missing for', t.planId); continue; }
  relocations.push({
    building_id: b.id, prefab: b.prefab, label: b.label, at_utc: at,
    from: t.before.position,
    to: { x: live.position.x, y: live.position.y, z: live.position.z },
    road_edge_id: live.road_edge_id, road_role: 'hex-ring', road_prefab: t.site.road_prefab,
    road_side: t.site.road_side,
    reason:
      '水塔必须紧邻普通道路才能向道路给水网供水：原址位于城镇核心区。按要求移到六边形最外围（外环外侧、'
      + `距六边形中心 ${t.site.dCentre} m，方位角 ${t.site.bearing}°），地块前缘与路缘齐平（中心距路中心线 ${t.site.gapToRing} m），`
      + '原生 preview_utility_facility_move 校验通过后提交；搬迁后 road_edge_id 与 m_RoadEdge 均指向外环路。',
    verification: {
      candidate: t.site,
      preview: t.preview,
      commit: t.commit,
      m_RoadEdge: t.after.m_RoadEdge,
      road_match: t.after.roadMatch,
      producer_edge: t.after.producerEdge,
      water_production: t.after.last_water_production,
      water_capacity: t.after.water_capacity,
      water_pollution: t.after.water_pollution,
      nearest_building: t.nearestBuilding,
      pollution_at_site: t.pollution,
    },
  });
  b.position = { x: live.position.x, y: live.position.y, z: live.position.z };
  b.road_edge_id = live.road_edge_id;
  b.road_edge_side = t.site.road_side;
  b.placement_status = 'native_preview_verified';
  b.relocated_at_utc = at;
  b.relocation_note =
    `移至六边形外环外侧最外围（r=${t.site.dCentre} m，方位 ${t.site.bearing}°），正面朝路，地块前缘与路缘齐平；`
    + '原生 preview_utility_facility_move 校验通过后提交，回读 m_RoadEdge 与外环路一致。';
}

const oldId = doc.plan_id;
const newId = computeCityPlanId(doc.bounds, doc.plan);
doc.plan_id = newId;
doc.plan_id_history = [...(doc.plan_id_history ?? []), {
  from: oldId, to: newId, at_utc: at,
  reason: 'three WaterTower01 relocated from the hexagon core to the outermost periphery on the outer side of the hex-ring',
}];
doc.relocations = [...(doc.relocations ?? []), ...relocations];
doc.updated_at_utc = at;

writeFileSync(PATH, JSON.stringify(doc, null, 2));

console.log(`relocations recorded: ${relocations.length}`);
for (const r of relocations) {
  console.log(`  ${r.building_id} ${r.label}: (${r.from.x.toFixed(1)}, ${r.from.z.toFixed(1)}) -> (${r.to.x.toFixed(1)}, ${r.to.z.toFixed(1)})  road=${r.road_edge_id}  production=${r.verification.water_production}`);
}
console.log('buildings in plan:', doc.plan.buildings.length);
console.log('plan_id:', oldId, '->', newId);
