import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { URDFCollider, URDFLink, URDFVisual } from '@/core/parsers/urdf/loader';
import {
  buildColladaRootNormalizationHints,
  createLoadingManager,
  createMeshLoader,
} from '@/core/loaders';
import { parseURDF } from '@/core/parsers/urdf/parser';
import {
  DEFAULT_LINK,
  GeometryType,
  type UrdfLink,
  type UrdfVisual as LinkGeometry,
} from '@/types';

import { applyGeometryPatchInPlace } from './robotLoaderGeometryPatch';
import { syncLoadedRobotScene } from './loadedRobotSceneSync';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function getWorldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function toFixedColorArray(color: THREE.Color, digits = 4): number[] {
  return color.toArray().map((value) => Number(value.toFixed(digits)));
}

function expectBoxEquals(actual: THREE.Box3, expected: THREE.Box3, epsilon = 1e-6) {
  const actualMin = actual.min.toArray();
  const expectedMin = expected.min.toArray();
  const actualMax = actual.max.toArray();
  const expectedMax = expected.max.toArray();

  actualMin.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMin[index]) < epsilon);
  });
  actualMax.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMax[index]) < epsilon);
  });
}

const makeGeometry = (overrides: Partial<LinkGeometry> = {}): LinkGeometry => ({
  type: GeometryType.BOX,
  dimensions: { x: 0.1, y: 0.2, z: 0.3 },
  color: '#808080',
  origin: {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  },
  visible: true,
  meshPath: undefined,
  ...overrides,
});

const makeLink = (overrides: Partial<UrdfLink> = {}): UrdfLink => ({
  id: 'rr_thigh_link',
  name: 'RR_thigh',
  visual: makeGeometry(),
  collision: makeGeometry({ type: GeometryType.NONE, meshPath: undefined }),
  collisionBodies: [],
  visible: true,
  ...overrides,
});

async function waitForPatchedChild(group: THREE.Object3D): Promise<THREE.Object3D> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const child = group.children[0];
    if (child) {
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for patched mesh object.');
}

test(
  'applyGeometryPatchInPlace preserves b2w base_link Collada scene roots before reattaching',
  { skip: typeof Worker === 'undefined' },
  async () => {
    const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/base_link.dae';
    const urdfContent = fs.readFileSync(
      'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
      'utf8',
    );
    const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
      parseURDF(urdfContent).links,
    );
    const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
    const manager = createLoadingManager({
      [meshPath]: meshDataUrl,
      'package://b2w_description/meshes/base_link.dae': meshDataUrl,
      base_link: meshDataUrl,
      'base_link.dae': meshDataUrl,
    });
    const meshLoader = createMeshLoader(
      {
        [meshPath]: meshDataUrl,
        'package://b2w_description/meshes/base_link.dae': meshDataUrl,
        base_link: meshDataUrl,
        'base_link.dae': meshDataUrl,
      },
      manager,
      '',
      { colladaRootNormalizationHints },
    );
    const referenceObject = await new Promise<THREE.Object3D>((resolve, reject) => {
      meshLoader('package://b2w_description/meshes/base_link.dae', manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });
    const referenceBox = getWorldBox(referenceObject);

    const robotModel = new THREE.Group() as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
    };
    const linkObject = new THREE.Group();
    linkObject.name = 'base_link';
    (linkObject as any).isURDFLink = true;
    const visualGroup = new URDFVisual();
    linkObject.add(visualGroup);
    robotModel.add(linkObject);
    robotModel.links = { base_link: linkObject };

    const previousLinkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        type: GeometryType.BOX,
        meshPath: undefined,
      }),
    });
    const linkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        type: GeometryType.MESH,
        meshPath: 'package://b2w_description/meshes/base_link.dae',
        dimensions: { x: 1, y: 1, z: 1 },
      }),
    });

    const applied = applyGeometryPatchInPlace({
      robotModel,
      patch: {
        linkName: 'base_link',
        previousLinkData,
        linkData,
        visualChanged: true,
        visualBodiesChanged: false,
        collisionChanged: false,
        collisionBodiesChanged: false,
        inertialChanged: false,
        visibilityChanged: false,
      },
      assets: {
        [meshPath]: meshDataUrl,
        base_link: meshDataUrl,
        'base_link.dae': meshDataUrl,
      },
      colladaRootNormalizationHints,
      showVisual: true,
      showCollision: false,
      linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
      invalidate: () => {},
    });

    assert.equal(applied, true);

    const patchedObject = await waitForPatchedChild(visualGroup);

    assert.ok(Math.abs(patchedObject.rotation.x - referenceObject.rotation.x) < 1e-6);
    assert.ok(Math.abs(patchedObject.rotation.y - referenceObject.rotation.y) < 1e-6);
    assert.ok(Math.abs(patchedObject.rotation.z - referenceObject.rotation.z) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.x - referenceObject.quaternion.x) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.y - referenceObject.quaternion.y) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.z - referenceObject.quaternion.z) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.w - referenceObject.quaternion.w) < 1e-6);
    expectBoxEquals(getWorldBox(patchedObject), referenceBox);
  },
);

