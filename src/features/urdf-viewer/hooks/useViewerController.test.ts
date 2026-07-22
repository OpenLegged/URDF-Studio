import test from 'node:test';
import assert from 'node:assert/strict';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type JointQuaternion,
  type RobotState,
} from '@/types';
import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import { buildClosedLoopMotionPreviewRobot } from '@/shared/utils/robot/closedLoopMotionPreview';
import {
  EMPTY_JOINT_INTERACTION_PREVIEW,
  useJointInteractionPreviewStore,
  useSelectionStore,
} from '@/store';
import { disposeClosedLoopMotionPreviewWorker } from '@/shared/utils/robot/closedLoopMotionPreviewWorkerBridge';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

import { useViewerController } from './useViewerController.ts';

class ClosedLoopPreviewMockWorker {
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  private baseRobot: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
      return;
    }

    if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
      return;
    }

    if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: {
    type?: string;
    requestId: number;
    robot?: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'> | null;
    jointId: string;
    angle: number;
    options?: Parameters<typeof resolveClosedLoopDrivenJointMotion>[3];
    previewState?: { angles: Record<string, number>; quaternions: Record<string, JointQuaternion> };
  }): void {
    if (message.type === 'set-base-robot') {
      this.baseRobot = message.robot ?? null;
      return;
    }

    queueMicrotask(() => {
      try {
        const sourceRobot = message.robot ?? this.baseRobot;
        if (!sourceRobot) {
          throw new Error('mock worker base robot not set');
        }
        const solveRobot = message.previewState
          ? buildClosedLoopMotionPreviewRobot(sourceRobot, message.previewState)
          : sourceRobot;
        const solution = resolveClosedLoopDrivenJointMotion(
          solveRobot,
          message.jointId,
          message.angle,
          message.options ?? {},
        );
        const event = {
          data: {
            type: 'resolve-motion-preview-result',
            requestId: message.requestId,
            solution,
          },
        } as MessageEvent;
        this.messageListeners.forEach((listener) => listener(event));
      } catch (error) {
        const event = {
          data: {
            type: 'resolve-motion-preview-error',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : 'mock worker failed',
          },
        } as MessageEvent;
        this.messageListeners.forEach((listener) => listener(event));
      }
    });
  }

  terminate(): void {
    this.messageListeners.clear();
    this.errorListeners.clear();
  }
}

class ControlledClosedLoopPreviewMockWorker {
  static requests: Array<{
    worker: ControlledClosedLoopPreviewMockWorker;
    message: {
      type?: string;
      requestId: number;
      robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>;
      jointId: string;
      angle: number;
      options?: Parameters<typeof resolveClosedLoopDrivenJointMotion>[3];
      previewState?: {
        angles: Record<string, number>;
        quaternions: Record<string, JointQuaternion>;
      };
    };
  }> = [];

  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();
  private baseRobot: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null = null;

  static reset(): void {
    ControlledClosedLoopPreviewMockWorker.requests = [];
  }

  static resolveNext(): void {
    const request = ControlledClosedLoopPreviewMockWorker.requests.shift();
    assert.ok(request, 'expected a pending closed-loop worker request');

    const solveRobot = request.message.previewState
      ? buildClosedLoopMotionPreviewRobot(request.message.robot, request.message.previewState)
      : request.message.robot;
    const solution = resolveClosedLoopDrivenJointMotion(
      solveRobot,
      request.message.jointId,
      request.message.angle,
      request.message.options ?? {},
    );
    const event = {
      data: {
        type: 'resolve-motion-preview-result',
        requestId: request.message.requestId,
        solution,
      },
    } as MessageEvent;

    queueMicrotask(() => {
      request.worker.messageListeners.forEach((listener) => listener(event));
    });
  }

  static rejectNext(error = 'mock worker failed'): void {
    const request = ControlledClosedLoopPreviewMockWorker.requests.shift();
    assert.ok(request, 'expected a pending closed-loop worker request');

    const event = {
      data: {
        type: 'resolve-motion-preview-error',
        requestId: request.message.requestId,
        error,
      },
    } as MessageEvent;

    queueMicrotask(() => {
      request.worker.messageListeners.forEach((listener) => listener(event));
    });
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
      return;
    }

    if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
      return;
    }

    if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  postMessage(message: {
    type?: string;
    requestId: number;
    robot?: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'> | null;
    jointId: string;
    angle: number;
    options?: Parameters<typeof resolveClosedLoopDrivenJointMotion>[3];
    previewState?: { angles: Record<string, number>; quaternions: Record<string, JointQuaternion> };
  }): void {
    if (message.type === 'set-base-robot') {
      this.baseRobot = message.robot ?? null;
      return;
    }

    const sourceRobot = message.robot ?? this.baseRobot;
    assert.ok(sourceRobot, 'mock worker base robot should be set before solve');
    ControlledClosedLoopPreviewMockWorker.requests.push({
      worker: this,
      message: {
        ...message,
        robot: sourceRobot,
      },
    });
  }

  terminate(): void {
    this.messageListeners.clear();
    this.errorListeners.clear();
  }
}

