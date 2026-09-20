import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { queryGame } from '../../mcp/bridge-client.mjs';
import { proposeGridPlan } from '../../mcp/planning-proposer.mjs';
import { bindGridProposal } from '../../mcp/planning-binder.mjs';
import { renderCityPlanInteractive } from '../../mcp/planning-interactive.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactDir = 'C:/Users/cheng/.gemini/antigravity/brain/7a318694-7d0f-4c38-96cb-b268b201833b';

function boundsForTiles(tiles) {
  if (!tiles.length) return null;
  return {
    min_x: Math.min(...tiles.map(tile => tile.bounds.min_x)),
    max_x: Math.max(...tiles.map(tile => tile.bounds.max_x)),
    min_z: Math.min(...tiles.map(tile => tile.bounds.min_z)),
    max_z: Math.max(...tiles.map(tile => tile.bounds.max_z))
  };
}

function summarizeMapTile(tile) {
  return {
    tile_id: tile.tile_id,
    owned: tile.owned,
    bounds: tile.bounds,
    center: tile.center
  };
}

async function getBaseSnapshot() {
  console.log('Fetching live map tiles and snapshot...');
  const tileData = (await queryGame('list_map_tiles', { state: 'all', offset: 0, limit: 529 })).data;
  const tiles = tileData.items ?? [];
  const bounds = boundsForTiles(tiles);
  const snapshotData = (await queryGame('get_planning_map_snapshot', {
    bounds,
    include_roads: true,
    include_buildings: true,
    include_tracks: true,
    include_utilities: true,
    max_features_per_layer: 2000
  })).data;
  snapshotData.bounds = bounds;
  snapshotData.map_tiles = tiles.map(summarizeMapTile);
  snapshotData.purchased_tiles = snapshotData.map_tiles.filter(t => t.owned);
  snapshotData.waters = [];
  snapshotData.terrain = { cells: [] };
  return snapshotData;
}

