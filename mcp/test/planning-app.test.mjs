import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlanningStore } from '../planning-store.mjs';
import { createPlanningAppPayload, planningAppHtml, PLANNING_APP_URI } from '../planning-app.mjs';

test('planning app payload embeds a compressed SVG from a stored artifact', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'planning-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PlanningStore(root);
  const artifact = await store.artifact('<!doctype html><main><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg></main>');
  const payload = await createPlanningAppPayload('render_city_plan', { ...artifact, plan_ref: `plan-${'a'.repeat(64)}`, plan_id: 'cplan-0123456789abcdef' }, store);

  assert.equal(payload.map.encoding, 'gzip+base64');
  assert.match(gunzipSync(Buffer.from(payload.map.data, 'base64')).toString('utf8'), /^<svg[\s\S]*<\/svg>$/);
  assert.equal(payload.map.artifact_sha256, artifact.sha256);
});

test('planning app resource is self-contained and initializes the MCP Apps bridge', () => {
  const html = planningAppHtml();
  assert.equal(PLANNING_APP_URI, 'ui://cityweaver/planning/v1.html');
  assert.match(html, /ui\/initialize/);
  assert.match(html, /ui\/request-display-mode/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});
