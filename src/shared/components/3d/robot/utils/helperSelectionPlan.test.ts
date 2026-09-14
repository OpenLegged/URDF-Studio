import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHelperSelectionPlan } from './helperSelectionPlan';

test('origin-axes helper keeps the owning link selected', () => {
  const result = resolveHelperSelectionPlan({
    fallbackType: 'link',
    fallbackId: 'thigh_link',
    helperKind: 'origin-axes',
    linkObject: null,
  });

  assert.deepEqual(result.selectTarget, { type: 'link', id: 'thigh_link' });
});

test('non-origin helper keeps the resolved selection target', () => {
  const result = resolveHelperSelectionPlan({
    fallbackType: 'link',
    fallbackId: 'base_link',
    helperKind: 'center-of-mass',
    linkObject: null,
  });

  assert.deepEqual(result.selectTarget, { type: 'link', id: 'base_link' });
});
