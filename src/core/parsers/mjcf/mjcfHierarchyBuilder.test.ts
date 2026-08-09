import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { BOX_FACE_MATERIAL_ORDER } from '@/core/robot';

import { MJCFLoadAbortedError } from './mjcfLoadLifecycle.ts';
import { buildMJCFHierarchy } from './mjcfHierarchyBuilder.ts';

function toFixedColorArray(color: THREE.Color, digits = 4): number[] {
  return color.toArray().map((value) => Number(value.toFixed(digits)));
}

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function readFirstTexturePixel(texture: THREE.Texture): [number, number, number] {
  const image = texture.image as { data?: Uint8Array };
  assert.ok(image?.data instanceof Uint8Array);
  return [image.data[0] ?? 0, image.data[1] ?? 0, image.data[2] ?? 0];
}

function createCompilerSettings(texturedir = '') {
  return {
    angleUnit: 'radian' as const,
    assetdir: '',
    meshdir: '',
    texturedir,
    eulerSequence: 'xyz',
    autolimits: false,
    fitaabb: false,
    inertiafromgeom: 'auto' as const,
  };
}

test('applies texture-backed material assets to generated visual meshes', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    texture.needsUpdate = true;
    return texture;
  };
  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'carbon_fibre',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/carbon.png': 'mock://assets/carbon.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'carbon_fibre',
        {
          name: 'carbon_fibre',
          texture: 'carbon',
          texrepeat: [2, 3],
          shininess: 1,
          reflectance: 0.4,
        },
      ],
    ]),
    textureMap: new Map([
      [
        'carbon',
        {
          name: 'carbon',
          file: 'assets/carbon.png',
          type: '2d',
        },
      ],
    ]),
    sourceFileDir: '',
  });
  await waitForNextMacrotask();

  let visualMaterial: THREE.MeshStandardMaterial | null = null as THREE.MeshStandardMaterial | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMaterial = mesh.material;
    }
  });

  assert.ok(visualMaterial);
  assert.equal(visualMaterial.name, 'carbon_fibre');
  assert.ok(visualMaterial.map instanceof THREE.Texture);
  assert.equal(visualMaterial.map.repeat.x, 2);
  assert.equal(visualMaterial.map.repeat.y, 3);
  assert.deepEqual(
    toFixedColorArray(visualMaterial.color),
    toFixedColorArray(new THREE.Color(0xffffff)),
  );
  assert.equal(visualMaterial.toneMapped, false);
  assert.equal(visualMaterial.roughness, 0);
  assert.equal(visualMaterial.metalness, 0.4);
});

test('applies builtin cube textures to box geoms without reporting them as incomplete', async (t) => {
  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args) => {
    loggedErrors.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'geom',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map([
      [
        'geom',
        {
          name: 'geom',
          texture: 'texgeom',
          texuniform: true,
        },
      ],
    ]),
    textureMap: new Map([
      [
        'texgeom',
        {
          name: 'texgeom',
          type: 'cube',
          builtin: 'flat',
          rgb1: [0.7, 0.7, 0.7],
          rgb2: [0.2, 0.2, 0.2],
          width: 4,
          height: 4,
        },
      ],
    ]),
    sourceFileDir: '',
  });
  await waitForNextMacrotask();

  let visualMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh) {
      visualMesh = mesh;
    }
  });

  assert.ok(visualMesh);
  assert.ok(Array.isArray(visualMesh.material));
  assert.equal(visualMesh.material.length, BOX_FACE_MATERIAL_ORDER.length);

  const rightMaterial = visualMesh.material[BOX_FACE_MATERIAL_ORDER.indexOf('right')];
  const downMaterial = visualMesh.material[BOX_FACE_MATERIAL_ORDER.indexOf('down')];
  assert.ok(rightMaterial instanceof THREE.MeshStandardMaterial);
  assert.ok(downMaterial instanceof THREE.MeshStandardMaterial);
  assert.ok(rightMaterial.map instanceof THREE.Texture);
  assert.ok(downMaterial.map instanceof THREE.Texture);
  assert.deepEqual(readFirstTexturePixel(rightMaterial.map), [179, 179, 179]);
  assert.deepEqual(readFirstTexturePixel(downMaterial.map), [51, 51, 51]);
  assert.equal(
    loggedErrors.some((entry) =>
      /references incomplete cube texture definition/.test(String(entry?.[0] || '')),
    ),
    false,
  );
});

