import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROGRESS_FILE = path.join(ROOT, 'tools/scratch/.meridian-construction-progress.jsonl');

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const client = new Client({ name: 'deploy-utilities', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs']
}));

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content || []).map(c => c.text || '').join('\n');
  try { return JSON.parse(text); } catch { return { raw: text, isError: result.isError }; }
}

async function pollUtility(operationId) {
  for (let i = 0; i < 20; i++) {
    const res = await call('get_utility_operation', { operation_id: operationId });
    const data = res.data || res;
    if (data.state === 'preview_ready' || data.state === 'completed' || data.state === 'failed' || data.state === 'cancelled') {
      return data;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const last = await call('get_utility_operation', { operation_id: operationId });
  return last.data || last;
}

try {
  await call('set_simulation_speed', { speed: 'paused' });

  // 1. Water Ring Inner (13 points, 30 deg steps)
  const ringPoints = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (i * 30 * Math.PI) / 180;
    ringPoints.push({
      x: Math.round(320 * Math.cos(angle)),
      z: 1024 + Math.round(320 * Math.sin(angle)),
      elevation_m: -10
    });
  }

  // 2. Sewage Trunk 1
  const sewagePoints = [
    { x: 0, z: 1024, elevation_m: -10 },
    { x: 160, z: 1024, elevation_m: -10 },
    { x: 320, z: 1024, elevation_m: -10 },
    { x: 430, z: 1099, elevation_m: -10 },
    { x: 540, z: 1175, elevation_m: -10 },
    { x: 650, z: 1250, elevation_m: -10 }
  ];

  // 3. Power Line 1
  const powerPoints = [
    { x: 596, z: 1068, elevation_m: -10 },
    { x: 458, z: 1046, elevation_m: -10 },
    { x: 320, z: 1024, elevation_m: -10 },
    { x: 160, z: 1024, elevation_m: -10 },
    { x: 0, z: 1024, elevation_m: -10 }
  ];

  const utilityTasks = [
    { id: 'util-water-ring-inner', prefab: 'Large Water Pipe', points: ringPoints },
    { id: 'util-sewage-trunk-1', prefab: 'Large Sewage Pipe', points: sewagePoints },
    { id: 'util-power-line-1', prefab: 'High-voltage Ground Cable', points: powerPoints }
  ];

  for (const task of utilityTasks) {
    console.log(`\n--------------------------------------------------`);
    console.log(`正在预览管网: ${task.id} (${task.prefab}, ${task.points.length} 点)...`);
    const preview = await call('preview_utility_network', {
      request_id: `req-${task.id}-pvw-02`,
      utility_prefab: task.prefab,
      points: task.points
    });

    let pv = preview.data || preview;
    if (pv.state === 'queued' || pv.state === 'generating_preview') {
      pv = await pollUtility(pv.operation_id);
    }
    console.log(`  [preview] state=${pv.state} cost=${pv.cost ?? '?'}`);
    if (pv.state !== 'preview_ready') {
      console.error('  预览未就绪:', JSON.stringify(pv).slice(0, 1000));
      continue;
    }

    console.log(`正在提交管网施工: ${task.id}...`);
    const commit = await call('apply_utility_operation', {
      operation_id: pv.operation_id,
      request_id: `req-${task.id}-cmt-02`,
      max_cost: Math.ceil((pv.cost || 0) * 1.5) + 10000
    });

    let cm = commit.data || commit;
    if (cm.state === 'commit_queued' || cm.state === 'applying') {
      cm = await pollUtility(cm.operation_id || pv.operation_id);
    }
    console.log(`  [commit] state=${cm.state} edges=${cm.created_utility_ids?.length ?? cm.created_network_ids?.length ?? 'yes'}`);

    await appendFile(PROGRESS_FILE, JSON.stringify({
      phase: 'committed',
      batch_id: task.id,
      state: cm.state,
      object_ids: [task.id],
      result_entities: cm.created_utility_ids || cm.created_network_ids || [],
      at: new Date().toISOString()
    }) + '\n');
  }

  console.log(`\n==================================================`);
  console.log(`所有骨干管网施工完毕！`);

} finally {
  await client.close();
}
