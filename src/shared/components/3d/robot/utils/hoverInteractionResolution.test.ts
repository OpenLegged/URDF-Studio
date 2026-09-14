import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from './hoverInteractionResolution';

function createLinkCandidate(
  id: string,
  distance: number,
  subType: 'visual' | 'collision' = 'visual',
  object: THREE.Object3D | null = null,
): ResolvedHoverInteractionCandidate {
  return {
    type: 'link',
    id,
    linkId: id,
    subType,
    targetKind: 'geometry',
    distance,
    highlightTarget: object ?? undefined,
  };
}

function createHelperCandidate(
  id: string,
  distance: number,
  helperKind: 'origin-axes' | 'joint-axis' | 'center-of-mass' | 'inertia',
  object: THREE.Object3D | null = null,
): ResolvedHoverInteractionCandidate {
  return {
    type: helperKind === 'joint-axis' ? 'joint' : 'link',
    id,
    targetKind: 'helper',
    helperKind,
    distance,
    highlightTarget: object ?? undefined,
  };
}

function createMesh(
  options: {
    renderOrder?: number;
    depthTest?: boolean;
  } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  mesh.renderOrder = options.renderOrder ?? 0;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.depthTest = options.depthTest ?? true;
  }

  return mesh;
}

function createPickOnlyMesh(options: { renderOrder?: number } = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  mesh.renderOrder = options.renderOrder ?? 0;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.colorWrite = false;
    material.depthTest = false;
    material.depthWrite = false;
  }

  return mesh;
}

function createSupportPlane(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ color: 0x666666 }),
  );
  mesh.name = 'floor';
  return mesh;
}

test('resolveHoverInteractionResolution uses nearest hit when candidates share the same layer score', () => {
  const candidates = [
    createLinkCandidate('right_wrist_roll_link', 0.58, 'visual', createMesh()),
    createLinkCandidate('right_wrist_pitch_link', 0.6, 'visual', createMesh()),
  ];

  const result = resolveHoverInteractionResolution(candidates);

  assert.equal(result.primaryInteraction?.id, 'right_wrist_roll_link');
});

test('resolveHoverInteractionResolution keeps the nearer geometry hit ahead of a farther preferred layer', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.58, 'visual', createMesh()),
    createLinkCandidate('collision_link', 0.6, 'collision', createMesh()),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['collision', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'visual_link');
  assert.equal(result.primaryInteraction?.subType, 'visual');
});

test('resolveHoverInteractionResolution deprioritizes floor-like support planes beneath foreground geometry', () => {
  const candidates = [
    createLinkCandidate('floor_link', 0.6, 'collision', createSupportPlane()),
    createLinkCandidate('visual_link', 0.58, 'visual', createMesh()),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['collision', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'visual_link');
  assert.equal(result.primaryInteraction?.subType, 'visual');
});

test('resolveHoverInteractionResolution keeps floor-like support planes hoverable when no foreground target overlaps', () => {
  const candidates = [createLinkCandidate('floor_link', 0.6, 'collision', createSupportPlane())];

  const result = resolveHoverInteractionResolution(candidates, ['collision', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'floor_link');
  assert.equal(result.primaryInteraction?.subType, 'collision');
});

test('resolveHoverInteractionResolution keeps nearer geometry ahead of non-overlay helper layers that sit behind it', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.58, 'visual', createMesh()),
    createHelperCandidate('base_link', 0.62, 'center-of-mass', createMesh()),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['center-of-mass', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'visual_link');
  assert.equal(result.primaryInteraction?.subType, 'visual');
});

test('resolveHoverInteractionResolution treats overlay presentation as stronger than plain geometry when pinned', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.4, 'visual', createMesh()),
    createHelperCandidate(
      'hip_joint',
      0.8,
      'joint-axis',
      createMesh({ renderOrder: 10001, depthTest: false }),
    ),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['joint-axis', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'hip_joint');
  assert.equal(result.primaryInteraction?.helperKind, 'joint-axis');
});