async function main() {
  const snapshot = await getBaseSnapshot();
  const purchasedTiles = snapshot.purchased_tiles ?? [];
  const purchasedBounds = {
    min_x: Math.min(...purchasedTiles.map(t => t.bounds.min_x)),
    max_x: Math.max(...purchasedTiles.map(t => t.bounds.max_x)),
    min_z: Math.min(...purchasedTiles.map(t => t.bounds.min_z)),
    max_z: Math.max(...purchasedTiles.map(t => t.bounds.max_z))
  };
  const proposalSnapshot = { ...snapshot, bounds: purchasedBounds };

  const [roadCatalog, zoneCatalog, cityConfig] = await Promise.all([
    queryGame('list_road_prefabs', { search: '', offset: 0, limit: 100 }),
    queryGame('list_zone_types', { search: '', unlocked_only: true }),
    queryGame('get_city_configuration', {})
  ]);

  const tasks = [
    {
      key: 'residential-medium',
      title: '住宅区（中密公寓与排屋组团 3×3）',
      districtKind: 'residential',
      args: {
        district_kind: 'residential',
        density: 'medium',
        columns: 3,
        rows: 3,
        block_width_m: 96,
        block_height_m: 96,
        road_prefab: 'Small Road',
        zone_type: 'EU Residential Medium',
        theme_preference: 'eu'
      }
    },
    {
      key: 'residential-low',
      title: '住宅区（低密花园独栋组团 2×3）',
      districtKind: 'residential',
      args: {
        district_kind: 'residential',
        density: 'low',
        columns: 2,
        rows: 3,
        block_width_m: 96,
        block_height_m: 96,
        road_prefab: 'Small Road',
        zone_type: 'EU Residential Low',
        theme_preference: 'eu'
      }
    },
    {
      key: 'commercial',
      title: '商业区（高密度商业金融街区 2×3）',
      districtKind: 'commercial',
      args: {
        district_kind: 'commercial',
        density: 'high',
        columns: 2,
        rows: 3,
        block_width_m: 96,
        block_height_m: 96,
        road_prefab: 'Small Road',
        zone_type: 'EU Commercial High',
        theme_preference: 'eu'
      }
    },
    {
      key: 'industrial',
      title: '工业区（先进制造产业园 3×2）',
      districtKind: 'industrial',
      args: {
        district_kind: 'industrial',
        density: 'low',
        columns: 3,
        rows: 2,
        block_width_m: 96,
        block_height_m: 96,
        road_prefab: 'Small Road',
        zone_type: 'Industrial Manufacturing',
        theme_preference: 'eu'
      }
    },
    {
      key: 'office',
      title: '办公区（科创与总部办公中心 2×2）',
      districtKind: 'office',
      args: {
        district_kind: 'office',
        density: 'high',
        columns: 2,
        rows: 2,
        block_width_m: 96,
        block_height_m: 96,
        road_prefab: 'Small Road',
        zone_type: 'Office High',
        theme_preference: 'eu'
      }
    }
  ];

  const results = [];

  for (const task of tasks) {
    console.log(`\n==================================================`);
    console.log(`[Proposing Grid Plan] ${task.title}`);
    const conceptual = proposeGridPlan(proposalSnapshot, task.args);
    const bound = bindGridProposal(conceptual, {
      road_prefabs: roadCatalog.data?.items ?? [],
      zone_types: zoneCatalog.data?.items ?? []
    }, { ...task.args, city_theme: cityConfig.data?.theme });

    console.log(`Proposal ID: ${bound.proposal_id}`);
    console.log(`Placement Origin: (${bound.placement.origin.x}, ${bound.placement.origin.z})`);
    console.log(`Bound Road: ${bound.bindings?.road?.name} (Source: ${bound.bindings?.road?.source})`);
    console.log(`Bound Zone: ${bound.bindings?.zone?.name} (Source: ${bound.bindings?.zone?.source})`);
    console.log(`Distance to Road: ${bound.placement.nearest_road_distance_m}m`);
    console.log(`Connection Point: (${bound.placement.connection_point?.x}, ${bound.placement.connection_point?.z})`);

    const renderOptions = {
      title: `美瑞迪安｜${task.title} 施工图`,
      width: 1600,
      height: 1000,
      bounds: snapshot.bounds,
      planning_bounds: purchasedBounds,
      include_existing: true,
      format: 'static_html'
    };
    const rendered = renderCityPlanInteractive(snapshot, bound.plan, renderOptions);

    const htmlFileName = `propose-grid-${task.key}.html`;
    const repoHtmlPath = path.join(repoRoot, 'artifacts', htmlFileName);
    fs.writeFileSync(repoHtmlPath, rendered.html, 'utf8');

    const artifactHtmlPath = path.join(artifactDir, htmlFileName);
    fs.writeFileSync(artifactHtmlPath, rendered.html, 'utf8');

    console.log(`Rendered HTML: ${repoHtmlPath}`);
    console.log(`Artifact HTML: ${artifactHtmlPath}`);

    results.push({
      key: task.key,
      title: task.title,
      district_kind: task.districtKind,
      proposal_id: bound.proposal_id,
      plan_id: rendered.plan_id,
      origin: bound.placement.origin,
      grid: {
        columns: task.args.columns,
        rows: task.args.rows,
        block_width_m: task.args.block_width_m,
        block_height_m: task.args.block_height_m,
        total_width_m: task.args.columns * task.args.block_width_m,
        total_height_m: task.args.rows * task.args.block_height_m
      },
      road_prefab: bound.bindings?.road?.name,
      zone_type: bound.bindings?.zone?.name,
      nearest_road_distance_m: bound.placement.nearest_road_distance_m,
      connection_point: bound.placement.connection_point,
      html_file: repoHtmlPath
    });
  }

  const summary = {
    city: '美瑞迪安',
    theme: cityConfig.data?.theme,
    timestamp: new Date().toISOString(),
    purchased_bounds: purchasedBounds,
    plans: results
  };

  fs.writeFileSync(
    path.join(repoRoot, 'artifacts', 'propose-grid-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(artifactDir, 'propose-grid-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  console.log('\n==================================================');
  console.log('[COMPLETED] All 5 grid district proposals generated successfully!');
}

main().catch(console.error);
