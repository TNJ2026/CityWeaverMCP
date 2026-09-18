// 只读开发工具：列出 MCP 服务暴露的工具名，或导出指定工具的 JSON Schema。
// 放在 mcp/ 下是因为它直接依赖 mcp/node_modules 里的 MCP SDK（与 check-tool-parity.mjs 同类）。
// 用法：
//   node mcp/list-tools.mjs                    # 列出全部工具名
//   node mcp/list-tools.mjs --match wind       # 只列名字里含 wind 的工具
//   node mcp/list-tools.mjs list_road_prefabs  # 打印这些工具的 inputSchema
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const matchIndex = argv.indexOf('--match');
const pattern = matchIndex >= 0 ? argv[matchIndex + 1] : null;
const wanted = argv.filter((item, index) => !item.startsWith('--') && (matchIndex < 0 || index !== matchIndex + 1));

const client = new Client({ name: 'list-tools', version: '0.1.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
}));
const { tools } = await client.listTools();
const selected = tools.filter(tool => (wanted.length ? wanted.includes(tool.name) : !pattern || tool.name.includes(pattern)));
console.log(`共 ${tools.length} 个工具，命中 ${selected.length} 个`);
for (const tool of selected) {
  if (!wanted.length) { console.log(tool.name); continue; }
  console.log(`=== ${tool.name} ===`);
  console.log(JSON.stringify(tool.inputSchema, null, 1));
}
await client.close();
