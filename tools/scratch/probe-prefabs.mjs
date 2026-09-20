// 一次性探针：把设施 prefab 目录压成「名称 / 尺寸 / 关键字段」的紧凑列表，避免直读原始 JSON 爆上下文。
// 运行：node tools/scratch/probe-prefabs.mjs [service|utility|transport]
// 注意：本脚本位于 tools/scratch/，上级没有 node_modules，因此 SDK 用绝对路径导入（放到 mcp/ 下才能裸包名）。
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const serverPath = fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url));
const kindArg = process.argv[2] || 'service';
const filter = (process.argv[3] || '').toLowerCase();
const kindFilter = process.argv[4] || 'all';
const toolName = kindArg === 'utility'
  ? 'list_utility_facility_prefabs'
  : 'list_city_service_prefabs';

const client = new Client({ name: 'prefabs-probe', version: '0.1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  // 默认 limit 只有 50，必须翻页才能拿到完整目录（total 是总量不是返回量）。
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await client.callTool({
      name: toolName,
      arguments: { limit: 100, offset, kind: kindFilter },
    });
    const pd = page.structuredContent?.data ?? {};
    const pItems = pd.items ?? [];
    all.push(...pItems);
    if (pItems.length === 0 || pd.next_offset == null || all.length >= (pd.total ?? 0)) break;
    offset = pd.next_offset;
  }
  const shown = filter ? all.filter((it) => it.name.toLowerCase().includes(filter)) : all;
  console.log(`# ${toolName} total=${all.length} shown=${shown.length}`);
  for (const it of shown) {
    const size = it.size_m ? `${it.size_m.x}x${it.size_m.z}` : (it.size ? `${it.size.x}x${it.size.z}` : '-');
    const parts = [
      it.name,
      `size=${size}`,
      it.locked === false ? '' : `locked=${it.locked}`,
      it.cost != null ? `cost=${it.cost}` : '',
      it.category ? `cat=${it.category}` : '',
      it.service ? `svc=${it.service}` : '',
      it.upkeep != null ? `upkeep=${it.upkeep}` : '',
    ].filter(Boolean);
    console.log(parts.join(' | '));
  }
} finally {
  await client.close();
}
