// Read-only prefab audit. Requires a running game bridge; never applies construction.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';

const client = new Client({ name: 'cities2-building-prefab-audit', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).structuredContent;
try {
  const status = await call('get_game_status');
  if (!status?.data?.connected || !status?.data?.city_loaded) throw new Error('Load a playable city with the updated mod first.');
  const report = { started_at: new Date().toISOString(), session_id: status.meta?.session_id, game_version: status.meta?.game_version, categories: {}, limitations: [
    'This audit discovers prefab metadata and does not commit construction.',
    'Native placement preview remains required for per-location rules and hidden game constraints.',
    'Coverage, attraction and passenger results are simulation-dependent; use the dedicated analysis tools after selecting a candidate.'
  ] };
  async function pages(tool, base) {
    const items = [];
    let offset = 0;
    for (;;) {
      const page = await call(tool, { ...base, offset, limit: 100, unlocked_only: false });
      if (!page?.ok) throw new Error(`${tool}: ${JSON.stringify(page?.error || page)}`);
      items.push(...(page.data?.items || []));
      if (page.data?.next_offset == null) break;
      offset = page.data.next_offset;
    }
    return items;
  }
  const buildings = await pages('list_building_prefabs', { kind: 'building' });
  const services = await pages('list_city_service_prefabs', { kind: 'all' });
  const transport = await pages('list_transport_facility_prefabs', { kind: 'all' });
  report.categories = {
    buildings: { total: buildings.length, items: buildings },
    city_services: { total: services.length, items: services },
    transport_facilities: { total: transport.length, items: transport },
    upgrades: { total: (await pages('list_building_prefabs', { kind: 'upgrade' })).length }
  };
  report.summary = {
    unique_buildings: buildings.filter(x => String(x.placement_flags || '').includes('Unique') || x.placement?.unique).length,
    special_placement_buildings: buildings.filter(x => ['shoreline', 'floating', 'road_edge', 'road_node'].some(mode => x.placement?.[mode])).length,
    service_kinds: [...new Set(services.map(x => x.kind))].sort(),
    transport_prefabs: transport.length,
    unlocked_buildings: buildings.filter(x => !x.locked).length,
    locked_buildings: buildings.filter(x => x.locked).length
  };
  report.finished_at = new Date().toISOString();
  await writeFile(new URL('./building-prefab-audit.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, output: 'mcp/building-prefab-audit.json', summary: report.summary }, null, 2));
} finally { await client.close(); }
