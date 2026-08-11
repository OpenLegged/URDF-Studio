import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWorkspaceCanvasErrorDetail,
  probeWorkspaceCanvasWebglSupport,
} from './workspaceCanvasWebgl.ts';

test('probeWorkspaceCanvasWebglSupport reports missing browser WebGL APIs', () => {
  const result = probeWorkspaceCanvasWebglSupport({
    window: {},
  });

  assert.deepEqual(result, {
    supported: false,
    reason: 'missing-api',
    detail: 'WebGL APIs are unavailable in the current browser environment.',
  });
});

test('probeWorkspaceCanvasWebglSupport does not create a temporary WebGL context', () => {
  let documentReads = 0;
  const environment = {
    window: {
      WebGLRenderingContext: {},
    },
    get document() {
      documentReads += 1;
      throw new Error('The support probe must not touch a canvas.');
    },
  };
  const result = probeWorkspaceCanvasWebglSupport(environment);

  assert.deepEqual(result, { supported: true });
  assert.equal(documentReads, 0);
});

test('getWorkspaceCanvasErrorDetail normalizes error payloads', () => {
  assert.equal(
    getWorkspaceCanvasErrorDetail(new Error('Renderer init failed')),
    'Renderer init failed',
  );
  assert.equal(getWorkspaceCanvasErrorDetail('  WebGL context lost  '), 'WebGL context lost');
  assert.equal(getWorkspaceCanvasErrorDetail({ message: 'ignored' }), undefined);
});
