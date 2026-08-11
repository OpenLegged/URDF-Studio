import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { resolveScreenSpaceUsdHelperHit } from './usdScreenSpaceHelperInteraction.ts';

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
    },
    linkPathById: {
      base_link: '/robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
  };
}

function createOriginHelperMesh(): THREE.Mesh {
  const helperRoot = new THREE.Group();
  helperRoot.name = '__origin_axes__';
  helperRoot.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'origin-axes',
    usdLinkPath: '/robot/base_link',
  };

  const helperMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  helperMesh.userData = {
    isGizmo: true,
    isSelectableHelper: true,
  };

  helperRoot.add(helperMesh);
  helperRoot.updateMatrixWorld(true);
  return helperMesh;
}

test('resolveScreenSpaceUsdHelperHit does not use padded fallback for origin-axes helpers', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const helperMesh = createOriginHelperMesh();
  const resolved = resolveScreenSpaceUsdHelperHit({
    pointerClientX: 100,
    pointerClientY: 100,
    helperTargets: [helperMesh],
    resolution: createResolution(),
    camera,
    canvasRect: {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    },
    interactionLayerPriority: ['origin-axes', 'collision', 'visual'],
  });

  assert.equal(resolved, null);
});

test('resolveScreenSpaceUsdHelperHit ignores pointers outside the helper footprint', () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const helperMesh = createOriginHelperMesh();
  const resolved = resolveScreenSpaceUsdHelperHit({
    pointerClientX: 4,
    pointerClientY: 4,
    helperTargets: [helperMesh],
    resolution: createResolution(),
    camera,
    canvasRect: {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    },
  });

  assert.equal(resolved, null);
});
