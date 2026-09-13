import { getUsdTextureArithmeticSummary } from './usdTextureArithmetic';
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

// The override replaces the loader material with a matte MeshStandardMaterial;
// narrow with a real instanceof check instead of an incompatible `as` cast.
function expectStandardMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
  return mesh.material;
}

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

test('applyVisualMaterialOverrideToObject applies USD per-slot uv transform to the map clone', () => {
  // Native UsdTransform2d: scale (39.37, 39.37), no rotation/translation — the
  // computer002 keyboard case. Column-major 3x3 for uniform scale s.
  const scale = 39.370079040527344;
  const sharedTexture = new THREE.Texture();
  sharedTexture.flipY = true;
  sharedTexture.wrapS = THREE.ClampToEdgeWrapping;
  const textureCache = new Map<string, THREE.Texture>([
    ['img/keyboard.png', sharedTexture],
  ]);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(
    root,
    {
      usdMaterial: {
        materialId: '/root/materials/mat_62',
        mapPath: 'img/keyboard.png',
        textureInputs: {
          mapPath: {
            uvTransform: [scale, 0, 0, 0, scale, 0, 0, 0, 1],
            uvPrimvar: 'st',
            wrapS: 'repeat',
            wrapT: 'repeat',
          },
        },
      },
    },
    undefined,
    undefined,
    textureCache,
  );

  const map = expectStandardMaterial(mesh).map;
  // Authored metadata forces a per-material clone; the cache instance stays
  // pristine for other materials referencing the same image.
  assert.notEqual(map, sharedTexture);
  assert.ok(map);
  assert.equal(map.matrixAutoUpdate, false);
  const uv = new THREE.Vector3(7.062000076984987e-05, 0.021887220442295074, 1).applyMatrix3(map.matrix);
  // First native st sample of the keyboard mesh; the transform must scale it
  // exactly once (no baked-in loader repeat on top of the USD matrix).
  assert.ok(Math.abs(uv.x - 0.002780315012151091) <= 1e-9);
  assert.ok(Math.abs(uv.y - 0.8617015987906029) <= 1e-9);
  assert.equal(map.wrapS, THREE.RepeatWrapping);
  assert.equal(map.wrapT, THREE.RepeatWrapping);
  assert.equal(sharedTexture.matrixAutoUpdate, true);
  assert.equal(sharedTexture.wrapS, THREE.ClampToEdgeWrapping);
});