test('applies single-file cube textures to box geoms without reporting them as incomplete', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  const originalConsoleError = console.error;
  let loadCount = 0;
  const loggedErrors: unknown[][] = [];

  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    loadCount += 1;
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    texture.needsUpdate = true;
    return texture;
  };
  console.error = (...args) => {
    loggedErrors.push(args);
  };
  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
    console.error = originalConsoleError;
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'wood_box',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/wood.png': 'mock://assets/wood.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'wood_box',
        {
          name: 'wood_box',
          texture: 'wood_texture',
          texrepeat: [2, 3],
        },
      ],
    ]),
    textureMap: new Map([
      [
        'wood_texture',
        {
          name: 'wood_texture',
          type: 'cube',
          file: 'assets/wood.png',
        },
      ],
    ]),
    sourceFileDir: '',
  });
  await waitForNextMacrotask();

  let visualMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh) {
      visualMesh = mesh;
    }
  });

  assert.ok(visualMesh);
  assert.ok(Array.isArray(visualMesh.material));
  assert.equal(visualMesh.material.length, BOX_FACE_MATERIAL_ORDER.length);
  assert.equal(loadCount, 1);
  visualMesh.material.forEach((material) => {
    assert.ok(material instanceof THREE.MeshStandardMaterial);
    assert.ok(material.map instanceof THREE.Texture);
    assert.equal(material.map.repeat.x, 2);
    assert.equal(material.map.repeat.y, 3);
  });
  assert.equal(
    loggedErrors.some((entry) =>
      /references incomplete cube texture definition/.test(String(entry?.[0] || '')),
    ),
    false,
  );
});

test('prefers ImageBitmap texture decoding when the browser supports it', async (t) => {
  const globalWithImageBitmap = globalThis as typeof globalThis & {
    createImageBitmap?: (...args: unknown[]) => Promise<ImageBitmap>;
  };
  const originalCreateImageBitmap = globalWithImageBitmap.createImageBitmap;
  globalWithImageBitmap.createImageBitmap = async () => ({ close() {} }) as ImageBitmap;

  const originalBitmapLoadAsync = THREE.ImageBitmapLoader.prototype.loadAsync;
  const originalTextureLoadAsync = THREE.TextureLoader.prototype.loadAsync;

  let bitmapLoadCount = 0;
  let textureLoadCount = 0;
  const fakeBitmap = { close() {} } as ImageBitmap;

  THREE.ImageBitmapLoader.prototype.loadAsync = async function mockBitmapLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<ImageBitmap> {
    bitmapLoadCount += 1;
    return fakeBitmap;
  };

  THREE.TextureLoader.prototype.loadAsync = async function mockTextureLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    textureLoadCount += 1;
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    texture.needsUpdate = true;
    return texture;
  };

  t.after(() => {
    THREE.ImageBitmapLoader.prototype.loadAsync = originalBitmapLoadAsync;
    THREE.TextureLoader.prototype.loadAsync = originalTextureLoadAsync;
    if (originalCreateImageBitmap) {
      globalWithImageBitmap.createImageBitmap = originalCreateImageBitmap;
    } else {
      Reflect.deleteProperty(globalWithImageBitmap, 'createImageBitmap');
    }
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'bitmap_material',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/bitmap.png': 'mock://assets/bitmap.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'bitmap_material',
        {
          name: 'bitmap_material',
          texture: 'bitmap_texture',
        },
      ],
    ]),
    textureMap: new Map([
      [
        'bitmap_texture',
        {
          name: 'bitmap_texture',
          file: 'assets/bitmap.png',
          type: '2d',
        },
      ],
    ]),
    sourceFileDir: '',
  });
  await waitForNextMacrotask();

  assert.equal(bitmapLoadCount, 1);
  assert.equal(textureLoadCount, 0);

  let visualMaterial: THREE.MeshStandardMaterial | null = null as THREE.MeshStandardMaterial | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMaterial = mesh.material;
    }
  });

  assert.ok(visualMaterial?.map instanceof THREE.Texture);
  assert.equal(visualMaterial?.map?.image, fakeBitmap);
});

