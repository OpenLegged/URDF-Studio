import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRenderSemanticOutlineOverlay } from './SemanticOutline.tsx';

test('keeps semantic outlines out of the active interaction render path', () => {
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      isInteracting: true,
      snapshotRenderActive: false,
    }),
    false,
  );
});

test('restores semantic outlines for a settled interactive workspace', () => {
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      isInteracting: false,
      snapshotRenderActive: false,
    }),
    true,
  );
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: false,
      isInteracting: false,
      snapshotRenderActive: false,
    }),
    false,
  );
  assert.equal(
    shouldRenderSemanticOutlineOverlay({
      hasTargets: true,
      isInteracting: false,
      snapshotRenderActive: true,
    }),
    false,
  );
});
