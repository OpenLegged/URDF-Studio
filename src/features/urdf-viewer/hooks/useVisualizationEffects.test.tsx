import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { context as r3fContext } from '@react-three/fiber';
import { create } from 'zustand';

import { useVisualizationEffects } from './useVisualizationEffects.ts';
import { SnapshotRenderStateProvider } from '@/shared/components/3d/scene/SnapshotRenderContext';

function installDom() {
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

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLDivElement?: typeof HTMLDivElement }).HTMLDivElement =
    dom.window.HTMLDivElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, root };
}

function createRobotWithCenterOfMassHelper() {
  const robot = new THREE.Group();
  const link = new THREE.Group();
  link.name = 'base_link';
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;

  const inertiaVisualGroup = new THREE.Group();
  inertiaVisualGroup.name = '__inertia_visual__';
  link.add(inertiaVisualGroup);

  const createHelperRoot = (name: '__com_visual__' | '__inertia_box__') => {
    const helperRoot = new THREE.Group();
    helperRoot.name = name;

    const helperMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
      }),
    );
    helperRoot.add(helperMesh);
    inertiaVisualGroup.add(helperRoot);
    return helperRoot;
  };

  const centerOfMassHelperRoot = createHelperRoot('__com_visual__');
  const inertiaHelperRoot = createHelperRoot('__inertia_box__');

  link.userData.__inertiaVisualGroup = inertiaVisualGroup;
  link.userData.__comVisual = centerOfMassHelperRoot;
  link.userData.__inertiaBox = inertiaHelperRoot;
  robot.add(link);

  const robotLinks = {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visible: true,
      visual: { visible: true },
      collision: { visible: true },
      inertial: {
        mass: 1,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
      },
    },
  } as any;

  return { robot, centerOfMassHelperRoot, inertiaHelperRoot, robotLinks };
}

function createRobotWithJointOwnedOriginAxes() {
  const robot = new THREE.Group();

  const joint = new THREE.Group() as THREE.Group & { isURDFJoint?: boolean };
  joint.isURDFJoint = true;
  joint.name = 'hip_joint';

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'child_link';

  joint.add(link);
  robot.add(joint);

  return { robot, link };
}

test('helper-only selection changes still refresh helper interaction state for the same link', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, centerOfMassHelperRoot, inertiaHelperRoot, robotLinks } =
    createRobotWithCenterOfMassHelper();

  await renderHarness(root, robot, {
    robotLinks,
    selection: {
      type: 'link',
      id: 'base_link',
      helperKind: 'center-of-mass',
    },
  });

  assert.ok(centerOfMassHelperRoot.scale.x > 1, 'CoM helper should be selected initially');
  assert.equal(inertiaHelperRoot.scale.x, 1);

  await renderHarness(root, robot, {
    robotLinks,
    selection: {
      type: 'link',
      id: 'base_link',
      helperKind: 'inertia',
    },
  });

  assert.equal(centerOfMassHelperRoot.scale.x, 1, 'previous helper selection should be cleared');
  assert.ok(inertiaHelperRoot.scale.x > 1, 'new helper selection should become active');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

const useR3fStore = create(() => ({
  invalidate: () => {},
  internal: {
    subscribe: () => () => {},
  },
}));

