// 勘查已购区内的既有高压电力网络与线塔位置。
//   node tools/scratch/survey-power.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const A = (f) => path.join(ROOT, 'artifacts', f);

const client = new Client({ name: 'survey-power', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };

  const networks = await call('list_utility_networks', { network_type: 'electricity' });
  console.log('=== electricity networks ===', JSON.stringify(networks).slice(0, 2500));

  const pylons = await call('query_entities', {
    category: 'all', any_components: ['Game.Prefabs.PowerLinePylon'],
    include_prefabs: true, limit: 100,
  }).catch(async () => call('query_entities', { category: 'resource_holders', include_prefabs: true, limit: 100 }));
  console.log('=== pylon query ===', JSON.stringify(pylons).slice(0, 1500));

  const snapshot = await call('get_planning_map_snapshot', {
    bounds: { min_x: -1600, min_z: -1600, max_x: 400, max_z: 300 },
    include_roads: false, include_buildings: false, include_tracks: false, include_utilities: true,
    max_features_per_layer: 2000,
  });
  await writeFile(A('peiqi-power-survey.json'), JSON.stringify({ networks, snapshot }, null, 2));
  const utilities = snapshot.utilities ?? [];
  console.log('=== utility edges in box ===', utilities.length);
  for (const item of utilities.slice(0, 20)) {
    console.log(JSON.stringify({ id: item.id, prefab: item.prefab, a: item.curve?.a ?? item.points?.[0], d: item.curve?.d ?? item.points?.at(-1) }));
  }
} finally {
  await client.close();
}
