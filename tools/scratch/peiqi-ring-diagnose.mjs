// 排查 pentagon-ring-part-1 的 GAME_VALIDATION_ERROR：逐条边与不同长度前缀做原生路线预览。
//   node tools/scratch/peiqi-ring-diagnose.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const A = (f) => path.join(ROOT, 'artifacts', f);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({ name: 'peiqi-ring-diagnose', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args, timeout = 300000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  const doc = JSON.parse(await readFile(A('peiqi-roads-stage.json'), 'utf8'));
  const ring = doc.plan.roads.find((r) => r.id === 'pentagon-ring');

  const results = [];
  const previewRoute = async (label, points) => {
    const row = { label, points: points.length, length_m: Math.round(points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0)) };
    let operationId = null;
    try {
      const started = await call('preview_road_route', {
        request_id: `peiqiroute_${label.replace(/[^A-Za-z0-9]/g, '_')}_${Date.now()}`,
        road_prefab: ring.prefab,
        points: points.map((p) => ({ x: p.x, z: p.z })),
      });
      operationId = started.operation_id ?? started.operationId ?? started.id ?? null;
      row.operation_id = operationId;
      for (let attempt = 0; attempt < 80 && operationId; attempt++) {
        const state = await call('get_road_operation', { operation_id: operationId });
        row.state = state.state;
        row.cost = state.cost ?? state.native_preview?.cost ?? null;
        row.errors = state.errors ?? state.native_preview?.errors ?? [];
        row.error = state.error ?? state.native_preview?.error ?? null;
        if (['preview_ready', 'failed', 'cancelled', 'expired', 'outcome_unknown'].includes(state.state)) break;
        await sleep(250);
      }
      if (operationId) { try { await call('cancel_road_preview', { operation_id: operationId }); row.cancelled = true; } catch (e) { row.cancel_error = String(e.message).slice(0, 120); } }
    } catch (e) { row.state = row.state ?? 'tool_error'; row.error = String(e.message).slice(0, 300); }
    results.push(row);
    console.log(JSON.stringify(row));
    return row;
  };

  const chainFor = (vertices) => {
    const chain = [vertices[0]];
    for (let index = 0; index < vertices.length - 1; index++) {
      const a = vertices[index], b = vertices[index + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 240));
      for (let step = 1; step <= steps; step++) chain.push({ x: a.x + (b.x - a.x) * step / steps, z: a.z + (b.z - a.z) * step / steps });
    }
    return chain;
  };

  const vertices = ring.points.map((p) => ({ x: p.x, z: p.z }));
  const chain = chainFor(vertices);
  console.log('=== total points', chain.length, '===');
  // 逐条边（每条边 5 段）
  for (let index = 0; index < vertices.length - 1; index++) {
    const a = vertices[index], b = vertices[index + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 240));
    const points = [a];
    for (let step = 1; step < steps; step++) points.push({ x: a.x + (b.x - a.x) * step / steps, z: a.z + (b.z - a.z) * step / steps });
    points.push(b);
    await previewRoute(`edge-${index}`, points);
  }
  // 逐段前缀：定位第一个失败段
  for (const size of [7, 8, 9, 10]) await previewRoute(`prefix-${size}`, chain.slice(0, size));
  // 单段跨越 V1 角点及其相邻段
  for (const [label, from, to] of [['v0-v1-half', 3, 7], ['v1-v2-half', 6, 10], ['v1-corner', 4, 8]]) {
    await previewRoute(label, chain.slice(from, to + 1));
  }
  await writeFile(A('peiqi-ring-diagnose.json'), JSON.stringify(results, null, 2));
} finally {
  await client.close();
}
