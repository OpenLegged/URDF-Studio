import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, JointType, type RobotData, type UrdfJoint } from '@/types';
import { createSingleComponentWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { setRegressionBeforeUnloadPromptSuppressed } from '@/shared/debug/regressionBridge';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';

import { useUnsavedChangesPrompt } from './useUnsavedChangesPrompt.ts';

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('MutationObserver', originalMutationObserver);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
    },
  };
}

function createJoint(): UrdfJoint {
  return {
    id: 'joint_1',
    name: 'joint_1',
    type: JointType.REVOLUTE,
    parentLinkId: 'base_link',
    childLinkId: 'tool_link',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };
}

function createRobotData(): RobotData {
  return {
    name: 'demo_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      joint_1: createJoint(),
    },
  };
}

function resetStoresToBaseline() {
  setRegressionBeforeUnloadPromptSuppressed(false);
  const current = useWorkspaceStore.getState();
  if (current.transaction) {
    current.cancelWorkspaceTransaction(current.transaction.id);
  }
  current.flushPendingJointMotion({ skipHistory: true });
  current.replaceWorkspace(
    createSingleComponentWorkspace(createRobotData(), {
      componentId: 'component_demo',
      sourceFile: 'demo.urdf',
    }),
    { resetHistory: true },
  );
}

