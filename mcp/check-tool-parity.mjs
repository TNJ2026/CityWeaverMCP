import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { queryGame } from './bridge-client.mjs';

const serverOnlyTools = new Set([
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
    serverOnly: server.filter(x => serverOnlyTools.has(x)),
    missingInGame: gameBackedServer.filter(x => !game.includes(x)),
    missingInServer: game.filter(x => !server.includes(x))
  }, null, 2));
} finally { await client.close(); }
