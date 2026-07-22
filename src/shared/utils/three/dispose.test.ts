import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { markSharedThreeResource } from '@/core/utils/threeResourceOwnership';
import { disposeObject3D, disposeObject3DGraph, disposeWebGLRenderer } from './dispose.ts';

test('disposeObject3D disposes shared skeletons once and clears the object tree', () => {
  const root = new THREE.Group();
  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).links = {};
  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).joints = {};
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  let disposeCallCount = 0;
  const originalDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => {
    disposeCallCount += 1;
    originalDispose();
  };

  const meshA = new THREE.SkinnedMesh(geometry, material);
  meshA.add(bone);
  meshA.bind(skeleton);
  root.add(meshA);
  (root as THREE.Group & { links?: Record<string, THREE.Object3D> }).links!.meshA = meshA;

  const meshB = new THREE.SkinnedMesh(geometry.clone(), material.clone());
  meshB.bind(skeleton);
  root.add(meshB);
  (root as THREE.Group & { joints?: Record<string, THREE.Object3D> }).joints!.meshB = meshB;

  disposeObject3D(root);

  assert.equal(disposeCallCount, 1);
  assert.equal(root.children.length, 0);
  assert.deepEqual((root as THREE.Group & { links?: Record<string, THREE.Object3D> }).links, {});
  assert.deepEqual((root as THREE.Group & { joints?: Record<string, THREE.Object3D> }).joints, {});
});

test('disposeObject3DGraph clears primitive clones without disposing shared geometry or material', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  let skeletonDisposeCount = 0;
  let geometryDisposeCount = 0;
  let materialDisposeCount = 0;
  const originalSkeletonDispose = skeleton.dispose.bind(skeleton);
  const originalGeometryDispose = geometry.dispose.bind(geometry);
  const originalMaterialDispose = material.dispose.bind(material);
  skeleton.dispose = () => {
    skeletonDisposeCount += 1;
    originalSkeletonDispose();
  };
  geometry.dispose = () => {
    geometryDisposeCount += 1;
    originalGeometryDispose();
  };
  material.dispose = () => {
    materialDisposeCount += 1;
    originalMaterialDispose();
  };

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.add(bone);
  mesh.bind(skeleton);
  root.add(mesh);

  disposeObject3DGraph(root);

  assert.equal(skeletonDisposeCount, 1);
  assert.equal(geometryDisposeCount, 0);
  assert.equal(materialDisposeCount, 0);
  assert.equal(root.children.length, 0);
});

test('disposeObject3D preserves resources explicitly shared across backend scene graphs', () => {
  const root = new THREE.Group();
  const sharedGeometry = markSharedThreeResource(new THREE.BoxGeometry(1, 1, 1));
  const sharedMaterial = markSharedThreeResource(new THREE.MeshBasicMaterial());
  let geometryDisposeCount = 0;
  let materialDisposeCount = 0;
  sharedGeometry.addEventListener('dispose', () => {
    geometryDisposeCount += 1;
  });
  sharedMaterial.addEventListener('dispose', () => {
    materialDisposeCount += 1;
  });
  root.add(new THREE.Mesh(sharedGeometry, sharedMaterial));

  disposeObject3D(root);

  assert.equal(geometryDisposeCount, 0);
  assert.equal(materialDisposeCount, 0);
  assert.equal(root.children.length, 0);
});

test('disposeWebGLRenderer releases renderer caches without forcing context loss by default', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
    forceContextLoss: () => {
      calls.push('force-context-loss');
    },
  } as any;

  disposeWebGLRenderer(renderer);

  assert.deepEqual(calls, ['render-lists', 'dispose']);
});

test('disposeWebGLRenderer tolerates teardown failures and keeps progressing', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
        throw new Error('cache cleanup failed');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
  } as any;

  disposeWebGLRenderer(renderer);

  assert.deepEqual(calls, ['render-lists', 'dispose']);
});

test('disposeWebGLRenderer can explicitly force context loss during final teardown', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
    forceContextLoss: () => {
      calls.push('force-context-loss');
    },
  } as any;

  disposeWebGLRenderer(renderer, { forceContextLoss: true });

  assert.deepEqual(calls, ['render-lists', 'dispose', 'force-context-loss']);
});
