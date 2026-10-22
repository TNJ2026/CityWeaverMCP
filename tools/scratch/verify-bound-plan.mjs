import { readFileSync } from 'node:fs';
import { computeCityPlanId } from '../../mcp/planning-renderer.mjs';

const d = JSON.parse(readFileSync(process.argv[2] ?? 'plans/peiqi-hexagon-town-bound.json', 'utf8'));
const id = computeCityPlanId(d.bounds, d.plan);
console.log('declared plan_id:', d.plan_id);
console.log('recomputed     :', id, '| 一致:', id === d.plan_id);
const bs = d.plan.buildings ?? [];
console.log('buildings:', bs.length);
const st = {};
for (const b of bs) st[b.placement_status ?? 'null'] = (st[b.placement_status ?? 'null'] ?? 0) + 1;
console.log('placement_status:', JSON.stringify(st));
console.log('有 road_edge_id:', bs.filter(b => b.road_edge_id).length);
console.log('无 road_edge_id:', bs.filter(b => !b.road_edge_id).map(b => b.id + ':' + b.prefab).join(', ') || '（无）');
console.log('有 rotation:', bs.filter(b => Number.isFinite(b.rotation_degrees)).length);
console.log('kind 分布:', JSON.stringify(bs.reduce((a, b) => (a[b.kind ?? '?'] = (a[b.kind ?? '?'] ?? 0) + 1, a), {})));
console.log('roads:', (d.plan.roads ?? []).length, '| zones:', (d.plan.zones ?? []).length, '| grids:', (d.plan.grids ?? []).length, '| utilities:', (d.plan.utilities ?? []).length);
