import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runFileImportWorkflow,
  StaleImportRequestError,
} from './runFileImportWorkflow.ts';

function installRevokeSpy() {
  const original = URL.revokeObjectURL;
  const revoked: string[] = [];
  URL.revokeObjectURL = (url) => revoked.push(url);
  return {
    revoked,
    restore: () => {
      URL.revokeObjectURL = original;
    },
  };
}

test('stale import releases provisional URLs and clears its overlay', async () => {
  const revoke = installRevokeSpy();
  const overlays: Array<string | null> = [];
  let failureCalled = false;
  try {
    const result = await runFileImportWorkflow({
      isCurrent: () => true,
      skippedResult: 'skipped',
      onOverlayChange: (state: string | null) => overlays.push(state),
      onFailure: () => {
        failureCalled = true;
        return 'failed';
      },
      execute: async ({ setOverlay, trackBlobUrls }) => {
        setOverlay('preparing');
        trackBlobUrls(['blob:first', 'blob:first', 'https://example.test/kept']);
        throw new StaleImportRequestError();
      },
    });

    assert.equal(result, 'skipped');
    assert.deepEqual(revoke.revoked, ['blob:first']);
    assert.deepEqual(overlays, ['preparing', null]);
    assert.equal(failureCalled, false);
  } finally {
    revoke.restore();
  }
});

test('committed import transfers URL ownership instead of revoking on later failure', async () => {
  const revoke = installRevokeSpy();
  try {
    const result = await runFileImportWorkflow({
      isCurrent: () => true,
      skippedResult: 'skipped',
      onFailure: () => 'failed',
      execute: async ({ markStateMutated, trackBlobUrls }) => {
        trackBlobUrls(['blob:owned-by-store']);
        markStateMutated();
        throw new Error('post-commit load failed');
      },
    });

    assert.equal(result, 'failed');
    assert.deepEqual(revoke.revoked, []);
  } finally {
    revoke.restore();
  }
});