test('applyVisualMaterialOverrideToObject configures synchronous USD texture slots with per-slot transforms', () => {
  const sharedOrmTexture = new THREE.Texture();
  sharedOrmTexture.wrapS = THREE.ClampToEdgeWrapping;
  const scale = 39.370079040527344;
  const textureCache = new Map<string, THREE.Texture>([
    ['img/keyboard_orm.png', sharedOrmTexture],
  ]);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(
    root,
    {
      usdMaterial: {
        materialId: '/root/materials/mat_62',
        mapPath: 'img/keyboard_orm.png',
        roughnessMapPath: 'img/keyboard_orm.png',
        textureInputs: {
          mapPath: {
            uvTransform: [scale, 0, 0, 0, scale, 0, 0, 0, 1],
            wrapS: 'repeat',
            wrapT: 'repeat',
          },
          roughnessMapPath: {
            uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
        },
      },
    },
    undefined,
    undefined,
    textureCache,
  );

  const material = expectStandardMaterial(mesh);
  // Roughness slot: metadata present (authored identity) -> clone, identity
  // matrix enforced, wrap stays the cache default because the slot did not
  // author wrap tokens.
  assert.notEqual(material.roughnessMap, sharedOrmTexture);
  assert.equal(material.roughnessMap?.matrixAutoUpdate, false);
  assert.deepEqual(material.roughnessMap?.matrix.elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(material.roughnessMap?.wrapS, THREE.ClampToEdgeWrapping);
  // The shared cache texture is untouched for other consumers.
  assert.equal(sharedOrmTexture.matrixAutoUpdate, true);
  assert.equal(sharedOrmTexture.wrapS, THREE.ClampToEdgeWrapping);
});

test('applyVisualMaterialOverrideToObject clones shared images per material so different transforms do not contaminate', () => {
  const sharedTexture = new THREE.Texture();
  const textureCache = new Map<string, THREE.Texture>([
    ['img/shared.png', sharedTexture],
  ]);
  const firstMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const secondMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const firstRoot = new THREE.Group();
  firstRoot.add(firstMesh);
  const secondRoot = new THREE.Group();
  secondRoot.add(secondMesh);

  const buildOverride = (uvTransform: number[]) => ({
    usdMaterial: {
      materialId: '/root/materials/mat_83',
      mapPath: 'img/shared.png',
      textureInputs: {
        mapPath: { uvTransform },
      },
    } as const,
  });

  applyVisualMaterialOverrideToObject(firstRoot, buildOverride([5, 0, 0, 0, 4.647887, 0, 0, 0, 1]), undefined, undefined, textureCache);
  applyVisualMaterialOverrideToObject(secondRoot, buildOverride([39.370079, 0, 0, 0, 39.370079, 0, 0, 0, 1]), undefined, undefined, textureCache);

  const firstMap = expectStandardMaterial(firstMesh).map;
  const secondMap = expectStandardMaterial(secondMesh).map;
  assert.notEqual(firstMap, secondMap);
  assert.notEqual(firstMap, sharedTexture);
  const firstUv = new THREE.Vector3(0.5, 0.5, 1).applyMatrix3(firstMap!.matrix);
  assert.deepEqual(
    [firstUv.x, firstUv.y],
    [2.5, 4.647887 / 2],
  );
  const secondUv = new THREE.Vector3(0.5, 0.5, 1).applyMatrix3(secondMap!.matrix);
  assert.deepEqual(
    [secondUv.x, secondUv.y],
    [39.370079 / 2, 39.370079 / 2],
  );
  // Shared cache instance keeps its pristine state.
  assert.equal(sharedTexture.matrixAutoUpdate, true);
});

test('applyVisualMaterialOverrideToObject keeps texture metadata through the shared cache path for color slots', () => {
  const sharedTexture = new THREE.Texture();
  sharedTexture.colorSpace = THREE.LinearSRGBColorSpace;
  const textureCache = new Map<string, THREE.Texture>([
    ['img/color.png', sharedTexture],
  ]);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#888888' }),
  );
  const root = new THREE.Group();
  root.add(mesh);

  applyVisualMaterialOverrideToObject(
    root,
    {
      texture: 'img/color.png',
      usdMaterial: {
        materialId: '/root/materials/mat_83',
        mapPath: 'img/color.png',
        textureInputs: {
          mapPath: {
            uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            wrapS: 'repeat',
            wrapT: 'repeat',
          },
        },
      },
    },
    undefined,
    undefined,
    textureCache,
  );

  const map = expectStandardMaterial(mesh).map;
  assert.notEqual(map, sharedTexture);
  assert.equal(map?.wrapS, THREE.RepeatWrapping);
  assert.equal(map?.wrapT, THREE.RepeatWrapping);
  // Color slot with absent sourceColorSpace follows the 8-bit sRGB fallback.
  assert.equal(map?.colorSpace, THREE.SRGBColorSpace);
  assert.equal(map?.matrixAutoUpdate, false);
  assert.deepEqual(map?.matrix.elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // The shared cache texture keeps its original color space for other callers.
  assert.equal(sharedTexture.colorSpace, THREE.LinearSRGBColorSpace);
});

test('USD wardrobe RGB arithmetic reaches final physical material and its later clones', () => {
  const texture = new THREE.Texture();
  const cache = new Map([['img/wardrobe.png', texture]]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  applyVisualMaterialOverrideToObject(root, { usdMaterial: {
    mapPath: 'img/wardrobe.png', clearcoat: 0.51,
    textureInputs: { mapPath: { sourceOutput: 'rgb', sampleBias: [0.001, 0.02, 0.01, 0] } },
  } }, undefined, undefined, cache);
  const material = expectStandardMaterial(mesh);
  assert.ok(material instanceof THREE.MeshPhysicalMaterial);
  for (const target of [material, material.clone()]) {
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <map_fragment>' } as Parameters<THREE.Material['onBeforeCompile']>[0];
    target.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    assert.equal(getUsdTextureArithmeticSummary(target)?.compiled, true);
    assert.deepEqual(shader.uniforms.usdMapSampleBias.value.toArray(), [0.001, 0.02, 0.01, 0]);
    assert.doesNotMatch(shader.fragmentShader, /sampledDiffuseColor\.a\s*=/);
  }
  assert.deepEqual(texture.userData, {});
});


test('USD dielectric parameters promote canonical materials and preserve Fresnel endpoints through clones', () => {
  const ior = (1 + Math.sqrt(0.08)) / (1 - Math.sqrt(0.08));
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const materials: THREE.MeshPhysicalMaterial[] = [];
  for (const specularIntensity of [0, 0.5]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({
      name: 'dielectric', side: THREE.BackSide,
    }));
    const override = { usdMaterial: {
      color: [0.2, 0.3, 0.4], opacity: 0.8, roughness: 0.25, metalness: 0,
      ior, specularIntensity, specularColor: [1, 0.8, 0.4],
    } };
    applyVisualMaterialOverrideToObject(mesh, override, undefined, cache);
    const material = expectStandardMaterial(mesh);
    assert.ok(material instanceof THREE.MeshPhysicalMaterial);
    materials.push(material);
    for (const actual of [material, material.clone()]) {
      assert.equal(actual.ior, ior);
      assert.equal(actual.specularIntensity, specularIntensity);
      assert.deepEqual(actual.specularColor.toArray(), [1, 0.8, 0.4]);
      const f0 = ((actual.ior - 1) / (actual.ior + 1)) ** 2 * actual.specularIntensity;
      assert.ok(Math.abs(f0 - 0.08 * specularIntensity) < 1e-12);
      assert.equal(actual.name, 'dielectric');
      assert.equal(actual.side, THREE.BackSide);
      assert.equal(actual.opacity, 0.8);
      assert.equal(actual.transparent, true);
      assert.equal(actual.depthWrite, false);
    }
    const sharedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({
      name: 'dielectric', side: THREE.BackSide,
    }));
    applyVisualMaterialOverrideToObject(sharedMesh, override, undefined, cache);
    assert.equal(sharedMesh.material, material);
  }
  assert.notEqual(materials[0], materials[1]);
});

test('physical-only USD overrides are applied, including zero specular intensity', () => {
  for (const usdMaterial of [{ ior: 1.78 }, { specularIntensity: 0 }, { specularColor: [0.2, 0.4, 0.6] }]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#335577' }));
    applyVisualMaterialOverrideToObject(mesh, { usdMaterial });
    const material = expectStandardMaterial(mesh);
    assert.ok(material instanceof THREE.MeshPhysicalMaterial);
    if ('ior' in usdMaterial) assert.equal(material.ior, usdMaterial.ior);
    if ('specularIntensity' in usdMaterial) assert.equal(material.specularIntensity, 0);
    if ('specularColor' in usdMaterial) assert.deepEqual(material.specularColor.toArray(), usdMaterial.specularColor);
  }
  for (const usdMaterial of [{ roughness: 0.3 }, { ior: null, specularIntensity: Number.NaN, specularColor: [Number.NaN, 1, 1] }]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    applyVisualMaterialOverrideToObject(mesh, { color: '#556677', usdMaterial });
    assert.ok(!(expectStandardMaterial(mesh) instanceof THREE.MeshPhysicalMaterial));
  }
});

test('USD specular texture alone promotes the receiving material', () => {
  const texture = new THREE.Texture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  applyVisualMaterialOverrideToObject(mesh, {
    usdMaterial: { specularIntensityMapPath: 'textures/specular.png' },
  }, undefined, undefined, new Map([['textures/specular.png', texture]]));
  const material = expectStandardMaterial(mesh);
  assert.ok(material instanceof THREE.MeshPhysicalMaterial);
  assert.equal(material.specularIntensityMap, texture);
});
