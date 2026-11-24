import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { createAssemblySceneProjection, createSingleComponentWorkspace } from '@/core/robot';
import {
  useJointInteractionPreviewStore,
  type JointInteractionPreviewSnapshot,
} from '@/store/jointInteractionPreviewStore';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData } from '@/types';
import { TreeEditorJointSection, resolveWorkspaceJointPreviewState } from './TreeEditorJointSection';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  // React's legacy input-event detection runs before this per-test DOM exists.
  for (const name of ['attachEvent', 'detachEvent', 'scrollIntoView']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, name, {
      value: () => {}, configurable: true,
    });
  }
  return dom;
}

function createProjection() {
  const robot: RobotData = {
    name: 'panel-sync', rootLinkId: 'base',
    links: Object.fromEntries(['base', 'door', 'handle'].map(id => [
      id, { ...structuredClone(DEFAULT_LINK), id, name: id },
    ])),
    joints: Object.fromEntries(['hinge', 'follower'].map((id, index) => [
      id, {
        ...structuredClone(DEFAULT_JOINT), id, name: id,
        parentLinkId: 'base', childLinkId: index ? 'handle' : 'door',
        type: JointType.REVOLUTE, angle: 0,
        limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      },
    ])),
  };
  return createAssemblySceneProjection(createSingleComponentWorkspace(robot, { componentId: 'arm' }));
}

function jointPreview(
  angles: Record<string, number>,
  source: 'tree-panel' | 'viewer' = 'tree-panel',
): JointInteractionPreviewSnapshot {
  return {
    ownerId: source, source, dragSessionId: 'interaction', activeJointId: 'hinge',
    jointAngles: angles, jointQuaternions: {}, jointOrigins: {},
    workspaceTargets: Object.entries(angles).map(([entityId, angle]) => ({
      ref: { type: 'joint', componentId: 'arm', entityId },
      active: entityId === 'hinge', angle,
    })),
  };
}

async function mountPanel(onCommit: (angle: number) => void = () => {}) {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const projection = createProjection();
  useJointInteractionPreviewStore.getState().clearPreview();
  const render = async (angles: Record<string, number>) => {
    await act(async () => root.render(
      <TreeEditorJointSection
        robot={projection.robotData} projection={projection} jointAngleState={angles}
        selection={null} lang="en" onUpdate={() => {}} show height={320}
        onJointAngleChange={(_ref, angle) => onCommit(angle)}
      />,
    ));
  };
  await render({ hinge: 0, follower: 0 });
  return {
    render,
    value: (name: string) => {
      const slider = container.querySelector(`[role="slider"][aria-label="${name} slider"]`);
      assert.ok(slider, `${name} slider exists`);
      return Number(slider.getAttribute('aria-valuenow'));
    },
    enter: async (value: string) => {
      const row = container.querySelector('[role="button"][aria-label="hinge"]');
      assert.ok(row, 'hinge row exists');
      const button = row.querySelector('button');
      assert.ok(button);
      await act(async () => button.click());
      const input = row.querySelector<HTMLInputElement>('input[type="text"]');
      assert.ok(input, 'numeric editor is open');
      await act(async () => {
        input.value = value;
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
    },
    publish: async (preview: JointInteractionPreviewSnapshot) => {
      await act(async () => useJointInteractionPreviewStore.getState().publishPreview(preview));
    },
    clear: async () => {
      await act(async () => useJointInteractionPreviewStore.getState().clearPreview());
    },
    close: async () => {
      await act(async () => root.unmount());
      useJointInteractionPreviewStore.getState().clearPreview();
      dom.window.close();
    },
  };
}

test('tree previews map accepted values by canonical refs, ignoring raw renderer values', () => {
  const preview = jointPreview({ hinge: 1, follower: 0.5 });
  preview.jointAngles = { hinge: 5, follower: 99 };
  assert.deepEqual(resolveWorkspaceJointPreviewState(preview, createProjection()).jointAngles, {
    hinge: 1, follower: 0.5,
  });
});

test('numeric commit shows the accepted limit value and subsequent canonical edits replace it', async () => {
  const requested: number[] = [];
  const mounted = await mountPanel(angle => {
    requested.push(angle);
    useJointInteractionPreviewStore.getState().publishPreview(jointPreview({ hinge: 1 }));
  });
  try {
    await mounted.enter('5');
    assert.deepEqual(requested, [5]);
    assert.equal(mounted.value('hinge'), 1, 'accepted preview replaces raw numeric input before props arrive');
    await mounted.render({ hinge: 1, follower: 0 });
    await mounted.clear();
    await mounted.render({ hinge: -0.4, follower: 0 });
    assert.equal(mounted.value('hinge'), -0.4, 'an undo or another controller cannot be shadowed by old pending input');
  } finally {
    await mounted.close();
  }
});

test('coupled preview updates every row and cancellation restores canonical values', async () => {
  const mounted = await mountPanel();
  try {
    await mounted.publish(jointPreview({ hinge: 0.25, follower: -0.25 }));
    assert.equal(mounted.value('hinge'), 0.25);
    assert.equal(mounted.value('follower'), -0.25, 'the solved follower follows the same accepted preview');
    await mounted.render({ hinge: 0, follower: 0 });
    assert.equal(mounted.value('follower'), -0.25, 'a canonical render does not replace an active preview');
    await mounted.publish(jointPreview({ hinge: 0, follower: 0 }));
    await mounted.clear();
    assert.equal(mounted.value('hinge'), 0);
    assert.equal(mounted.value('follower'), 0);

    await mounted.publish(jointPreview({ hinge: 0.6 }, 'viewer'));
    await mounted.clear();
    await mounted.render({ hinge: 0.55, follower: 0 });
    assert.equal(mounted.value('hinge'), 0.55, 'a final link-drag commit wins over its preceding preview');
  } finally {
    await mounted.close();
  }
});

test('a rejected numeric commit retains the canonical value without optimistic raw input', async () => {
  const requested: number[] = [];
  const mounted = await mountPanel(angle => requested.push(angle));
  try {
    await mounted.render({ hinge: 0.3, follower: 0 });
    await mounted.enter('0.9');
    assert.deepEqual(requested, [0.9]);
    assert.equal(mounted.value('hinge'), 0.3);
  } finally {
    await mounted.close();
  }
});