test('resolveHoverInteractionResolution keeps pinned origin axes hoverable above plain geometry', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.4, 'visual', createMesh()),
    createHelperCandidate(
      'base_link',
      0.8,
      'origin-axes',
      createMesh({ renderOrder: 10001, depthTest: false }),
    ),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['origin-axes', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'base_link');
  assert.equal(result.primaryInteraction?.helperKind, 'origin-axes');
});

test('resolveHoverInteractionResolution keeps direct origin-axes hits ahead of overlapping geometry', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.2, 'visual', createMesh()),
    createHelperCandidate('base_link', 0.3, 'origin-axes', createMesh()),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['origin-axes', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'base_link');
  assert.equal(result.primaryInteraction?.helperKind, 'origin-axes');
});

test('resolveHoverInteractionResolution keeps direct geometry hover ahead of screen-space helper fallback', () => {
  const candidates = [
    createLinkCandidate('collision_link', 0.2, 'collision', createMesh()),
    {
      ...createHelperCandidate('hip_joint', 0, 'joint-axis', createMesh()),
      screenSpaceProjected: true,
    },
  ];

  const result = resolveHoverInteractionResolution(candidates, [
    'collision',
    'joint-axis',
    'visual',
  ]);

  assert.equal(result.primaryInteraction?.id, 'collision_link');
  assert.equal(result.primaryInteraction?.subType, 'collision');
});

test('resolveHoverInteractionResolution lets nearer geometry beat a non-overlay helper hit that is hidden behind it', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.2, 'visual', createMesh()),
    createHelperCandidate(
      'base_link',
      0.3,
      'origin-axes',
      createPickOnlyMesh({ renderOrder: 10020 }),
    ),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['origin-axes', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'visual_link');
  assert.equal(result.primaryInteraction?.subType, 'visual');
});

test('resolveHoverInteractionResolution keeps non-overlay inertia behind foreground geometry despite renderOrder', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.2, 'visual', createMesh()),
    createHelperCandidate(
      'base_link',
      0.3,
      'inertia',
      createMesh({ renderOrder: 10001, depthTest: true }),
    ),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['inertia', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'visual_link');
  assert.equal(result.primaryInteraction?.subType, 'visual');
});

test('resolveHoverInteractionResolution lets overlay inertia beat geometry behind it', () => {
  const candidates = [
    createLinkCandidate('visual_link', 0.2, 'visual', createMesh()),
    createHelperCandidate(
      'base_link',
      0.3,
      'inertia',
      createMesh({ renderOrder: 10001, depthTest: false }),
    ),
  ];

  const result = resolveHoverInteractionResolution(candidates, ['inertia', 'visual']);

  assert.equal(result.primaryInteraction?.id, 'base_link');
  assert.equal(result.primaryInteraction?.helperKind, 'inertia');
});

test('resolveHoverInteractionResolution lets screen-space overlay CoM beat collision geometry behind it', () => {
  const comObject = createMesh({ renderOrder: 10001, depthTest: false });
  const candidates = [
    createLinkCandidate('collision_link', 0.2, 'collision', createMesh()),
    {
      ...createHelperCandidate('base_link', 0, 'center-of-mass', comObject),
      screenSpaceProjected: true,
    },
  ];

  const result = resolveHoverInteractionResolution(candidates, [
    'collision',
    'center-of-mass',
    'visual',
  ]);

  assert.equal(result.primaryInteraction?.id, 'base_link');
  assert.equal(result.primaryInteraction?.helperKind, 'center-of-mass');
});

test('resolveHoverInteractionResolution keeps non-overlay screen-space helpers behind collision geometry', () => {
  const candidates = [
    createLinkCandidate('collision_link', 0.2, 'collision', createMesh()),
    {
      ...createHelperCandidate('base_link', 0, 'center-of-mass', createMesh()),
      screenSpaceProjected: true,
    },
  ];

  const result = resolveHoverInteractionResolution(candidates, [
    'collision',
    'center-of-mass',
    'visual',
  ]);

  assert.equal(result.primaryInteraction?.id, 'collision_link');
  assert.equal(result.primaryInteraction?.subType, 'collision');
});

test('resolveHoverInteractionResolution returns null when there are no candidates', () => {
  const result = resolveHoverInteractionResolution([]);

  assert.equal(result.primaryInteraction, null);
});