test('applyGeometryPatchInPlace updates visual material colors in place for link color edits', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const authoredMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#808080'),
    name: 'authored_base_link',
  });
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), authoredMaterial);
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#808080',
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#12ab34',
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.notEqual(visualMesh.material, authoredMaterial);
  assert.equal(visualMesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal(
    (visualMesh.material as unknown as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
  assert.equal(
    (visualMesh.material as unknown as THREE.MeshStandardMaterial).userData.urdfColorApplied,
    true,
  );
});

test('applyGeometryPatchInPlace updates runtime link display metadata in place for link rename edits', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  linkObject.userData.linkId = 'base_link';
  linkObject.userData.displayName = 'base_link';
  (linkObject as any).isURDFLink = true;
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'renamed_base_link',
  });

  const invalidations: number[] = [];
  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      linkDisplayName: 'renamed_base_link',
      previousLinkData,
      linkData,
      visualChanged: false,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
      linkNameChanged: true,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {
      invalidations.push(1);
    },
  });

  assert.equal(applied, true);
  assert.equal(linkObject.name, 'base_link');
  assert.equal(linkObject.userData.linkId, 'base_link');
  assert.equal(linkObject.userData.displayName, 'renamed_base_link');
  assert.equal(invalidations.length, 1);
});

test('applyGeometryPatchInPlace updates MJCF visual colors in place through runtime links maps', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';

  const visualGroup = new URDFVisual();
  const authoredMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#808080'),
    name: 'mjcf_body',
  });
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), authoredMaterial);
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#808080',
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#12ab34',
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.notEqual(visualMesh.material, authoredMaterial);
  assert.equal(visualMesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal((visualMesh.material as THREE.MeshStandardMaterial).color.getHexString(), '12ab34');
  assert.equal((visualMesh.material as THREE.MeshStandardMaterial).userData.urdfColorApplied, true);
});

