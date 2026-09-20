import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { contentHash } from './planning-store.mjs';
import { BoundedCache } from './bounded-cache.mjs';
import { renderCityPlan } from './planning-renderer.mjs';
import { renderCityPlanInteractive } from './planning-interactive.mjs';

// Bump when renderer semantics change. Cache is process-local and stores no HTML.
export const RENDERER_VERSION = 'planning-render-1';
export function createPlanningRenderCache(store, render = (snapshot, plan, options, html) =>
  html ? renderCityPlanInteractive(snapshot, plan, options) : renderCityPlan(snapshot, plan, options)) {
  const cache = new BoundedCache(8 * 1024 * 1024, 64);
  const pending = new Map();
  async function renderArtifact(snapshot, plan, options, html) {
    const key = contentHash({ version: RENDERER_VERSION, snapshot, plan, options, html });
    if (pending.has(key)) return structuredClone(await pending.get(key));
    const task = (async () => {
      const cached = cache.get(key);
      if (cached) {
        try {
          const bytes = await readFile(cached.artifact_path);
          if (createHash('sha256').update(bytes).digest('hex') === cached.sha256) return cached;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        cache.delete(key);
      }
      const rendered = await render(snapshot, plan, options, html);
      const metadata = { ...rendered, ...await store.artifact(html ? rendered.html : rendered.svg, html ? 'html' : 'svg') };
      delete metadata.html; delete metadata.svg;
      cache.set(key, metadata, Buffer.byteLength(JSON.stringify(metadata)) * 4);
      return metadata;
    })();
    pending.set(key, task);
    try { return structuredClone(await task); } finally { pending.delete(key); }
  }
  return { renderArtifact, inspect: () => ({ ...cache.inspect(), pending: pending.size }) };
}
