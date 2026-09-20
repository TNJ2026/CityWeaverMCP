// 只读渲染：把 plans/nistar-star-city-plan.json 交给 render_city_plan，落盘 HTML 与校验结果。
// 运行：node tools/scratch/render-nistar-plan.mjs
const SDK = new URL('../../mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/', import.meta.url).href;
const { Client } = await import(`${SDK}client/index.js`);
const { StdioClientTransport } = await import(`${SDK}client/stdio.js`);
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const serverPath = path.join(ROOT, 'mcp', 'server.mjs');
const planPath = path.join(ROOT, 'plans', 'nistar-star-city-plan.json');
const htmlOut = path.join(ROOT, 'artifacts', 'nistar-star-city-plan.html');
const jsonOut = path.join(ROOT, 'artifacts', 'nistar-star-city-render-result.json');

const args = JSON.parse(await readFile(planPath, 'utf8'));
const client = new Client({ name: 'nistar-planning', version: '1.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
  const r = await client.callTool({ name: 'render_city_plan', arguments: args }, undefined, { timeout: 300000 });
  if (r.isError) throw new Error(JSON.stringify(r).slice(0, 2000));
  const html = r.content?.find((x) => x.type === 'resource' && x.resource?.mimeType === 'text/html')?.resource?.text;
  if (!html) throw new Error(`HTML missing: ${JSON.stringify(r.content?.map((c) => c.type)).slice(0, 500)}`);
  await writeFile(htmlOut, html);
  await writeFile(jsonOut, JSON.stringify(r.structuredContent, null, 2));
  const d = r.structuredContent?.data ?? {};
  console.log(JSON.stringify({
    html: htmlOut,
    html_bytes: html.length,
    plan_id: d.plan_id,
    validation: d.validation,
  }, null, 2));
} finally {
  await client.close();
}
