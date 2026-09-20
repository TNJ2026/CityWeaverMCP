import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const client = new Client({ name: 'meridian-building-binding', version: '1.0.0' });

try {
  await client.connect(new StdioClientTransport({
    command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
    args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs']
  }));

  const planDoc = JSON.parse(await readFile(path.join(ROOT, 'plans/meridian-circular-town-plan.json'), 'utf8'));
  const roads = planDoc.plan.roads.map(r => ({ ...r, construction_status: 'built' }));

  // Fix category to 'auto' for all buildings, and test the 5 problematic buildings with larger radius
  const testIds = ['bld-city-hall', 'bld-general-hospital', 'bld-college', 'bld-police-hq', 'bld-elem-school-nw'];
  const buildings = planDoc.plan.buildings.map(b => {
    const item = { ...b, category: 'auto' };
    if (item.id === 'bld-general-hospital') {
      item.position = { x: 160, z: 1080 }; // move away from center intersection
    } else if (item.id === 'bld-city-hall') {
      item.position = { x: -160, z: 1080 };
    } else if (item.id === 'bld-college') {
      item.position = { x: -160, z: 960 };
    } else if (item.id === 'bld-police-hq') {
      item.position = { x: 160, z: 960 };
    } else if (item.id === 'bld-elem-school-nw') {
      item.position = { x: -480, z: 1360 }; // along the northwest avenue / ring
    }
    return item;
  });

  const plan = { ...planDoc.plan, roads, buildings };

  console.log('Testing binding for the 5 buildings...');
  const res = await client.callTool({
    name: 'bind_city_plan_buildings',
    arguments: {
      bounds: planDoc.bounds,
      plan,
      building_ids: testIds,
      request_id: 'test-bind-5-001',
      candidate_count: 16,
      max_preview_attempts: 8,
      search_radius_m: 400,
      continue_on_error: true,
      operation_timeout_ms: 30000
    }
  });

  const data = res.structuredContent || res;
  const boundPlan = data.data?.plan || data.plan;
  const results = data.data?.results || data.results || [];
  for (const r of results) {
    console.log(r.building_id, 'state=' + r.state, r.error || '');
  }
} finally {
  await client.close();
}
