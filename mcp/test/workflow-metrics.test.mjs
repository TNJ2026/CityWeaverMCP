import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowMetrics} from '../workflow-metrics.mjs';

test('parallel request metrics remain isolated and failures close open stages',async()=>{
  const metrics=createWorkflowMetrics(async name=>{await Promise.resolve();if(name==='failure')throw new Error('fixture');return {};});
  const [a,b]=await Promise.all([
    metrics.run(async()=>{await Promise.all([metrics.query('a'),metrics.query('a')]);return {};}),
    metrics.run(async()=>{await metrics.query('b');return {};})
  ]);
  assert.deepEqual(Object.keys(a.performance.queries),['a']);
  assert.equal(a.performance.queries.a.calls,2);
  assert.deepEqual(Object.keys(b.performance.queries),['b']);
  await assert.rejects(metrics.run(async()=>{metrics.mark('unfinished');await metrics.query('failure');}),e=>{
    assert.equal(e.performance.queries.failure.failures,1);
    assert.ok(e.performance.stages_ms.unfinished>=0);
    assert.equal(JSON.stringify(e.performance).includes('active'),false);
    return true;
  });
});
