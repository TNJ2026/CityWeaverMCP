import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'traffic-mobility-filters', version: '1.12.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'] }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent.data;
};

try {
  const report = { vehicle_class: {}, role: {}, state: {}, traveler_mode: {} };
  for (const vehicle_class of ['all', 'car', 'bicycle', 'train', 'watercraft', 'aircraft', 'other'])
    report.vehicle_class[vehicle_class] = (await call('list_vehicles', { vehicle_class, limit: 1 })).total;
  for (const role of ['all', 'personal', 'taxi', 'public_transport', 'cargo_transport', 'delivery', 'service', 'other'])
    report.role[role] = (await call('list_vehicles', { role, limit: 1 })).total;
  for (const state of ['all', 'moving', 'parked', 'stuck'])
    report.state[state] = (await call('list_vehicles', { state, limit: 1 })).total;
  for (const mode of ['all', 'walking', 'riding', 'waiting', 'stuck'])
    report.traveler_mode[mode] = (await call('list_travelers', { mode, limit: 1 })).total;
  report.status = await call('get_game_status');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
