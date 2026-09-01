import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applyVisualMaterialOverrideToObject,
  getVisualMaterialTextureRequests,
  hasExplicitGeometryMaterialOverride,
  resolvePrimaryAuthoredVisualMaterialOverride,
  resolveVisualMaterialOverrideFromGeometry,
} from './visualMaterialOverrides';

test('USD texture requests preserve prepared OBJ orientation and packed ORM roles', () => {
  assert.deepEqual(
    getVisualMaterialTextureRequests({
      texture: 'texture/base.png',
      usdMaterial: {
        mapPath: 'texture/base.png',
        roughnessMapPath: 'texture/orm.png',
        metalnessMapPath: 'texture/orm.png',
        aoMapPath: 'texture/orm.png',
      },
    }),
    [
      { path: 'texture/base.png', isColor: true, flipY: true },
      { path: 'texture/orm.png', isColor: false, flipY: true },
    ],
  );
});

test('resolveVisualMaterialOverrideFromGeometry includes first-batch PBR parameters', () => {
  const override = resolveVisualMaterialOverrideFromGeometry({
    color: '#808080',
    authoredMaterials: [
      {
        color: '#123456',
        texture: 'textures/body.png',
        opacity: 0.35,
        roughness: 0.72,
        metalness: 0.18,
        emissive: '#102030',
        emissiveIntensity: 1.4,
      },
    ],
  });

  assert.deepEqual(override, {
    color: '#123456',
    texture: 'textures/body.png',
    opacity: 0.35,
    roughness: 0.72,
    metalness: 0.18,
    emissive: '#102030',
    emissiveIntensity: 1.4,
  });
});

test('resolveVisualMaterialOverrideFromGeometry derives opacity from authored colorRgba alpha', () => {
  const override = resolveVisualMaterialOverrideFromGeometry({
    color: '#808080',
    authoredMaterials: [
      {
        color: '#19334c',
        colorRgba: [0.1, 0.2, 0.3, 0.4],
      },
    ],
  });

  assert.deepEqual(override, {
    color: '#19334c',
    opacity: 0.4,
  });
});

test('resolveVisualMaterialOverrideFromGeometry uses colorRgba when no hex color is available', () => {
  const override = resolveVisualMaterialOverrideFromGeometry({
    color: '#808080',
    authoredMaterials: [
      {
        colorRgba: [0.1, 0.2, 0.3, 0.4],
      },
    ],
  });

  assert.deepEqual(override, {
    color: '#1a334d66',
    opacity: 0.4,
  });
});

test('hasExplicitGeometryMaterialOverride detects PBR-only authored overrides', () => {
  assert.equal(
    hasExplicitGeometryMaterialOverride({
      authoredMaterials: [{ roughness: 0.2 }],
    }),
    true,
  );
});

test('applyVisualMaterialOverrideToObject applies PBR parameters to generated materials', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(root, {
    color: '#abcdef',
    opacity: 0.6,
    roughness: 0.25,
    metalness: 0.85,
    emissive: '#224466',
    emissiveIntensity: 0.9,
  });

  const appliedMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(appliedMaterial.color.getHexString(), 'abcdef');
  assert.ok(Math.abs(appliedMaterial.opacity - 0.6) <= 1e-6);
  assert.equal(appliedMaterial.transparent, true);
  assert.ok(Math.abs(appliedMaterial.roughness - 0.25) <= 1e-6);
  assert.ok(Math.abs(appliedMaterial.metalness - 0.85) <= 1e-6);
  assert.equal(appliedMaterial.emissive.getHexString(), '224466');
  assert.ok(Math.abs(appliedMaterial.emissiveIntensity - 0.9) <= 1e-6);
});

test('applyVisualMaterialOverrideToObject restores USD base color and packed ORM maps', () => {
  const baseTexture = new THREE.Texture();
  baseTexture.flipY = true;
  const ormTexture = new THREE.Texture();
  ormTexture.flipY = true;
  const textureCache = new Map<string, THREE.Texture>([
    ['texture/base.png', baseTexture],
    ['texture/orm.png', ormTexture],
  ]);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(
    root,
    {
      color: '#ffffff',
      texture: 'texture/base.png',
      usdMaterial: {
        isOmniPbr: true,
        mapPath: 'texture/base.png',
        roughnessMapPath: 'texture/orm.png',
        metalnessMapPath: 'texture/orm.png',
        aoMapPath: 'texture/orm.png',
        emissive: [0.1, 0.2, 0.3],
        roughness: 0.5,
        metalness: 0.1,
      },
    },
    undefined,
    undefined,
    textureCache,
  );

  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  const material = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(material.map, baseTexture);
  assert.equal(material.map?.flipY, true);
  assert.equal(material.roughnessMap, ormTexture);
  assert.equal(material.metalnessMap, ormTexture);
  assert.equal(material.aoMap, ormTexture);
  assert.deepEqual(
    material.emissive.toArray().map((value) => Number(value.toFixed(6))),
    [0.1, 0.2, 0.3],
  );
  assert.equal(material.userData.usdMaterialApplied, true);
  assert.equal(geometry.getAttribute('uv1'), geometry.getAttribute('uv'));
});

