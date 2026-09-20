// 只读：采样任意点列地形高度（用于坡度排查与选址）
// 用法：node tools/scratch/nistar-elev.mjs x,z x,z ...
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SERVER = path.join(ROOT, 'mcp', 'server.mjs');

const pts = process.argv.slice(2).map((a) => {
  const [x, z] = a.split(',').map(Number);
  return { x, z };
});
if (!pts.length) throw new Error('need x,z pairs');

const client = new Client({ name: 'nistar-elev', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  const r = await client.callTool({ name: 'sample_terrain', arguments: { points: pts } });
  if (r.isError) throw new Error(JSON.stringify(r).slice(0, 2000));
  const d = r.structuredContent?.data ?? r.structuredContent ?? {};
  const list = d.samples ?? d.points ?? d.heights ?? d;
  console.log(JSON.stringify(list, null, 0).slice(0, 4000));
} finally {
  await client.close();
}
