import { readFile, writeFile } from 'node:fs/promises';
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
  // Mark all roads as built so the binder knows the roads exist
  const roads = planDoc.plan.roads.map(r => ({ ...r, construction_status: 'built' }));

  const buildings = planDoc.plan.buildings.map(b => {
    const item = { ...b, category: 'auto' };
    if (item.id === 'bld-city-hall') {
      item.position = { x: -160, z: 1080 };
    } else if (item.id === 'bld-general-hospital') {
      item.position = { x: 140, z: 1080 };
    } else if (item.id === 'bld-college') {
      item.position = { x: -160, z: 960 };
    } else if (item.id === 'bld-police-hq') {
      item.position = { x: 160, z: 960 };
    } else if (item.id === 'bld-elem-school-nw') {
      item.position = { x: -480, z: 1360 };
    }
    return item;
  });

  const plan = { ...planDoc.plan, roads, buildings };

  console.log('Invoking bind_city_plan_buildings for all 25 buildings via MCP server...');
  const res = await client.callTool({
    name: 'bind_city_plan_buildings',
    arguments: {
      bounds: planDoc.bounds,
      plan,
      request_id: 'meridian-building-binding-full-002',
      candidate_count: 16,
      max_preview_attempts: 8,
      search_radius_m: 400,
      continue_on_error: true,
      operation_timeout_ms: 60000
    }
  });

  const data = res.structuredContent || res;
  await writeFile(path.join(ROOT, 'artifacts/meridian-building-bindings.json'), JSON.stringify(data, null, 2), 'utf8');
  console.log('[OK] Bind output written to artifacts/meridian-building-bindings.json');

  const boundPlan = data.data?.plan || data.plan;
  const results = data.data?.results || data.results || [];
  console.log(`\nBinding Results: ${results.filter(r => r.state === 'bound').length} / ${results.length} succeeded.`);
  for (const r of results) {
    console.log(`- ${r.building_id}: state=${r.state} edge=${r.road_edge_id || 'none'} ${r.error || ''}`);
  }

  // Also update meridian-circular-town-plan.json with the bound plan so subsequent tools see the bound buildings
  if (boundPlan) {
    const updatedDoc = {
      ...planDoc,
      plan: boundPlan
    };
    await writeFile(path.join(ROOT, 'plans/meridian-circular-town-plan.json'), JSON.stringify(updatedDoc, null, 2), 'utf8');
    console.log('[OK] Updated plans/meridian-circular-town-plan.json with bound buildings');
  }
} finally {
  await client.close();
}
