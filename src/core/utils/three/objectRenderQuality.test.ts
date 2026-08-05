import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { markMaterialAsShared } from './materialProtection';
import { applyObjectRenderQuality } from './objectRenderQuality';

test('applies material dithering and texture anisotropy across a scene graph', () => {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));

  try {
    assert.equal(
      applyObjectRenderQuality(root, {
        textureAnisotropy: 8,
        materialDithering: true,
      }),
      true,
    );
    assert.equal(material.dithering, true);
    assert.equal(texture.anisotropy, 8);
    assert.equal(
      applyObjectRenderQuality(root, {
        textureAnisotropy: 8,
        materialDithering: true,
      }),
      false,
    );
  } finally {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });
    material.dispose();
    texture.dispose();
  }
});

test('includes highlighted base materials and custom texture uniforms while preserving shared materials', () => {
  const highlightedTexture = new THREE.Texture();
  const uniformTexture = new THREE.Texture();
  const highlightedBaseMaterial = new THREE.MeshStandardMaterial({ map: highlightedTexture });
  highlightedBaseMaterial.userData.__urdfStudioTextureUniforms = {
    terrain: { value: uniformTexture },
  };
  const sharedMaterial = new THREE.MeshStandardMaterial();
  markMaterialAsShared(sharedMaterial);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), sharedMaterial);
  mesh.userData.__urdfHighlightSnapshot = { material: highlightedBaseMaterial };

  try {
    applyObjectRenderQuality(mesh, {
      textureAnisotropy: 16,
      materialDithering: true,
    });
    assert.equal(sharedMaterial.dithering, false);
    assert.equal(highlightedBaseMaterial.dithering, true);
    assert.equal(highlightedTexture.anisotropy, 16);
    assert.equal(uniformTexture.anisotropy, 16);
  } finally {
    mesh.geometry.dispose();
    sharedMaterial.dispose();
    highlightedBaseMaterial.dispose();
    highlightedTexture.dispose();
    uniformTexture.dispose();
  }
});