function renderHook() {
  let hookValue: ReturnType<typeof useUnsavedChangesPrompt> | null = null as ReturnType<typeof useUnsavedChangesPrompt> | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useUnsavedChangesPrompt();
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });

  assert.ok(hookValue, 'hook should render');

  return {
    get hook() {
      assert.ok(hookValue, 'hook should stay mounted');
      return hookValue;
    },
    rerender() {
      flushSync(() => root.render(React.createElement(Probe)));
    },
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

function dispatchBeforeUnload(): boolean {
  const event = new window.Event('beforeunload', { cancelable: true });
  return window.dispatchEvent(event);
}

test('useUnsavedChangesPrompt only warns for persistent canonical workspace edits', async () => {
  const domEnvironment = installDomEnvironment();
  resetStoresToBaseline();

  const rendered = renderHook();

  try {
    assert.equal(rendered.hook.hasUnsavedChanges, false);
    assert.equal(dispatchBeforeUnload(), true);

    flushSync(() => {
      useWorkspaceStore.getState().setComponentVisibility('component_demo', false);
    });
    assert.equal(rendered.hook.hasUnsavedChanges, true);
    flushSync(() => {
      useWorkspaceStore.getState().undo();
    });
    assert.equal(rendered.hook.hasUnsavedChanges, false);

    flushSync(() => {
      useWorkspaceStore.getState().setJointMotion(
        { type: 'joint', componentId: 'component_demo', entityId: 'joint_1' },
        0.5,
      );
      useWorkspaceStore
        .getState()
        .flushPendingJointMotion({ label: 'Commit joint pose' });
    });
    assert.equal(rendered.hook.hasUnsavedChanges, true);
    flushSync(() => {
      useWorkspaceStore.getState().undo();
    });
    assert.equal(rendered.hook.hasUnsavedChanges, false);

    flushSync(() => {
      const currentLink = useWorkspaceStore.getState().workspace.components[
        'component_demo'
      ]!.robot.links.tool_link!;
      useWorkspaceStore.getState().updateLink(
        { type: 'link', componentId: 'component_demo', entityId: 'tool_link' },
        {
        collision: {
          ...currentLink.collision,
          dimensions: { x: 1.5, y: 0.4, z: 0.2 },
        },
        },
      );
    });
    assert.equal(rendered.hook.hasUnsavedChanges, true);
    assert.equal(dispatchBeforeUnload(), false);

    flushSync(() => {
      rendered.hook.markCurrentStateSaved();
    });
    assert.equal(rendered.hook.hasUnsavedChanges, false);
    assert.equal(dispatchBeforeUnload(), true);
  } finally {
    rendered.cleanup();
    setRegressionBeforeUnloadPromptSuppressed(false);
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
    void domEnvironment;
  }
});

test('unchanged immutable workspaces reuse their snapshot across notifications and renders', (context) => {
  const domEnvironment = installDomEnvironment();
  resetStoresToBaseline();
  const stringify = JSON.stringify;
  let snapshots = 0;
  const stringifyMock = context.mock.method(JSON, 'stringify', (value: unknown) => {
    if (new Error().stack?.includes('createStableJsonSnapshot')) snapshots += 1;
    return stringify(value);
  });
  const rendered = renderHook();

  try {
    snapshots = 0;
    flushSync(() => useWorkspaceStore.getState().clearHistory());
    rendered.rerender();
    flushSync(() => rendered.hook.markCurrentStateSaved());
    assert.equal(snapshots, 0);

    flushSync(() => useWorkspaceStore.getState().setJointMotion(
      { type: 'joint', componentId: 'component_demo', entityId: 'joint_1' },
      0.25,
    ));
    assert.equal(snapshots, 1);
    assert.equal(rendered.hook.hasUnsavedChanges, true);
    rendered.rerender();
    flushSync(() => rendered.hook.markCurrentStateSaved());
    assert.equal(snapshots, 1);
    assert.equal(rendered.hook.hasUnsavedChanges, false);
  } finally {
    stringifyMock.mock.restore();
    rendered.cleanup();
    domEnvironment.restore();
  }
});

test('saving before the next render reads current state and undo can return to the saved contents', () => {
  const domEnvironment = installDomEnvironment();
  resetStoresToBaseline();
  const rendered = renderHook();

  try {
    flushSync(() => {
      useWorkspaceStore.getState().renameWorkspace('saved before render');
      markUnsavedChangesBaselineSaved();
    });
    assert.equal(rendered.hook.hasUnsavedChanges, false);
    assert.equal(dispatchBeforeUnload(), true);

    flushSync(() => useWorkspaceStore.getState().renameWorkspace('later edit'));
    assert.equal(rendered.hook.hasUnsavedChanges, true);
    assert.equal(dispatchBeforeUnload(), false);
    flushSync(() => useWorkspaceStore.getState().undo());
    assert.equal(rendered.hook.hasUnsavedChanges, false);
    assert.equal(dispatchBeforeUnload(), true);
    flushSync(() => useWorkspaceStore.getState().redo());
    assert.equal(rendered.hook.hasUnsavedChanges, true);
  } finally {
    rendered.cleanup();
    assert.equal(dispatchBeforeUnload(), true);
    domEnvironment.restore();
  }
});

test('useUnsavedChangesPrompt can suppress beforeunload warnings for regression automation', async () => {
  const domEnvironment = installDomEnvironment();
  resetStoresToBaseline();

  const rendered = renderHook();

  try {
    flushSync(() => {
      const currentLink = useWorkspaceStore.getState().workspace.components[
        'component_demo'
      ]!.robot.links.tool_link!;
      useWorkspaceStore.getState().updateLink(
        { type: 'link', componentId: 'component_demo', entityId: 'tool_link' },
        {
        collision: {
          ...currentLink.collision,
          dimensions: { x: 1.25, y: 0.5, z: 0.3 },
        },
        },
      );
    });

    assert.equal(rendered.hook.hasUnsavedChanges, true);
    assert.equal(dispatchBeforeUnload(), false);

    flushSync(() => {
      setRegressionBeforeUnloadPromptSuppressed(true);
    });
    assert.equal(dispatchBeforeUnload(), true);

    flushSync(() => {
      setRegressionBeforeUnloadPromptSuppressed(false);
    });
    assert.equal(dispatchBeforeUnload(), false);
  } finally {
    rendered.cleanup();
    setRegressionBeforeUnloadPromptSuppressed(false);
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });
    void domEnvironment;
  }
});
