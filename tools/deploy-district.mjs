import { queryGame, BridgeError } from '../mcp/bridge-client.mjs';
import { validateDistrictConfig, snapPoint, snapToCell, subdivideRoute } from './lib/physics-rules.mjs';
import { surveySpace } from './survey-space.mjs';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CityWeaver High-Efficiency District Deployment Tool
 * 
 * Automates the entire end-to-end process of:
 * 1. Pre-flight conflict check (buildings, tile ownership, game status)
 * 2. Simulation pausing with guaranteed rollback/restoral
 * 3. Grid road network construction (orthogonal 8m lattice aligned)
 * 4. Arterial/connector road link to existing network (auto-subdividing long curves)
 * 5. Theme-aware batch zoning (NA / EU asset resolution)
 * 6. Simulation restoral and concise token-optimized reporting
 */

// Mapping of generic zone keys to theme-specific active asset prefabs
const ZONE_PREFAB_MAP = {
  'North American': {
    'residential_low': 'NA Residential Low',
    'residential_medium': 'NA Residential Medium',
    'residential_high': 'NA Residential High',
    'residential_mixed': 'NA Residential Mixed',
    'commercial_low': 'NA Commercial Low',
    'commercial_high': 'NA Commercial High',
    'industrial': 'Industrial Manufacturing',
    'industrial_low': 'Industrial Manufacturing',
    'office_low': 'NA Office Low',
    'office_high': 'NA Office High',
    'office': 'NA Office High'
  },
  'European': {
    'residential_low': 'EU Residential Low',
    'residential_medium': 'EU Residential Medium',
    'residential_high': 'EU Residential High',
    'residential_mixed': 'EU Residential Mixed',
    'commercial_low': 'EU Commercial Low',
    'commercial_high': 'EU Commercial High',
    'industrial': 'Industrial Manufacturing',
    'industrial_low': 'Industrial Manufacturing',
    'office_low': 'EU Office Low',
    'office_high': 'EU Office High',
    'office': 'EU Office High'
  }
};

/**
 * Wait for a road operation to enter a target state with timeout.
 */
async function waitRoadOp(opId, targetState = 'preview_ready', maxWaitMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_road_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Road operation ${opId} failed: state=${op.state}, errors=${JSON.stringify(op.errors || [])}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Road operation ${opId} timed out waiting for ${targetState}`);
}

async function waitZoningOp(opId, targetState = 'completed', maxWaitMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_zoning_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Zoning operation ${opId} failed: state=${op.state}, errors=${JSON.stringify(op.errors || [])}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Zoning operation ${opId} timed out waiting for ${targetState}`);
}

