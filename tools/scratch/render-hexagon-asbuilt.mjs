// Read-only render of the finished hexagon town over the live map.
// The bound plan carries construction-only fields, so it is first projected onto
// the strict `render_city_plan` plan schema by whitelisting keys.
//   node tools/scratch/render-hexagon-asbuilt.mjs
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const serverPath = path.join(ROOT, 'mcp', 'server.mjs');
const planPath = path.join(ROOT, 'plans', 'peiqi-hexagon-town-bound.json');
const htmlOut = path.join(ROOT, 'artifacts', 'peiqi-hexagon-town-asbuilt-map.html');
const jsonOut = path.join(ROOT, 'artifacts', 'peiqi-hexagon-town-asbuilt-render.json');

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
};
const KEY = {
  road: ['id', 'label', 'prefab', 'planning_status', 'construction_status', 'native_preview', 'level', 'width_m', 'points', 'district', 'road_class', 'axis', 'role', 'widening_policy', 'construction_order', 'depends_on', 'max_cost'],
  point: ['x', 'y', 'z', 'elevation_m', 'node_id', 'edge_id'],
  building: ['id', 'label', 'name', 'prefab', 'planning_status', 'placement_status', 'construction_status', 'kind', 'category', 'position', 'rotation_degrees', 'rotation_source', 'size_m', 'reserved_size_m', 'roadside_of', 'road_edge_id', 'road_side', 'snap_target_id', 'placement_mode', 'reserve_upgrade_prefabs', 'native_preview', 'placement_binding', 'construction_order', 'depends_on', 'max_cost'],
  zone: ['id', 'kind', 'label', 'district', 'area_m2', 'polygon'],
  gridException: ['scope_id', 'road_ids', 'reason_codes', 'message'],
  preview: ['operation_id', 'state', 'cost', 'warnings', 'errors', 'error', 'expires_at_utc', 'snapped_origin'],
  binding: ['session_id', 'building_plan_id', 'operation_id', 'preview_state', 'preview_cancelled', 'candidate_index', 'road_prefab', 'cancel_error'],
};
const prunePreview = (p) => p ? pick(p, KEY.preview) : undefined;
const prunePoints = (pts) => (pts ?? []).map(p => pick(p, KEY.point));

const src = JSON.parse(await readFile(planPath, 'utf8'));
const p = src.plan;
const cleaned = {
  bounds: src.bounds,
  plan: {
    grids: [],
    grid_exceptions: (p.grid_exceptions ?? []).map(g => pick(g, KEY.gridException)),
    roads: (p.roads ?? []).map(r => ({ ...pick(r, KEY.road), native_preview: prunePreview(r.native_preview), points: prunePoints(r.points) })),
    buildings: (p.buildings ?? []).map(b => ({
      ...pick(b, KEY.building),
      position: pick(b.position, KEY.point),
      native_preview: prunePreview(b.native_preview),
      placement_binding: b.placement_binding ? pick(b.placement_binding, KEY.binding) : undefined,
    })),
    zones: (p.zones ?? []).map(z => ({ ...pick(z, KEY.zone), polygon: (z.polygon ?? []).map(q => ({ x: q.x, z: q.z })) })),
    tracks: [],
    utilities: [],
  },
  include_existing: true,
  include_water: true,
  include_terrain: true,
  max_features_per_layer: 5000,
  render: {
    title: '佩奇代尔｜正六边形城镇竣工图（规划叠合实景基础设施）',
    width: 2200, height: 1600, view: 'surface', format: 'static_html',
  },
};

const client = new Client({ name: 'hexagon-asbuilt-render', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  const r = await client.callTool({ name: 'render_city_plan', arguments: cleaned }, undefined, { timeout: 300000 });
  if (r.isError) throw new Error(JSON.stringify(r).slice(0, 1500));
  // render_city_plan returns a JSON summary; the page itself lands in the planning-store artifact file.
  let html = r.content?.find(x => x.type === 'resource' && x.resource?.mimeType === 'text/html')?.resource?.text;
  let summary = r.structuredContent?.data ?? null;
  if (!html) {
    const t = r.content?.find(x => x.type === 'text')?.text ?? '';
    summary = summary ?? (t.trimStart().startsWith('{') ? JSON.parse(t).data : null);
    const artifact = summary?.artifact_path;
    if (!artifact) throw new Error(`No HTML and no artifact_path: ${t.slice(0, 500)}`);
    html = await readFile(artifact, 'utf8');
  }
  if (!html) throw new Error('Empty render output.');
  await writeFile(htmlOut, html);
  await writeFile(jsonOut, JSON.stringify(r.structuredContent ?? summary, null, 2));
  console.log(JSON.stringify({
    html: htmlOut, html_bytes: html.length,
    plan_id: summary?.plan_id, counts: summary?.counts, validation: summary?.validation,
    artifact_path: summary?.artifact_path,
  }, null, 2));
} finally {
  await client.close();
}