test('does not block hierarchy completion on unresolved texture-backed materials', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  let resolveTexture: ((texture: THREE.Texture<HTMLImageElement>) => void) | undefined;
  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    return await new Promise<THREE.Texture<HTMLImageElement>>((resolve) => {
      resolveTexture = resolve;
    });
  };
  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const rootGroup = new THREE.Group();
  await Promise.race([
    buildMJCFHierarchy({
      bodies: [
        {
          name: 'world',
          pos: [0, 0, 0],
          geoms: [],
          joints: [],
          children: [
            {
              name: 'base',
              pos: [0, 0, 0],
              geoms: [
                {
                  name: 'body-shell',
                  type: 'box',
                  size: [0.1, 0.1, 0.1],
                  material: 'carbon_fibre',
                  contype: 0,
                  conaffinity: 0,
                },
              ],
              joints: [],
              children: [],
            },
          ],
        },
      ],
      rootGroup,
      meshMap: new Map(),
      assets: {
        'assets/carbon.png': 'mock://assets/carbon.png',
      },
      meshCache: new Map(),
      compilerSettings: createCompilerSettings('assets'),
      materialMap: new Map([
        [
          'carbon_fibre',
          {
            name: 'carbon_fibre',
            texture: 'carbon',
          },
        ],
      ]),
      textureMap: new Map([
        [
          'carbon',
          {
            name: 'carbon',
            file: 'assets/carbon.png',
            type: '2d',
          },
        ],
      ]),
      sourceFileDir: '',
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('hierarchy build blocked on unresolved texture load')), 50);
    }),
  ]);

  const findVisualMaterial = () => {
    let nextVisualMaterial: THREE.MeshStandardMaterial | null =
      null as THREE.MeshStandardMaterial | null;
    rootGroup.traverse((child) => {
      if (!('isMesh' in child) || !(child as any).isMesh) {
        return;
      }

      const mesh = child as THREE.Mesh;
      if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
        nextVisualMaterial = mesh.material;
      }
    });
    return nextVisualMaterial;
  };

  const visualMaterial = findVisualMaterial();
  assert.ok(visualMaterial);
  assert.equal(visualMaterial.map, null);
  const initialMaterialInstance = visualMaterial;

  const resolvedTexture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
  resolvedTexture.needsUpdate = true;
  assert.ok(resolveTexture);
  resolveTexture(resolvedTexture);
  await waitForNextMacrotask();

  const updatedVisualMaterial = findVisualMaterial();
  assert.ok(updatedVisualMaterial);
  assert.ok(updatedVisualMaterial.map instanceof THREE.Texture);
  assert.equal(
    updatedVisualMaterial,
    initialMaterialInstance,
    'deferred texture application should update the existing material instance instead of rebuilding it',
  );
});

test('logs deferred MJCF texture failures instead of silently leaving materials untextured', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const loggedErrors: unknown[][] = [];
  const loggedWarnings: unknown[][] = [];

  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(): Promise<
    THREE.Texture<HTMLImageElement>
  > {
    throw new Error('mjcf-texture-load-failed');
  };
  console.error = (...args) => {
    loggedErrors.push(args);
  };
  console.warn = (...args) => {
    loggedWarnings.push(args);
  };

  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'carbon_fibre',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/carbon.png': 'mock://assets/carbon.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'carbon_fibre',
        {
          name: 'carbon_fibre',
          texture: 'carbon',
        },
      ],
    ]),
    textureMap: new Map([
      [
        'carbon',
        {
          name: 'carbon',
          file: 'assets/carbon.png',
          type: '2d',
        },
      ],
    ]),
    sourceFileDir: '',
  });
  await waitForNextMacrotask();

  assert.ok(
    loggedErrors.some((entry) =>
      /Failed to load texture asset: mock:\/\/assets\/carbon\.png/.test(String(entry?.[0] || '')),
    ),
  );
  assert.ok(
    loggedWarnings.some((entry) =>
      /Deferred texture application produced no texture/.test(String(entry?.[0] || '')),
    ),
  );
});

