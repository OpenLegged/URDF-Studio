import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { resolveSelectionCommitHoverAction } from './selectionCommitHoverPolicy';

test('preserves hover for committed link geometry clicks', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'base_link',
      linkId: 'base_link',
      subType: 'visual',
      targetKind: 'geometry',
      objectIndex: 2,
      highlightTarget: mesh,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: 'base_link',
        subType: 'visual',
        objectIndex: 2,
        highlightObjectId: mesh.id,
      },
    },
  );
});

test('preserves hover for collision geometry even when objectIndex metadata is absent', () => {
  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'base_link',
      linkId: 'base_link',
      subType: 'collision',
      targetKind: 'geometry',
      objectIndex: undefined,
      highlightTarget: undefined,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: 'base_link',
        subType: 'collision',
        objectIndex: 0,
        highlightObjectId: undefined,
      },
    },
  );
});

test('preserves hover for committed inertia helper clicks', () => {
  const inertiaBox = new THREE.Group();
  inertiaBox.name = '__inertia_box__';

  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'link',
      id: 'tool_tip',
      linkId: 'tool_tip',
      subType: undefined,
      targetKind: 'helper',
      helperKind: 'inertia',
      objectIndex: undefined,
      highlightTarget: inertiaBox,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'link',
        id: 'tool_tip',
        helperKind: 'inertia',
        highlightObjectId: inertiaBox.id,
      },
    },
  );
});

test('preserves hover after committed tendon selections', () => {
  const tendonGroup = new THREE.Group();

  assert.deepEqual(
    resolveSelectionCommitHoverAction({
      type: 'tendon',
      id: 'finger_tendon',
      subType: undefined,
      targetKind: 'geometry',
      objectIndex: undefined,
      highlightTarget: tendonGroup,
    }),
    {
      mode: 'preserve',
      hoveredSelection: {
        type: 'tendon',
        id: 'finger_tendon',
        highlightObjectId: tendonGroup.id,
      },
    },
  );
});