async function waitBuildingOp(opId, targetState = 'preview_ready', maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await queryGame('get_building_operation', { operation_id: opId });
    const op = res.data;
    if (op.state === targetState) return op;
    if (['failed', 'cancelled', 'expired', 'outcome_unknown'].includes(op.state)) {
      throw new Error(`Building operation ${opId} failed: state=${op.state}, errors=${JSON.stringify(op.errors || [])}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Building operation ${opId} timed out waiting for ${targetState}`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

/**
 * Build a previewed road operation.
 */
async function buildRoadOp(opId, reqId, maxCost = 1000000) {
  await queryGame('build_road', {
    operation_id: opId,
    request_id: `${reqId}-build`,
    max_cost: maxCost
  });
  return await waitRoadOp(opId, 'completed', 15000);
}

/**
 * Auto-subdivide long road segments so no segment exceeds maxLenM (CS2 max is 256m).
 */
function normalizeRoutePoints(points, maxLenM = 200, minLenM = 16) {
  if (!points || points.length < 2) return points;
  const result = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= maxLenM) {
      result.push(p2);
    } else {
      const steps = Math.ceil(dist / maxLenM);
      for (let s = 1; s < steps; s++) {
        const ratio = s / steps;
        result.push({
          x: Number((p1.x + dx * ratio).toFixed(2)),
          z: Number((p1.z + dz * ratio).toFixed(2))
        });
      }
      result.push(p2);
    }
  }
  return result;
}

/**
 * Deploy a complete district with pre-flight checks, road grid, connectors, zoning, and simulation control.
 *
 * @param {Object} options Configuration parameters:
 *   - origin: { x: number, z: number } (Southwest corner of grid)
 *   - columns: number (1..5)
 *   - rows: number (1..5)
 *   - block_width_m: number (multiples of 8m, e.g. 96)
 *   - block_height_m: number (multiples of 8m, e.g. 96)
 *   - road_prefab: string (default 'Small Road')
 *   - perimeter_road_prefab: string (optional)
 *   - zone_type: string ('commercial_low', 'residential_low', 'industrial', etc. or exact prefab)
 *   - arterial_connector: { road_prefab: string, points: Array<{ x, z, node_id? }> } (optional)
 *   - resume_speed: 'paused' | 'normal' | 'fast' | 'fastest' (default 'fastest')
 *   - survey_mode: 'full' | 'quick' (default 'full'; quick defers full building collision scan)
 *   - building_batch: { building_prefab, road_side?, spacing_m?, maximum_buildings?, max_cost? } (optional)
 *   - growth_loop: { cycles?, interval_ms?, stop_on_negative_cash?, speed? } (optional)
 *   - check_conflicts: boolean (default true)
 */
export async function deployDistrict(options) {
  const t0 = Date.now();
  const summary = {
    success: false,
    city: null,
    district_type: options.zone_type || 'none',
    grid: null,
    arterial: null,
    zoning: null,
    buildings: null,
    growth_loop: null,
    total_cost: 0,
    duration_ms: 0,
    notes: []
  };

  let originalSpeed = 'paused';
  let initialPaused = true;

  try {
    // === 0. Mathematical & Physics Rules Pre-Flight Validation ===
    const validation = validateDistrictConfig(options);
    if (!validation.valid) {
      throw new Error(`Geometric configuration invalid: ${validation.errors.join('; ')}`);
    }
    if (validation.warnings.length > 0) {
      summary.notes.push(...validation.warnings);
    }

    // === 1. Pre-flight Status & Conflict Check ===
    const statusRes = await queryGame('get_game_status', {});
    const status = statusRes.data;
    if (!status.city_loaded) throw new Error('No city is currently loaded in the game.');
    
    summary.city = status.city_name;
    originalSpeed = status.selected_speed === 4 ? 'fastest' : status.selected_speed === 2 ? 'fast' : status.selected_speed === 1 ? 'normal' : 'paused';
    initialPaused = status.paused;

    // Pause game for atomic mutation
    if (!status.paused) {
      await queryGame('set_simulation_speed', { speed: 'paused' });
    }

    // Resolve Theme and Zone Prefab
    let targetZonePrefab = options.zone_type || null;
    if (targetZonePrefab) {
      const configRes = await queryGame('get_city_configuration', {});
      const theme = configRes.data?.theme || 'North American';
      const mapped = ZONE_PREFAB_MAP[theme]?.[targetZonePrefab.toLowerCase()];
      if (mapped) targetZonePrefab = mapped;
    }

    // Lattice snapping for origin (8m grid via physics rules)
    const originX = snapToCell(options.origin.x);
    const originZ = snapToCell(options.origin.z);
    const cols = options.columns || 3;
    const rows = options.rows || 3;
    const blockW = snapToCell(options.block_width_m || 96);
    const blockH = snapToCell(options.block_height_m || 96);
    const totalW = cols * blockW;
    const totalH = rows * blockH;

    // === 1. Pre-flight Spatial & Conflict Survey ===
    if (options.check_conflicts !== false) {
        const survey = await surveySpace({
        origin: { x: originX, z: originZ },
        width_m: totalW,
        height_m: totalH,
        clearance_m: options.clearance_m ?? 16,
        mode: options.survey_mode || 'full'
      });

      if (survey.suitability.verdict === 'BLOCKED') {
        throw new Error(`Spatial Survey Failed: ${survey.issues.join('; ')}`);
      }

      summary.spatial_survey = {
        terrain_grade: `${survey.terrain.max_grade_percent}% (${survey.terrain.classification})`,
        elevation_delta: `${survey.terrain.delta_y}m`,
        ownership: survey.ownership.fully_owned ? '100% Owned' : 'Incomplete',
        obstacles: survey.collisions.checked === false ? 'deferred' : survey.collisions.building_count
      };
    }

    // === 2. Build Road Grid ===
    const gridReqId = `dist-grid-${Date.now().toString(36)}`;
    const gridPreview = await queryGame('preview_road_grid', {
      request_id: gridReqId,
      road_prefab: options.road_prefab || 'Small Road',
      horizontal_road_prefab: options.horizontal_road_prefab,
      vertical_road_prefab: options.vertical_road_prefab,
      perimeter_road_prefab: options.perimeter_road_prefab || options.road_prefab || 'Small Road',
      origin: { x: originX, z: originZ },
      columns: cols,
      rows: rows,
      block_width_m: blockW,
      block_height_m: blockH,
      auto_connect: options.auto_connect ?? false,
      connection_sides: options.connection_sides,
      connection_search_radius_m: options.connection_search_radius_m,
      connection_road_prefab: options.connection_road_prefab,
      minimum_connections: options.minimum_connections,
      maximum_connections: options.maximum_connections
    });

    const gridOp = await waitRoadOp(gridPreview.data.operation_id, 'preview_ready');
    const gridCost = gridOp.cost || 0;
    summary.total_cost += gridCost;

    const gridDone = await buildRoadOp(gridPreview.data.operation_id, gridReqId, options.max_cost || 100000);
    const createdEdges = gridDone.created_road_ids || [];
    summary.grid = {
      origin: { x: originX, z: originZ },
      cols, rows,
      block_size_m: { width: blockW, height: blockH },
      edges_count: createdEdges.length,
      cost: gridCost
    };

    // === 3. Build Arterial Connector (Optional) ===
    if (options.arterial_connector && options.arterial_connector.points?.length >= 2) {
      const artReqId = `dist-art-${Date.now().toString(36)}`;
      const rawPoints = options.arterial_connector.points;
      const normPoints = normalizeRoutePoints(rawPoints, 200, 16);

      // Preload edge/node topology with bounded concurrency, then snap endpoints locally.
      if (createdEdges.length > 0) {
        const edgeDataList = await mapLimit(createdEdges, 4, edgeId => queryGame('get_entity_components', {
          entity_id: edgeId,
          components: ['Game.Net.Edge']
        }));
        const nodeIds = [...new Set(edgeDataList.flatMap(edgeData => {
          const f = edgeData.data?.components?.['Game.Net.Edge']?.fields;
          return f ? [f.m_Start, f.m_End].filter(Boolean) : [];
        }))];
        const nodeDataList = await mapLimit(nodeIds, 4, nodeId => queryGame('get_entity_components', {
          entity_id: nodeId,
          components: ['Game.Net.Node']
        }));
        const nodes = nodeDataList.map((nodeData, i) => ({
          id: nodeIds[i],
          position: nodeData.data?.components?.['Game.Net.Node']?.fields?.m_Position
        })).filter(n => n.position);
        for (const pt of normPoints) {
          if (pt.node_id) continue;
          const match = nodes.find(n => Math.hypot(n.position.x - pt.x, n.position.z - pt.z) < 4);
          if (match) pt.node_id = match.id;
        }
      }

      const artPreview = await queryGame('preview_road_route', {
        request_id: artReqId,
        road_prefab: options.arterial_connector.road_prefab || 'Medium Road',
        points: normPoints
      });

      const artOp = await waitRoadOp(artPreview.data.operation_id, 'preview_ready');
      const artCost = artOp.cost || 0;
      summary.total_cost += artCost;

      const artDone = await buildRoadOp(artPreview.data.operation_id, artReqId, options.max_cost || 100000);
      summary.arterial = {
        road_prefab: options.arterial_connector.road_prefab || 'Medium Road',
        segments_count: artDone.created_road_ids?.length || normPoints.length - 1,
        cost: artCost
      };
    }

    // === 4. Apply Batch Zoning (Optional) ===
    if (targetZonePrefab && createdEdges.length > 0) {
      const zoneReqId = `dist-zone-${Date.now().toString(36)}`;
      const zonePreview = await queryGame('preview_zoning', {
        request_id: zoneReqId,
        edge_ids: createdEdges,
        zone: targetZonePrefab,
        road_side: 'both',
        depth_cells: options.depth_cells || 6,
        overwrite: true
      });

      const changedCells = zonePreview.data.changed_cell_count || 0;
      await queryGame('apply_zoning', {
        operation_id: zonePreview.data.operation_id,
        request_id: zoneReqId
      });
      await waitZoningOp(zonePreview.data.operation_id, 'completed');

      summary.zoning = {
        zone_prefab: targetZonePrefab,
        cells_zoned: changedCells
      };
    }

    // === 5. Optional Batch Building Placement ===
    const batch = options.building_batch;
    if (batch?.building_prefab && createdEdges.length > 0) {
      const planReq = await queryGame('plan_building_row', {
        building_prefab: batch.building_prefab,
        road_edge_ids: createdEdges,
        road_side: batch.road_side || 'both',
        spacing_m: batch.spacing_m ?? 8,
        maximum_buildings: batch.maximum_buildings ?? 32,
        auto_level_foundations: batch.auto_level_foundations ?? true,
        max_terrain_relief_m: batch.max_terrain_relief_m ?? 8,
        reserve_upgrade_prefabs: batch.reserve_upgrade_prefabs ?? []
      });
      const placements = planReq.data?.placements || [];
      if (placements.length === 0) throw new Error('Building batch planner returned no valid placements.');
      const buildReqId = `dist-build-${Date.now().toString(36)}`;
      const buildPreview = await queryGame('preview_building_batch_placement', {
        request_id: buildReqId,
        building_prefab: batch.building_prefab,
        placements,
        auto_level_foundations: batch.auto_level_foundations ?? true,
        max_terrain_relief_m: batch.max_terrain_relief_m ?? 8
      });
      const buildOp = await waitBuildingOp(buildPreview.data.operation_id, 'preview_ready');
      const buildCost = buildOp.cost || 0;
      await queryGame('apply_building_operation', {
        operation_id: buildPreview.data.operation_id,
        request_id: `${buildReqId}-commit`,
        max_cost: batch.max_cost ?? options.max_cost ?? 1000000
      });
      const buildDone = await waitBuildingOp(buildPreview.data.operation_id, 'completed');
      summary.total_cost += buildCost;
      summary.buildings = {
        building_prefab: batch.building_prefab,
        placed_count: buildDone.result_entity_ids?.length || placements.length,
        cost: buildCost
      };
    }

    // === 6. Restore Simulation ===
    const targetResumeSpeed = options.resume_speed || 'fastest';
    await queryGame('set_simulation_speed', { speed: targetResumeSpeed });

    // === 7. Optional High-Speed Growth Observation Loop ===
    const growth = options.growth_loop;
    if (growth) {
      const requestedCycles = Number(growth.cycles ?? 3);
      const requestedInterval = Number(growth.interval_ms ?? 2000);
      const cycles = Number.isFinite(requestedCycles) ? Math.max(1, Math.min(60, Math.floor(requestedCycles))) : 3;
      const intervalMs = Number.isFinite(requestedInterval) ? Math.max(250, Math.min(120000, Math.floor(requestedInterval))) : 2000;
      const speed = growth.speed || 'fastest';
      await queryGame('set_simulation_speed', { speed });
      const samples = [];
      let stopReason = null;
      let nextAction = 'continue';
      for (let i = 0; i < cycles; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        const [city, demand, housing, employment, economy] = await Promise.all([
          queryGame('get_city_summary', {}),
          queryGame('get_zone_demand', {}),
          queryGame('get_housing_statistics', {}),
          queryGame('get_employment_statistics', {}),
          queryGame('get_city_economy', {})
        ]);
        const economyData = economy.data || {};
        const sample = {
          cycle: i + 1,
          population: city.data?.population ?? null,
          money: economyData.money ?? null,
          balance: economyData.balance ?? null,
          hourly_money_delta: economyData.hourly_money_delta ?? null,
          unemployment_rate: employment.data?.unemployment_rate ?? null,
          housing: housing.data?.properties ?? null,
          demand: demand.data || null
        };
        samples.push(sample);
        if (growth.stop_on_negative_cash !== false && typeof sample.money === 'number' && sample.money < 0) {
          stopReason = 'negative_cash';
          nextAction = 'stop_and_repair_finances';
          break;
        }
        if (typeof growth.min_balance === 'number' && typeof sample.balance === 'number' && sample.balance < growth.min_balance) {
          stopReason = 'balance_below_threshold';
          nextAction = 'stop_and_reassess_budget';
          break;
        }
        if (typeof growth.max_unemployment_rate === 'number' &&
            typeof sample.unemployment_rate === 'number' &&
            sample.unemployment_rate > growth.max_unemployment_rate) {
          stopReason = 'unemployment_above_threshold';
          nextAction = 'stop_and_reassess_housing_jobs';
          break;
        }
      }
      if (!stopReason) nextAction = 'continue_or_start_next_batch';
      summary.growth_loop = { cycles_requested: cycles, cycles_completed: samples.length, interval_ms: intervalMs, speed, stop_reason: stopReason, next_action: nextAction, samples };
    }

    summary.success = true;
    summary.duration_ms = Date.now() - t0;
    return summary;

  } catch (err) {
    // Safety: restore the pre-deployment speed even if a post-build growth
    // observation cycle fails after temporarily running at fastest speed.
    try {
      await queryGame('set_simulation_speed', { speed: initialPaused ? 'paused' : originalSpeed });
    } catch {}
    summary.duration_ms = Date.now() - t0;
    summary.error = err.message;
    throw err;
  }
}

// === CLI Execution Handler ===
if (process.argv[1] && process.argv[1].endsWith('deploy-district.mjs')) {
  import('node:fs').then(async fsModule => {
    const fs = fsModule.default;
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage:
  node tools/deploy-district.mjs --archetype <name> --origin X,Z [options]
  node tools/deploy-district.mjs --config <path-to-json>
  node tools/deploy-district.mjs --origin X,Z --cols 3 --rows 3 --zone commercial_low

Options:
  --archetype <name>    Use pre-validated archetype: residential_suburban_3x2, commercial_hub_3x3, industrial_manufacturing_3x2, etc.
  --config <path>       Path to JSON configuration file
  --origin <X,Z>        Grid origin (e.g. -1600,160)
  --cols <N>            Columns (1..10, default 3)
  --rows <N>            Rows (1..10, default 3)
  --block-w <N>         Block width in meters (default 96)
  --block-h <N>         Block height in meters (default 96)
  --road <name>         Road prefab (default 'Small Road')
  --zone <type>         Zone type: commercial_low, residential_low, industrial, etc.
  --survey-mode <mode>  Spatial survey mode: full (default) or quick (defer building scan)
  --building-prefab <p> Batch-place a roadside building prefab on the new roads
  --building-count <N>  Maximum buildings for the batch (default 32)
  --growth-cycles <N>   Run fastest-speed observation cycles after construction
  --growth-interval-ms <N>  Delay between growth samples (default 2000)
  --resume <speed>      Simulation speed to set after completion (fastest, normal, paused)
  --verbose             Output full verbose JSON dump instead of compact summary
      `);
      process.exit(0);
    }

    let config = {};
    const verbose = args.includes('--verbose');

    // Check for archetype preset
    const archIdx = args.indexOf('--archetype');
    if (archIdx !== -1 && args[archIdx + 1]) {
      const archName = args[archIdx + 1];
      const presetPath = path.resolve(path.dirname(process.argv[1]), 'presets/district-archetypes.json');
      if (fs.existsSync(presetPath)) {
        const presets = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
        if (presets.archetypes?.[archName]) {
          config = { ...presets.archetypes[archName] };
          console.log(`[Archetype Loaded] ${config.name || archName} (Zoning Efficiency: ${config.zoning_efficiency || '100%'})`);
        } else {
          console.warn(`[Warning] Archetype '${archName}' not found in presets, proceeding with defaults.`);
        }
      }
    }

    const configIdx = args.indexOf('--config');
    if (configIdx !== -1 && args[configIdx + 1]) {
      config = { ...config, ...JSON.parse(fs.readFileSync(args[configIdx + 1], 'utf-8')) };
    } else {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--origin' && args[i + 1]) {
          const [x, z] = args[i + 1].split(',').map(Number);
          config.origin = { x, z };
        }
        if (args[i] === '--cols' && args[i + 1]) config.columns = Number(args[i + 1]);
        if (args[i] === '--rows' && args[i + 1]) config.rows = Number(args[i + 1]);
        if (args[i] === '--block-w' && args[i + 1]) config.block_width_m = Number(args[i + 1]);
        if (args[i] === '--block-h' && args[i + 1]) config.block_height_m = Number(args[i + 1]);
        if (args[i] === '--road' && args[i + 1]) config.road_prefab = args[i + 1];
        if (args[i] === '--zone' && args[i + 1]) config.zone_type = args[i + 1];
        if (args[i] === '--survey-mode' && args[i + 1]) config.survey_mode = args[i + 1];
        if (args[i] === '--building-prefab' && args[i + 1]) {
          config.building_batch = { ...(config.building_batch || {}), building_prefab: args[i + 1] };
        }
        if (args[i] === '--building-count' && args[i + 1]) {
          config.building_batch = { ...(config.building_batch || {}), maximum_buildings: Number(args[i + 1]) };
        }
        if (args[i] === '--growth-cycles' && args[i + 1]) {
          config.growth_loop = { ...(config.growth_loop || {}), cycles: Number(args[i + 1]) };
        }
        if (args[i] === '--growth-interval-ms' && args[i + 1]) {
          config.growth_loop = { ...(config.growth_loop || {}), interval_ms: Number(args[i + 1]) };
        }
        if (args[i] === '--resume' && args[i + 1]) config.resume_speed = args[i + 1];
      }
    }

    try {
      const result = await deployDistrict(config);
      console.log(`\n✓ [DISTRICT DEPLOYED] City: ${result.city} | Zone: ${result.district_type} | Duration: ${result.duration_ms}ms`);
      if (result.spatial_survey) {
        console.log(`  - Survey: ${result.spatial_survey.ownership} | Slope: ${result.spatial_survey.terrain_grade} | Obstacles: ${result.spatial_survey.obstacles}`);
      }
      if (result.grid) {
        console.log(`  - Grid: ${result.grid.cols}x${result.grid.rows} (${result.grid.edges_count} edges) @ (${result.grid.origin.x}, ${result.grid.origin.z}) | Cost: ₡${result.grid.cost.toLocaleString()}`);
      }
      if (result.arterial) {
        console.log(`  - Arterial: ${result.arterial.segments_count} segs [${result.arterial.road_prefab}] | Cost: ₡${result.arterial.cost.toLocaleString()}`);
      }
      if (result.buildings) {
        console.log(`  - Buildings: ${result.buildings.placed_count} x [${result.buildings.building_prefab}] | Cost: ₡${result.buildings.cost.toLocaleString()}`);
      }
      if (result.zoning) {
        console.log(`  - Zoning: ${result.zoning.cells_zoned.toLocaleString()} cells -> [${result.zoning.zone_prefab}]`);
      }
      if (result.growth_loop) {
        console.log(`  - Growth Loop: ${result.growth_loop.cycles_completed}/${result.growth_loop.cycles_requested} cycles @ ${result.growth_loop.speed}` +
          (result.growth_loop.stop_reason ? ` | Stopped: ${result.growth_loop.stop_reason}` : ` | Next: ${result.growth_loop.next_action}`));
      }
      console.log(`  - Total Cost: ₡${result.total_cost.toLocaleString()} | Simulation Resumed: OK`);
      if (result.notes?.length > 0) {
        console.log(`  - Notes: ${result.notes.join('; ')}`);
      }
      if (verbose) {
        console.log('\n[Verbose JSON Details]:\n', JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(`\n✗ [District Deployment Failed]: ${err.message}`);
      process.exit(1);
    }
  });
}
