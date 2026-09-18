import { matchesPlannedBuilding } from './plan-targets.mjs';

export function samplePolyline(points, step = 8) {
  if (!Array.isArray(points) || points.length < 2 || !(step > 0)) return [];
  const samples = [];
  for (let segment = 1; segment < points.length; segment += 1) {
    const a = points[segment - 1], b = points[segment];
    const length = Math.hypot(Number(b.x) - Number(a.x), Number(b.z) - Number(a.z));
    const count = Math.max(1, Math.ceil(length / step));
    for (let index = segment === 1 ? 0 : 1; index <= count; index += 1) {
      const t = index / count;
      samples.push({
        x: Number(a.x) + (Number(b.x) - Number(a.x)) * t,
        z: Number(a.z) + (Number(b.z) - Number(a.z)) * t,
      });
    }
  }
  return samples;
}

export function findCompletedPlannedBuildingIds(plannedBuildings, permanentBuildings, toleranceM = 2) {
  const available = new Set((permanentBuildings ?? []).map((_, index) => index));
  const completed = [];
  for (const planned of plannedBuildings ?? []) {
    let bestIndex = null, bestDistance = Infinity;
    for (const index of available) {
      const permanent = permanentBuildings[index];
      if (!matchesPlannedBuilding(planned, permanent, toleranceM)) continue;
      const distance = Math.hypot(
        Number(permanent.position.x) - Number(planned.position.x),
        Number(permanent.position.z) - Number(planned.position.z),
      );
      if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
    }
    if (bestIndex === null) continue;
    available.delete(bestIndex);
    completed.push(planned.id);
  }
  return completed;
}

export function filterAlreadyBuiltBatches(batches, { skip, roadIds = [], buildingIds = [] } = {}) {
  if (!skip) return [...batches];
  const completedRoads = new Set(roadIds);
  const completedBuildings = new Set(buildingIds);
  return batches.filter(batch => {
    const objectIds = batch.object_ids ?? [batch.batch_id];
    if (batch.batch_type === 'grid' || batch.batch_type === 'route') {
      return !objectIds.some(id => completedRoads.has(id));
    }
    if (batch.batch_type === 'building') {
      return !objectIds.some(id => completedBuildings.has(id));
    }
    return true;
  });
}

export function mayContinueAfterPreviewFailure(state, continueOnFailure) {
  // 继续模式仅用于收集游戏明确拒绝的批次。未知、过期、取消和仍在运行的操作
  // 都必须停机，避免与尚未确认的原生工具状态重叠。
  return continueOnFailure === true && state === 'failed';
}
