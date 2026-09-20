// 施工前问题探针：
//   1) 全量 dump 某一批次的 preview_batch 原生返回（含 game errors/warnings），随后取消预览
//   2) 勘查高速终点 (-1384,-1136) 附近现存永久道路，确认 portal 锚点
//   node tools/scratch/peiqi-probe.mjs preview <stage> <batch_id>
//   node tools/scratch/peiqi-probe.mjs anchor
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const A = (f) => path.join(ROOT, 'artifacts', f);
const cmd = process.argv[2];
const stage = process.argv[3] ?? 'roads';
const batchId = process.argv[4];

const client = new Client({ name: 'peiqi-probe', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args, timeout = 300000) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
    if (r.isError) throw new Error(r.content?.find((c) => c.type === 'text')?.text?.slice(0, 800) ?? 'tool error');
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };

  if (cmd === 'preview') {
    const doc = JSON.parse(await readFile(A(`peiqi-${stage}-stage.json`), 'utf8'));
    const d = await call('advance_city_plan_construction', {
      action: 'preview_batch', bounds: doc.bounds, plan: doc.plan, approved_plan_id: doc.approved_plan_id,
      batch_id: batchId, request_id: `peiqiprobe_${Date.now()}`, operation_timeout_ms: 120000,
    });
    await writeFile(A(`peiqi-probe-${batchId}.json`), JSON.stringify(d, null, 2));
    console.log(JSON.stringify(d, null, 2).slice(0, 4000));
    if (d.cancel_action) { try { await call(d.cancel_action.tool, d.cancel_action.arguments); console.log('[cancelled]'); } catch (e) { console.log('[cancel failed]', String(e.message).slice(0, 200)); } }
  } else if (cmd === 'nodes') {
    const ids = process.argv.slice(3).filter(Boolean);
    for (const id of ids) {
      const components = await call('get_entity_components', { entity_id: id, components: ['Game.Net.Node'] });
      console.log(id, JSON.stringify(components).slice(0, 1500));
    }
  } else if (cmd === 'anchor') {
    const bounds = { min_x: -1700, min_z: -1500, max_x: -1000, max_z: -800 };
    const snap = await call('get_planning_map_snapshot', { bounds, max_features_per_layer: 2000 });
    const roads = snap.roads ?? [];
    console.log(JSON.stringify({
      road_count: roads.length,
      roads: roads.map((r) => ({
        id: r.id, prefab: r.prefab, name: r.name ?? null,
        a: r.curve?.a ?? r.points?.[0] ?? null, d: r.curve?.d ?? r.points?.at(-1) ?? null,
      })).slice(0, 40),
    }, null, 1));
    const status = await call('get_game_status');
    console.log(JSON.stringify({ session_id: status.session_id ?? null, paused: status.paused }));
  }
} finally {
  await client.close();
}