test('scopes texture loader cache to a single MJCF hierarchy build', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  let loadCount = 0;
  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    loadCount += 1;
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    texture.needsUpdate = true;
    return texture;
  };
  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const createBuildOptions = (rootGroup: THREE.Group) => ({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0] as [number, number, number],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0] as [number, number, number],
            geoms: [
              {
                name: 'body-shell-a',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'carbon_fibre',
                contype: 0,
                conaffinity: 0,
              },
              {
                name: 'body-shell-b',
                type: 'box',
                size: [0.08, 0.08, 0.08],
                material: 'carbon_fibre',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/carbon.png': 'mock://assets/carbon.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'carbon_fibre',
        {
          name: 'carbon_fibre',
          texture: 'carbon',
          texrepeat: [2, 3] as [number, number],
        },
      ],
    ]),
    textureMap: new Map([
      [
        'carbon',
        {
          name: 'carbon',
          file: 'assets/carbon.png',
          type: '2d' as const,
        },
      ],
    ]),
    sourceFileDir: '',
  });

  await buildMJCFHierarchy(createBuildOptions(new THREE.Group()));
  await buildMJCFHierarchy(createBuildOptions(new THREE.Group()));
  await waitForNextMacrotask();

  assert.equal(
    loadCount,
    2,
    'each hierarchy build should resolve its own texture cache instead of retaining a module-global texture promise',
  );
});

test('disposes temporary base textures after a hierarchy build completes', async (t) => {
  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  const loadedTextures: THREE.Texture[] = [];
  let disposeCount = 0;
  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
    const originalDispose = texture.dispose.bind(texture);
    texture.dispose = () => {
      disposeCount += 1;
      originalDispose();
    };
    texture.needsUpdate = true;
    loadedTextures.push(texture);
    return texture;
  };
  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'carbon_fibre',
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {
      'assets/carbon.png': 'mock://assets/carbon.png',
    },
    meshCache: new Map(),
    compilerSettings: createCompilerSettings('assets'),
    materialMap: new Map([
      [
        'carbon_fibre',
        {
          name: 'carbon_fibre',
          texture: 'carbon',
        },
      ],
    ]),
    textureMap: new Map([
      [
        'carbon',
        {
          name: 'carbon',
          file: 'assets/carbon.png',
          type: '2d',
        },
      ],
    ]),
    sourceFileDir: '',
  });

  await waitForNextMacrotask();

  let visualMap: THREE.Texture | null = null as THREE.Texture | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMap = mesh.material.map;
    }
  });

  assert.equal(loadedTextures.length, 1);
  assert.equal(disposeCount, 1);
  assert.ok(visualMap instanceof THREE.Texture);
  assert.notEqual(visualMap, loadedTextures[0]);
});

test('copies MJCF site metadata onto runtime links for downstream helper rendering', async () => {
  const rootGroup = new THREE.Group();
  const siteDefinition = {
    name: 'tool_tip',
    type: 'sphere',
    size: [0.015],
    rgba: [1, 0.4, 0.1, 0.75] as [number, number, number, number],
    pos: [0, 0, 0.08] as [number, number, number],
    quat: [1, 0, 0, 0] as [number, number, number, number],
  };
  const inputSites = [siteDefinition];

  const { linksMap } = await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [],
            sites: inputSites,
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const baseLink = linksMap.base as THREE.Object3D | undefined;
  assert.ok(baseLink, 'expected runtime base link to be created');
  assert.deepEqual(baseLink.userData.__mjcfSitesData, [siteDefinition]);
  assert.notEqual(baseLink.userData.__mjcfSitesData, inputSites);
  assert.notEqual(
    (baseLink.userData.__mjcfSitesData as (typeof siteDefinition)[])[0],
    siteDefinition,
    'runtime site metadata entries should be cloned',
  );

  (siteDefinition.pos as [number, number, number])[2] = 999;
  assert.equal(
    (baseLink.userData.__mjcfSitesData as (typeof siteDefinition)[])[0]?.pos?.[2],
    0.08,
    'runtime site metadata should be cloned from parsed MJCF bodies',
  );
});

