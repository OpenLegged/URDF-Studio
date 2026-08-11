import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanupWorkspaceCanvasRenderer } from './workspaceCanvasRendererCleanup.ts';

test('cleanupWorkspaceCanvasRenderer releases resources without forcing context loss', () => {
  const calls: string[] = [];
  const renderer = {
    domElement: {
      __workspaceCanvasCleanup: () => {
        calls.push('canvas-cleanup');
      },
    },
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
    forceContextLoss: () => {
      calls.push('force-context-loss');
    },
  } as any;

  cleanupWorkspaceCanvasRenderer(renderer, () => {
    calls.push('context-menu-cleanup');
  });

  assert.deepEqual(calls, ['canvas-cleanup', 'render-lists', 'dispose']);
});

test('cleanupWorkspaceCanvasRenderer still releases context-menu cleanup without a renderer', () => {
  const calls: string[] = [];

  cleanupWorkspaceCanvasRenderer(null, () => {
    calls.push('context-menu-cleanup');
  });

  assert.deepEqual(calls, ['context-menu-cleanup']);
});