type ClosedLoopPreviewMockWorkerClass = new () => {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  postMessage(message: unknown): void;
  terminate(): void;
};

function renderHook() {
  let hookValue: ReturnType<typeof useViewerController> | null = null as ReturnType<typeof useViewerController> | null;

  function Probe() {
    hookValue = useViewerController({ active: false });
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue, 'hook should render');
  return hookValue as ReturnType<typeof useViewerController>;
}

function installDom(
  workerClass: ClosedLoopPreviewMockWorkerClass = ClosedLoopPreviewMockWorker,
) {
  disposeClosedLoopMotionPreviewWorker();
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: dom.window.requestAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: dom.window.cancelAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Worker', {
    value: workerClass,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'Worker', {
    value: workerClass,
    configurable: true,
  });

  return dom;
}

function createClosedLoopRobotFixture(): RobotState {
  return {
    name: 'closed-loop-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'joint_a' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      link_a: {
        ...DEFAULT_LINK,
        id: 'link_a',
        name: 'link_a',
      },
      link_b: {
        ...DEFAULT_LINK,
        id: 'link_b',
        name: 'link_b',
      },
    },
    joints: {
      joint_a: {
        ...DEFAULT_JOINT,
        id: 'joint_a',
        name: 'joint_a',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_a',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
      joint_b: {
        ...DEFAULT_JOINT,
        id: 'joint_b',
        name: 'joint_b',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_b',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
    },
    closedLoopConstraints: [
      {
        id: 'connect-rotating-links',
        type: 'connect',
        linkAId: 'link_a',
        linkBId: 'link_b',
        anchorWorld: { x: 1, y: 0, z: 0 },
        anchorLocalA: { x: 1, y: 0, z: 0 },
        anchorLocalB: { x: 1, y: 0, z: 0 },
        source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
      },
    ],
  };
}

function createMimicRobotFixture(): RobotState {
  return {
    name: 'mimic-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'follower_joint' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      leader_link: {
        ...DEFAULT_LINK,
        id: 'leader_link',
        name: 'leader_link',
      },
      follower_link: {
        ...DEFAULT_LINK,
        id: 'follower_link',
        name: 'follower_link',
      },
    },
    joints: {
      leader_joint: {
        ...DEFAULT_JOINT,
        id: 'leader_joint',
        name: 'leader_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'leader_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
      follower_joint: {
        ...DEFAULT_JOINT,
        id: 'follower_joint',
        name: 'follower_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'follower_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
        mimic: {
          joint: 'leader_joint',
          multiplier: -2,
          offset: 0.1,
        },
      },
    },
  };
}

function createSimpleRobotFixture(): RobotState {
  return {
    name: 'simple-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'joint_a' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      link_a: {
        ...DEFAULT_LINK,
        id: 'link_a',
        name: 'link_a',
      },
    },
    joints: {
      joint_a: {
        ...DEFAULT_JOINT,
        id: 'joint_a',
        name: 'joint_a',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_a',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
    },
  };
}

type RuntimeJoint = RobotState['joints'][string] & {
  jointValue: number;
  jointQuaternion?: JointQuaternion;
  quaternion?: JointQuaternion;
  setJointValue: (angle: number) => void;
  finalizeJointValue: () => void;
  setJointQuaternion: (quaternion: JointQuaternion) => void;
};

type RuntimeRobotFixture = RuntimeRobotObject & {
  joints: Record<string, RuntimeJoint>;
};

function createRuntimeRobotFixture(robot: RobotState): RuntimeRobotFixture {
  const runtimeJoints = Object.fromEntries(
    Object.entries(robot.joints).map(([jointId, joint]) => {
      const runtimeJoint: RuntimeJoint = {
        ...joint,
        jointValue: joint.angle ?? 0,
        setJointValue(angle: number) {
          this.angle = angle;
          this.jointValue = angle;
        },
        finalizeJointValue() {},
        setJointQuaternion(quaternion: JointQuaternion) {
          this.quaternion = quaternion;
        },
      };

      return [jointId, runtimeJoint];
    }),
  ) as Record<string, RuntimeJoint>;

  return Object.assign(new THREE.Object3D(), robot, {
    joints: runtimeJoints,
  }) as unknown as RuntimeRobotFixture;
}

async function mountController(closedLoopRobotState: RobotState) {
  return mountControllerWithProps({
    active: false,
    closedLoopRobotState,
  });
}

