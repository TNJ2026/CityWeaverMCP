import { queryGame, BridgeError } from '../mcp/bridge-client.mjs';
import {
  CELL_SIZE,
  snapToCell,
  snapPoint,
  calculateGrade,
  evaluateWindRelationship,
  checkAABBOverlap,
  calculateGridFootprint,
  ROAD_SPECIFICATIONS,
  POLLUTION_RULES
} from './lib/physics-rules.mjs';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CityWeaver Pre-Flight Spatial Survey Engine
 * 
 * Performs 5-dimensional pre-flight spatial analysis:
 * 1. Land Ownership & Buildable Status
 * 2. Elevation Matrix & Slope Mechanics (Grade %)
 * 3. Existing Building & Infrastructure Collisions
 * 4. Environmental Dynamics (Wind, Air/Ground/Noise Pollution)
 * 5. Natural Resource Overlays (Groundwater, Fertile Land, Forests)
 */

/**
 * Perform comprehensive spatial survey on a target footprint.
 * 
 * @param {Object} options
 *   - origin: { x: number, z: number } (Southwest corner)
 *   - width_m: number
 *   - height_m: number
 *   - clearance_m: number (default 16)
 *   - city_center: { x, z } (optional reference point for wind calculations)
 */
export async function surveySpace(options) {
  const t0 = Date.now();
  const ox = snapToCell(options.origin.x);
  const oz = snapToCell(options.origin.z);
  const w = snapToCell(options.width_m || 96);
  const h = snapToCell(options.height_m || 96);
  const clearance = options.clearance_m ?? 16;
  const mode = options.mode || 'full';
  if (!['full', 'quick'].includes(mode)) throw new Error(`Unsupported survey mode: ${mode}`);

  const minX = ox;
  const maxX = ox + w;
  const minZ = oz;
  const maxZ = oz + h;
  const centerX = snapToCell(ox + w / 2);
  const centerZ = snapToCell(oz + h / 2);

  const report = {
    mode,
    footprint: { minX, maxX, minZ, maxZ, width_m: w, height_m: h, center: { x: centerX, z: centerZ } },
    ownership: { fully_owned: true, tiles: [], unowned_points: [] },
    terrain: { min_height: 0, max_height: 0, delta_y: 0, max_grade_percent: 0, classification: 'Unknown' },
    collisions: { checked: true, building_count: 0, buildings: [] },
    environment: { wind: null, pollution: { air: 0, ground: 0, noise: 0 } },
    resources: { groundwater: 0, fertile_land: 0, forest: 0, ore: 0, oil: 0 },
    suitability: { residential: 0, commercial: 0, industrial: 0, verdict: 'PASS' },
    issues: [],
    duration_ms: 0
  };

  // === 1. Land Ownership & Boundary Survey ===
  const probePoints = [
    { x: minX, z: minZ, label: 'SW' },
    { x: minX, z: maxZ, label: 'NW' },
    { x: maxX, z: minZ, label: 'SE' },
    { x: maxX, z: maxZ, label: 'NE' },
    { x: centerX, z: centerZ, label: 'Center' }
  ];

  const uniqueTileIds = new Set();
  const tileResults = await Promise.all(probePoints.map(async pt => {
    try {
      return { pt, result: await queryGame('find_map_tile_at', { x: pt.x, z: pt.z }) };
    } catch (err) {
      report.issues.push(`Map tile query failed at (${pt.x}, ${pt.z}): ${err.message}`);
      return { pt, result: null };
    }
  }));
  for (const { pt, result } of tileResults) {
    const tileData = result?.data?.tile;
    if (!tileData) continue;
    if (!tileData.owned) {
      report.ownership.fully_owned = false;
      report.ownership.unowned_points.push({ ...pt, tile_id: tileData.tile_id });
      report.issues.push(`Point ${pt.label} (${pt.x}, ${pt.z}) is on UNOWNED land (${tileData.tile_id})`);
    }
    if (uniqueTileIds.has(tileData.tile_id)) continue;
    uniqueTileIds.add(tileData.tile_id);
    report.ownership.tiles.push({ tile_id: tileData.tile_id, owned: tileData.owned, area_m2: tileData.surface_area_m2 });
    for (const f of tileData.features || []) {
      if (f.feature === 'GroundWater') report.resources.groundwater += f.amount || 0;
      if (f.feature === 'FertileLand') report.resources.fertile_land += f.amount || 0;
      if (f.feature === 'Forest') report.resources.forest += f.amount || 0;
      if (f.feature === 'Ore') report.resources.ore += f.amount || 0;
      if (f.feature === 'Oil') report.resources.oil += f.amount || 0;
    }
  }

  // === 2. Terrain Elevation Matrix & Slope Analysis ===
  // Sample a 3x3 grid across the bounding box
  const terrainSamplePoints = [
    { x: minX, z: minZ },
    { x: centerX, z: minZ },
    { x: maxX, z: minZ },
    { x: minX, z: centerZ },
    { x: centerX, z: centerZ },
    { x: maxX, z: centerZ },
    { x: minX, z: maxZ },
    { x: centerX, z: maxZ },
    { x: maxX, z: maxZ }
  ];

  try {
    const terrainRes = await queryGame('sample_terrain', { points: terrainSamplePoints });
    const heights = (terrainRes.data?.items || []).map(i => i.height_m);
    if (heights.length > 0) {
      report.terrain.min_height = Number(Math.min(...heights).toFixed(2));
      report.terrain.max_height = Number(Math.max(...heights).toFixed(2));
      report.terrain.delta_y = Number((report.terrain.max_height - report.terrain.min_height).toFixed(2));

      // Calculate max slope grade between adjacent sampled grid cells
      let maxGrade = 0;
      const items = terrainRes.data.items;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const p1 = items[i];
          const p2 = items[j];
          const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
          if (dist > 0) {
            const grade = (Math.abs(p2.height_m - p1.height_m) / dist) * 100;
            if (grade > maxGrade) maxGrade = grade;
          }
        }
      }
      report.terrain.max_grade_percent = Number(maxGrade.toFixed(2));

      if (maxGrade <= 1.0) report.terrain.classification = '极度平整 (Ultra-Flat <1%)';
      else if (maxGrade <= 5.0) report.terrain.classification = '平缓平原 (Gentle 1-5%)';
      else if (maxGrade <= 15.0) report.terrain.classification = '缓坡适宜 (Buildable 5-15%)';
      else {
        report.terrain.classification = '陡峭超限 (Too Steep >15%)';
        report.issues.push(`Slope (${maxGrade.toFixed(1)}%) exceeds municipal road limit (15.0%)`);
      }
    }
  } catch (err) {
    report.issues.push(`Terrain sampling failed: ${err.message}`);
  }

  // === 3. Footprint Building Collisions ===
  try {
    // Quick surveys defer the expensive full-city building scan to native preview validation.
    if (mode === 'quick') {
      report.collisions.checked = false;
      report.issues.push('Building collision scan deferred to native preview (quick survey)');
    } else {
      let buildings = [];
      let page = await queryGame('query_buildings', { limit: 100 });
      buildings.push(...(page.data?.items || []));
      let snapshotId = page.data?.snapshot_id;
      let offset = page.data?.next_offset ?? 100;
      while (snapshotId && page.data?.items?.length === 100 && offset < 5000) {
        page = await queryGame('query_buildings', { snapshot_id: snapshotId, offset, limit: 100 });
        if (!page.data?.items?.length) break;
        buildings.push(...page.data.items);
        offset = page.data?.next_offset ?? (offset + 100);
      }

      const collisionBox = {
        minX: minX - clearance,
        maxX: maxX + clearance,
        minZ: minZ - clearance,
        maxZ: maxZ + clearance
      };

      const conflicts = buildings.filter(b => {
        const bx = b.position?.x, bz = b.position?.z;
        return bx >= collisionBox.minX && bx <= collisionBox.maxX && bz >= collisionBox.minZ && bz <= collisionBox.maxZ;
      });

      report.collisions.building_count = conflicts.length;
      report.collisions.buildings = conflicts.slice(0, 5).map(c => ({
        name: c.name || c.prefab_name,
        position: c.position,
        category: c.categories?.[0] || 'unknown'
      }));

      if (conflicts.length > 0) {
        report.issues.push(`Found ${conflicts.length} building(s) in footprint clearance (${clearance}m)`);
      }
    }
  } catch (err) {
    report.issues.push(`Building collision check failed: ${err.message}`);
  }

  // === 4. Environmental Dynamics (Wind & Pollution) ===
  try {
    const windRes = await queryGame('sample_wind', { points: [{ x: centerX, z: centerZ }] });
    const windItem = windRes.data?.items?.[0];
    if (windItem) {
      report.environment.wind = {
        vector: { x: Number(windItem.x.toFixed(3)), z: Number(windItem.z.toFixed(3)) },
        speed: Number(windItem.speed.toFixed(2))
      };
    }

    const polRes = await queryGame('sample_pollution', { points: [{ x: centerX, z: centerZ }] });
    const polItem = polRes.data?.items?.[0];
    if (polItem) {
      report.environment.pollution = {
        air: polItem.air,
        ground: polItem.ground,
        noise: polItem.noise
      };
    }
  } catch (err) {
    report.issues.push(`Environmental sampling failed: ${err.message}`);
  }

  // === 5. Suitability Scoring ===
  let resScore = 100;
  let comScore = 100;
  let indScore = 100;

  if (!report.ownership.fully_owned) {
    resScore -= 80;
    comScore -= 80;
    indScore -= 80;
  }
  if (report.collisions.building_count > 0) {
    const pen = Math.min(60, report.collisions.building_count * 20);
    resScore -= pen;
    comScore -= pen;
    indScore -= pen;
  }
  if (report.terrain.max_grade_percent > 15.0) {
    resScore -= 50;
    comScore -= 50;
    indScore -= 50;
  } else if (report.terrain.max_grade_percent > 5.0) {
    resScore -= 10;
  }

  // Pollution impact on residential
  if (report.environment.pollution.air > 0) resScore -= Math.min(50, report.environment.pollution.air);
  if (report.environment.pollution.ground > 0) resScore -= Math.min(50, report.environment.pollution.ground);
  if (report.environment.pollution.noise > 1000) resScore -= 30;

  // Industrial suitability: Groundwater risk
  if (report.resources.groundwater > 0) {
    indScore -= 40; // Discourage industrial on drinking aquifers
    report.issues.push(`Groundwater aquifer present (${report.resources.groundwater.toLocaleString()}); avoid heavy industrial pollution`);
  }

  // Wind relation if city center anchor is known
  if (options.city_center && report.environment.wind?.vector) {
    const windEval = evaluateWindRelationship(options.city_center, { x: centerX, z: centerZ }, report.environment.wind.vector);
    report.environment.wind_relationship_to_anchor = windEval;
    if (windEval.is_downwind) {
      // Downwind is great for industry, dangerous for residential if existing industry is upwind
      indScore += 10;
    } else {
      // Upwind is terrible for industry
      indScore -= 60;
      report.issues.push(`Upwind location: Industrial air emissions will blow directly toward anchor city`);
    }
  }

  report.suitability.residential = Math.max(0, Math.min(100, resScore));
  report.suitability.commercial = Math.max(0, Math.min(100, comScore));
  report.suitability.industrial = Math.max(0, Math.min(100, indScore));

  report.suitability.verdict = report.ownership.fully_owned &&
                               (report.collisions.checked !== false ? report.collisions.building_count === 0 : true) &&
                               report.terrain.max_grade_percent <= 15.0 ? (mode === 'quick' ? 'UNVERIFIED' : 'PASS') : 'BLOCKED';

  report.duration_ms = Date.now() - t0;
  return report;
}

