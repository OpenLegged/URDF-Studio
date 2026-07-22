import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applyVisualMeshMaterialGroupsToObject,
  captureRuntimeVisualMaterialDescriptor,
  hasDistinctRuntimeBaseMaterialsWithinVisual,
  resolveMeshFaceSelection,
  resolveRuntimeMeshMaterialGroupKey,
} from './meshMaterialGroups';

test('captureRuntimeVisualMaterialDescriptor preserves authored structure and captures the actual unhighlighted PBR base', () => {
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: '#2468ac',
    opacity: 0.62,
    transparent: true,
    roughness: 0.24,
    metalness: 0.76,
    emissive: '#123456',
    emissiveIntensity: 1.4,
    alphaTest: 0.38,
  });
  baseMaterial.userData.originalColor = baseMaterial.color.clone();
  baseMaterial.userData.originalRoughness = 0.24;
  baseMaterial.userData.originalMetalness = 0.76;
  baseMaterial.userData.originalEmissive = baseMaterial.emissive.clone();
  baseMaterial.userData.originalEmissiveIntensity = 1.4;
  const texture = new THREE.Texture();
  texture.rotation = 0.6;
  baseMaterial.map = texture;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), baseMaterial);
  const visibleHighlight = baseMaterial.clone();
  visibleHighlight.color.set('#ffffff');
  mesh.material = visibleHighlight;
  mesh.userData.__urdfHighlightSnapshot = {
    material: baseMaterial,
    materialStates: [],
    activeRole: 'visual',
  };
  const authoredPasses = [
    { texture: 'detail.png', sceneBlend: 'alpha_blend' as const, depthWrite: false },
  ];

  const descriptor = captureRuntimeVisualMaterialDescriptor(mesh, {
    name: 'authored_base',
    color: '#000000',
    colorRgba: [0, 0, 0, 0.62],
    texture: 'base.png',
    passes: authoredPasses,
  });

  assert.deepEqual(descriptor, {
    name: 'authored_base',
    color: '#2468ac',
    colorRgba: [0, 0, 0, 0.62],
    texture: 'base.png',
    textureRotation: 0.6,
    opacity: 0.62,
    roughness: 0.24,
    metalness: 0.76,
    emissive: '#123456',
    emissiveIntensity: 1.4,
    alphaTest: 0.38,
    passes: authoredPasses,
  });
  assert.notEqual(descriptor.passes, authoredPasses);
  assert.notEqual(descriptor.passes?.[0], authoredPasses[0]);
});

test('captureRuntimeVisualMaterialDescriptor prefers runtime identity over synthetic fallbacks', () => {
  const runtimeMaterial = new THREE.MeshStandardMaterial({ color: '#abcdef' });
  runtimeMaterial.name = 'runtime_base';
  runtimeMaterial.userData.urdfTexturePath = 'textures/runtime.png';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), runtimeMaterial);

  const descriptor = captureRuntimeVisualMaterialDescriptor(mesh, null, {
    name: 'paint_base_0',
    color: '#ffffff',
  });

  assert.equal(descriptor.name, 'runtime_base');
  assert.equal(descriptor.texture, 'textures/runtime.png');
  assert.equal(descriptor.color, '#abcdef');
});

test('hasDistinctRuntimeBaseMaterialsWithinVisual rejects heterogeneous single-material child meshes', () => {
  const visual = new THREE.Group() as THREE.Group & { isURDFVisual?: boolean };
  visual.isURDFVisual = true;
  const left = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#ff0000', name: 'left' }),
  );
  const right = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#0000ff', name: 'right' }),
  );
  visual.add(left, right);

  assert.equal(hasDistinctRuntimeBaseMaterialsWithinVisual(left), true);
  (right.material as THREE.MeshStandardMaterial).color.copy(
    (left.material as THREE.MeshStandardMaterial).color,
  );
  right.material.name = left.material.name;
  assert.equal(hasDistinctRuntimeBaseMaterialsWithinVisual(left), false);
});