async function mountControllerWithProps(props: Parameters<typeof useViewerController>[0]) {
  const dom = installDom();
  return mountControllerWithDom(props, dom);
}

async function mountControllerWithDom(
  props: Parameters<typeof useViewerController>[0],
  dom: JSDOM,
) {
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  useJointInteractionPreviewStore.getState().clearPreview();

  const root = createRoot(container);
  let hookValue: ReturnType<typeof useViewerController> | null = null as ReturnType<typeof useViewerController> | null;
  let currentProps = props;

  function Probe() {
    hookValue = useViewerController(currentProps);
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    dom,
    root,
    async rerender(nextProps: Parameters<typeof useViewerController>[0]) {
      currentProps = nextProps;
      await act(async () => {
        root.render(React.createElement(Probe));
      });
    },
    getHook() {
      assert.ok(hookValue, 'hook should stay mounted');
      return hookValue as ReturnType<typeof useViewerController>;
    },
  };
}

async function nextAnimationFrame(dom: JSDOM) {
  await new Promise<void>((resolve) => {
    dom.window.requestAnimationFrame(() => resolve());
  });
  await Promise.resolve();
  await Promise.resolve();
}

function assertAlmostEqual(actual: number | undefined, expected: number, epsilon = 1e-3) {
  assert.equal(typeof actual, 'number');
  assert.ok(
    Math.abs((actual ?? 0) - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
}

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.interactionHoverFreezeOwners.forEach((owner) => {
    useSelectionStore.getState().setHoverFrozen(owner, false);
  });
  state.clearHover();
  state.setHoveredSelection(null);
}

test('handleAutoFitGround delegates to the active runtime auto-fit handler when registered', () => {
  const hook = renderHook();
  let callCount = 0;

  hook.registerRuntimeAutoFitGroundHandler(() => {
    callCount += 1;
  });

  hook.handleAutoFitGround();

  assert.equal(callCount, 1);
});

test('handleRobotLoaded derives origin axes size limits from robot bounds', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const geometry = new THREE.BoxGeometry(0.5, 0.2, 0.1);
  const material = new THREE.MeshBasicMaterial();
  const visualMesh = new THREE.Mesh(geometry, material);
  visualMesh.userData.isVisualMesh = true;
  runtimeRobot.add(visualMesh);

  const { dom, root, getHook } = await mountControllerWithProps({ active: false });

  await act(async () => {
    getHook().setOriginSize(0.4);
  });
  assert.equal(getHook().originSize, 0.4);

  await act(async () => {
    getHook().handleRobotLoaded(runtimeRobot);
  });

  assert.equal(getHook().originAxesSizeMax, 0.5);
  assert.equal(getHook().originSize, 0.4);

  await act(async () => {
    root.unmount();
  });
  geometry.dispose();
  material.dispose();
  dom.window.close();
});