test('applyGeometryPatchInPlace updates folded MJCF synthetic link colors through the parent runtime link metadata', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const runtimeParentLink = new URDFLink();
  runtimeParentLink.name = 'base_link';

  const primaryVisual = new URDFVisual();
  primaryVisual.name = 'base_link_geom_0';
  primaryVisual.userData.visualOrder = 0;
  const primaryMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#808080'),
      name: 'base_primary',
    }),
  );
  primaryVisual.add(primaryMesh);

  const foldedAttachmentVisual = new URDFVisual();
  foldedAttachmentVisual.name = 'base_link_geom_1';
  foldedAttachmentVisual.userData.visualOrder = 1;
  const attachmentMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color('#999999'),
      name: 'base_attachment',
    }),
  );
  foldedAttachmentVisual.add(attachmentMesh);

  runtimeParentLink.add(primaryVisual);
  runtimeParentLink.add(foldedAttachmentVisual);
  robotModel.add(runtimeParentLink);
  robotModel.links = { base_link: runtimeParentLink };

  syncLoadedRobotScene({
    robot: robotModel,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          color: '#808080',
        },
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          color: '#999999',
        },
      },
    },
  });

  const previousLinkData = makeLink({
    id: 'base_link_geom_1',
    name: 'base_link_geom_1',
    visual: makeGeometry({
      color: '#999999',
    }),
  });
  const linkData = makeLink({
    id: 'base_link_geom_1',
    name: 'base_link_geom_1',
    visual: makeGeometry({
      color: '#12ab34',
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link_geom_1',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal((primaryMesh.material as THREE.MeshStandardMaterial).color.getHexString(), '808080');
  assert.equal(
    (attachmentMesh.material as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
  assert.equal(attachmentMesh.userData.parentLinkName, 'base_link_geom_1');
});

test('applyGeometryPatchInPlace rebuilds visual meshes when authored material textures change', () => {
  const originalTextureLoad = THREE.TextureLoader.prototype.load;
  const appliedTexture = new THREE.Texture();
  const requestedTexturePaths: string[] = [];
  THREE.TextureLoader.prototype.load = function mockTextureLoad(
    url: string,
    onLoad?: (texture: THREE.Texture<HTMLImageElement>) => void,
  ) {
    requestedTexturePaths.push(url);
    const texture = appliedTexture as THREE.Texture<HTMLImageElement>;
    onLoad?.(texture);
    return texture;
  };

  try {
    const robotModel = new THREE.Group() as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
    };
    const linkObject = new THREE.Group();
    linkObject.name = 'base_link';
    (linkObject as any).isURDFLink = true;

    const visualGroup = new URDFVisual();
    const visualMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ color: new THREE.Color('#808080') }),
    );
    visualGroup.add(visualMesh);
    linkObject.add(visualGroup);
    robotModel.add(linkObject);
    robotModel.links = { base_link: linkObject };

    const previousLinkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        color: '#808080',
      }),
    });
    const linkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        color: '#808080',
        authoredMaterials: [{ texture: 'textures/coat.png' }],
      }),
    });

    const applied = applyGeometryPatchInPlace({
      robotModel,
      patch: {
        linkName: 'base_link',
        previousLinkData,
        linkData,
        visualChanged: true,
        visualBodiesChanged: false,
        collisionChanged: false,
        collisionBodiesChanged: false,
        inertialChanged: false,
        visibilityChanged: false,
      },
      assets: {},
      showVisual: true,
      showCollision: false,
      linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
      invalidate: () => {},
    });

    assert.equal(applied, true);
    assert.equal(visualGroup.children.length, 1);
    assert.notEqual(visualGroup.children[0], visualMesh);
    const rebuiltMesh = visualGroup.children[0] as THREE.Mesh;
    assert.deepEqual(requestedTexturePaths, ['textures/coat.png']);
    assert.equal(rebuiltMesh.material instanceof THREE.MeshStandardMaterial, true);
    if (!(rebuiltMesh.material instanceof THREE.MeshStandardMaterial)) {
      assert.fail('expected rebuilt mesh to use MeshStandardMaterial');
    }
    assert.equal(rebuiltMesh.material.map, appliedTexture);
    assert.equal(rebuiltMesh.material.color.getHexString(), 'ffffff');
    assert.equal(rebuiltMesh.material.userData.urdfTextureApplied, true);
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
});

