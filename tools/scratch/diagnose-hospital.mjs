import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const client = new Client({ name: 'meridian-hospital-diagnostics', version: '1.0.0' });

try {
  await client.connect(new StdioClientTransport({
    command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
    args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs']
  }));

  // Let's test different positions along the East-West avenue (z = 1024 + offset) or inner ring
  const testPositions = [
    { label: 'pos-140-1080', x: 140, z: 1080 },
    { label: 'pos-180-1080', x: 180, z: 1080 },
    { label: 'pos-120-1120', x: 120, z: 1120 },
    { label: 'pos-180-1120', x: 180, z: 1120 },
    { label: 'pos-200-1070', x: 200, z: 1070 },
    { label: 'pos-80-1150', x: 80, z: 1150 }
  ];

  const planDoc = JSON.parse(await readFile(path.join(ROOT, 'plans/meridian-circular-town-plan.json'), 'utf8'));
  const roads = planDoc.plan.roads.map(r => ({ ...r, construction_status: 'built' }));

  for (const tp of testPositions) {
    const testBuilding = {
      id: 'bld-general-hospital',
      prefab: 'Hospital01',
      label: '中央综合医院',
      kind: 'service',
      category: 'auto',
      size_m: { x: 184, z: 80 },
      position: { x: tp.x, z: tp.z }
    };

    const plan = {
      ...planDoc.plan,
      roads,
      buildings: [testBuilding]
    };

    const res = await client.callTool({
      name: 'bind_city_plan_buildings',
      arguments: {
        bounds: planDoc.bounds,
        plan,
        building_ids: ['bld-general-hospital'],
        request_id: `test-hosp-${tp.label}`,
        candidate_count: 8,
        max_preview_attempts: 8,
        search_radius_m: 350,
        continue_on_error: true,
        operation_timeout_ms: 20000
      }
    });

    const data = res.structuredContent || res;
    const result = (data.data?.results || data.results || [])[0];
    console.log(tp.label, '=> state:', result?.state, result?.error || '');
    if (result?.state === 'bound') {
      console.log('SUCCESS! Bound result:', JSON.stringify(result, null, 2));
      break;
    }
  }
} finally {
  await client.close();
}
