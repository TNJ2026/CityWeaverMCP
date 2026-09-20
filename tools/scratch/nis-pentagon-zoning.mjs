// 尼思五边形城 · 分区阶段：按路边格子反查规划多边形用途，分组批量 preview+apply
// 用法：node tools/scratch/nis-pentagon-zoning.mjs [scan|apply] [groupPrefix]
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PLAN_FILE = path.join(ROOT, 'plans', 'nis-pentagon-city-plan.json');
const JOURNAL = path.join(ROOT, 'artifacts', 'nis-pentagon-zoning-journal.jsonl');
const MODE = process.argv[2] ?? 'apply';
const only = process.argv[3] ?? null;

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const base = JSON.parse(await readFile(PLAN_FILE, 'utf8'));
const b = base.bounds;

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// plan zones: kind → game zone type identical strings; build lookup list
const zones = base.plan.zones.map((z) => ({ kind: z.kind, poly: z.polygon }));
function regionAt(p) {
  for (const z of zones) if (pointInPoly(p.x, p.z, z.poly)) return z.kind;
  return null;
}

const client = new Client({ name: 'nis-pentagon-zoning', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args, timeout = 120000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    const data = r.structuredContent?.data ?? r.structuredContent;
    if (r.isError || data?.ok === false) throw new Error(`${name}: ${JSON.stringify(r.structuredContent ?? r).slice(0, 400)}`);
    return data;
  };

  // 1. 快照已建道路（非高速）
  const snap = await call('get_planning_map_snapshot', {
    bounds: { min_x: b.min_x - 50, min_z: b.min_z - 50, max_x: b.max_x + 50, max_z: b.max_z + 50 },
    max_features_per_layer: 5000,
  });
  const roads = (snap.roads ?? []).filter((r) => !/Highway/i.test(r.prefab ?? ''));
  console.log('[snapshot] non-highway roads:', roads.length);

  // 2. 逐条路分析两侧分区格子，按规划多边形归类
  const groups = new Map(); // key: kind|side → {zone, side, edges:[]}
  let surveyed = 0;
  for (const road of roads) {
    if (!['Small Road', 'Medium Road', 'Large Road'].includes(road.prefab)) continue;
    const d = await call('analyze_zoning_cells', { edge_ids: [road.id], road_side: 'both', depth_cells: 6 });
    if (d.items_truncated) throw new Error('Truncated cells on ' + road.id);
    surveyed += 1;
    for (const side of ['left', 'right']) {
      const cells = d.items.filter((v) => v.side === side && !v.occupied && !/Blocked|Shared|Redundant|Occupied/.test(v.state ?? '') && v.zone === 'Unzoned');
      if (cells.length < 4) continue;
      // 多数票归组：一条边一侧以占比最高的规划用途为准（纯度 ≥60%），边界误差 ≤1 格
      const tally = new Map();
      for (const v of cells) {
        const kind = regionAt(v.position);
        if (kind) tally.set(kind, (tally.get(kind) ?? 0) + 1);
      }
      if (!tally.size) continue;
      const [bestKind, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n / cells.length < 0.6) continue;
      const key = `${bestKind}|${side}`;
      let g = groups.get(key);
      if (!g) { g = { zone: bestKind, side, edges: [] }; groups.set(key, g); }
      g.edges.push(road.id);
    }
  }
  await writeFile(path.join(ROOT, 'artifacts', 'nis-pentagon-zoning-groups.json'), JSON.stringify([...groups.values()], null, 2));
  console.log('[survey] roads analyzed:', surveyed, '| groups:', groups.size,
    '| edges total:', [...groups.values()].reduce((s, g) => s + g.edges.length, 0));
  for (const g of groups.values()) console.log(`  ${g.zone} ${g.side}: ${g.edges.length} edges`);

  if (MODE === 'scan') { console.log('[scan] dry-run only, no zoning applied'); process.exit(0); }

  // 3. 分组批量 preview + apply（每批 6 条边）
  let seq = 0, totalCells = 0;
  const results = [];
  for (const g of [...groups.values()].sort((a, c) => a.zone.localeCompare(c.zone))) {
    if (only && !`${g.zone}|${g.side}`.startsWith(only)) continue;
    for (let i = 0; i < g.edges.length; i += 6) {
      const edgeIds = g.edges.slice(i, i + 6);
      const req = `nispen-zone-${String(seq++).padStart(4, '0')}`;
      const args = { request_id: req, edge_ids: edgeIds, zone: g.zone, road_side: g.side, depth_cells: 6, overwrite: false, include_occupied: false };
      try {
        const p = await call('preview_zoning', args);
        if (p.state !== 'preview_ready') throw new Error('preview ' + p.state);
        const a = await call('apply_zoning', { operation_id: p.operation_id, request_id: req });
        const o = await call('get_zoning_operation', { operation_id: p.operation_id });
        if (o.state !== 'completed') throw new Error('apply ' + o.state);
        totalCells += o.changed_cell_count ?? 0;
        results.push({ req, zone: g.zone, side: g.side, edges: edgeIds.length, cells: o.changed_cell_count });
        await appendFile(JOURNAL, JSON.stringify({ at: new Date().toISOString(), stage: 'completed', req, zone: g.zone, side: g.side, edges: edgeIds.length, cells: o.changed_cell_count }) + '\n');
        process.stdout.write(`.`);
      } catch (e) {
        await appendFile(JOURNAL, JSON.stringify({ at: new Date().toISOString(), stage: 'failed', req, zone: g.zone, side: g.side, error: String(e.message).slice(0, 300), args }) + '\n');
        console.log(`\n[fail] ${req} ${g.zone}/${g.side}: ${String(e.message).slice(0, 200)}`);
      }
    }
  }
  console.log('\n[zoning] ops:', results.length, '| cells painted:', totalCells);
  await writeFile(path.join(ROOT, 'artifacts', 'nis-pentagon-zoning-results.json'), JSON.stringify(results, null, 2));
} finally {
  await client.close();
}
