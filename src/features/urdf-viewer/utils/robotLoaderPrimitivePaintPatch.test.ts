import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { URDFVisual } from '@/core/parsers/urdf/loader';
import {
  DEFAULT_LINK,
  GeometryType,
  type UrdfLink,
  type UrdfVisual as LinkGeometry,
} from '@/types';

import { applyGeometryPatchInPlace } from './robotLoaderGeometryPatch';
import { createHighlightOverrideMaterial } from './materials';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

const makeGeometry = (overrides: Partial<LinkGeometry> = {}): LinkGeometry => ({
  type: GeometryType.BOX,
  dimensions: { x: 1, y: 1, z: 1 },
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
  ...DEFAULT_LINK,
  id: 'base_link',
  name: 'base_link',
  visual: makeGeometry(),
  collision: makeGeometry({ type: GeometryType.NONE, meshPath: undefined }),
  visualBodies: [],
  collisionBodies: [],
  visible: true,
  ...overrides,
});

test('applyGeometryPatchInPlace applies paint material groups to primitive box visuals in place', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkObject.name = 'base_link';
  linkObject.isURDFLink = true;

  const visualGroup = new URDFVisual();
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#808080') }),
  );
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    visual: makeGeometry({
      authoredMaterials: [{ name: 'base_gray', color: '#808080' }],
      meshMaterialGroups: [],
      color: undefined,
    }),
  });

  const linkData = makeLink({
    visual: makeGeometry({
      authoredMaterials: [
        { name: 'base_gray', color: '#808080' },
        { name: 'paint_base_link_0_1', color: '#007aff' },
      ],
      meshMaterialGroups: [
        { meshKey: '0', start: 0, count: 6, materialIndex: 1 },
        { meshKey: '0', start: 6, count: 30, materialIndex: 0 },
      ],
      color: undefined,
    }),
  });

  const originalChild = visualGroup.children[0];
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
  assert.equal(visualGroup.children[0], originalChild);
  assert.ok(Array.isArray(visualMesh.material), 'expected primitive visual to gain material slots');
  if (!Array.isArray(visualMesh.material)) {
    assert.fail('expected primitive visual to gain material slots');
  }
  assert.deepEqual(
    visualMesh.material.map((material) => `#${material.color.getHexString()}`),
    ['#808080', '#007aff'],
  );
  assert.deepEqual(
    visualMesh.geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    [
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 30, materialIndex: 0 },
    ],
  );
});