function VisualizationEffectsProbe({
  robot,
  selection,
  hoveredSelection,
  showCollision = false,
  showVisual = true,
  showCenterOfMass = false,
  showInertia = false,
  showInertiaOverlay = true,
  showIkHandles = false,
  showOrigins = false,
  showMjcfSites = false,
  robotLinks,
  linkMeshMapRef,
  onHighlightGeometry,
}: {
  robot: THREE.Object3D;
  selection?: {
    type: 'link' | 'joint' | 'tendon' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: 'center-of-mass' | 'inertia' | 'origin-axes' | 'joint-axis' | 'ik-handle';
    highlightObjectId?: number;
  };
  hoveredSelection?: {
    type: 'link' | 'joint' | 'tendon' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: 'center-of-mass' | 'inertia' | 'origin-axes' | 'joint-axis' | 'ik-handle';
    highlightObjectId?: number;
  };
  showCollision?: boolean;
  showVisual?: boolean;
  showCenterOfMass?: boolean;
  showInertia?: boolean;
  showInertiaOverlay?: boolean;
  showIkHandles?: boolean;
  showOrigins?: boolean;
  showMjcfSites?: boolean;
  robotLinks?: Record<string, any>;
  linkMeshMapRef?: React.RefObject<Map<string, THREE.Mesh[]>>;
  onHighlightGeometry?: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => void;
}) {
  const highlightedMeshesRef = useRef(new Map());

  const { syncHoverHighlight } = useVisualizationEffects({
    robot,
    robotVersion: 1,
    showCollision,
    showVisual,
    showCollisionAlwaysOnTop: true,
    showInertia,
    showInertiaOverlay,
    showIkHandles,
    showCenterOfMass,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
    showOrigins,
    showOriginsOverlay: true,
    originSize: 1,
    showMjcfSites,
    showJointAxes: false,
    showJointAxesOverlay: true,
    jointAxisSize: 1,
    modelOpacity: 1,
    sourceFormat: 'urdf',
    showMjcfWorldLink: true,
    robotLinks,
    selection,
    highlightGeometry: onHighlightGeometry ?? (() => {}),
    highlightedMeshesRef,
    linkMeshMapRef,
  });

  useEffect(() => {
    syncHoverHighlight(hoveredSelection);
  }, [
    hoveredSelection?.helperKind,
    hoveredSelection?.id,
    hoveredSelection?.objectIndex,
    hoveredSelection?.subType,
    hoveredSelection?.type,
    hoveredSelection?.highlightObjectId,
    syncHoverHighlight,
  ]);

  return null;
}

function Harness({
  robot,
  selection,
  showCollision = false,
  showVisual = true,
  showCenterOfMass = false,
  showInertia = false,
  showInertiaOverlay = true,
  showIkHandles = false,
  showOrigins = false,
  showMjcfSites = false,
  robotLinks,
  linkMeshMapRef,
  hoveredSelection,
  onHighlightGeometry,
  snapshotRenderActive = false,
}: Parameters<typeof VisualizationEffectsProbe>[0] & { snapshotRenderActive?: boolean }) {
  return React.createElement(
    r3fContext.Provider,
    { value: useR3fStore as unknown as React.ContextType<typeof r3fContext> },
    React.createElement(
      SnapshotRenderStateProvider,
      {
        value: {
          snapshotRenderActive,
          setSnapshotRenderActive: () => {},
        },
      },
      React.createElement(VisualizationEffectsProbe, {
        robot,
        selection,
        hoveredSelection,
        showCollision,
        showVisual,
        showCenterOfMass,
        showInertia,
        showInertiaOverlay,
        showIkHandles,
        showOrigins,
        showMjcfSites,
        robotLinks,
        linkMeshMapRef,
        onHighlightGeometry,
      }),
    ),
  );
}

async function renderHarness(
  root: Root,
  robot: THREE.Object3D,
  options: Omit<Parameters<typeof Harness>[0], 'robot'> = {},
) {
  await act(async () => {
    root.render(React.createElement(Harness, { robot, ...options }));
  });
}