test('paint tool state switches back to select when the paint panel closes', async () => {
  const { root, getHook } = await mountControllerWithProps({
    active: false,
  });

  try {
    assert.equal(getHook().paintColor, '#ff6c0a');
    assert.equal(getHook().paintStatus, null);
    assert.deepEqual(getHook().paintInteractionRef.current, {
      color: '#ff6c0a',
      operation: 'paint',
      selectionScope: 'island',
    });

    await act(async () => {
      getHook().handleToolModeChange('paint');
      getHook().setPaintColor('#123456');
      getHook().setPaintOperation('erase');
      getHook().setPaintSelectionScope('face');
      getHook().setPaintStatus({ tone: 'success', message: 'painted' });
    });

    assert.equal(getHook().toolMode, 'paint');
    assert.deepEqual(getHook().paintInteractionRef.current, {
      color: '#123456',
      operation: 'erase',
      selectionScope: 'face',
    });
    assert.deepEqual(getHook().paintStatus, { tone: 'success', message: 'painted' });

    await act(async () => {
      getHook().handleClosePaintTool();
    });

    assert.equal(getHook().toolMode, 'select');
    assert.equal(getHook().paintStatus, null);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('handleHoverWrapper forwards renderer hover without writing canonical selection state', async () => {
  const forwarded: Array<{
    type: 'link' | 'joint' | 'tendon' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: string;
    highlightObjectId?: number;
  }> = [];
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    onHover: (type, id, subType, objectIndex, helperKind, highlightObjectId) => {
      forwarded.push({ type, id, subType, objectIndex, helperKind, highlightObjectId });
    },
  });

  try {
    await act(async () => {
      getHook().handleHoverWrapper('link', 'base_link', 'visual', 2);
    });

    assert.deepEqual(forwarded, [
      {
        type: 'link',
        id: 'base_link',
        subType: 'visual',
        objectIndex: 2,
        helperKind: undefined,
        highlightObjectId: undefined,
      },
    ]);

    await act(async () => {
      getHook().handleHoverWrapper(null, null);
    });

    assert.deepEqual(forwarded[1], {
      type: null,
      id: null,
      subType: undefined,
      objectIndex: undefined,
      helperKind: undefined,
      highlightObjectId: undefined,
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('handleRuntimeJointAngleChange publishes live closed-loop preview compensation before commit', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emittedChanges: Array<[string, number]> = [];
  const dom = installDom();
  const { root, getHook } = await mountControllerWithDom(
    {
      active: false,
      closedLoopRobotState,
      syncJointChangesToApp: true,
      onJointChange: (jointName, angle) => {
        emittedChanges.push([jointName, angle]);
      },
    },
    dom,
  );

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleRuntimeJointAngleChange('joint_a', 0.42);
      await nextAnimationFrame(dom);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);

    const preview = useJointInteractionPreviewStore.getState().preview;
    assert.equal(preview.source, 'viewer');
    assert.equal(preview.activeJointId, 'joint_a');
    assertAlmostEqual(preview.jointAngles.joint_a, 0.42);
    assertAlmostEqual(preview.jointAngles.joint_b, 0.42);

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.42);
    });

    assert.deepEqual(
      emittedChanges.map(([name, angle]) => [name, Number(angle.toFixed(2))]),
      [['joint_a', 0.42]],
    );

    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );
  } finally {
    useJointInteractionPreviewStore.getState().clearPreview();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRuntimeJointChangeCommit emits the active joint after local closed-loop compensation', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emittedChanges: Array<[string, number]> = [];
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState,
    syncJointChangesToApp: true,
    onJointChange: (jointName, angle) => {
      emittedChanges.push([jointName, angle]);
    },
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    runtimeRobot.joints.joint_a.setJointValue(0.55);

    await act(async () => {
      await getHook().handleRuntimeJointChangeCommit('joint_a', 0.55);
    });

    assert.deepEqual(
      emittedChanges.map(([name, angle]) => [name, Number(angle.toFixed(2))]),
      [['joint_a', 0.55]],
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('handleRobotLoaded sanitizes runtime Three.js quaternions before closed-loop preview cloning', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  runtimeRobot.joints.joint_a.quaternion = new THREE.Quaternion(
    0,
    0.5,
    0,
    0.8660254,
  );
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const mergedQuaternion = getHook().closedLoopRobotState?.joints.joint_a?.quaternion;
    assert.deepEqual(mergedQuaternion, {
      x: 0,
      y: 0.5,
      z: 0,
      w: 0.8660254,
    });
    assert.equal(Object.getPrototypeOf(mergedQuaternion), Object.prototype);
    assert.notEqual(mergedQuaternion, runtimeRobot.joints.joint_a.quaternion);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRobotLoaded stores runtime ball joint motion quaternion in RobotState', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  runtimeRobot.joints.joint_a.jointQuaternion = new THREE.Quaternion(
    0,
    0.5,
    0,
    0.8660254,
  );
  runtimeRobot.joints.joint_a.quaternion = new THREE.Quaternion(
    0.1,
    0.6,
    0.2,
    0.7,
  );
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const mergedQuaternion = getHook().closedLoopRobotState?.joints.joint_a?.quaternion;
    assert.deepEqual(mergedQuaternion, {
      x: 0,
      y: 0.5,
      z: 0,
      w: 0.8660254,
    });
    assert.equal(Object.getPrototypeOf(mergedQuaternion), Object.prototype);
    assert.notEqual(mergedQuaternion, runtimeRobot.joints.joint_a.jointQuaternion);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('closedLoopRobotState sanitizes runtime-shaped joints before preview session cloning', async () => {
  const runtimeClosedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeLikeJoint = {
    ...runtimeClosedLoopRobotState.joints.joint_a,
    quaternion: new THREE.Quaternion(0, 0.25, 0, 0.9682458),
    setJointValue(this: { angle?: number }, angle: number) {
      this.angle = angle;
    },
  } as unknown as RobotState['joints'][string];

  const { dom, root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: {
      ...runtimeClosedLoopRobotState,
      joints: {
        ...runtimeClosedLoopRobotState.joints,
        joint_a: runtimeLikeJoint,
      },
    },
  });

  try {
    const previewRobotState = getHook().closedLoopRobotState;
    assert.ok(previewRobotState);
    assert.doesNotThrow(() => structuredClone(previewRobotState));
    assert.deepEqual(previewRobotState.joints.joint_a?.quaternion, {
      x: 0,
      y: 0.25,
      z: 0,
      w: 0.9682458,
    });
    assert.equal(
      'setJointValue' in (previewRobotState.joints.joint_a as unknown as Record<string, unknown>),
      false,
    );
    assert.equal(Object.getPrototypeOf(previewRobotState.joints.joint_a), Object.prototype);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRuntimeJointAnglesChange keeps USD drag previews local until the drag ends', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const committedJointChanges: Array<{
    jointName: string;
    angle: number;
    context?: { jointAngles?: Record<string, number> };
  }> = [];
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    onJointChange: (jointName, angle, context) => {
      committedJointChanges.push({ jointName, angle, context });
    },
    syncJointChangesToApp: true,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().setIsDragging(true);
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.35 });
    });

    assert.deepEqual(committedJointChanges, []);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.35);

    await act(async () => {
      getHook().setIsDragging(false);
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.45 });
    });

    assert.deepEqual(committedJointChanges, [
      {
        jointName: 'joint_a',
        angle: 0.45,
        context: { jointAngles: { joint_a: 0.45 } },
      },
    ]);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.45);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.45);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('tree-panel joint preview updates the runtime immediately and does not snap back on clear', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  let refreshCount = 0;
  const { dom, root, getHook } = await mountControllerWithProps({
    active: false,
    jointAngleState: { joint_a: 0 },
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
      getHook().registerSceneRefresh(() => {
        refreshCount += 1;
      });
    });
    refreshCount = 0;

    await act(async () => {
      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'tree-panel',
        dragSessionId: 'tree-test',
        activeJointId: 'joint_a',
        jointAngles: { joint_a: 0.62 },
        jointQuaternions: {},
        jointOrigins: {},
      });
      await nextAnimationFrame(dom);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.62);
    assert.equal(refreshCount, 1);

    await act(async () => {
      useJointInteractionPreviewStore.getState().clearPreview({
        source: 'tree-panel',
        dragSessionId: 'tree-test',
      });
      await nextAnimationFrame(dom);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.62);
    assert.equal(refreshCount, 1);
  } finally {
    useJointInteractionPreviewStore.getState().clearPreview();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('tree-panel joint preview shields runtime from stale external joint motion props', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { dom, root, getHook, rerender } = await mountControllerWithProps({
    active: false,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'tree-panel',
        dragSessionId: 'tree-test',
        activeJointId: 'joint_a',
        jointAngles: { joint_a: 0.62 },
        jointQuaternions: {},
        jointOrigins: {},
      });
      await nextAnimationFrame(dom);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.62);

    await rerender({
      active: false,
      jointMotionState: { joint_a: { angle: 0 } },
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.62);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.62);
  } finally {
    useJointInteractionPreviewStore.getState().clearPreview();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRuntimeJointAnglesChange keeps closed-loop runtime drags local while worker preview catches up', async () => {
  ControlledClosedLoopPreviewMockWorker.reset();
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const dom = installDom(ControlledClosedLoopPreviewMockWorker);
  const { root, getHook } = await mountControllerWithDom(
    {
      active: false,
      closedLoopRobotState,
    },
    dom,
  );

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().setIsDragging(true);
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.2 });
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 1);
    let panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.2);
    assertAlmostEqual(panelAngles.joint_b, 0);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);

    await act(async () => {
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.42 });
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 2);
    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.2);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
  } finally {
    ControlledClosedLoopPreviewMockWorker.reset();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('previewIkJointKinematics keeps the IK drag preview out of the joint panel store', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointAngleState: { joint_a: 0 },
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.35 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('clearIkJointKinematicsPreview restores the latest committed joint baseline', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.3);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.3);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.65 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.65);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.3);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('getInitialJointAnglesForNextLoad seeds same-scope reloads from the current pose', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const reloadedRuntimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointStateScopeKey: 'demo.urdf',
  });

  try {
    assert.deepEqual(getHook().getInitialJointAnglesForNextLoad(), {});

    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    assert.deepEqual(getHook().getInitialJointAnglesForNextLoad(), { joint_a: 0 });

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.47);
    });

    const initialAnglesForReload = getHook().getInitialJointAnglesForNextLoad();
    assertAlmostEqual(initialAnglesForReload.joint_a, 0.47);

    await act(async () => {
      getHook().handleRobotLoaded(reloadedRuntimeRobot);
    });

    assertAlmostEqual(reloadedRuntimeRobot.joints.joint_a?.angle, 0.47);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.47);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('committed IK joint kinematics become the baseline restored after preview clear', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointAngleState: { joint_a: 0 },
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.35 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0);

    await act(async () => {
      getHook().commitIkJointKinematics({ joint_a: 0.35 }, {});
    });

    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.35);

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.7 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.35);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('local joint commits are not overwritten by stale external joint motion props', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emitted: Array<[string, number]> = [];
  const staleMotionState = {
    joint_a: { angle: 0 },
    joint_b: { angle: 0 },
  };
  const { root, getHook, rerender } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState,
    jointMotionState: staleMotionState,
    syncJointChangesToApp: true,
    onJointChange: (jointName, angle) => {
      emitted.push([jointName, angle]);
    },
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.42);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
    assert.deepEqual(
      emitted.map(([jointName]) => jointName),
      ['joint_a'],
    );
    assertAlmostEqual(emitted[0]?.[1], 0.42);

    await rerender({
      active: false,
      closedLoopRobotState,
      jointMotionState: {
        joint_a: { angle: 0 },
        joint_b: { angle: 0 },
      },
      syncJointChangesToApp: true,
      onJointChange: (jointName, angle) => {
        emitted.push([jointName, angle]);
      },
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.42);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_b, 0.42);

    await rerender({
      active: false,
      closedLoopRobotState,
      jointMotionState: {
        joint_a: { angle: 0.42 },
        joint_b: { angle: 0.42 },
      },
      syncJointChangesToApp: true,
      onJointChange: (jointName, angle) => {
        emitted.push([jointName, angle]);
      },
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('closedLoopRobotState keeps the runtime-loaded joint pose when external joint motion state is empty', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  runtimeRobot.joints.joint_a.setJointValue(0.25);
  runtimeRobot.joints.joint_b.setJointValue(-0.85);

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState,
    jointMotionState: {},
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const resolvedClosedLoopRobotState = getHook().closedLoopRobotState;
    assert.ok(resolvedClosedLoopRobotState);
    assertAlmostEqual(resolvedClosedLoopRobotState.joints.joint_a?.angle, 0.25);
    assertAlmostEqual(resolvedClosedLoopRobotState.joints.joint_b?.angle, -0.85);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('closedLoopRobotState converts runtime motion angles back to referenced actual angles', async () => {
  const robotState = createSimpleRobotFixture();
  robotState.joints.joint_a.referencePosition = 0.4;
  robotState.joints.joint_a.angle = 0.4;
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  runtimeRobot.joints.joint_a.setJointValue(0.2);

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: robotState,
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const resolvedClosedLoopRobotState = getHook().closedLoopRobotState;
    assert.ok(resolvedClosedLoopRobotState);
    assertAlmostEqual(resolvedClosedLoopRobotState.joints.joint_a?.angle, 0.6);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('empty jointMotionState does not clear the runtime baseline used by IK preview reset', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  runtimeRobot.joints.joint_a.setJointValue(0.2);

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointMotionState: {},
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.2);

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.65 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.65);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.2);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('runtime joint drag handlers convert motion angles before applying referenced joints', async () => {
  const robotState = createSimpleRobotFixture();
  robotState.joints.joint_a.referencePosition = 0.4;
  robotState.joints.joint_a.angle = 0.4;
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const runtimeAngles: number[] = [];
  runtimeRobot.joints.joint_a.setJointValue = function setJointValue(angle: number) {
    runtimeAngles.push(angle);
    this.angle = angle;
    this.jointValue = angle;
  };

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: robotState,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleRuntimeJointAngleChange('joint_a', 0.2);
    });

    assertAlmostEqual(runtimeAngles.at(-1), 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.6);

    await act(async () => {
      await getHook().handleRuntimeJointChangeCommit('joint_a', 0.2);
    });

    assertAlmostEqual(runtimeAngles.at(-1), 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.6);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('actual joint change handlers apply referenced joints in runtime motion space', async () => {
  const robotState = createSimpleRobotFixture();
  robotState.joints.joint_a.referencePosition = 0.4;
  robotState.joints.joint_a.angle = 0.4;
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const runtimeAngles: number[] = [];
  runtimeRobot.joints.joint_a.setJointValue = function setJointValue(angle: number) {
    runtimeAngles.push(angle);
    this.angle = angle;
    this.jointValue = angle;
  };

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: robotState,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointAngleChange('joint_a', 0.6);
    });

    assertAlmostEqual(runtimeAngles.at(-1), 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.6);

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.6);
    });

    assertAlmostEqual(runtimeAngles.at(-1), 0.2);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.6);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('external joint motion state is converted from actual angle to runtime motion angle', async () => {
  const robotState = createSimpleRobotFixture();
  robotState.joints.joint_a.referencePosition = 0.4;
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const runtimeAngles: number[] = [];
  runtimeRobot.joints.joint_a.setJointValue = function setJointValue(angle: number) {
    runtimeAngles.push(angle);
    this.angle = angle;
    this.jointValue = angle;
  };

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: robotState,
    jointMotionState: { joint_a: { angle: 0.9 } },
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    assertAlmostEqual(runtimeAngles.at(-1), 0.5);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.5);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.9);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('setIsDragging freezes hover updates without clearing the visible hover for active viewers', async () => {
  resetSelectionStore();
  const { root, getHook } = await mountControllerWithProps({
    active: true,
  });

  try {
    useSelectionStore.getState().setHoveredSelection({
      entity: { type: 'link', componentId: 'component_1', entityId: 'base_link' },
      subType: 'visual',
      objectIndex: 0,
    });

    await act(async () => {
      getHook().setIsDragging(true);
    });

    let selectionState = useSelectionStore.getState();
    assert.equal(selectionState.hoverFrozen, true);
    assert.deepEqual(selectionState.hoveredSelection, {
      entity: { type: 'link', componentId: 'component_1', entityId: 'base_link' },
      subType: 'visual',
      objectIndex: 0,
    });
    assert.deepEqual(selectionState.deferredHoveredSelection, {
      entity: { type: 'link', componentId: 'component_1', entityId: 'base_link' },
      subType: 'visual',
      objectIndex: 0,
    });

    await act(async () => {
      getHook().setIsDragging(false);
    });

    selectionState = useSelectionStore.getState();
    assert.equal(selectionState.hoverFrozen, false);
  } finally {
    resetSelectionStore();
    await act(async () => {
      root.unmount();
    });
  }
});

