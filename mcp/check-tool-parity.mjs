import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { queryGame } from './bridge-client.mjs';

// Tools implemented by the Node MCP service rather than routed through the game bridge.
// They must never appear in get_query_capabilities; the game-side capabilities array lists
// only bridge-backed tools (see the workflow_orchestration block in GameQueryService.cs).
const serverOnlyTools = new Set([
  'advance_city_plan_construction',
  'advance_grid_construction',
  'bind_city_plan_buildings',
  'build_utility_backbone',
  'cancel_building_plan',
  'connect_utility_facility',
  'deploy_building_plans',
  'deploy_grid_district',
  'deploy_industrial_campus',
  'deploy_service_cluster',
  'deploy_transit_corridor',
  'execute_building_plan',
  'plan_building_workflow',
  'prepare_city_plan_construction',
  'prepare_grid_native_preview',
  'propose_city_plan',
  'propose_grid_plan',
  'render_city_plan',
  'repair_congested_corridor'
]);

const client = new Client({ name: 'tool-parity', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./server.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1')] }));
try {
  const server = (await client.listTools()).tools.map(x => x.name).sort();
  const game = [...(await queryGame('get_query_capabilities', {})).data.tools].sort();
  const gameBackedServer = server.filter(x => !serverOnlyTools.has(x));
  console.log(JSON.stringify({
    server: server.length,
    game: game.length,
    serverOnlyCount: server.filter(x => serverOnlyTools.has(x)).length,
    // A listed server-only tool that the game also advertises means the two lists have
    // drifted: the game is claiming a tool it does not route, or the tool became
    // bridge-backed and must be removed from the exclusion set above.
    serverOnlyButInGame: server.filter(x => serverOnlyTools.has(x) && game.includes(x)),
    missingInGame: gameBackedServer.filter(x => !game.includes(x)),
    missingInServer: game.filter(x => !server.includes(x))
  }, null, 2));
} finally { await client.close(); }
