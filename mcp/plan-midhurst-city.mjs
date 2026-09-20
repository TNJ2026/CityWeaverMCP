// Midhurst grid-first city plan, driven through the project's own MCP planners.
//
// Per docs/guides/planning/PLANNING-MAP-GUIDE.md the planners (propose_grid_plan /
// propose_city_plan) are Node-side MCP orchestration tools, not game-bridge operations, so they
// must be called over the STDIO MCP client. Read-only: no construction tool is ever called.
//
// Usage: node mcp/plan-midhurst-city.mjs [--probe]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const client = new Client({ name: 'midhurst-planner', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'mcp', 'server.mjs')],
}));

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error(`${name}: no text content`);
  const parsed = JSON.parse(text);
  if (parsed.ok === false) throw new Error(`${name}: ${parsed.error?.code} ${parsed.error?.message}`);
  return parsed;
};
// strip bulky base64 blobs before logging
const slim = (value, depth = 0) => {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.length > 8 ? { __array: value.length, head: value.slice(0, 3).map((v) => slim(v, depth + 1)) } : value.map((v) => slim(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && v.length > 400) out[k] = `__string(${v.length})`;
      else out[k] = slim(v, depth + 1);
    }
    return out;
  }
  return value;
};

if (process.argv.includes('--probe')) {
  const probe = await call('propose_grid_plan', {
    district_kind: 'residential', density: 'low', theme_preference: 'auto',
    columns: 2, rows: 2, block_width_m: 96, block_height_m: 96,
    render: { format: 'static_html', view: 'combined' },
  });
  console.log(JSON.stringify({
    ok: probe.ok,
    data_keys: Object.keys(probe.data ?? {}),
    plan: probe.data?.plan,
    validation: probe.data?.render?.validation ?? probe.data?.validation,
    placement: probe.data?.placement,
    bindings: probe.data?.bindings,
    preview_draft: probe.data?.preview_draft,
    access_points: probe.data?.access_points,
  }, null, 2));
  await client.close();
  process.exit(0);
}

if (process.argv.includes('--city-probe')) {
  const city = await call('propose_city_plan', {
    district_kind: 'residential', density: 'low', theme_preference: 'auto',
    columns: 3, rows: 3, block_width_m: 96, block_height_m: 96,
    infrastructure_profile: 'complete', power_level: 'surface',
  });
  console.log(JSON.stringify({
    ok: city.ok,
    data_keys: Object.keys(city.data ?? {}),
    plan_keys: city.data?.plan ? Object.keys(city.data.plan) : null,
    grids: city.data?.plan?.grids?.length ?? null,
    roads: city.data?.plan?.roads?.map((r) => ({ id: r.id, prefab: r.prefab, width_m: r.width_m, pts: r.points?.length })) ?? null,
    buildings: city.data?.plan?.buildings?.map((b) => ({ id: b.id, prefab: b.prefab, kind: b.kind, pos: b.position })) ?? null,
    utilities: city.data?.plan?.utilities?.map((u) => ({ id: u.id, type: u.network_type, prefab: u.prefab, pts: u.points?.length })) ?? null,
    tracks: city.data?.plan?.tracks?.map((t) => ({ id: t.id, type: t.track_type, pts: t.points?.length })) ?? null,
    zones: city.data?.plan?.zones?.length ?? null,
    bindings: city.data?.bindings ?? null,
    access: city.data?.access_points ?? null,
    validation: city.data?.render?.validation ?? city.data?.validation ?? null,
    other: slim(Object.fromEntries(Object.entries(city.data ?? {}).filter(([k]) => !['plan', 'bindings', 'render'].includes(k)))),
  }, null, 2));
  await client.close();
  process.exit(0);
}

await client.close();
