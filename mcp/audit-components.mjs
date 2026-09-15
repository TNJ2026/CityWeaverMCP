// Sample one existing entity per discovered component type; not a complete world export.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const client = new Client({ name: 'cities2-component-audit', version: '0.8.0' });
const report = { started_at: new Date().toISOString(), checked: 0, readable_samples: 0, empty: 0, bounded_out: [], errors: [], unsupported_samples: [], nested_markers: [], by_kind: {}, sampled: [] };
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))] }));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;
  const status = await call('get_game_status');
  if (!status?.data?.city_loaded || status.data.bridge_version !== '1.1.0') throw new Error('Load a city with bridge 1.1.0 first.');
  report.session_id = status.meta.session_id;
  const catalog = [];
  for (let offset = 0; offset !== null;) {
    const page = await call('list_component_types', { limit: 100, offset });
    if (!page.ok) throw new Error(JSON.stringify(page.error));
    catalog.push(...page.data.items);
    offset = page.data.next_offset;
  }
  for (const type of catalog) {
    const response = await call('query_entities', { all_components: [type.name], include_prefabs: true, include_components: [type.name], limit: 1, buffer_limit: 1 });
    report.checked++;
    if (!response?.ok) {
      const code = response?.error?.code || 'MCP_ERROR';
      const entry = { component: type.name, code };
      if (['QUERY_TOO_LARGE', 'INVALID_ARGUMENT'].includes(code)) report.bounded_out.push(entry); else report.errors.push(entry);
      continue;
    }
    if (response.meta.session_id !== report.session_id) throw new Error('City changed during the audit.');
    if (!response.data.items.length) report.empty++;
    else {
      const value = response.data.items[0].components[type.name];
      if (!value.present || value.status) report.unsupported_samples.push({ component: type.name, status: value.status, error_type: value.error_type });
      else {
        report.readable_samples++;
        report.by_kind[value.kind] = (report.by_kind[value.kind] || 0) + 1;
        report.sampled.push(type.name);
        if (/"(?:unsupported|truncated|_truncated|_pagination|reference_type)"|"status":"unavailable"/.test(JSON.stringify(value))) report.nested_markers.push(type.name);
      }
    }
    if (report.checked % 100 === 0) console.log(`Checked ${report.checked}/${catalog.length}: ${report.readable_samples} samples, ${report.empty} empty, ${report.errors.length} errors.`);
  }
  report.finished_at = new Date().toISOString();
  await writeFile(new URL('./component-audit.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, sampled: `${report.sampled.length} names saved in component-audit.json` }, null, 2));
  if (report.errors.length || report.unsupported_samples.length) process.exitCode = 1;
} finally { await client.close(); }