test('applyGeometryPatchInPlace keeps collision boxes rendered as cylinders during in-place updates', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new URDFLink();
  linkObject.name = 'base_link';

  const collisionGroup = new URDFCollider();
  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff') }),
  );
  collisionGroup.add(collisionMesh);
  linkObject.add(collisionGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    collision: makeGeometry({
      dimensions: { x: 0.4, y: 0.2, z: 0.2 },
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    collision: makeGeometry({
      dimensions: { x: 1.2, y: 0.4, z: 0.2 },
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: false,
      visualBodiesChanged: false,
      collisionChanged: true,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: true,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(collisionMesh.geometry.type, 'CylinderGeometry');
  assert.deepEqual(
    collisionMesh.scale.toArray().map((value) => Number(value.toFixed(4))),
    [0.2, 1.2, 0.1],
  );
  assert.equal(Number(collisionMesh.rotation.x.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.y.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.z.toFixed(4)), Number((Math.PI / 2).toFixed(4)));
});

test('applyGeometryPatchInPlace updates selected auxiliary visual bodies in place', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const primaryVisualGroup = new URDFVisual();
  const primaryVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: new THREE.Color('#808080') }),
  );
  primaryVisualGroup.add(primaryVisualMesh);

  const secondaryVisualGroup = new URDFVisual();
  const secondaryVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: new THREE.Color('#22c55e') }),
  );
  secondaryVisualGroup.add(secondaryVisualMesh);

  linkObject.add(primaryVisualGroup);
  linkObject.add(secondaryVisualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visualBodies: [
      makeGeometry({
        color: '#22c55e',
        origin: {
          xyz: { x: 0.1, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      }),
    ],
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visualBodies: [
      makeGeometry({
        color: '#12ab34',
        origin: {
          xyz: { x: 0.1, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      }),
    ],
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: false,
      visualBodiesChanged: true,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(
    (primaryVisualMesh.material as THREE.MeshPhongMaterial).color.getHexString(),
    '808080',
  );
  assert.equal(secondaryVisualMesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal(
    (secondaryVisualMesh.material as unknown as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
});

test('applyGeometryPatchInPlace applies double-sided rendering to marked mesh visuals in place', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({
      color: new THREE.Color('#808080'),
      side: THREE.FrontSide,
    }),
  );
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      type: GeometryType.MESH,
      meshPath: 'base_link_visual_0.obj',
      dimensions: { x: 1, y: 1, z: 1 },
      doubleSided: false,
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      type: GeometryType.MESH,
      meshPath: 'base_link_visual_0.obj',
      dimensions: { x: 1, y: 1, z: 1 },
      doubleSided: true,
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(visualGroup.children[0], visualMesh);
  assert.equal((visualMesh.material as THREE.Material).side, THREE.DoubleSide);
});

test('applyGeometryPatchInPlace updates authored multi-material colors in place without rebuilding the visual group', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'FR_hip';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    new THREE.MeshStandardMaterial({
      name: 'Material-effect',
      color: new THREE.Color('#bebebe'),
    }),
    new THREE.MeshStandardMaterial({
      name: '深色橡胶_001-effect',
      color: new THREE.Color('#111111'),
    }),
  ]);
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { FR_hip: linkObject };

  const previousLinkData = makeLink({
    id: 'FR_hip',
    name: 'FR_hip',
    visual: makeGeometry({
      type: GeometryType.MESH,
      meshPath: 'meshes/hip.dae',
      dimensions: { x: 1, y: 1, z: 1 },
      authoredMaterials: [
        { name: 'Material-effect', color: '#bebebe' },
        { name: '深色橡胶_001-effect', color: '#111111' },
      ],
      color: undefined,
    }),
  });

  const linkData = makeLink({
    id: 'FR_hip',
    name: 'FR_hip',
    visual: makeGeometry({
      type: GeometryType.MESH,
      meshPath: 'meshes/hip.dae',
      dimensions: { x: 1, y: 1, z: 1 },
      authoredMaterials: [
        { name: 'Material-effect', color: '#d8dce4' },
        { name: '深色橡胶_001-effect', color: '#161616' },
      ],
      color: undefined,
    }),
  });

  const originalChild = visualGroup.children[0];
  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'FR_hip',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(visualGroup.children.length, 1);
  assert.equal(visualGroup.children[0], originalChild);
  assert.ok(Array.isArray(visualMesh.material), 'expected mesh to keep material slots');
  if (!Array.isArray(visualMesh.material)) {
    assert.fail('expected multi-material mesh');
  }

  assert.deepEqual(
    toFixedColorArray(visualMesh.material[0].color),
    toFixedColorArray(new THREE.Color('#d8dce4')),
  );
  assert.deepEqual(
    toFixedColorArray(visualMesh.material[1].color),
    toFixedColorArray(new THREE.Color('#161616')),
  );
});

test(
  'applyGeometryPatchInPlace reapplies authored multi-material palettes onto rebuilt mesh visuals',
  { skip: typeof Worker === 'undefined' },
  async () => {
    const meshPath = 'test/unitree_ros/robots/go2_description/dae/hip.dae';
    const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;

    const robotModel = new THREE.Group() as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
    };
    const linkObject = new THREE.Group();
    linkObject.name = 'FR_hip';
    (linkObject as any).isURDFLink = true;

    const visualGroup = new URDFVisual();
    const placeholderMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ color: new THREE.Color('#808080') }),
    );
    visualGroup.add(placeholderMesh);
    linkObject.add(visualGroup);
    robotModel.add(linkObject);
    robotModel.links = { FR_hip: linkObject };

    const previousLinkData = makeLink({
      id: 'FR_hip',
      name: 'FR_hip',
      visual: makeGeometry({
        type: GeometryType.MESH,
        meshPath,
        dimensions: { x: 1, y: 1, z: 1 },
        authoredMaterials: [
          { name: 'Material-effect', color: '#ffffff' },
          { name: '深色橡胶_001-effect', color: '#000000' },
        ],
        color: undefined,
      }),
    });

    const linkData = makeLink({
      id: 'FR_hip',
      name: 'FR_hip',
      visual: makeGeometry({
        type: GeometryType.MESH,
        meshPath,
        dimensions: { x: 1, y: 1, z: 1 },
        authoredMaterials: [
          { name: 'Material-effect', color: '#d8dce4' },
          { name: '深色橡胶_001-effect', color: '#161616' },
        ],
        color: undefined,
      }),
    });

    const applied = applyGeometryPatchInPlace({
      robotModel,
      patch: {
        linkName: 'FR_hip',
        previousLinkData,
        linkData,
        visualChanged: true,
        visualBodiesChanged: false,
        collisionChanged: false,
        collisionBodiesChanged: false,
        inertialChanged: false,
        visibilityChanged: false,
      },
      assets: {
        [meshPath]: meshDataUrl,
      },
      showVisual: true,
      showCollision: false,
      linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
      invalidate: () => {},
    });

    assert.equal(applied, true);

    const rebuiltRoot = await waitForPatchedChild(visualGroup);
    let rebuiltMesh: THREE.Mesh | null = null;
    rebuiltRoot.traverse((child: any) => {
      if (!rebuiltMesh && child.isMesh) {
        rebuiltMesh = child as THREE.Mesh;
      }
    });

    assert.ok(rebuiltMesh, 'expected rebuilt multi-material mesh');
    if (!rebuiltMesh || !Array.isArray(rebuiltMesh.material)) {
      assert.fail('expected rebuilt visual mesh to keep multi-material slots');
    }

    const [primaryMaterial, secondaryMaterial] = rebuiltMesh.material;
    assert.equal(primaryMaterial instanceof THREE.MeshStandardMaterial, true);
    assert.equal(secondaryMaterial instanceof THREE.MeshStandardMaterial, true);
    if (
      !(primaryMaterial instanceof THREE.MeshStandardMaterial) ||
      !(secondaryMaterial instanceof THREE.MeshStandardMaterial)
    ) {
      assert.fail('expected rebuilt material palette to upgrade to MeshStandardMaterial');
    }

    assert.equal(primaryMaterial.userData.urdfMaterialName, 'Material-effect');
    assert.equal(secondaryMaterial.userData.urdfMaterialName, '深色橡胶_001-effect');
    assert.deepEqual(
      toFixedColorArray(primaryMaterial.color),
      toFixedColorArray(new THREE.Color('#d8dce4')),
    );
    assert.deepEqual(
      toFixedColorArray(secondaryMaterial.color),
      toFixedColorArray(new THREE.Color('#161616')),
    );
  },
);

