import { BridgeError } from './bridge-client.mjs';
import { computeCityPlanId } from './planning-renderer.mjs';
import { compileCityPlanRoads } from './city-plan-construction-workflow.mjs';
import { contentHash } from './planning-store.mjs';

export const EXECUTOR_VERSION = 'city-plan-executor-1';
export function createPlanningSession({ store, queryGame, prepare, advance }) {
  async function register(bounds, plan, session_id = null) {
    const plan_id = computeCityPlanId(bounds, plan);
    const plan_ref = await store.put('plan', { bounds, plan, plan_id, session_id });
    return { plan_ref, plan_id };
  }
  async function resolve(args) {
    if (!args.plan_ref) {
      if (!args.bounds || !args.plan) throw new BridgeError('PLAN_REQUIRED', 'Provide plan_ref, or both bounds and plan.');
      return args;
    }
    if (args.bounds || args.plan) throw new BridgeError('AMBIGUOUS_PLAN', 'Do not combine plan_ref with inline plan or bounds.');
    if (!args.plan_ref.startsWith('plan-')) throw new BridgeError('INVALID_REFERENCE', 'Expected a plan reference.');
    const record = await store.get(args.plan_ref);
    const status = await queryGame('get_game_status', {});
    const session = status.meta?.session_id;
    if (record.session_id && record.session_id !== session) throw new BridgeError('CITY_SESSION_CHANGED', 'Plan bindings belong to another city session.');
    if (computeCityPlanId(record.bounds, record.plan) !== record.plan_id) throw new BridgeError('PLAN_HASH_MISMATCH', 'Stored plan does not match its approval hash.');
    return { ...args, bounds: record.bounds, plan: record.plan, expected_session_id: record.session_id ?? args.expected_session_id };
  }
  const publicNext = (ref, journal) => journal.next_action ? { tool: 'advance_city_plan_construction', arguments: { construction_id: ref, state_version: journal.state_version, action: journal.next_action.arguments.action, batch_id: journal.next_action.arguments.batch_id } } : null;
  const decorate = (result, ref, journal) => ({ ...result, construction_id: ref, state_version: journal.state_version, next_action: publicNext(ref, journal) });
  async function prepareStored(args) {
    return store.locked(async () => {
      const resolved = await resolve(args);
      const compiled = compileCityPlanRoads(resolved.bounds, resolved.plan, resolved.approved_plan_id);
      const result = await prepare({ ...resolved, compiled_plan: compiled });
      const registered = await register(resolved.bounds, resolved.plan, result.session_id);
      const compiled_hash = contentHash(compiled);
      const construction_id = `construction-${contentHash({ plan_ref: registered.plan_ref, session_id: result.session_id, executor: EXECUTOR_VERSION })}`;
      let journal;
      try { journal = await store.get(construction_id); }
      catch (error) { if (error.code !== 'REFERENCE_NOT_FOUND') throw error; }
      if (journal) {
        if (journal.in_flight || journal.recovery_required) throw new BridgeError('CONSTRUCTION_RECOVERY_REQUIRED', `Inspect ${construction_id} and its native operation before continuing.`);
        if (journal.compiled_hash !== compiled_hash) throw new BridgeError('EXECUTOR_CHANGED', 'Compiled batches changed; do not reuse this construction.');
        return { ...registered, ...decorate(journal.last_result ?? result, construction_id, journal) };
      }
      if (!result.construction_ready) return { ...result, ...registered };
      journal = { schema_version: 1, executor_version: EXECUTOR_VERSION, compiled_hash, compiled, plan_ref: registered.plan_ref, session_id: result.session_id, approved_plan_id: resolved.approved_plan_id, state_version: 0, next_action: result.next_action, in_flight: null, history: [], last_result: null };
      await store.save(construction_id, journal);
      return { ...registered, ...decorate(result, construction_id, journal) };
    });
  }
  async function advanceStored(args) {
    return store.locked(async () => {
      if (args.plan_ref || args.plan || args.bounds || args.operation_id || args.request_id || args.approved_plan_id || args.expected_session_id || args.road_id) throw new BridgeError('AMBIGUOUS_CONSTRUCTION', 'A construction handle uses only state_version, action, batch_id and optional lower max_cost.');
      const journal = await store.get(args.construction_id);
      const status = await queryGame('get_game_status', {});
      if (!journal.session_id || journal.session_id !== status.meta?.session_id) throw new BridgeError('CITY_SESSION_CHANGED', 'Construction belongs to another city session.');
      if (journal.executor_version !== EXECUTOR_VERSION) throw new BridgeError('EXECUTOR_CHANGED', 'Construction executor version changed.');
      const fingerprint = contentHash({ state_version: args.state_version, action: args.action, batch_id: args.batch_id, max_cost: args.max_cost });
      if (journal.in_flight || journal.recovery_required) throw new BridgeError('CONSTRUCTION_RECOVERY_REQUIRED', `Inspect ${args.construction_id}; do not replay native writes after interrupted execution.`);
      if (journal.last_fingerprint === fingerprint) return decorate(journal.last_result, args.construction_id, journal);
      if (args.state_version !== journal.state_version) throw new BridgeError('STALE_CONSTRUCTION_STATE', 'Use the current next_action and state_version.');
      const expected = journal.next_action?.arguments;
      if (!expected || args.action !== expected.action || args.batch_id !== expected.batch_id) throw new BridgeError('INVALID_CONSTRUCTION_TRANSITION', 'Only the journal next_action is permitted.');
      const record = await store.get(journal.plan_ref);
      if (computeCityPlanId(record.bounds, record.plan) !== journal.approved_plan_id || contentHash(journal.compiled) !== journal.compiled_hash) throw new BridgeError('EXECUTOR_CHANGED', 'Approved plan or compiled batch integrity changed.');
      const nativeArgs = { ...expected, operation_timeout_ms: args.operation_timeout_ms ?? 20000, compiled_plan: journal.compiled };
      if (args.max_cost !== undefined) {
        if (!Number.isFinite(expected.max_cost) || args.max_cost > expected.max_cost) throw new BridgeError('COST_LIMIT', 'Caller may only lower the preview budget.');
        nativeArgs.max_cost = args.max_cost;
      }
      journal.in_flight = { fingerprint, started_at: new Date().toISOString(), arguments: nativeArgs };
      await store.save(args.construction_id, journal);
      try {
        const result = await advance(nativeArgs);
        journal.history.push({ state_version: journal.state_version, evidence_ref: await store.put('evidence', result) });
        journal.state_version++; journal.next_action = result.next_action; journal.last_result = result; journal.last_fingerprint = fingerprint; journal.in_flight = null;
        await store.save(args.construction_id, journal);
        return decorate(result, args.construction_id, journal);
      } catch (error) {
        journal.recovery_required = true;
        journal.failure = { code: error.code ?? 'INTERNAL_ERROR', message: error.message, operation_id: error.operation_id ?? nativeArgs.operation_id ?? null };
        await store.save(args.construction_id, journal);
        error.recovery_required = true;
        error.construction_id = args.construction_id;
        throw error;
      }
    });
  }
  return { register, resolve, prepare: prepareStored, advance: advanceStored };
}
