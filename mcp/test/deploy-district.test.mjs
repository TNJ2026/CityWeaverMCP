import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseRequestId } from '../../tools/deploy-district.mjs';

test('district phase request ids preserve distinct suffixes at the 100-character limit', () => {
  const base = 'district-'.padEnd(100, 'x');
  const preview = phaseRequestId(base, 'roads-preview');
  const commit = phaseRequestId(base, 'roads-commit');
  assert(preview.length <= 100);
  assert(commit.length <= 100);
  assert.notEqual(preview, commit);
  assert.match(preview, /-roads-preview$/);
  assert.match(commit, /-roads-commit$/);
});
