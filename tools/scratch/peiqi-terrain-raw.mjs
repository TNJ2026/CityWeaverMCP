// 打印 sample_terrain 原始返回结构，并检查五边形范围的原生可建设土地。
//   node tools/scratch/peiqi-terrain-raw.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const client = new Client({ name: 'peiqi-terrain-raw', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    if (r.isError) throw new Error(`${name}: ${r.content?.find((c) => c.type === 'text')?.text?.slice(0, 300)}`);
    return r.structuredContent?.data ?? r.structuredContent ?? {};
  };

  const terrain = await call('sample_terrain', {
    points: [
      { x: -1400, z: -480 }, { x: -1366.4, z: -583.2 }, { x: -1332.8, z: -686.4 },
      { x: -1266, z: -893 }, { x: -1064, z: -1512 }, { x: -520, z: 160 },
    ],
  });
  console.log('=== sample_terrain raw ===');
  console.log(JSON.stringify(terrain).slice(0, 1500));

  const buildable = await call('analyze_buildable_area', { state: 'owned' });
  console.log('=== analyze_buildable_area (owned) ===');
  console.log(JSON.stringify(buildable).slice(0, 2000));
} finally {
  await client.close();
}