test('stops MJCF hierarchy work at abort boundaries without processing later geoms', async () => {
  const abortSignal = { aborted: false };
  let processedGeoms = 0;

  await assert.rejects(
    buildMJCFHierarchy({
      bodies: [
        {
          name: 'world',
          pos: [0, 0, 0],
          geoms: [],
          joints: [],
          children: [
            {
              name: 'base',
              pos: [0, 0, 0],
              geoms: [
                {
                  name: 'geom_a',
                  type: 'box',
                  size: [0.1, 0.1, 0.1],
                },
                {
                  name: 'geom_b',
                  type: 'box',
                  size: [0.1, 0.1, 0.1],
                },
              ],
              joints: [],
              children: [],
            },
          ],
        },
      ],
      rootGroup: new THREE.Group(),
      meshMap: new Map(),
      assets: {},
      abortSignal,
      meshCache: new Map(),
      compilerSettings: createCompilerSettings(),
      materialMap: new Map(),
      textureMap: new Map(),
      onProgress: ({ processedGeoms: nextProcessedGeoms }) => {
        processedGeoms = nextProcessedGeoms;
      },
      yieldIfNeeded: async () => {
        if (processedGeoms >= 1) {
          abortSignal.aborted = true;
        }
      },
    }),
    (error) => error instanceof MJCFLoadAbortedError,
  );

  assert.equal(processedGeoms, 1);
});

test('rejects hierarchy construction when a geom cannot be built', async () => {
  const brokenGeom = {
    name: 'broken_geom',
    type: 'box',
    size: [0.1, 0.1, 0.1],
  };
  Object.defineProperty(brokenGeom, 'pos', {
    configurable: true,
    get() {
      throw new Error('geom transform failed');
    },
  });
  let processedGeoms = 0;

  await assert.rejects(
    buildMJCFHierarchy({
      bodies: [
        {
          name: 'base',
          pos: [0, 0, 0],
          geoms: [
            brokenGeom,
            {
              name: 'unreachable_geom',
              type: 'box',
              size: [0.1, 0.1, 0.1],
            },
          ],
          joints: [],
          children: [],
        },
      ],
      rootGroup: new THREE.Group(),
      meshMap: new Map(),
      assets: {},
      meshCache: new Map(),
      compilerSettings: createCompilerSettings(),
      materialMap: new Map(),
      textureMap: new Map(),
      onProgress: ({ processedGeoms: nextProcessedGeoms }) => {
        processedGeoms = nextProcessedGeoms;
      },
    }),
    /geom transform failed/,
  );

  assert.equal(processedGeoms, 1);
});

test('does not let inherited geom rgba override material asset colors', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'steel_mat',
                rgba: [0.8, 0.6, 0.4, 1],
                hasExplicitRgba: false,
                contype: 0,
                conaffinity: 0,
              } as any,
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map([
      [
        'steel_mat',
        {
          name: 'steel_mat',
          rgba: [0.1, 0.2, 0.3, 1],
        },
      ],
    ]),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  let visualMaterial: THREE.MeshStandardMaterial | null = null as THREE.MeshStandardMaterial | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMaterial = mesh.material;
    }
  });

  assert.ok(visualMaterial);
  const expected = new THREE.Color().setRGB(0.1, 0.2, 0.3, THREE.SRGBColorSpace);
  assert.deepEqual(toFixedColorArray(visualMaterial.color), toFixedColorArray(expected));
  assert.equal(visualMaterial.toneMapped, false);
  assert.equal(visualMaterial.opacity, 1);
  assert.equal(visualMaterial.transparent, false);
});

test('inherits geom alpha onto material asset opacity without overriding asset rgb', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'steel_mat',
                rgba: [0.8, 0.6, 0.4, 0.25],
                hasExplicitRgba: false,
                contype: 0,
                conaffinity: 0,
              } as any,
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map([
      [
        'steel_mat',
        {
          name: 'steel_mat',
          rgba: [0.1, 0.2, 0.3, 1],
        },
      ],
    ]),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  let visualMaterial: THREE.MeshStandardMaterial | null = null as THREE.MeshStandardMaterial | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMaterial = mesh.material;
    }
  });

  assert.ok(visualMaterial);
  const expected = new THREE.Color().setRGB(0.1, 0.2, 0.3, THREE.SRGBColorSpace);
  assert.deepEqual(toFixedColorArray(visualMaterial.color), toFixedColorArray(expected));
  assert.equal(visualMaterial.transparent, true);
  assert.ok(Math.abs(visualMaterial.opacity - 0.25) < 1e-9);
  assert.equal(visualMaterial.depthWrite, false);
});