test('resolveMeshFaceSelection expands to a coplanar island', () => {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

  assert.deepEqual(resolveMeshFaceSelection(geometry, 0, 'face'), [0]);
  assert.deepEqual(resolveMeshFaceSelection(geometry, 0, 'island'), [0, 1]);
});

test('applyVisualMeshMaterialGroupsToObject restores geometry groups and material slots', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#808080', name: 'base' }),
  );
  root.add(mesh);

  const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, root);
  applyVisualMeshMaterialGroupsToObject(root, {
    authoredMaterials: [
      { name: 'base', color: '#808080' },
      {
        name: 'paint_slot_1',
        color: '#33aa44',
        opacity: 0.45,
        roughness: 0.2,
        metalness: 0.8,
        emissive: '#112233',
        emissiveIntensity: 1.2,
      },
    ],
    meshMaterialGroups: [
      { meshKey, start: 0, count: 3, materialIndex: 1 },
      { meshKey, start: 3, count: 3, materialIndex: 0 },
    ],
  });

  assert.equal(Array.isArray(mesh.material), true);
  if (!Array.isArray(mesh.material)) {
    throw new Error('mesh material should be an array after grouped material application');
  }
  const materials = mesh.material;
  assert.equal(materials.length, 2);
  const paintedMaterial = materials[1] as THREE.MeshStandardMaterial;
  assert.equal(paintedMaterial.color.getHexString(), '33aa44');
  assert.equal(paintedMaterial.toneMapped, false);
  assert.equal(
    (paintedMaterial.userData.originalColor as THREE.Color).getHexString(),
    '33aa44',
  );
  assert.ok(Math.abs(paintedMaterial.opacity - 0.45) <= 1e-6);
  assert.equal(paintedMaterial.transparent, true);
  assert.ok(Math.abs(paintedMaterial.roughness - 0.2) <= 1e-6);
  assert.ok(Math.abs(paintedMaterial.metalness - 0.8) <= 1e-6);
  assert.equal(paintedMaterial.emissive.getHexString(), '112233');
  assert.ok(Math.abs(paintedMaterial.emissiveIntensity - 1.2) <= 1e-6);
  assert.deepEqual(
    mesh.geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    [
      { start: 0, count: 3, materialIndex: 1 },
      { start: 3, count: 3, materialIndex: 0 },
    ],
  );
});

test('applyVisualMeshMaterialGroupsToObject applies alpha test and texture rotation', () => {
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function load(
    _url,
    onLoad,
  ): THREE.Texture {
    const texture = new THREE.Texture();
    onLoad?.(texture as THREE.Texture<HTMLImageElement>);
    return texture;
  } as typeof THREE.TextureLoader.prototype.load;

  try {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff' }),
    );
    root.add(mesh);
    const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, root);

    applyVisualMeshMaterialGroupsToObject(root, {
      authoredMaterials: [
        {
          name: 'base',
          color: '#ffffff',
          texture: 'base.png',
          textureRotation: 0.75,
          alphaTest: 0.35,
        },
        { name: 'paint', color: '#ff0000' },
      ],
      meshMaterialGroups: [
        { meshKey, start: 0, count: 3, materialIndex: 0 },
        { meshKey, start: 3, count: 3, materialIndex: 1 },
      ],
    });

    assert.ok(Array.isArray(mesh.material));
    if (!Array.isArray(mesh.material)) {
      assert.fail('expected a material palette');
    }
    const restoredBase = mesh.material[0] as THREE.MeshStandardMaterial;
    assert.ok(Math.abs(restoredBase.alphaTest - 0.35) <= 1e-6);
    assert.ok(restoredBase.map);
    assert.ok(Math.abs((restoredBase.map?.rotation ?? 0) - 0.75) <= 1e-6);
    assert.ok(Math.abs((restoredBase.map?.center.x ?? 0) - 0.5) <= 1e-6);
    assert.ok(Math.abs((restoredBase.map?.center.y ?? 0) - 0.5) <= 1e-6);
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});