test('paint and restore keep the highlight registry snapshot synchronized with replacement materials', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkObject.name = 'base_link';
  linkObject.isURDFLink = true;

  const visualGroup = new URDFVisual();
  const originalBaseMaterial = new THREE.MeshStandardMaterial({
    color: '#527399',
    roughness: 0.28,
    metalness: 0.61,
  });
  const visualMesh = new THREE.Mesh<
    THREE.BoxGeometry,
    THREE.Material | THREE.Material[]
  >(new THREE.BoxGeometry(1, 1, 1), originalBaseMaterial);
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const highlightSnapshot = {
    material: originalBaseMaterial as THREE.Material | THREE.Material[],
    renderOrder: visualMesh.renderOrder,
    materialStates: [
      {
        transparent: originalBaseMaterial.transparent,
        opacity: originalBaseMaterial.opacity,
        depthTest: originalBaseMaterial.depthTest,
        depthWrite: originalBaseMaterial.depthWrite,
        colorHex: originalBaseMaterial.color.getHex(),
        emissiveHex: originalBaseMaterial.emissive.getHex(),
        emissiveIntensity: originalBaseMaterial.emissiveIntensity,
      },
    ],
    activeRole: 'visual' as const,
  };
  const highlightRegistry = new Map([[visualMesh, highlightSnapshot]]);
  visualMesh.userData.__urdfHighlightSnapshot = highlightSnapshot;
  visualMesh.material = createHighlightOverrideMaterial(originalBaseMaterial, 'visual');

  const baseGeometry = makeGeometry({
    authoredMaterials: [
      {
        name: 'base_gray',
        color: '#527399',
        roughness: 0.28,
        metalness: 0.61,
        alphaTest: 0.2,
      },
    ],
    meshMaterialGroups: [],
    color: undefined,
  });
  const paintedGeometry = makeGeometry({
    authoredMaterials: [
      {
        name: 'base_gray',
        color: '#527399',
        roughness: 0.28,
        metalness: 0.61,
        alphaTest: 0.2,
      },
      { name: 'paint_base_link_0_1', color: '#007aff' },
    ],
    meshMaterialGroups: [
      { meshKey: '0', start: 0, count: 6, materialIndex: 1 },
      { meshKey: '0', start: 6, count: 30, materialIndex: 0 },
    ],
    color: undefined,
  });
  const baseLink = makeLink({ visual: baseGeometry });
  const paintedLink = makeLink({ visual: paintedGeometry });

  const applyPatch = (previousLinkData: UrdfLink, linkData: UrdfLink) =>
    applyGeometryPatchInPlace({
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

  assert.equal(applyPatch(baseLink, paintedLink), true);
  assert.equal(highlightRegistry.get(visualMesh), highlightSnapshot);
  assert.equal(visualMesh.userData.__urdfHighlightSnapshot, highlightSnapshot);
  const activePaintedSnapshotMaterial = highlightSnapshot.material;
  assert.ok(Array.isArray(activePaintedSnapshotMaterial));
  if (!Array.isArray(activePaintedSnapshotMaterial)) {
    assert.fail('highlight snapshot should track the painted base palette');
  }
  assert.deepEqual(
    activePaintedSnapshotMaterial.map(
      (material) => `#${(material as THREE.MeshStandardMaterial).color.getHexString()}`,
    ),
    ['#527399', '#007aff'],
  );
  assert.ok(Array.isArray(visualMesh.material));
  assert.ok(
    (visualMesh.material as THREE.Material[]).every(
      (material) => material.userData.isHighlightOverrideMaterial === true,
    ),
  );

  const paintedSnapshotMaterial = activePaintedSnapshotMaterial;
  assert.equal(applyPatch(paintedLink, baseLink), true);
  assert.equal(highlightRegistry.get(visualMesh), highlightSnapshot);
  assert.equal(visualMesh.userData.__urdfHighlightSnapshot, highlightSnapshot);
  assert.notEqual(highlightSnapshot.material, paintedSnapshotMaterial);
  assert.equal(Array.isArray(highlightSnapshot.material), false);
  const restoredSnapshotMaterial = highlightSnapshot.material;
  if (Array.isArray(restoredSnapshotMaterial)) {
    assert.fail('highlight snapshot should track a single restored base material');
  }
  assert.equal(
    (restoredSnapshotMaterial as THREE.MeshStandardMaterial).color.getHexString(),
    '527399',
  );
  assert.equal(
    (restoredSnapshotMaterial as THREE.MeshStandardMaterial).roughness,
    0.28,
  );
  assert.equal(
    (restoredSnapshotMaterial as THREE.MeshStandardMaterial).metalness,
    0.61,
  );
  assert.equal(restoredSnapshotMaterial.alphaTest, 0.2);
  assert.equal(visualMesh.geometry.groups.length, 0);
  assert.equal(
    (visualMesh.material as THREE.Material).userData.isHighlightOverrideMaterial,
    true,
  );

  // This is exactly what useHighlightManager does when hover ends. The map must
  // now restore the fresh base, never the material captured before painting.
  visualMesh.material = highlightRegistry.get(visualMesh)!.material;
  if (Array.isArray(visualMesh.material)) {
    assert.fail('restoring the highlight snapshot should attach one base material');
  }
  assert.equal(
    (visualMesh.material as THREE.MeshStandardMaterial).color.getHexString(),
    '527399',
  );
});
