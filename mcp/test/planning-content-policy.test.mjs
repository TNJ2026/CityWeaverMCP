import test from 'node:test';
import assert from 'node:assert/strict';
import { planningContentDecision } from '../planning-content-policy.mjs';
import { bindGridProposal } from '../planning-binder.mjs';
import { createBuildingWorkflow } from '../building-workflow.mjs';

const source = { category: 'no_declared_requirement', requirements_complete: true, content_available: true, is_builtin_asset: true, is_subscribed_mod: false };
const road = (name, extra = {}) => ({ name, width_m: 8, locked: false, zoning_enabled: true, structure_type: 'standard', source: { ...source, ...extra } });
const proposal = { plan: { grids: [{ road_width_m: 8, zone_kind: 'residential' }] } };

test('planning uses built-in fallback when DLC is unavailable; available DLC remains eligible', () => {
  const base = road('Gravel Road');
  const dlc = road('Alley', { category: 'dlc', content_available: false });
  const bind = () => bindGridProposal(proposal, { road_prefabs: [dlc, base] });
  assert.equal(bind().plan.grids[0].road_prefab, 'Gravel Road');
  dlc.source.content_available = true;
  assert.equal(bind().plan.grids[0].road_prefab, 'Alley');
  dlc.source.content_available = false;
  const explicit = bindGridProposal(proposal, { road_prefabs: [dlc, base] }, { road_prefab: 'Alley' });
  assert.equal(explicit.bindings.road.status, 'not_found');
  assert.equal(explicit.preview_draft, null);
});

test('unknown, unavailable, locked, subscribed and account-only assets are excluded', () => {
  for (const prefab of [{}, { source: { ...source, category: 'unknown' } },
    road('DLC', { category: 'dlc', content_available: null }),
    road('mod', { is_subscribed_mod: true }), road('login', { category: 'account_reward' }),
    { ...road('locked'), locked: true }]) assert.equal(planningContentDecision(prefab).allowed, false);
});

test('building planning rejects unavailable DLC before site planning or preview', async () => {
  const calls = [];
  const workflow = createBuildingWorkflow(async tool => {
    calls.push(tool);
    if (tool === 'get_game_status') return { ok: true, meta: { session_id: 'fixture' }, data: { city_loaded: true, paused: true } };
    if (tool === 'list_building_prefabs') return { ok: true, meta: { session_id: 'fixture' }, data: { items: [road('DLC Building', { category: 'dlc', content_available: false })] } };
    throw new Error(`Unexpected tool ${tool}`);
  });
  await assert.rejects(workflow.createPlan({ request_id: 'unavailable-dlc', category: 'building', building_prefab: 'DLC Building', near: { x: 0, z: 0 } }), e => e.code === 'PREFAB_CONTENT_UNAVAILABLE');
  assert.deepEqual(calls.filter(tool => tool.startsWith('plan_') || tool.startsWith('preview_')), []);
});