test('skips rendering fully transparent inherited material-backed geoms', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'hidden_inertial_proxy',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                material: 'body_mat',
                rgba: [0, 0, 0, 0],
                hasExplicitRgba: false,
                contype: 0,
                conaffinity: 0,
              } as any,
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map([
      [
        'body_mat',
        {
          name: 'body_mat',
          rgba: [0.7, 0.4, 0.2, 1],
        },
      ],
    ]),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const visualGroups: string[] = [];
  rootGroup.traverse((child: any) => {
    if (child?.isURDFVisual) {
      visualGroups.push(child.name);
    }
  });

  assert.deepEqual(visualGroups, []);
});

test('interprets explicit MJCF geom rgba values as sRGB to match URDF imports', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'body-shell',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                rgba: [1, 0.4235294118, 0.0392156863, 1],
                hasExplicitRgba: true,
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  let visualMaterial: THREE.MeshStandardMaterial | null = null as THREE.MeshStandardMaterial | null;
  rootGroup.traverse((child) => {
    if (!('isMesh' in child) || !(child as any).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData.isVisualMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      visualMaterial = mesh.material;
    }
  });

  assert.ok(visualMaterial);
  const expected = new THREE.Color().setRGB(1, 0.4235294118, 0.0392156863, THREE.SRGBColorSpace);
  assert.deepEqual(toFixedColorArray(visualMaterial.color), toFixedColorArray(expected));
  assert.equal(visualMaterial.toneMapped, false);
});

test('keeps collision proxy geoms out of runtime visuals when a dedicated visual geom exists', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base_link',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'base_visual',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                group: 1,
                contype: 0,
                conaffinity: 0,
              },
              {
                name: 'base_collision',
                type: 'box',
                size: [0.2, 0.15, 0.15],
                pos: [0, 0, 0.08],
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const visualGroups: string[] = [];
  const collisionGroups: string[] = [];

  rootGroup.traverse((child: any) => {
    if (child.isURDFVisual) {
      visualGroups.push(child.name);
    }

    if (child.isURDFCollider) {
      collisionGroups.push(child.name);
    }
  });

  assert.deepEqual(visualGroups, ['base_visual']);
  assert.deepEqual(collisionGroups, ['base_collision']);
});

test('restacks coincident MJCF visual roots to preserve authored overlay order', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'wing_link',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'wing_brown',
                type: 'box',
                size: [0.1, 0.05, 0.001],
                pos: [0.01, 0.02, 0.03],
                quat: [1, 0, 0, 0],
                contype: 0,
                conaffinity: 0,
              },
              {
                name: 'wing_membrane',
                type: 'box',
                size: [0.1, 0.05, 0.001],
                pos: [0.01, 0.02, 0.03],
                quat: [1, 0, 0, 0],
                rgba: [0.539, 0.686, 0.8, 0.4],
                hasExplicitRgba: true,
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const visualGroups = new Map<string, THREE.Object3D>();
  rootGroup.traverse((child: any) => {
    if (child?.isURDFVisual) {
      visualGroups.set(child.name, child);
    }
  });

  const wingBrown = visualGroups.get('wing_brown');
  const wingMembrane = visualGroups.get('wing_membrane');
  assert.ok(wingBrown);
  assert.ok(wingMembrane);
  assert.equal(wingBrown.userData.visualStackIndex, 0);
  assert.equal(wingMembrane.userData.visualStackIndex, 1);

  const membraneMesh = wingMembrane.children.find((child: any) => child?.isMesh) as
    | THREE.Mesh
    | undefined;
  assert.ok(membraneMesh);
  assert.equal(membraneMesh.renderOrder, 1);
  assert.ok(membraneMesh.material instanceof THREE.MeshStandardMaterial);
  assert.equal(membraneMesh.material.polygonOffset, true);
  assert.equal(membraneMesh.material.transparent, true);
  assert.equal(membraneMesh.material.depthWrite, false);
});