test('applyVisualMaterialOverrideToObject restores OmniGlass physical properties', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(root, {
    color: '#777777',
    usdMaterial: {
      materialId: '/Looks/door_glass',
      isOmniGlass: true,
      opacity: 0.8,
      roughness: 0,
      metalness: 0.01,
      transmission: 1,
      ior: 1.491,
      specularIntensity: 1,
    },
  });

  assert.ok(mesh.material instanceof THREE.MeshPhysicalMaterial);
  const material = mesh.material as THREE.MeshPhysicalMaterial;
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(material.side, THREE.DoubleSide);
  assert.ok(Math.abs(material.opacity - 0.8) <= 1e-6);
  assert.ok(Math.abs(material.transmission - 1) <= 1e-6);
  assert.ok(Math.abs(material.ior - 1.491) <= 1e-6);
  assert.equal(material.userData.usdMaterialId, '/Looks/door_glass');
});

test('applyVisualMaterialOverrideToObject preserves near-white texture base colors', () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    _url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#444444' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  try {
    applyVisualMaterialOverrideToObject(root, {
      color: '#ffffff',
      texture: 'textures/body.png',
    });
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }

  const appliedMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(appliedMaterial.color.getHexString(), 'ffffff');
  assert.equal(appliedMaterial.userData.urdfTextureApplied, true);
  assert.equal(appliedMaterial.userData.urdfTexturePath, 'textures/body.png');
});

test('applyVisualMaterialOverrideToObject keeps texture-only source projection opaque', () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    _url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  const sourceMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    opacity: 0,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sourceMaterial);
  const root = new THREE.Group();
  root.add(mesh);

  try {
    applyVisualMaterialOverrideToObject(root, {
      texture: 'textures/parquet.png',
    });
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }

  const appliedMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(appliedMaterial.opacity, 1);
  assert.equal(appliedMaterial.map?.isTexture, true);
  assert.equal(appliedMaterial.userData.urdfOpacityApplied, undefined);
});

test('applyVisualMaterialOverrideToObject logs when a texture override has no mesh materials to update', () => {
  const root = new THREE.Group();
  const originalConsoleWarn = console.warn;
  const loggedWarnings: unknown[][] = [];
  console.warn = (...args) => {
    loggedWarnings.push(args);
  };

  try {
    applyVisualMaterialOverrideToObject(root, {
      texture: 'textures/body.png',
    });
  } finally {
    console.warn = originalConsoleWarn;
  }

  assert.equal(loggedWarnings.length, 1);
  assert.match(
    String(loggedWarnings[0]?.[0] || ''),
    /Visual texture override requested, but no mesh materials were available to receive it/,
  );
  assert.equal(loggedWarnings[0]?.[1], 'textures/body.png');
});

test('resolveVisualMaterialOverrideFromGeometry includes alphaTest', () => {
  const override = resolveVisualMaterialOverrideFromGeometry({
    color: '#808080',
    authoredMaterials: [
      {
        texture: 'textures/leaves.png',
        alphaTest: 0.5,
      },
    ],
  });

  assert.deepEqual(override, {
    texture: 'textures/leaves.png',
    alphaTest: 0.5,
  });
});

test('applyVisualMaterialOverrideToObject applies alphaTest to generated materials', () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(root, {
    alphaTest: 0.5,
  });

  const appliedMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.ok(Math.abs(appliedMaterial.alphaTest - 0.5) <= 1e-6);
});

test('applyVisualMaterialOverrideToObject textures a material that replaced the original mid-load', () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  let resolveTextureLoad: ((texture: THREE.Texture) => void) | null = null;
  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    _url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    resolveTextureLoad = () => onLoad?.(texture);
    return texture;
  };

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#ffffff' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  try {
    applyVisualMaterialOverrideToObject(root, { texture: 'textures/floor.png' });

    // Stand in for the later scene passes (material enhancement / matte normalization)
    // that clone and swap a mesh's material while the texture load is still pending.
    const pendingMaterial = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = pendingMaterial.clone();

    assert.equal(resolveTextureLoad === null, false);
    resolveTextureLoad!(new THREE.Texture());
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }

  const currentMaterial = mesh.material as THREE.MeshStandardMaterial;
  assert.equal(currentMaterial.userData.urdfTexturePath, 'textures/floor.png');
  assert.notEqual(currentMaterial.map, null);
});

test('resolvePrimaryAuthoredVisualMaterialOverride falls back to the first entry of a palette', () => {
  const geometry = {
    color: '#808080',
    authoredMaterials: [
      { name: 'material0000', color: '#ffffff', texture: 'textures/a.png' },
      { name: 'material0001', color: '#ffffff', texture: 'textures/b.png' },
    ],
  };

  // The multi-material resolver refuses palettes, which is what leaves such a mesh
  // untextured; the primary-entry resolver is the explicit opt-in for that case.
  assert.equal(resolveVisualMaterialOverrideFromGeometry(geometry), null);
  assert.deepEqual(resolvePrimaryAuthoredVisualMaterialOverride(geometry), {
    color: '#ffffff',
    texture: 'textures/a.png',
  });
});

test('resolvePrimaryAuthoredVisualMaterialOverride returns null without authored materials', () => {
  assert.equal(resolvePrimaryAuthoredVisualMaterialOverride({ color: '#808080' }), null);
  assert.equal(resolvePrimaryAuthoredVisualMaterialOverride(null), null);
});
