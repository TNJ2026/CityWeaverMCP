// 三层连接探针：确认 cities-skylines2 这个 MCP 服务真的可用，而不是只「配置里写了」。
//
//   [1] 可执行性 — mcp.json 里登记的 command / 入口文件是否真的存在
//   [2] 协议层   — 能否完成 MCP 握手，serverInfo 与工具数量是多少
//   [3] 业务层   — get_game_status 能否打通到游戏
//
// 刻意用中立的工作目录（cwd: '/'）启动服务：若服务依赖启动目录，这里就会失败，
// 而 WorkBuddy 实际启动它时的工作目录同样不该被依赖。
//
// 必须在 mcp/ 目录内运行，否则解析不到 @modelcontextprotocol/sdk。
//
//   node mcp/verify-connection.mjs [服务名]
//
// 默认读 ~/.workbuddy/mcp.json，可用 WORKBUDDY_MCP_CONFIG 指向别的配置。
// 注意：这只验证「服务本身健康」。WorkBuddy 侧能否调用还取决于该服务是否已被信任
// （~/.workbuddy/mcp-approvals.json 里的 <hash>::<服务名> 键），那一步只能人工点。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONFIG = process.env.WORKBUDDY_MCP_CONFIG
  ?? path.join(os.homedir(), '.workbuddy', 'mcp.json');
const NAME = process.argv[2] ?? 'cities-skylines2';

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const server = cfg.mcpServers?.[NAME];
if (!server) {
  console.error(`配置 ${CONFIG} 里没有名为 ${NAME} 的服务`);
  process.exit(1);
}

const entry = server.args?.[0] ?? null;

console.log(`配置: ${CONFIG}`);
console.log(`服务: ${NAME}`);
console.log('[1] 可执行性');
console.log('  command 存在 :', fs.existsSync(server.command), '->', server.command);
console.log('  入口文件存在 :', entry ? fs.existsSync(entry) : '(未在 args[0] 声明)', '->', entry);
console.log('  disabled     :', server.disabled ?? false);

const client = new Client({ name: 'verify-connection', version: '0.0.1' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: server.command,
  args: server.args,
  cwd: server.cwd ?? '/',
});

try {
  await client.connect(transport);
} catch (error) {
  console.error(`[2] 协议层失败：无法启动或握手 ${error?.message ?? error}`);
  process.exit(1);
}

console.log('[2] 协议层');
console.log('  serverInfo   :', JSON.stringify(client.getServerVersion()));
const tools = await client.listTools();
console.log('  工具数量     :', tools.tools.length);
console.log('  工具样例     :', tools.tools.slice(0, 5).map(tool => tool.name).join(', '));

console.log('[3] 业务层');
const status = await client.callTool({ name: 'get_game_status', arguments: {} });
const text = (status.content ?? []).map(item => item.text ?? '').join('');
console.log('  isError      :', status.isError ?? false);
console.log('  payload      :', text.slice(0, 500));

await client.close();

if (status.isError) {
  console.error('\n业务层返回错误：服务与协议都正常，但游戏侧没通。');
  process.exitCode = 1;
} else {
  console.log('\n三层全通。');
}
