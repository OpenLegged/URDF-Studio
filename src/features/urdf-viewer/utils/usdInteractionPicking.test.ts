import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import {
  resolvePreferredUsdGeometryRole,
  resolveUsdHelperHit,
  sortUsdInteractionCandidates,
  type UsdInteractionCandidate,
} from './usdInteractionPicking.ts';

function createResolution(): ViewerRobotDataResolution {
  return {
    robotData: {
      name: 'robot',
      links: {},
      joints: {},
      rootLinkId: '',
    },
    stageSourcePath: null,
    linkIdByPath: {
      '/robot/base_link': 'base_link',
      '/robot/leg_link': 'leg_link',
    },
    linkPathById: {
      base_link: '/robot/base_link',
      leg_link: '/robot/leg_link',
    },
    jointPathById: {
      hip_joint: '/robot/hip_joint',
    },
    childLinkPathByJointId: {
      hip_joint: '/robot/leg_link',
    },
    parentLinkPathByJointId: {
      hip_joint: '/robot/base_link',
    },
  };
}

function createHelperRoot(name: string, userData: Record<string, unknown>): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    ...userData,
  };
  return group;
}

function createHelperMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  mesh.userData = {
    isGizmo: true,
    isSelectableHelper: true,
  };
  return mesh;
}

test('resolveUsdHelperHit maps link helpers back to the owning link id', () => {
  const resolution = createResolution();
  const helperRoot = createHelperRoot('__origin_axes__', {
    viewerHelperKind: 'origin-axes',
    usdLinkPath: '/robot/base_link',
  });
  const helperMesh = createHelperMesh();
  helperRoot.add(helperMesh);

  const resolved = resolveUsdHelperHit(helperMesh, resolution);

  assert.deepEqual(resolved, {
    type: 'link',
    id: 'base_link',
    helperKind: 'origin-axes',
    layer: 'origin-axes',
  });
});

test('resolveUsdHelperHit maps joint-axis helpers back to the owning joint id', () => {
  const resolution = createResolution();
  const helperRoot = createHelperRoot('__joint_axis__', {
    viewerHelperKind: 'joint-axis',
    usdLinkPath: '/robot/leg_link',
    usdJointId: 'hip_joint',
  });
  const helperMesh = createHelperMesh();
  helperRoot.add(helperMesh);

  const resolved = resolveUsdHelperHit(helperMesh, resolution);

  assert.deepEqual(resolved, {
    type: 'joint',
    id: 'hip_joint',
    helperKind: 'joint-axis',
    layer: 'joint-axis',
  });
});

test('sortUsdInteractionCandidates lets explicit helper priority override nearer collision hits', () => {
  const helperRoot = createHelperRoot('__origin_axes__', {
    viewerHelperKind: 'origin-axes',
    usdLinkPath: '/robot/base_link',
  });
  helperRoot.renderOrder = 999;
  const helperMesh = createHelperMesh();
  helperRoot.add(helperMesh);

  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
  );
  collisionMesh.renderOrder = 10001;

  const candidates: UsdInteractionCandidate<{ id: string }>[] = [
    {
      kind: 'geometry',
      distance: 1,
      layer: 'collision',
      meta: { id: 'collision' },
      object: collisionMesh,
    },
    {
      kind: 'helper',
      distance: 2,
      layer: 'origin-axes',
      object: helperMesh,
      selection: {
        type: 'link',
        id: 'base_link',
        helperKind: 'origin-axes',
        layer: 'origin-axes',
      },
    },
  ];

  const sorted = sortUsdInteractionCandidates(candidates, ['origin-axes', 'collision', 'visual']);

  assert.equal(sorted[0]?.kind, 'helper');
  assert.equal(sorted[0]?.layer, 'origin-axes');
});

test('sortUsdInteractionCandidates respects explicit visual-over-collision priority', () => {
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3366ff }),
  );
  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
  );

  const candidates: UsdInteractionCandidate<{ id: string }>[] = [
    {
      kind: 'geometry',
      distance: 1,
      layer: 'collision',
      meta: { id: 'collision' },
      object: collisionMesh,
    },
    {
      kind: 'geometry',
      distance: 2,
      layer: 'visual',
      meta: { id: 'visual' },
      object: visualMesh,
    },
  ];

  const sorted = sortUsdInteractionCandidates(candidates, ['visual', 'collision']);

  assert.equal(sorted[0]?.kind, 'geometry');
  assert.equal(sorted[0]?.layer, 'visual');
});

test('sortUsdInteractionCandidates keeps foreground geometry ahead of non-overlay inertia helpers', () => {
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3366ff }),
  );
  const inertiaMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.25,
      depthTest: true,
      depthWrite: false,
    }),
  );
  inertiaMesh.renderOrder = 10001;

  const candidates: UsdInteractionCandidate<{ id: string }>[] = [
    {
      kind: 'helper',
      distance: 2,
      layer: 'inertia',
      object: inertiaMesh,
      selection: {
        type: 'link',
        id: 'base_link',
        helperKind: 'inertia',
        layer: 'inertia',
      },
    },
    {
      kind: 'geometry',
      distance: 1,
      layer: 'visual',
      meta: { id: 'visual' },
      object: visualMesh,
    },
  ];

  const sorted = sortUsdInteractionCandidates(candidates, ['inertia', 'visual']);

  assert.equal(sorted[0]?.kind, 'geometry');
  assert.equal(sorted[0]?.layer, 'visual');
});

test('sortUsdInteractionCandidates lets overlay inertia helpers beat geometry behind them', () => {
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3366ff }),
  );
  const inertiaMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.25,
      depthTest: false,
      depthWrite: false,
    }),
  );
  inertiaMesh.renderOrder = 10001;

  const candidates: UsdInteractionCandidate<{ id: string }>[] = [
    {
      kind: 'helper',
      distance: 2,
      layer: 'inertia',
      object: inertiaMesh,
      selection: {
        type: 'link',
        id: 'base_link',
        helperKind: 'inertia',
        layer: 'inertia',
      },
    },
    {
      kind: 'geometry',
      distance: 1,
      layer: 'visual',
      meta: { id: 'visual' },
      object: visualMesh,
    },
  ];

  const sorted = sortUsdInteractionCandidates(candidates, ['inertia', 'visual']);

  assert.equal(sorted[0]?.kind, 'helper');
  assert.equal(sorted[0]?.layer, 'inertia');
});

test('resolvePreferredUsdGeometryRole skips helper layers and picks the top visible geometry layer', () => {
  assert.equal(resolvePreferredUsdGeometryRole({
    interactionLayerPriority: ['origin-axes', 'collision', 'visual'],
    showVisual: true,
    showCollision: true,
    showCollisionAlwaysOnTop: false,
  }), 'collision');

  assert.equal(resolvePreferredUsdGeometryRole({
    interactionLayerPriority: ['joint-axis', 'center-of-mass'],
    showVisual: true,
    showCollision: true,
    showCollisionAlwaysOnTop: false,
  }), 'visual');
});
