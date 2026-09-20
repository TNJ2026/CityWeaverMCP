// 美瑞迪安圆形城镇四象限功能区全域分区施划驱动器
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK_BASE = 'file:///D:/Develop/game/CityWeaverMCP/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm';
const { Client } = await import(`${SDK_BASE}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK_BASE}/client/stdio.js`);

const client = new Client({ name: 'apply-town-zoning', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: 'C:/Users/cheng/AppData/Local/pi-node/current/node.exe',
  args: ['D:/Develop/game/CityWeaverMCP/mcp/server.mjs']
}));

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content || []).map(c => c.text || '').join('\n');
  try { return JSON.parse(text); } catch { return { raw: text, isError: result.isError }; }
}

try {
  await call('set_simulation_speed', { speed: 'paused' });

  // 1. Snapshot all 141 roads in town bounds
  const snapshot = await call('get_planning_map_snapshot', {
    bounds: { min_x: -1000, min_z: 100, max_x: 1000, max_z: 2000 },
    include_roads: true,
    include_buildings: false,
    include_tracks: false,
    include_utilities: false,
    max_features_per_layer: 5000
  });

  const roads = snapshot.data?.roads || [];
  console.log(`获取到城镇范围内道路总数: ${roads.length} 条`);

  // Group roads into the 5 functional zoning categories
  const groups = {
    'ne-industrial': { name: '东北先进制造园 (工业)', zone: 'Industrial Manufacturing', edges: [] },
    'se-commercial': { name: '东南都会核心 (商业)', zone: 'EU Commercial High', edges: [] },
    'se-office': { name: '东南外环商务 (办公)', zone: 'Office High', edges: [] },
    'sw-residential': { name: '西南生态宜居 (低密住宅)', zone: 'EU Residential Low', edges: [] },
    'nw-res-medium': { name: '西北都会中密住宅', zone: 'EU Residential Medium', edges: [] },
    'nw-res-high': { name: '西北都会高密住宅', zone: 'EU Residential High', edges: [] }
  };

  for (const r of roads) {
    const cx = (r.curve.a.x + r.curve.d.x) / 2;
    const cz = (r.curve.a.z + r.curve.d.z) / 2;
    const dx = cx - 0;
    const dz = cz - 1024;
    const dist = Math.hypot(dx, dz);

    // Skip highway connector far east (x > 820)
    if (cx > 820) continue;

    // Center civic zone (r < 180): keep unzoned for public park/city hall/hospital tranquility
    if (dist < 180) continue;

    if (dx >= 0 && dz >= 0) {
      // Northeast
      groups['ne-industrial'].edges.push(r.id);
    } else if (dx >= 0 && dz < 0) {
      // Southeast
      if (dist < 560) {
        groups['se-commercial'].edges.push(r.id);
      } else {
        groups['se-office'].edges.push(r.id);
      }
    } else if (dx < 0 && dz < 0) {
      // Southwest
      groups['sw-residential'].edges.push(r.id);
    } else if (dx < 0 && dz >= 0) {
      // Northwest
      if (dist < 560) {
        groups['nw-res-medium'].edges.push(r.id);
      } else {
        groups['nw-res-high'].edges.push(r.id);
      }
    }
  }

  console.log('\n道路分组统计:');
  for (const [key, g] of Object.entries(groups)) {
    console.log(`- ${g.name} [${g.zone}]: ${g.edges.length} 条道路`);
  }

  // Apply zoning in batches of at most 24 edges per preview to avoid cell limit
  let totalZonedCells = 0;

  for (const [key, g] of Object.entries(groups)) {
    if (!g.edges.length) continue;
    console.log(`\n==================================================`);
    console.log(`正在为 ${g.name} 施划分区 (${g.zone})...`);

    const chunkSize = 20;
    for (let i = 0; i < g.edges.length; i += chunkSize) {
      const chunk = g.edges.slice(i, i + chunkSize);
      const reqId = `zone-${key}-${Math.floor(i / chunkSize) + 1}`;

      const preview = await call('preview_zoning', {
        request_id: reqId,
        edge_ids: chunk,
        zone: g.zone,
        road_side: 'both',
        depth_cells: 6,
        overwrite: false,
        include_occupied: false
      });

      const pv = preview.data || preview;
      if (pv.state !== 'preview_ready') {
        console.warn(`  批次 ${reqId} 预览返回状态: ${pv.state}，跳过`);
        continue;
      }

      const commit = await call('apply_zoning', {
        operation_id: pv.operation_id,
        request_id: reqId
      });

      const cm = commit.data || commit;
      const cells = cm.changed_cell_count ?? pv.changed_cell_count ?? 0;
      totalZonedCells += cells;
      console.log(`  批次 [${i / chunkSize + 1}] 已成功划定 ${cells} 个功能地块单元 (状态: ${cm.state})`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`全域土地分区施划完毕！累计生效分区地块单元: ${totalZonedCells} 个！`);

} finally {
  await client.close();
}
