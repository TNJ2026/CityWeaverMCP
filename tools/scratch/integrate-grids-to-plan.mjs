import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

import { buildCircularTownPlan } from './generate-meridian-circular-town.mjs';
import { computeCityPlanId, expandCityPlan } from '../../mcp/planning-renderer.mjs';
import { renderCityPlanInteractive } from '../../mcp/planning-interactive.mjs';
import { validateCityPlan } from '../../mcp/planning-validator.mjs';
import { queryGame } from '../../mcp/bridge-client.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactDir = 'C:/Users/cheng/.gemini/antigravity/brain/7a318694-7d0f-4c38-96cb-b268b201833b';

async function testRender() {
  const baseResult = buildCircularTownPlan();
  const basePlan = baseResult.plan;

  // Remove old placeholder sub-streets
  const subStreetIds = new Set([
    'ind-sub-1', 'ind-sub-2',
    'com-sub-1', 'com-sub-2',
    'res-sw-sub-1', 'res-sw-sub-2',
    'res-nw-sub-1', 'res-nw-sub-2'
  ]);

  const cleanedRoads = basePlan.roads.filter(r => !subStreetIds.has(r.id));

  // 5 Grid Districts:
  const grids = [
    {
      id: 'grid-industrial-ne',
      name: '东北先进制造工业网格',
      origin: { x: 384, z: 1024 },
      columns: 2,
      rows: 3,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      road_width_m: 16,
      zone_type: 'Industrial Manufacturing',
      zone_kind: 'industrial',
      construction_order: 28,
      construction_status: 'planned'
    },
    {
      id: 'grid-res-medium-nw',
      name: '西北都会中密生活网格',
      origin: { x: -576, z: 1024 },
      columns: 2,
      rows: 3,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      road_width_m: 16,
      zone_type: 'EU Residential Medium',
      zone_kind: 'residential',
      construction_order: 28,
      construction_status: 'planned'
    },
    {
      id: 'grid-res-low-sw',
      name: '西南生态低密花园网格',
      origin: { x: -576, z: 736 },
      columns: 2,
      rows: 3,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      road_width_m: 16,
      zone_type: 'EU Residential Low',
      zone_kind: 'residential',
      construction_order: 28,
      construction_status: 'planned'
    },
    {
      id: 'grid-commercial-se',
      name: '东南现代商业金融网格',
      origin: { x: 384, z: 832 },
      columns: 2,
      rows: 2,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      road_width_m: 16,
      zone_type: 'EU Commercial High',
      zone_kind: 'commercial',
      construction_order: 28,
      construction_status: 'planned'
    },
    {
      id: 'grid-office-se',
      name: '东南科技总部研发网格',
      origin: { x: 384, z: 736 },
      columns: 2,
      rows: 1,
      block_width_m: 96,
      block_height_m: 96,
      road_prefab: 'Small Road',
      road_width_m: 16,
      zone_type: 'Office High',
      zone_kind: 'office',
      construction_order: 28,
      construction_status: 'planned'
    }
  ];

  // Adjust building positions to eliminate all collisions
  const updatedBuildings = basePlan.buildings.map(b => {
    const item = { ...b };
    if (item.id === 'bld-substation-ne') {
      item.position = { x: 624, z: 1068 };
    } else if (item.id === 'bld-water-pump-ne') {
      item.position = { x: 624, z: 1160 };
    } else if (item.id === 'bld-water-tower-ne') {
      item.position = { x: 432, z: 1264 };
      item.rotation_degrees = 0;
    } else if (item.id === 'bld-bus-terminal-se') {
      item.position = { x: 650, z: 914 };
    } else if (item.id === 'bld-post-office-se') {
      item.position = { x: 640, z: 800 };
      item.rotation_degrees = 270;
    } else if (item.id === 'bld-parking-hall-se') {
      item.position = { x: 640, z: 700 };
      item.rotation_degrees = 270;
    } else if (item.id === 'bld-park-maintenance-se') {
      item.position = { x: 492, z: 650 };
    } else if (item.id === 'bld-elem-school-sw') {
      item.position = { x: -432, z: 880 };
    } else if (item.id === 'bld-clinic-sw') {
      item.position = { x: -432, z: 784 };
    } else if (item.id === 'bld-fire-house-sw') {
      item.position = { x: -432, z: 976 };
    } else if (item.id === 'bld-elem-school-nw') {
      item.position = { x: -640, z: 1220 };
    } else if (item.id === 'bld-police-station-nw') {
      item.position = { x: -432, z: 1072 };
    }
    return item;
  });

  const updatedUtilities = basePlan.utilities.map(u => {
    const item = { ...u };
    if (item.id === 'util-water-trunk-1') {
      item.points = [{ x: 624, z: 1160 }, { x: 320, z: 1024 }, { x: 0, z: 1024 }];
    } else if (item.id === 'util-power-line-1') {
      item.points = [{ x: 624, z: 1068 }, { x: 320, z: 1024 }, { x: 0, z: 1024 }];
    }
    return item;
  });

  const integratedPlan = {
    ...basePlan,
    roads: cleanedRoads,
    grids,
    buildings: updatedBuildings,
    utilities: updatedUtilities
  };

  const planId = computeCityPlanId(baseResult.bounds, integratedPlan);

  const fullPlanDocument = {
    cityName: '美瑞迪安',
    theme: 'European',
    title: '美瑞迪安｜圆形城镇与网格功能区一体化施工图（网页版）',
    plan_id: planId,
    bounds: baseResult.bounds,
    plan: integratedPlan
  };

  // Save to plans/meridian-circular-town-plan.json
  const planPath = path.join(repoRoot, 'plans', 'meridian-circular-town-plan.json');
  await writeFile(planPath, JSON.stringify(fullPlanDocument, null, 2), 'utf8');
  console.log(`[OK] Updated integrated plan written to: ${planPath}`);
  console.log(`New Plan ID: ${planId}`);

  // Validate
  const validation = validateCityPlan({ bounds: baseResult.bounds }, integratedPlan, baseResult.bounds);
  console.log(`Validation: valid=${validation.valid}, errors=${validation.error_count}, warnings=${validation.warning_count}`);

  // Fetch live snapshot for background rendering
  console.log('Fetching map snapshot for rendering...');
  const tileData = (await queryGame('list_map_tiles', { state: 'all', offset: 0, limit: 529 })).data;
  const tiles = tileData.items ?? [];
  const snapshotData = (await queryGame('get_planning_map_snapshot', {
    bounds: baseResult.bounds,
    include_roads: true,
    include_buildings: true,
    include_tracks: true,
    include_utilities: true,
    max_features_per_layer: 2000
  })).data;
  snapshotData.bounds = baseResult.bounds;
  snapshotData.map_tiles = tiles.map(t => ({ tile_id: t.tile_id, owned: t.owned, bounds: t.bounds, center: t.center }));
  snapshotData.purchased_tiles = snapshotData.map_tiles.filter(t => t.owned);
  snapshotData.waters = [];
  snapshotData.terrain = { cells: [] };

  console.log('Rendering interactive HTML...');
  const renderResult = renderCityPlanInteractive(snapshotData, integratedPlan, {
    title: fullPlanDocument.title,
    subtitle: '包含内/中/外同心环、十字主干道、四象限功能区标准网格（住宅/商业/工业/办公）与25座完整市政公服设施',
    theme: 'European'
  });
  const html = renderResult.html;

  const htmlPath = path.join(repoRoot, 'artifacts', 'meridian-circular-town-plan.html');
  await writeFile(htmlPath, html, 'utf8');
  console.log(`[OK] Rendered HTML written to: ${htmlPath}`);

  // Mirror to artifact directory
  const mirrorHtmlPath = path.join(artifactDir, 'meridian-circular-town-plan.html');
  await writeFile(mirrorHtmlPath, html, 'utf8');
  console.log(`[OK] Mirrored HTML written to: ${mirrorHtmlPath}`);
}

testRender().catch(console.error);
