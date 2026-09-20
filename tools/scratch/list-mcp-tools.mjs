// 列出 MCP 服务器注册的全部工具名，用于寻找可释放被占用工具状态的入口。
//   node tools/scratch/list-mcp-tools.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const client = new Client({ name: 'list-tools', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp', 'server.mjs')] }));
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name).sort();
  console.log(JSON.stringify({ count: names.length, names }, null, 1));
} finally {
  await client.close();
}