test('inactive viewer cleanup does not release another viewer hover freeze owner', async () => {
  resetSelectionStore();
  const primaryViewer = Symbol('primary-viewer');
  useSelectionStore.getState().setHoverFrozen(primaryViewer, true);
  const { root } = await mountControllerWithProps({ active: false });

  try {
    assert.equal(useSelectionStore.getState().interactionHoverFrozen, true);
    assert.deepEqual(
      [...useSelectionStore.getState().interactionHoverFreezeOwners],
      [primaryViewer],
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }

  assert.equal(useSelectionStore.getState().interactionHoverFrozen, true);
  useSelectionStore.getState().setHoverFrozen(primaryViewer, false);
});

test('handleJointAngleChange batches closed-loop slider preview into one frame-aligned update', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointAngleChange('joint_a', 0.42);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assert.deepEqual(getHook().jointPanelStore.getSnapshot().jointAngles, {
      joint_a: 0,
      joint_b: 0,
    });

    await act(async () => {
      await nextAnimationFrame(dom);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleJointAngleChange keeps closed-loop direct drags local while worker preview catches up', async () => {
  ControlledClosedLoopPreviewMockWorker.reset();
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emittedChanges: Array<{
    jointName: string;
    angle: number;
    context?: {
      jointAngles?: Record<string, number>;
      jointQuaternions?: Record<string, JointQuaternion>;
    };
  }> = [];
  const dom = installDom(ControlledClosedLoopPreviewMockWorker);
  const { root, getHook } = await mountControllerWithDom(
    {
      active: false,
      closedLoopRobotState,
      syncJointChangesToApp: true,
      onJointChange: (jointName, angle, context) => {
        emittedChanges.push({ jointName, angle, context });
      },
    },
    dom,
  );

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().setIsDragging(true);
      runtimeRobot.joints.joint_a.setJointValue(0.42);
      getHook().handleJointAngleChange('joint_a', 0.42);
      await nextAnimationFrame(dom);
    });

    let panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 1);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0);

    await act(async () => {
      runtimeRobot.joints.joint_a.setJointValue(0.55);
      getHook().handleJointAngleChange('joint_a', 0.55);
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 2);
    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.55);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assertAlmostEqual(panelAngles.joint_a, 0.55);
    assertAlmostEqual(panelAngles.joint_b, 0);

    await act(async () => {
      runtimeRobot.joints.joint_a.setJointValue(0.7);
      getHook().handleJointAngleChange('joint_a', 0.7);
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 2);
    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0.42);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.55);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0.55);

    await act(async () => {
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 1);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.7);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0.7);

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 0.7);
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.7);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0.7);
    assert.equal(emittedChanges.length, 1);
    assert.equal(emittedChanges[0]?.jointName, 'joint_a');
    assertAlmostEqual(emittedChanges[0]?.angle, 0.7);
    assertAlmostEqual(emittedChanges[0]?.context?.jointAngles?.joint_a, 0.7);
    assertAlmostEqual(emittedChanges[0]?.context?.jointAngles?.joint_b, 0.7);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.7);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.7);
    assertAlmostEqual(panelAngles.joint_a, 0.7);
    assertAlmostEqual(panelAngles.joint_b, 0.7);
  } finally {
    ControlledClosedLoopPreviewMockWorker.reset();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleJointChangeCommit keeps local closed-loop state when worker commit solve fails', async () => {
  ControlledClosedLoopPreviewMockWorker.reset();
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emittedChanges: Array<{
    jointName: string;
    angle: number;
    context?: {
      jointAngles?: Record<string, number>;
      jointQuaternions?: Record<string, JointQuaternion>;
    };
  }> = [];
  const dom = installDom(ControlledClosedLoopPreviewMockWorker);
  const { root, getHook } = await mountControllerWithDom(
    {
      active: false,
      closedLoopRobotState,
      syncJointChangesToApp: true,
      onJointChange: (jointName, angle, context) => {
        emittedChanges.push({ jointName, angle, context });
      },
    },
    dom,
  );
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    let commitPromise: Promise<void> | null = null as Promise<void> | null;
    await act(async () => {
      commitPromise = getHook().handleJointChangeCommit('joint_a', 0.73);
      await Promise.resolve();
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 1);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.rejectNext();
      await commitPromise;
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.73);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assert.equal(emittedChanges.length, 1);
    assert.equal(emittedChanges[0]?.jointName, 'joint_a');
    assertAlmostEqual(emittedChanges[0]?.angle, 0.73);
    assert.deepEqual(emittedChanges[0]?.context?.jointAngles, { joint_a: 0.73 });
    assert.deepEqual(emittedChanges[0]?.context?.jointQuaternions, {});
  } finally {
    console.warn = originalWarn;
    ControlledClosedLoopPreviewMockWorker.reset();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleJointAngleChange projects constrained closed-loop direct drags back onto the runtime joint', async () => {
  ControlledClosedLoopPreviewMockWorker.reset();
  const closedLoopRobotState = createClosedLoopRobotFixture();
  closedLoopRobotState.joints.joint_b = {
    ...closedLoopRobotState.joints.joint_b,
    limit: { lower: -0.5, upper: 0.5, effort: 1, velocity: 1 },
  };
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const emittedChanges: Array<{
    angle: number;
    context?: {
      jointAngles?: Record<string, number>;
    };
  }> = [];
  const dom = installDom(ControlledClosedLoopPreviewMockWorker);
  const { root, getHook } = await mountControllerWithDom(
    {
      active: false,
      closedLoopRobotState,
      syncJointChangesToApp: true,
      onJointChange: (_jointName, angle, context) => {
        emittedChanges.push({ angle, context });
      },
    },
    dom,
  );

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().setIsDragging(true);
      runtimeRobot.joints.joint_a.setJointValue(1.2);
      getHook().handleJointAngleChange('joint_a', 1.2);
      await nextAnimationFrame(dom);
    });

    assert.equal(ControlledClosedLoopPreviewMockWorker.requests.length, 1);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 1.2, 1e-3);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0, 1e-3);
    let panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 1.2, 1e-3);
    assertAlmostEqual(panelAngles.joint_b, 0, 1e-3);

    await act(async () => {
      ControlledClosedLoopPreviewMockWorker.resolveNext();
      await Promise.resolve();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.5, 1e-3);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.5, 1e-3);
    panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.5, 1e-3);
    assertAlmostEqual(panelAngles.joint_b, 0.5, 1e-3);

    await act(async () => {
      await getHook().handleJointChangeCommit('joint_a', 1.2);
    });

    assert.equal(emittedChanges.length, 1);
    assertAlmostEqual(emittedChanges[0]?.angle, 0.5, 1e-3);
    assertAlmostEqual(emittedChanges[0]?.context?.jointAngles?.joint_a, 0.5, 1e-3);
    assertAlmostEqual(emittedChanges[0]?.context?.jointAngles?.joint_b, 0.5, 1e-3);
  } finally {
    ControlledClosedLoopPreviewMockWorker.reset();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleJointAngleChange expands mimic-coupled joints before commit', async () => {
  const robotState = createMimicRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountController(robotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointAngleChange('follower_joint', 0.3);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.leader_joint, -0.1);
    assertAlmostEqual(panelAngles.follower_joint, 0.3);
    assertAlmostEqual(runtimeRobot.joints.leader_joint?.angle, -0.1);
    assertAlmostEqual(runtimeRobot.joints.follower_joint?.angle, 0.3);

    const preview = useJointInteractionPreviewStore.getState().preview;
    assert.equal(preview.source, 'viewer');
    assert.equal(preview.activeJointId, 'follower_joint');
    assertAlmostEqual(preview.jointAngles.leader_joint, -0.1);
    assertAlmostEqual(preview.jointAngles.follower_joint, 0.3);

    await act(async () => {
      await getHook().handleJointChangeCommit('follower_joint', 0.3);
    });

    const committedAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(committedAngles.leader_joint, -0.1);
    assertAlmostEqual(committedAngles.follower_joint, 0.3);
    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