test('applyGeometryPatchInPlace keeps highlighted visual meshes synchronized with new authored colors', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const authoredMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#808080'),
    name: 'authored_base_link',
  });
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), authoredMaterial) as THREE.Mesh<
    THREE.BoxGeometry,
    THREE.Material
  >;
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const highlightBaseMaterial = visualMesh.material as THREE.Material;
  const highlightSnapshot = {
    material: highlightBaseMaterial,
    renderOrder: visualMesh.renderOrder,
    materialStates: [
      {
        transparent: highlightBaseMaterial.transparent,
        opacity: highlightBaseMaterial.opacity,
        depthTest: highlightBaseMaterial.depthTest,
        depthWrite: highlightBaseMaterial.depthWrite,
        colorHex: (highlightBaseMaterial as THREE.MeshPhongMaterial).color.getHex(),
        emissiveHex: 0x000000,
        emissiveIntensity: 0,
      },
    ],
    activeRole: 'visual' as const,
  };
  visualMesh.userData.__urdfHighlightSnapshot = highlightSnapshot;
  visualMesh.material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#93c5fd'),
    emissive: new THREE.Color('#60a5fa'),
    emissiveIntensity: 0.38,
  });
  (visualMesh.material as THREE.Material).userData = {
    ...(visualMesh.material as THREE.Material).userData,
    isHighlightOverrideMaterial: true,
  };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({ color: '#808080' }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({ color: '#12ab34' }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(
    (highlightSnapshot.material as unknown as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
  assert.equal(
    (visualMesh.material as THREE.Material).userData?.isHighlightOverrideMaterial ?? false,
    true,
  );

  visualMesh.material = highlightSnapshot.material;
  assert.equal(
    (visualMesh.material as unknown as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
});
