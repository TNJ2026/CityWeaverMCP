// 把因 preview 失败而卡住的施工日志重新排队到该批次。
// 安全性：只允许在「失败预览没有产生任何永久/原生写入」时修复。
//   - preview 失败：permanent_changes=false 且 commit_dispatched=false
//   - 本地参数类错误（INVALID_ARGUMENT 等）：压根没有创建原生 operation
import { PlanningStore } from '../../mcp/planning-store.mjs';

const constructionId = process.argv[2];
const clearRecovery = process.argv.includes('--clear-recovery');
const batchOverride = process.argv.slice(3).find(a => !a.startsWith('--'));
const store = new PlanningStore();

const requestIdFor = (planId, batchId, suffix) =>
  `${planId.replace('cplan-', 'cp_')}_${String(batchId).replace(/[^A-Za-z0-9_-]+/g, '_')}_${suffix}`.slice(0, 100);

// 关键坑：mod 按 request_id 缓存操作结果。复用同一 request_id 会直接返回上一次的（失败）结果，
// 而不是真正重跑。因此重试必须换一个全新 request_id。
const retryRequestId = (planId, batchId, attempt) =>
  `${planId.replace('cplan-', 'cp_')}_${String(batchId).replace(/[^A-Za-z0-9_-]+/g, '_')}_retry${attempt}`.slice(0, 100);

// 只在原生未落笔时可清恢复标记
const SAFE_FAILURE_CODES = new Set(['INVALID_ARGUMENT', 'INVALID_WORKFLOW_INPUT', 'PLAN_BATCH_NOT_FOUND']);

await store.locked(async () => {
  const j = await store.get(constructionId);
  console.log('state_version', j.state_version, '| next_action', JSON.stringify(j.next_action));
  console.log('recovery_required', j.recovery_required ?? false, '| failure', JSON.stringify(j.failure ?? null).slice(0, 300));

  if (j.recovery_required) {
    if (!clearRecovery) { console.log('需要 --clear-recovery 才能继续。'); return; }
    const code = j.failure?.code;
    const nativeOp = j.failure?.operation_id;
    if (nativeOp) { console.log('拒绝：failure 关联了原生 operation_id', nativeOp); return; }
    if (!SAFE_FAILURE_CODES.has(code)) { console.log('拒绝：failure code 不在安全白名单内：' + code); return; }
    const last = j.last_result ?? {};
    const np = last.native_preview ?? {};
    if (last.success === true) { console.log('拒绝：last_result 表示成功。'); return; }
    if (np.commit_dispatched === true) { console.log('拒绝：原生提交已派发。'); return; }
    delete j.recovery_required; delete j.failure; delete j.in_flight;
    console.log('已清除 recovery 标记（安全：无原生写入）');
  }

  if (j.next_action?.arguments?.request_id && !batchOverride) { console.log('无需修复：next_action 完整。'); }
  else {
    const last = j.last_result;
    if (!last) { console.log('拒绝修复：没有 last_result。'); return; }
    const batchId = batchOverride ?? j.next_action?.arguments?.batch_id ?? last.batch_id;
    const batch = j.compiled.batches.find(b => b.batch_id === batchId);
    if (!batch) { console.log('拒绝修复：找不到批次', batchId); return; }
    j.next_action = {
      tool: 'advance_city_plan_construction',
      arguments: {
        action: 'preview_batch', batch_id: batchId, sequence: batch.sequence,
        request_id: retryRequestId(j.approved_plan_id, batchId, Date.now()),
      },
    };
    // 关键：last_fingerprint 缓存键含 state_version；不推进就只会命中旧的失败结果缓存。
    j.last_fingerprint = null;
    j.state_version += 1;
    console.log('已重新排队 → preview_batch', batchId, '| request_id', j.next_action.arguments.request_id, '| state_version →', j.state_version);
  }
  if (j.in_flight || j.recovery_required) { console.log('拒绝保存：仍存在 in_flight / recovery_required。'); return; }
  await store.save(constructionId, j);
  console.log('已保存。');
});
