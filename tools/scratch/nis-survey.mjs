// 一次性勘察脚本：分页拉全水掩码 + 地形采样网格
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function q(tool, args) {
  const out = execFileSync("node", ["mcp/query.mjs", tool, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 1e8,
  });
  return JSON.parse(out);
}

// ---- water mask, paginated ----
const wargs = { bounds: { min_x: -2500, min_z: -2000, max_x: 2000, max_z: 3900 }, cell_size_m: 128 };
let cells = [];
let offset = 0;
for (let i = 0; i < 50; i++) {
  const d = q("read_surface_water_mask", { ...wargs, offset }).data;
  cells = cells.concat(d.cells);
  if (d.next_offset == null || d.next_offset < 0 || cells.length >= d.total_cells) break;
  offset = d.next_offset;
}
const res = { x: Math.max(...cells.map(c => c.grid_x)) + 1, z: Math.max(...cells.map(c => c.grid_z)) + 1 };
writeFileSync("artifacts/nis-water-full.json", JSON.stringify({ resolution: res, cells }));

// ASCII map: '.' = dry inside owned, 'W' = water inside owned, 'o' = outside owned dry
let out = "";
for (let gz = 0; gz < res.z; gz++) {
  let row = String(cells[gz * res.x].z).padStart(5) + " ";
  for (let gx = 0; gx < res.x; gx++) {
    const c = cells[gz * res.x + gx];
    const inOwned = c.x >= -1558 && c.x <= 935 && c.z >= -935 && c.z <= 2805;
    row += c.water ? (inOwned ? "W" : "w") : (inOwned ? "." : " ");
  }
  out += row + "\n";
}
console.log(out);
const wet = cells.filter(c => c.water && c.x >= -1558 && c.x <= 935 && c.z >= -935 && c.z <= 2805);
console.log("water cells inside owned bbox:", wet.length, wet.length ? "maxdepth " + Math.max(...wet.map(c => c.water_depth_m)).toFixed(1) : "");

// ---- terrain sample 16x16 over owned bbox ----
const tb = { min_x: -1558, min_z: -935, max_x: 935, max_z: 2805 };
const N = 15;
const pts = [];
for (let iz = 0; iz <= N; iz++) for (let ix = 0; ix <= N; ix++) {
  pts.push({
    x: Math.round(tb.min_x + ((tb.max_x - tb.min_x) * ix) / N),
    z: Math.round(tb.min_z + ((tb.max_z - tb.min_z) * iz) / N),
  });
}
// sample_terrain likely takes {points:[...]} — chunk to <=256
const t = q("sample_terrain", { points: pts });
writeFileSync("artifacts/nis-terrain.json", JSON.stringify(t.data ?? t));
const tp = (t.data ? t.data.points ?? t.data.samples ?? t.data.results : null) || t.data?.samples;
console.log("terrain keys:", Object.keys(t.data ?? t));
