import { readFile } from 'node:fs/promises';

import { queryGame } from './bridge-client.mjs';
import {
  advanceCityPlanConstruction,
  prepareCityPlanConstruction,
} from './city-plan-construction-workflow.mjs';
import { computeCityPlanId } from './planning-renderer.mjs';

const sourcePath = process.argv[2] ?? '../artifacts/weford-master-plan.json';
const source = JSON.parse(await readFile(new URL(sourcePath, import.meta.url), 'utf8'));

const targets = [
  ['PoliceStation02', 'police-station', 'city_service'],
  ['FireHouse02', 'fire-house', 'city_service'],
  ['MedicalClinic02', 'medical-clinic', 'city_service'],
  ['Hospital01', 'hospital', 'city_service'],
  ['CityPark03', 'city-park', 'city_service'],
  ['CommunityPool01', 'community-pool', 'city_service'],
  ['BusDepot01', 'bus-depot', 'transport_facility'],
  ['Landfill01', 'landfill', 'city_service'],
  ['Cemetery02', 'cemetery', 'city_service'],
];

const sourceBuildings = new Map((source.plan?.buildings ?? []).map(item => [item.prefab, item]));
const snapshot = await queryGame('get_planning_map_snapshot', {
  bounds: source.bounds,
  include_roads: false,
  include_buildings: true,
  include_tracks: false,
  include_utilities: false,
  max_features_per_layer: 5000,
});
const existingPrefabs = new Set((snapshot.data?.buildings ?? []).map(item => item.prefab));
const skippedExisting = targets.filter(([prefab]) => existingPrefabs.has(prefab)).map(([prefab]) => prefab);
const pendingTargets = targets.filter(([prefab]) => !existingPrefabs.has(prefab));
const buildings = pendingTargets.map(([prefab, id, category], index) => {
  const building = sourceBuildings.get(prefab);
  if (!building) throw new Error(`Approved plan is missing ${prefab}.`);
  return {
    ...building,
    id,
    category,
    construction_order: index + 1,
    construction_status: 'planned',
  };
});

const bounds = source.bounds;
const plan = { roads: [], grids: [], zones: [], tracks: [], utilities: [], buildings };
const approvedPlanId = computeCityPlanId(bounds, plan);
const timeout = 30_000;
const completed = [];
let totalCost = 0;

function output(event, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

async function cancelPreview(preview) {
  if (!preview.cancel_action) return;
  await queryGame(preview.cancel_action.tool, preview.cancel_action.arguments);
}

async function advanceWithToolRecovery(args) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await advanceCityPlanConstruction(args);
    } catch (error) {
      if (error?.code !== 'TOOL_BUSY' || attempt >= 2) throw error;
      output('tool_busy_recovery', { batch_id: args.batch_id, attempt: attempt + 1 });
      await queryGame('set_simulation_speed', { speed: 'normal' });
      await new Promise(resolve => setTimeout(resolve, 450));
      await queryGame('set_simulation_speed', { speed: 'paused' });
    }
  }
}

try {
  const prepared = await prepareCityPlanConstruction({
    bounds,
    plan,
    approved_plan_id: approvedPlanId,
  });
  output('prepared', {
    city: prepared.city,
    session_id: prepared.session_id,
    plan_id: prepared.plan_id,
    construction_ready: prepared.construction_ready,
    batch_count: prepared.native_batch_count,
    skipped_existing: skippedExisting,
    order: prepared.execution_order.map(item => ({ batch_id: item.batch_id, prefab: item.building_prefab })),
  });
  if (!prepared.construction_ready) throw new Error('The approved public-service phase is not construction-ready.');

  for (const batch of prepared.execution_order) {
    const preview = await advanceWithToolRecovery({
      action: 'preview_batch',
      bounds,
      plan,
      approved_plan_id: approvedPlanId,
      expected_session_id: prepared.session_id,
      batch_id: batch.batch_id,
      request_id: `${approvedPlanId}-${batch.batch_id}-preview`,
      operation_timeout_ms: timeout,
    });
    output('preview', {
      batch_id: batch.batch_id,
      prefab: batch.building_prefab,
      state: preview.state,
      success: preview.success,
      operation_id: preview.native_preview?.operation_id,
      cost: preview.native_preview?.cost,
      warnings: preview.native_preview?.warnings,
      errors: preview.native_preview?.errors,
      error: preview.native_preview?.error,
    });
    if (!preview.success || preview.state !== 'preview_ready') {
      output('stopped', { reason: 'preview_not_ready', batch_id: batch.batch_id, completed, total_cost: totalCost });
      process.exitCode = 2;
      break;
    }
    if ((preview.native_preview?.errors ?? []).length || preview.native_preview?.error) {
      await cancelPreview(preview);
      output('stopped', { reason: 'preview_errors', batch_id: batch.batch_id, completed, total_cost: totalCost });
      process.exitCode = 3;
      break;
    }

    const commit = await advanceWithToolRecovery({
      ...preview.next_action.arguments,
      operation_timeout_ms: timeout,
    });
    output('commit', {
      batch_id: batch.batch_id,
      prefab: batch.building_prefab,
      state: commit.state,
      success: commit.success,
      operation_id: commit.native_operation?.operation_id,
      cost: commit.native_operation?.cost,
      errors: commit.native_operation?.errors,
      error: commit.native_operation?.error,
      result_entity_ids: commit.native_operation?.result_entity_ids,
      permanent_readback: commit.permanent_readback,
    });
    if (!commit.success || commit.state !== 'completed_verified') {
      output('stopped', { reason: 'commit_not_verified', batch_id: batch.batch_id, completed, total_cost: totalCost });
      process.exitCode = 4;
      break;
    }
    totalCost += Number(commit.native_operation?.cost ?? 0);
    completed.push({
      batch_id: batch.batch_id,
      prefab: batch.building_prefab,
      cost: Number(commit.native_operation?.cost ?? 0),
      building_ids: commit.permanent_readback?.building_ids ?? [],
    });
  }

  output('final', {
    plan_id: approvedPlanId,
    completed_count: completed.length,
    requested_count: prepared.native_batch_count,
    total_cost: totalCost,
    completed,
    all_completed: completed.length === prepared.native_batch_count,
  });
} catch (error) {
  output('fatal', {
    message: error?.message ?? String(error),
    code: error?.code ?? null,
    details: error?.details ?? null,
    completed,
    total_cost: totalCost,
  });
  process.exitCode = 1;
}