test('snapshot rendering hides URDF helper overlays even when their toggles are enabled', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, centerOfMassHelperRoot, inertiaHelperRoot, robotLinks } =
    createRobotWithCenterOfMassHelper();

  await renderHarness(root, robot, {
    robotLinks,
    showCenterOfMass: true,
    showInertia: true,
  });

  assert.equal(centerOfMassHelperRoot.visible, true);
  assert.equal(inertiaHelperRoot.visible, true);

  await renderHarness(root, robot, {
    robotLinks,
    showCenterOfMass: true,
    showInertia: true,
    snapshotRenderActive: true,
  });

  assert.equal(centerOfMassHelperRoot.visible, false);
  assert.equal(inertiaHelperRoot.visible, false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('inertia overlay changes refresh existing helper material depth state', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, inertiaHelperRoot, robotLinks } = createRobotWithCenterOfMassHelper();
  const inertiaMesh = inertiaHelperRoot.children[0] as THREE.Mesh;
  const material = inertiaMesh.material as THREE.Material;

  await renderHarness(root, robot, {
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
  });

  assert.equal(material.depthTest, false);
  assert.equal(material.depthWrite, false);
  assert.equal(inertiaMesh.renderOrder, 10001);

  await renderHarness(root, robot, {
    robotLinks,
    showInertia: true,
    showInertiaOverlay: false,
  });

  assert.equal(material.depthTest, true);
  assert.equal(material.depthWrite, false);
  assert.equal(inertiaMesh.renderOrder, 0);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('helper hover keeps helper interaction active without re-highlighting link geometry', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, robotLinks } = createRobotWithCenterOfMassHelper();
  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    subType?: 'visual' | 'collision';
    meshToHighlight?: THREE.Object3D | null | number;
  }> = [];

  await renderHarness(root, robot, {
    robotLinks,
    showCenterOfMass: true,
    hoveredSelection: {
      type: 'link',
      id: 'base_link',
      helperKind: 'center-of-mass',
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  assert.deepEqual(highlightCalls, []);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('clearing a geometry selection removes the selection outline owner', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, robotLinks } = createRobotWithCenterOfMassHelper();
  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    intent?: 'hover' | 'selection';
  }> = [];
  const onHighlightGeometry = (
    linkName: string | null,
    revert: boolean,
    _subType?: 'visual' | 'collision',
    _meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => {
    highlightCalls.push({ linkName, revert, intent });
  };

  await renderHarness(root, robot, {
    robotLinks,
    selection: {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
    },
    onHighlightGeometry,
  });

  highlightCalls.length = 0;
  await renderHarness(root, robot, {
    robotLinks,
    onHighlightGeometry,
  });

  assert.deepEqual(
    highlightCalls.find((call) => call.revert),
    {
      linkName: 'base_link',
      revert: true,
      intent: 'selection',
    },
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint-owned origin-axis hover activates the child link helper highlight', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, link } = createRobotWithJointOwnedOriginAxes();

  await renderHarness(root, robot, {
    showOrigins: true,
    hoveredSelection: {
      type: 'joint',
      id: 'hip_joint',
      helperKind: 'origin-axes',
    },
  });

  const originAxes = link.userData.__originAxes as THREE.Object3D | undefined;
  assert.ok(originAxes, 'origin axes helper should be created for the child link');
  const originMesh = originAxes.children.find((child: any) => child.isMesh) as THREE.Mesh;
  assert.ok(originMesh, 'origin axes helper should include a mesh child');
  assert.notEqual(
    (originMesh.material as THREE.MeshBasicMaterial).color.getHex(),
    0xef4444,
    'joint-owned origin axes should still receive hover highlight on the child link helper',
  );
  assert.equal(originAxes.scale.x, 1, 'origin-axis hover should keep helper scale stable');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('origin-axis selection keeps helper interaction active without selecting link geometry', async () => {
  const { dom, root } = createComponentRoot();
  const { robot, link } = createRobotWithJointOwnedOriginAxes();
  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    subType?: 'visual' | 'collision';
    meshToHighlight?: THREE.Object3D | null | number;
  }> = [];

  await renderHarness(root, robot, {
    showOrigins: true,
    selection: {
      type: 'link',
      id: 'child_link',
      helperKind: 'origin-axes',
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  const originAxes = link.userData.__originAxes as THREE.Object3D | undefined;
  assert.ok(originAxes, 'origin axes helper should be created for the child link');
  const originMesh = originAxes.children.find((child: any) => child.isMesh) as THREE.Mesh;
  assert.ok(originMesh, 'origin axes helper should include a mesh child');
  assert.notEqual(
    (originMesh.material as THREE.MeshBasicMaterial).color.getHex(),
    0xef4444,
    'origin axes helper should still reflect selected helper state',
  );
  assert.deepEqual(highlightCalls, []);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('geometry hover keeps per-object tendon highlights when the hovered target object changes', async () => {
  const { dom, root } = createComponentRoot();
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  robot.add(link);

  const firstTendonSegment = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  const secondTendonSegment = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  link.add(firstTendonSegment);
  link.add(secondTendonSegment);

  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    subType?: 'visual' | 'collision';
    meshToHighlight?: THREE.Object3D | null | number;
  }> = [];

  await renderHarness(root, robot, {
    hoveredSelection: {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
      highlightObjectId: firstTendonSegment.id,
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  await renderHarness(root, robot, {
    hoveredSelection: {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
      highlightObjectId: secondTendonSegment.id,
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  const applyCalls = highlightCalls.filter((call) => call.revert === false);
  assert.ok(applyCalls.length >= 2);
  assert.equal(applyCalls.at(-2)?.meshToHighlight, firstTendonSegment);
  assert.equal(applyCalls.at(-1)?.meshToHighlight, secondTendonSegment);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('tendon hover highlights the whole tendon visualization object', async () => {
  const { dom, root } = createComponentRoot();
  const robot = new THREE.Group();
  const tendonGroup = new THREE.Group();
  tendonGroup.name = '__mjcf_tendon__:finger_tendon';
  tendonGroup.userData.isMjcfTendon = true;
  tendonGroup.userData.mjcfTendonName = 'finger_tendon';
  const tendonSegment = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  tendonSegment.userData.isMjcfTendon = true;
  tendonSegment.userData.mjcfTendonName = 'finger_tendon';
  tendonGroup.add(tendonSegment);
  robot.add(tendonGroup);

  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    subType?: 'visual' | 'collision';
    meshToHighlight?: THREE.Object3D | null | number;
  }> = [];

  await renderHarness(root, robot, {
    hoveredSelection: {
      type: 'tendon',
      id: 'finger_tendon',
      highlightObjectId: tendonSegment.id,
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  const applyCall = highlightCalls.find((call) => call.revert === false);
  assert.ok(applyCall);
  assert.equal(applyCall.linkName, 'finger_tendon');
  assert.equal(applyCall.subType, 'visual');
  assert.equal(applyCall.meshToHighlight, tendonGroup);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('tendon selection resolves its visualization object even without a hover object id', async () => {
  const { dom, root } = createComponentRoot();
  const robot = new THREE.Group();
  const tendonGroup = new THREE.Group();
  tendonGroup.name = '__mjcf_tendon__:finger_tendon';
  tendonGroup.userData.isMjcfTendon = true;
  tendonGroup.userData.mjcfTendonName = 'finger_tendon';
  robot.add(tendonGroup);

  const highlightCalls: Array<{
    linkName: string | null;
    revert: boolean;
    subType?: 'visual' | 'collision';
    meshToHighlight?: THREE.Object3D | null | number;
  }> = [];

  await renderHarness(root, robot, {
    selection: {
      type: 'tendon',
      id: 'finger_tendon',
    },
    onHighlightGeometry: (linkName, revert, subType, meshToHighlight) => {
      highlightCalls.push({ linkName, revert, subType, meshToHighlight });
    },
  });

  const applyCall = highlightCalls.find((call) => call.revert === false);
  assert.ok(applyCall);
  assert.equal(applyCall.linkName, 'finger_tendon');
  assert.equal(applyCall.subType, 'visual');
  assert.equal(applyCall.meshToHighlight, tendonGroup);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visibility sync rebuilds collision pick targets when collisions are enabled after initial visual-only load', async () => {
  const { dom, root } = createComponentRoot();
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const visualGroup = new THREE.Group() as THREE.Group & { isURDFVisual?: boolean };
  visualGroup.isURDFVisual = true;
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );
  visualMesh.userData.parentLinkName = 'base_link';
  visualGroup.add(visualMesh);

  const collisionGroup = new THREE.Group();
  collisionGroup.userData.isCollisionGroup = true;
  collisionGroup.userData.parentLinkName = 'base_link';
  collisionGroup.visible = false;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  collisionGroup.add(collisionMesh);

  link.add(visualGroup);
  link.add(collisionGroup);
  robot.add(link);

  const linkMeshMapRef = {
    current: new Map<string, THREE.Mesh[]>([['base_link:visual', [visualMesh]]]),
  } as React.RefObject<Map<string, THREE.Mesh[]>>;

  await renderHarness(root, robot, {
    linkMeshMapRef,
    showCollision: false,
    showCenterOfMass: false,
    showInertia: false,
  });

  assert.equal(linkMeshMapRef.current.has('base_link:collision'), false);

  await renderHarness(root, robot, {
    linkMeshMapRef,
    showCollision: true,
    showCenterOfMass: false,
    showInertia: false,
  });

  assert.deepEqual(linkMeshMapRef.current.get('base_link:collision'), [collisionMesh]);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.isCollisionMesh, true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
