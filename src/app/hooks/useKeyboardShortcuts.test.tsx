import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act } from 'react';

import { renderHook } from '../../../scripts/test/helpers/react-hook-harness';
import { createDefaultWorkspace } from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { HistoryActions } from './useActiveHistory';
import { useKeyboardShortcuts } from './useAppEffects';

function mountShortcuts(context: TestContext, initialHistory?: HistoryActions | null) {
  const originalWorkspace = useWorkspaceStore.getState();
  const originalAssets = useAssetsStore.getState();
  useWorkspaceStore.getState().replaceWorkspace(createDefaultWorkspace('before'), {
    resetHistory: true,
  });
  useWorkspaceStore.getState().renameWorkspace('after');
  useAssetsStore.setState({ componentSourceDrafts: {} });

  let history = initialHistory;
  const rendered = renderHook(context, () => useKeyboardShortcuts(history));
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: document.defaultView!.Element,
  });
  context.after(() => {
    if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement);
    else Reflect.deleteProperty(globalThis, 'Element');
    useWorkspaceStore.setState(originalWorkspace, true);
    useAssetsStore.setState(originalAssets, true);
  });

  return {
    setHistory(next: HistoryActions | null | undefined) {
      history = next;
      rendered.rerender();
    },
    press(options: KeyboardEventInit, target: EventTarget = document.body) {
      const event = new window.KeyboardEvent('keydown', {
        key: 'z', bubbles: true, cancelable: true, ...options,
      });
      act(() => target.dispatchEvent(event));
      return event;
    },
  };
}

for (const modifier of ['ctrlKey', 'metaKey'] as const) {
  test(`${modifier} undo and uppercase Shift+Z redo use the active surface history`, (context) => {
    const calls = { undo: 0, redo: 0 };
    const alternate: HistoryActions = {
      canUndo: true,
      canRedo: true,
      undo: () => { calls.undo += 1; },
      redo: () => { calls.redo += 1; },
    };
    const shortcuts = mountShortcuts(context);

    assert.equal(shortcuts.press({ [modifier]: true }).defaultPrevented, true);
    assert.equal(useWorkspaceStore.getState().workspace.name, 'before');
    assert.equal(shortcuts.press({ [modifier]: true, key: 'Z', shiftKey: true }).defaultPrevented, true);
    assert.equal(useWorkspaceStore.getState().workspace.name, 'after');

    shortcuts.setHistory(alternate);
    shortcuts.press({ [modifier]: true });
    shortcuts.press({ [modifier]: true, key: 'Z', shiftKey: true });
    assert.deepEqual(calls, { undo: 1, redo: 1 });
    assert.equal(useWorkspaceStore.getState().workspace.name, 'after');
    assert.equal(useWorkspaceStore.getState().history.past.length, 1);

    shortcuts.setHistory(undefined);
    shortcuts.press({ [modifier]: true });
    assert.equal(useWorkspaceStore.getState().workspace.name, 'before');
    assert.deepEqual(calls, { undo: 1, redo: 1 });
  });
}

test('unavailable and exhausted alternate history never fall through to model history', (context) => {
  const shortcuts = mountShortcuts(context, null);
  assert.equal(shortcuts.press({ ctrlKey: true }).defaultPrevented, true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'after');

  shortcuts.setHistory({
    canUndo: false,
    canRedo: false,
    undo: () => assert.fail('exhausted undo must not run'),
    redo: () => assert.fail('exhausted redo must not run'),
  });
  shortcuts.press({ metaKey: true });
  shortcuts.press({ metaKey: true, key: 'Z', shiftKey: true });
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'after');
});

test('editable targets retain their native undo and redo', (context) => {
  const shortcuts = mountShortcuts(context);
  const markup = [
    '<input />',
    '<textarea></textarea>',
    '<select><option>One</option></select>',
    '<div contenteditable="true"><span>Text</span></div>',
    '<div role="textbox" tabindex="0"><span>Text</span></div>',
  ];
  for (const html of markup) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const editable = host.firstElementChild;
    assert.ok(editable instanceof HTMLElement);
    editable.focus();
    const target = editable.lastElementChild ?? editable;
    assert.equal(shortcuts.press({ ctrlKey: true }, target).defaultPrevented, false, html);
    assert.equal(shortcuts.press({ metaKey: true, key: 'Z', shiftKey: true }, target).defaultPrevented, false, html);
    host.remove();
  }
  assert.equal(useWorkspaceStore.getState().workspace.name, 'after');
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
});

test('consumed, composing and Alt-modified keyboard events do not change history', (context) => {
  const shortcuts = mountShortcuts(context);
  const target = document.createElement('button');
  document.body.appendChild(target);
  target.addEventListener('keydown', (event) => event.preventDefault());
  assert.equal(shortcuts.press({ ctrlKey: true }, target).defaultPrevented, true);
  assert.equal(shortcuts.press({ ctrlKey: true, isComposing: true }).defaultPrevented, false);
  assert.equal(shortcuts.press({ ctrlKey: true, altKey: true }).defaultPrevented, false);
  assert.equal(shortcuts.press({ key: 'z' }).defaultPrevented, false);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'after');
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
});
