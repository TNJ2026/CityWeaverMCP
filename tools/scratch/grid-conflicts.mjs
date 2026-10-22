// 找出 plan.grids 中所有「接触或重叠」的网格对（施工编译器 PLAN_GRID_OVERLAP 判据同款），
// 并按需给出可合并的同区域矩形建议。
//
// 用法: node tools/scratch/grid-conflicts.mjs <plan.json>

import { readFile } from 'node:fs/promises';

const doc = JSON.parse(await readFile(process.argv[2], 'utf8'));
const grids = doc.plan.grids ?? [];

const box = (g) => ({
  id: g.id,
  district: g.district,
  zone: g.zone_type,
  kind: g.zone_kind,
  min_x: Number(g.origin.x),
  min_z: Number(g.origin.z),
  max_x: Number(g.origin.x) + Number(g.columns) * Number(g.block_width_m),
  max_z: Number(g.origin.z) + Number(g.rows) * Number(g.block_height_m),
});

const boxes = grids.map(box);
const conflicts = [];
for (let i = 0; i < boxes.length; i++) {
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.max_x, b.max_x) - Math.max(a.min_x, b.min_x);
    const oz = Math.min(a.max_z, b.max_z) - Math.max(a.min_z, b.min_z);
    const sharedV = Math.abs(ox) < 1e-6 && oz > 0;
    const sharedH = Math.abs(oz) < 1e-6 && ox > 0;
    if ((ox > 0 && oz > 0) || sharedV || sharedH) {
      conflicts.push({
        a: a.id, b: b.id,
        type: ox > 0 && oz > 0 ? 'overlap' : sharedV ? 'shared_vertical_edge' : 'shared_horizontal_edge',
        same_zone: a.kind === b.kind && a.zone === b.zone,
        a_zone: a.zone, b_zone: b.zone,
        same_district: a.district === b.district,
      });
    }
  }
}

// 区域统计
const byDistrict = {};
for (const b of boxes) {
  byDistrict[b.district] ??= { zones: {}, cells: 0, boxes: [] };
  byDistrict[b.district].zones[b.zone] = (byDistrict[b.district].zones[b.zone] ?? 0) + 1;
  byDistrict[b.district].cells += ((b.max_x - b.min_x) / 112) * ((b.max_z - b.min_z) / 112);
  byDistrict[b.district].boxes.push(b.id);
}

console.log(JSON.stringify({
  grid_count: boxes.length,
  conflict_count: conflicts.length,
  conflicts,
  by_district: Object.fromEntries(Object.entries(byDistrict).map(([k, v]) => [k, { zone_type_variants: Object.keys(v.zones), cell_area: v.cells, grids: v.boxes.length }])),
}, null, 2));
