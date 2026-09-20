import { queryGame } from '../../mcp/bridge-client.mjs';

function inBounds(pt, b) {
  return pt.x >= b.min_x && pt.x <= b.max_x && pt.z >= b.min_z && pt.z <= b.max_z;
}

function midPoint(road) {
  const a = road.curve?.a ?? road.curve;
  const d = road.curve?.d ?? a;
  return { x: (a.x + d.x) / 2, z: (a.z + d.z) / 2 };
}

async function waitZoning(opId) {
  for (let i = 0; i < 20; i++) {
    const res = await queryGame('get_zoning_operation', { operation_id: opId });
    if (res.data?.state === 'completed') return res.data;
    if (res.data?.state === 'failed') throw new Error(`Zoning failed: ${JSON.stringify(res.data.errors)}`);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Zoning operation timed out');
}

async function applyZoneGroup(name, zoneType, edgeIds, side = 'both', depth = 6) {
  if (!edgeIds.length) {
    console.log(`[${name}] No edges to zone.`);
    return 0;
  }
  const CHUNK_SIZE = 20;
  let totalCells = 0;
  for (let chunkIdx = 0; chunkIdx < edgeIds.length; chunkIdx += CHUNK_SIZE) {
    const chunk = edgeIds.slice(chunkIdx, chunkIdx + CHUNK_SIZE);
    const reqId = `zone_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_p${Math.floor(chunkIdx / CHUNK_SIZE)}_${Date.now().toString(36)}`;
    console.log(`[${name}] Previewing ${zoneType} on chunk ${Math.floor(chunkIdx / CHUNK_SIZE) + 1} (${chunk.length} edges)...`);
    let preview;
    try {
      preview = await queryGame('preview_zoning', {
        request_id: reqId,
        edge_ids: chunk,
        zone: zoneType,
        road_side: side,
        depth_cells: depth,
        overwrite: true,
      });
    } catch (err) {
      if (err?.code === 'NO_ZONING_CHANGES') {
        console.log(`[${name}] Chunk ${Math.floor(chunkIdx / CHUNK_SIZE) + 1} already has matching zoning. Skipping.`);
        continue;
      }
      throw err;
    }
    if (!preview.ok || !preview.data?.can_commit) {
      throw new Error(`[${name}] Preview failed: ${JSON.stringify(preview.data?.error || preview.error)}`);
    }
    const cells = preview.data.changed_cell_count ?? 0;
    console.log(`[${name}] Chunk preview ready with ${cells} cells. Applying...`);
    await queryGame('apply_zoning', {
      operation_id: preview.data.operation_id,
      request_id: reqId,
    });
    await waitZoning(preview.data.operation_id);
    console.log(`[${name}] Chunk applied successfully! (${cells} cells)`);
    totalCells += cells;
  }
  return totalCells;
}

async function main() {
  const status = (await queryGame('get_game_status', {})).data;
  console.log(`Connected to city: ${status.city_name}, paused: ${status.paused}`);

  // 1. Fetch all roads in bounds
  const snapshot = await queryGame('get_planning_map_snapshot', {
    bounds: { min_x: -2816, min_z: 224, max_x: -88, max_z: 1424 },
    include_roads: true,
    max_features_per_layer: 500,
  });
  const allRoads = snapshot.data.roads ?? [];
  console.log(`Total roads found in plan bounds: ${allRoads.length}`);

  // Exclude trunk-avenue and highway from zoning
  const localRoads = allRoads.filter(r => r.prefab !== 'Large Road' && !r.prefab.includes('Highway'));
  console.log(`Local/collector roads to zone: ${localRoads.length}`);

  // Buckets
  const industrialOilEdges = [];
  const industrialMfgEdges = [];
  const commercialHighEdges = [];
  const commercialLowEdges = [];
  const officeHighEdges = [];
  const officeLowEdges = [];
  const resMediumEdges = [];
  const resMediumRowEdges = [];
  const resLowEdges = [];
  const greenBeltEdges = [];

  for (const road of localRoads) {
    const pt = midPoint(road);

    // Industrial zone (z: 1128..1384, x: -1144..-288)
    if (inBounds(pt, { min_x: -1144, max_x: -288, min_z: 1128, max_z: 1384 })) {
      if (pt.x <= -712) {
        industrialOilEdges.push(road.id);
      } else {
        industrialMfgEdges.push(road.id);
      }
      continue;
    }

    // Commercial zone (z: 480..944, x: -772..-172)
    if (inBounds(pt, { min_x: -772, max_x: -172, min_z: 480, max_z: 944 })) {
      if (inBounds(pt, { min_x: -592, max_x: -172, min_z: 544, max_z: 776 })) {
        commercialHighEdges.push(road.id);
      } else {
        commercialLowEdges.push(road.id);
      }
      continue;
    }

    // Office zone (z: 32..360, x: -776..-168)
    if (inBounds(pt, { min_x: -776, max_x: -168, min_z: 32, max_z: 360 })) {
      if (inBounds(pt, { min_x: -592, max_x: -172, min_z: 200, max_z: 360 })) {
        officeHighEdges.push(road.id);
      } else {
        officeLowEdges.push(road.id);
      }
      continue;
    }

    // Residential zone (z: 264..1384, x: -2780..-1548)
    if (inBounds(pt, { min_x: -2780, max_x: -1548, min_z: 264, max_z: 1384 })) {
      // Check green belt: z 1160..1272
      if (pt.z >= 1160 && pt.z <= 1272) {
        greenBeltEdges.push(road.id);
        continue;
      }
      if (pt.x >= -1648) {
        resMediumEdges.push(road.id);
      } else if (pt.x >= -2352 && pt.x <= -2168) {
        resMediumRowEdges.push(road.id);
      } else {
        resLowEdges.push(road.id);
      }
      continue;
    }
  }

  let totalZoned = 0;
  totalZoned += await applyZoneGroup('Industrial Oil', 'Industrial Oil', industrialOilEdges);
  totalZoned += await applyZoneGroup('Industrial Manufacturing', 'Industrial Manufacturing', industrialMfgEdges);
  totalZoned += await applyZoneGroup('Commercial High', 'EU Commercial High', commercialHighEdges);
  totalZoned += await applyZoneGroup('Commercial Low', 'EU Commercial Low', commercialLowEdges);
  totalZoned += await applyZoneGroup('Office High', 'Office High', officeHighEdges);
  totalZoned += await applyZoneGroup('Office Low', 'Office Low', officeLowEdges);
  totalZoned += await applyZoneGroup('Residential Medium', 'EU Residential Medium', resMediumEdges);
  totalZoned += await applyZoneGroup('Residential Medium Row', 'EU Residential Medium Row', resMediumRowEdges);
  totalZoned += await applyZoneGroup('Residential Low', 'EU Residential Low', resLowEdges);

  // Clear green belt
  if (greenBeltEdges.length) {
    console.log(`Clearing zoning on ${greenBeltEdges.length} green belt edges...`);
    await applyZoneGroup('Green Belt Clear', 'none', greenBeltEdges);
  }

  console.log(`\n========================================`);
  console.log(`ZONING COMPLETE: ${totalZoned} cells zoned across all 4 districts!`);
  console.log(`========================================`);
}

main().catch(err => {
  console.error('Fatal error during zoning:', err);
  process.exit(1);
});