test('restacks coincident MJCF visual roots across fixed child bodies in world space', async () => {
  const rootGroup = new THREE.Group();
  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'finger_base',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'finger_base_inner',
                type: 'box',
                size: [0.05, 0.04, 0.03],
                pos: [0.01, 0.02, 0.03],
                quat: [1, 0, 0, 0],
                contype: 0,
                conaffinity: 0,
              },
            ],
            joints: [],
            children: [
              {
                name: 'finger_base_shell_body',
                pos: [0, 0, 0],
                geoms: [
                  {
                    name: 'finger_base_outer',
                    type: 'box',
                    size: [0.051, 0.041, 0.031],
                    pos: [0.01, 0.02, 0.03],
                    quat: [1, 0, 0, 0],
                    rgba: [0.05, 0.05, 0.05, 1],
                    hasExplicitRgba: true,
                    contype: 0,
                    conaffinity: 0,
                  },
                ],
                joints: [],
                children: [],
              },
            ],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const visualGroups = new Map<string, THREE.Object3D>();
  rootGroup.traverse((child: any) => {
    if (child?.isURDFVisual) {
      visualGroups.set(child.name, child);
    }
  });

  const innerVisual = visualGroups.get('finger_base_inner');
  const outerVisual = visualGroups.get('finger_base_outer');
  assert.ok(innerVisual);
  assert.ok(outerVisual);
  assert.equal(innerVisual.userData.visualStackIndex, 0);
  assert.equal(outerVisual.userData.visualStackIndex, 1);

  const outerMesh = outerVisual.children.find((child: any) => child?.isMesh) as
    | THREE.Mesh
    | undefined;
  assert.ok(outerMesh);
  assert.equal(outerMesh.renderOrder, 1);
  assert.ok(outerMesh.material instanceof THREE.MeshStandardMaterial);
  assert.equal(outerMesh.material.polygonOffset, true);
});

test('reports geom build progress while constructing the hierarchy', async () => {
  const rootGroup = new THREE.Group();
  const progressUpdates: Array<[number, number]> = [];

  await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base_link',
            pos: [0, 0, 0],
            geoms: [
              {
                name: 'base_visual',
                type: 'box',
                size: [0.1, 0.1, 0.1],
                contype: 0,
                conaffinity: 0,
              },
              {
                name: 'base_collision',
                type: 'sphere',
                size: [0.12],
              },
            ],
            joints: [],
            children: [],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
    onProgress: ({ processedGeoms, totalGeoms }) => {
      progressUpdates.push([processedGeoms, totalGeoms]);
    },
  });

  assert.deepEqual(progressUpdates, [
    [0, 2],
    [1, 2],
    [2, 2],
  ]);
});

test('tracks MJCF joint ref values without double-applying them to runtime joint transforms', async () => {
  const rootGroup = new THREE.Group();
  const { jointsMap, linksMap } = await buildMJCFHierarchy({
    bodies: [
      {
        name: 'world',
        pos: [0, 0, 0],
        geoms: [],
        joints: [],
        children: [
          {
            name: 'base_link',
            pos: [0, 0, 0],
            geoms: [],
            joints: [],
            children: [
              {
                name: 'knee_link',
                pos: [0, 0, 0],
                geoms: [
                  {
                    name: 'knee_visual',
                    type: 'box',
                    size: [0.1, 0.1, 0.1],
                    contype: 0,
                    conaffinity: 0,
                  },
                ],
                joints: [
                  {
                    name: 'knee_joint',
                    type: 'hinge',
                    axis: [0, 0, 1],
                    ref: Math.PI / 4,
                  },
                ],
                children: [],
              },
            ],
          },
        ],
      },
    ],
    rootGroup,
    meshMap: new Map(),
    assets: {},
    meshCache: new Map(),
    compilerSettings: createCompilerSettings(),
    materialMap: new Map(),
    textureMap: new Map(),
    sourceFileDir: '',
  });

  const joint = jointsMap.knee_joint as THREE.Object3D & {
    angle?: number;
    jointValue?: number;
    referencePosition?: number;
  };
  assert.ok(joint);
  assert.ok(Math.abs((joint.angle ?? 0) - Math.PI / 4) < 1e-9);
  assert.equal(joint.jointValue, Math.PI / 4);
  assert.equal(joint.referencePosition, Math.PI / 4);

  const expectedQuaternion = new THREE.Quaternion();
  const actualQuaternion = joint.quaternion.clone().normalize();
  assert.ok(actualQuaternion.angleTo(expectedQuaternion) <= 1e-9);

  const kneeLink = linksMap.knee_link as THREE.Object3D;
  assert.ok(kneeLink);
  const kneeLinkQuaternion = kneeLink.quaternion.clone().normalize();
  assert.ok(kneeLinkQuaternion.angleTo(new THREE.Quaternion()) <= 1e-9);
});
