import assert from 'node:assert/strict';
import { queryGame } from './bridge-client.mjs';

const status = await queryGame('get_game_status', {});
assert.equal(status.data.city_loaded, true);
await queryGame('set_simulation_speed', { speed: 'paused' });

const zones = await queryGame('list_zone_types', { unlocked_only: true });
assert(zones.data.items.some(x => x.name === 'EU Residential Low'));

let offset = 0;
let snapshot_id;
const roads = [];
do {
  const page = await queryGame('query_entities', { category: 'roads', offset, limit: 100, ...(snapshot_id ? { snapshot_id } : {}) });
  snapshot_id = page.data.snapshot_id;
  roads.push(...page.data.items.filter(x => !x.prefab_name?.includes('Highway')));
  offset = page.data.next_offset;
} while (offset != null);

let selected;
for (const road of roads.reverse()) {
  const analysis = await queryGame('analyze_zoning_cells', { edge_ids: [road.entity_id], road_side: 'both', depth_cells: 2 });
  const eligible = analysis.data.items.filter(x => !/(Blocked|Shared|Redundant|Occupied)/.test(x.state));
  if (eligible.length >= 4 && eligible.every(x => x.zone_index === 0) && new Set(eligible.map(x => x.side)).size === 2) {
    selected = { road, analysis, eligible };
    break;
  }
}
assert(selected, 'No clear two-sided zoning test road was found');

const edge_ids = [selected.road.entity_id];
const leftCancel = await queryGame('preview_zoning', { request_id: 'zoning_cancel_left_001', edge_ids, zone: 'EU Residential Low', road_side: 'left', depth_cells: 1 });
assert(leftCancel.data.changed_cell_count > 0);
assert.equal(leftCancel.data.changes_by_side.right, 0);
await queryGame('cancel_zoning_preview', { operation_id: leftCancel.data.operation_id });

const assign = await queryGame('preview_zoning', { request_id: 'zoning_assign_both_001', edge_ids, zone: 'EU Residential Low', road_side: 'both', depth_cells: 2 });
assert(assign.data.changed_cell_count >= 4);
await queryGame('apply_zoning', { operation_id: assign.data.operation_id, request_id: 'zoning_assign_both_001' });
const assigned = await queryGame('analyze_zoning_cells', { edge_ids, road_side: 'both', depth_cells: 2 });
assert.equal(assigned.data.items.filter(x => x.zone === 'EU Residential Low').length, assign.data.changed_cell_count);

const replace = await queryGame('preview_zoning', { request_id: 'zoning_replace_both_001', edge_ids, zone: 'EU Commercial Low', road_side: 'both', depth_cells: 2, overwrite: true });
assert.equal(replace.data.changed_cell_count, assign.data.changed_cell_count);
await queryGame('apply_zoning', { operation_id: replace.data.operation_id, request_id: 'zoning_replace_both_001' });
const replaced = await queryGame('analyze_zoning_cells', { edge_ids, road_side: 'both', depth_cells: 2 });
assert.equal(replaced.data.items.filter(x => x.zone === 'EU Commercial Low').length, replace.data.changed_cell_count);

const clear = await queryGame('preview_zoning', { request_id: 'zoning_clear_both_001', edge_ids, zone: 'none', road_side: 'both', depth_cells: 2, overwrite: true });
await queryGame('apply_zoning', { operation_id: clear.data.operation_id, request_id: 'zoning_clear_both_001' });
const restored = await queryGame('analyze_zoning_cells', { edge_ids, road_side: 'both', depth_cells: 2 });
assert.equal(restored.data.items.filter(x => x.zone_index !== 0 && !/(Blocked|Shared|Redundant|Occupied)/.test(x.state)).length, 0);

console.log(JSON.stringify({
  ok: true,
  bridge_version: status.data.bridge_version,
  zone_type_count: zones.data.total,
  edge_id: selected.road.entity_id,
  road_prefab: selected.road.prefab_name,
  initial_cells: selected.analysis.data.cell_count,
  assigned_cells: assign.data.changed_cell_count,
  replaced_cells: replace.data.changed_cell_count,
  cleared_cells: clear.data.changed_cell_count,
  final_clear_cells: restored.data.items.filter(x => x.zone_index === 0).length
}, null, 2));
