import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

// One context per logical request; parallel discovery calls remain attributable.
export function createWorkflowMetrics(query) {
  const context = new AsyncLocalStorage();
  const round = n => Math.round(n * 1000) / 1000;
  return {
    async query(...args) {
      const metrics = context.getStore();
      if (!metrics) return query(...args);
      const started = performance.now();
      const row = metrics.queries[args[0]] ??= { calls: 0, failures: 0, elapsed_ms: 0 };
      row.calls++;
      try { return await query(...args); }
      catch (error) { row.failures++; throw error; }
      finally { row.elapsed_ms += performance.now() - started; }
    },
    mark(name) {
      const metrics = context.getStore(), started = performance.now();
      let done = false;
      const stop = () => {
        if (!metrics || done) return;
        done = true; metrics.active.delete(stop);
        metrics.stages_ms[name] = (metrics.stages_ms[name] ?? 0) + performance.now() - started;
      };
      metrics?.active.add(stop);
      return stop;
    },
    count(name, value = 1) {
      const metrics = context.getStore();
      if (metrics) metrics.counters[name] = (metrics.counters[name] ?? 0) + value;
    },
    async run(fn) {
      const metrics = { elapsed_ms: 0, stages_ms: {}, queries: {}, counters: {} };
      Object.defineProperty(metrics, 'active', { value: new Set() });
      const started = performance.now();
      const finish = () => {
        for (const stop of metrics.active) stop();
        metrics.elapsed_ms = round(performance.now() - started);
        for (const name of Object.keys(metrics.stages_ms)) metrics.stages_ms[name] = round(metrics.stages_ms[name]);
        for (const row of Object.values(metrics.queries)) row.elapsed_ms = round(row.elapsed_ms);
        return metrics;
      };
      return context.run(metrics, async () => {
        try { const result = await fn(); result.performance ??= finish(); return result; }
        catch (error) { error.performance ??= finish(); throw error; }
      });
    },
  };
}