/**
 * Format a survey report into a compact 6-10 line summary (~40 tokens).
 */
export function formatSurveySummary(report) {
  const fp = report.footprint;
  const t = report.terrain;
  const o = report.ownership;
  const c = report.collisions;
  const e = report.environment;
  const s = report.suitability;

  const lines = [
    `[SPATIAL SURVEY] Footprint: [(${fp.minX}, ${fp.minZ}) -> (${fp.maxX}, ${fp.maxZ})] (${fp.width_m}m x ${fp.height_m}m)`,
    `  - Ownership: ${o.fully_owned ? '✓ 100% Owned' : '✗ UNOWNED TILES DETECTED'} | Tiles: ${o.tiles.map(t => t.tile_id.split(':')[1]).join(', ')}`,
    `  - Terrain: ${t.min_height}m ~ ${t.max_height}m (ΔY: ${t.delta_y}m | Grade: ${t.max_grade_percent}% - ${t.classification})`,
    `  - Collisions: ${c.checked === false ? '？ Deferred to native preview' : c.building_count === 0 ? '✓ None (Clear)' : `✗ ${c.building_count} building(s) in way`}`,
    `  - Environment: Air: ${e.pollution.air} | Ground: ${e.pollution.ground} | Noise: ${e.pollution.noise} | Wind: ${e.wind?.speed ?? '?'}m/s`,
    `  - Resources: Aquifer: ${report.resources.groundwater > 0 ? report.resources.groundwater.toLocaleString() : 'None'} | Forest: ${report.resources.forest.toLocaleString()}`,
    `  - Suitability: Res: ${s.residential}/100 | Com: ${s.commercial}/100 | Ind: ${s.industrial}/100`,
    `  - Verdict: ${s.verdict === 'PASS' ? '✓ READY FOR DEVELOPMENT' : s.verdict === 'UNVERIFIED' ? '？ QUICK SURVEY (native preview required)' : `✗ DEVELOPMENT BLOCKED (${report.issues[0] || 'Unknown issue'})`}`
  ];

  if (report.issues.length > 0 && s.verdict !== 'PASS') {
    lines.push(`  - Blocking Issues: ${report.issues.join('; ')}`);
  }

  return lines.join('\n');
}

