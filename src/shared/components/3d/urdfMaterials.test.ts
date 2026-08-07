import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applyURDFMaterials,
  applyURDFMaterialTextures,
  collectURDFMaterialsFromVisualGeometry,
} from './urdfMaterials';

function createTexturedPaletteMesh(materialName: string): {
  root: THREE.Object3D;
  mesh: THREE.Mesh;
} {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff', name: materialName }),
  );
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh };
}

test('collectURDFMaterialsFromVisualGeometry carries authored textures into the palette', () => {
  const palette = collectURDFMaterialsFromVisualGeometry({
    authoredMaterials: [
      { name: 'material0000', color: '#ffffff', texture: 'textures/a.png', textureRotation: 0.5 },
      { name: 'material0001', color: '#ffffff' },
    ],
  });

  assert.equal(palette.get('material0000')?.texture, 'textures/a.png');
  assert.equal(palette.get('material0000')?.textureRotation, 0.5);
  assert.equal(palette.get('material0001')?.texture, undefined);
});

test('applyURDFMaterials reports whether the named palette matched anything', () => {
  const palette = collectURDFMaterialsFromVisualGeometry({
    authoredMaterials: [{ name: 'material0000', color: '#123456' }],
  });

  const matched = createTexturedPaletteMesh('material0000');
  assert.equal(applyURDFMaterials(matched.root, palette), true);

  const unmatched = createTexturedPaletteMesh('some_generated_obj_material');
  assert.equal(applyURDFMaterials(unmatched.root, palette), false);
});

test('applyURDFMaterialTextures assigns palette textures to their named material', () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    _url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  const palette = collectURDFMaterialsFromVisualGeometry({
    authoredMaterials: [
      { name: 'material0000', color: '#ffffff', texture: 'textures/ceiling.png' },
    ],
  });
  const { root, mesh } = createTexturedPaletteMesh('material0000');
  // Vertex colors would otherwise modulate the texture into a darkened surface.
  (mesh.material as THREE.MeshStandardMaterial).vertexColors = true;

  try {
    applyURDFMaterials(root, palette);
    applyURDFMaterialTextures(root, palette);
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }

  const appliedMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.notEqual(appliedMaterial.map, null);
  assert.equal(appliedMaterial.vertexColors, false);
  assert.equal(appliedMaterial.userData.urdfTexturePath, 'textures/ceiling.png');
});
