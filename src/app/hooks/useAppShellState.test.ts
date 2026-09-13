import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import { renderHook } from '../../../scripts/test/helpers/react-hook-harness';
import { useAppShellState } from './useAppShellState';

test('shell toast replacement resets expiration and does not alter panel preferences', (context) => {
  const rendered = renderHook(context, useAppShellState);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  act(() => {
    rendered.current.setViewConfig({
      showJointPanel: false, showOptionsPanel: true, showStructureGraph: true,
    });
    rendered.current.showToast('First', 'info');
    context.mock.timers.tick(4000);
    rendered.current.showToast('Second', 'error');
    context.mock.timers.tick(1000);
  });
  assert.deepEqual(rendered.current.toast, { show: true, message: 'Second', type: 'error' });
  act(() => { context.mock.timers.tick(4000); });
  assert.equal(rendered.current.toast.show, false);
  assert.equal(rendered.current.viewConfig.showStructureGraph, true);
  assert.equal(rendered.current.viewConfig.showJointPanel, false);
});

test('shell close hides the toast without affecting the code editor', (context) => {
  const rendered = renderHook(context, useAppShellState);
  act(() => {
    rendered.current.setIsCodeViewerOpen(true);
    rendered.current.showToast('Saved', 'success');
    rendered.current.closeToast();
  });
  assert.equal(rendered.current.toast.show, false);
  assert.equal(rendered.current.isCodeViewerOpen, true);
});