/**
 * Automatically search and evaluate candidate locations for a given district archetype or size.
 */
export async function findOptimalDistrictSite(options) {
  const targetType = options.district_type || 'residential';
  const widthM = options.width_m || 288;
  const heightM = options.height_m || 192;
  const anchor = options.anchor || { x: -1138, z: 528 }; // Default to central arterial
  const surveyMode = options.survey_mode || options.mode || 'full';

  // Probe wind
  const windRes = await queryGame('sample_wind', { points: [anchor] });
  const windVec = windRes.data?.items?.[0] || { x: 0.2, z: 0.35 };

  const candidates = [];
  const distances = [250, 400, 550, 700];

  if (targetType.includes('ind')) {
    // Search strictly downwind
    const mag = Math.hypot(windVec.x, windVec.z) || 1;
    const ux = windVec.x / mag;
    const uz = windVec.z / mag;

    for (const dist of distances) {
      const cx = anchor.x + ux * dist;
      const cz = anchor.z + uz * dist;
      candidates.push({
        origin: { x: snapToCell(cx - widthM / 2), z: snapToCell(cz - heightM / 2) },
        width_m: widthM,
        height_m: heightM,
        city_center: anchor,
        desc: `Downwind offset ${dist}m`
      });
    }
  } else {
    // Search in orthogonal quadrants away from existing industrial
    const offsets = [
      { dx: 0, dz: 300, desc: 'Northward expansion' },
      { dx: 0, dz: -350, desc: 'Southward expansion' },
      { dx: -350, dz: 0, desc: 'Westward expansion' }
    ];

    for (const off of offsets) {
      candidates.push({
        origin: { x: snapToCell(anchor.x + off.dx - widthM / 2), z: snapToCell(anchor.z + off.dz - heightM / 2) },
        width_m: widthM,
        height_m: heightM,
        city_center: anchor,
        desc: off.desc
      });
    }
  }

  const results = [];
  for (const cand of candidates) {
    const survey = await surveySpace({ ...cand, mode: surveyMode });
    results.push({
      desc: cand.desc,
      origin: cand.origin,
      survey,
      score: targetType.includes('ind') ? survey.suitability.industrial : survey.suitability.residential
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// === CLI Execution Handler ===
if (process.argv[1] && process.argv[1].endsWith('survey-space.mjs')) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
CityWeaver Pre-Flight Spatial Survey Tool

Usage:
  node tools/survey-space.mjs --origin X,Z --width W --height H [options]
  node tools/survey-space.mjs --archetype <name> --origin X,Z
  node tools/survey-space.mjs --auto-find <type> [--anchor X,Z]

Options:
  --origin <X,Z>        Southwest origin of target footprint
  --width <M>           Width in meters (default 96)
  --height <M>          Height in meters (default 96)
  --archetype <name>    Preset: residential_suburban_3x2, commercial_hub_3x3, industrial_manufacturing_3x2
  --auto-find <type>    Automatically evaluate candidate sites for: residential, commercial, industrial
  --anchor <X,Z>        Reference city center coordinates (default -1138,528)
  --mode <mode>         Survey mode: full (default) or quick (defer building scan)
  --verbose             Show full JSON output
    `);
    process.exit(0);
  }

  (async () => {
    try {
      const verbose = args.includes('--verbose');

      // Check Auto-Find mode
      const findIdx = args.indexOf('--auto-find');
      if (findIdx !== -1 && args[findIdx + 1]) {
        const type = args[findIdx + 1];
        let anchor = { x: -1138, z: 528 };
        const anchorIdx = args.indexOf('--anchor');
        if (anchorIdx !== -1 && args[anchorIdx + 1]) {
          const [ax, az] = args[anchorIdx + 1].split(',').map(Number);
          anchor = { x: ax, z: az };
        }

        const modeIdx = args.indexOf('--mode');
        const mode = modeIdx !== -1 && args[modeIdx + 1] ? args[modeIdx + 1] : 'full';

        console.log(`\n[SPATIAL AUTO-SITING] Searching optimal candidate sites for [${type}] from anchor (${anchor.x}, ${anchor.z}) [survey: ${mode}]...\n`);
        const results = await findOptimalDistrictSite({ district_type: type, anchor, survey_mode: mode });
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          console.log(`Candidate #${i + 1} (${r.desc}) - Score: ${r.score}/100:`);
          console.log(formatSurveySummary(r.survey));
          console.log('');
        }
        process.exit(0);
      }

      let origin = { x: 0, z: 0 };
      let width = 96;
      let height = 96;
      let mode = 'full';

      const archIdx = args.indexOf('--archetype');
      if (archIdx !== -1 && args[archIdx + 1]) {
        const archName = args[archIdx + 1];
        const presetPath = path.resolve(path.dirname(process.argv[1]), 'presets/district-archetypes.json');
        if (fs.existsSync(presetPath)) {
          const presets = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
          const p = presets.archetypes?.[archName];
          if (p) {
            width = p.footprint_m?.width || (p.columns * p.block_width_m);
            height = p.footprint_m?.height || (p.rows * p.block_height_m);
          }
        }
      }

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--origin' && args[i + 1]) {
          const [x, z] = args[i + 1].split(',').map(Number);
          origin = { x, z };
        }
        if (args[i] === '--width' && args[i + 1]) width = Number(args[i + 1]);
        if (args[i] === '--height' && args[i + 1]) height = Number(args[i + 1]);
        if (args[i] === '--mode' && args[i + 1]) mode = args[i + 1];
      }

      const report = await surveySpace({ origin, width_m: width, height_m: height, mode });
      console.log('\n' + formatSurveySummary(report));

      if (verbose) {
        console.log('\n[Verbose JSON Data]:\n', JSON.stringify(report, null, 2));
      }
    } catch (err) {
      console.error('\n✗ [Spatial Survey Failed]:', err.message);
      process.exit(1);
    }
  })();
}
