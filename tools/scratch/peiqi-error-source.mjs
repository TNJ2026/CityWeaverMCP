// 找出游戏校验错误实体与可建设土地层的可读入口。
//   node tools/scratch/peiqi-error-source.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const client = new Client({ name: 'peiqi-error-source', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };
  for (const search of ['Error', 'Validation', 'Notification']) {
    const found = await call('list_component_types', { search, limit: 60 });
    console.log(`=== component types matching ${search} ===`);
    console.log(JSON.stringify((found.components ?? found.items ?? found).map?.((c) => c.name ?? c.type ?? c) ?? found).slice(0, 1200));
  }
  const layers = await call('list_environment_layers', { limit: 80 });
  console.log('=== environment layers ===');
  console.log(JSON.stringify(layers).slice(0, 1500));
} finally {
  await client.close();
}
