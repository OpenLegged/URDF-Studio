import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { createMeshLoader, isCoplanarOffsetMaterial } from '@/core/loaders';
import { normalizeColladaUpAxis } from '@/core/loaders/colladaUpAxis';

import { cloneColladaScenePreservingRootTransform } from './colladaScene';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function getWorldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
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

test('cloneColladaScenePreservingRootTransform bakes b2w base_link root transforms into the preview clone', async () => {
  const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/base_link.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      base_link: meshDataUrl,
      'base_link.dae': meshDataUrl,
    },
    manager,
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('base_link.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result!);
    });
  });

  const { clone } = cloneColladaScenePreservingRootTransform(loadedObject);
  const referenceBox = getWorldBox(loadedObject);
  const loadedMeshRoot = loadedObject.children[0] as THREE.Object3D | undefined;
  assert.ok(loadedMeshRoot);
  assert.ok(Math.abs(loadedMeshRoot.position.y - 0.008) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.x - 0.5) < 1e-6);
  assert.ok(Math.abs(clone.rotation.x) < 1e-6);
  assert.ok(Math.abs(clone.rotation.y) < 1e-6);
  assert.ok(Math.abs(clone.rotation.z) < 1e-6);
  assert.ok(Math.abs(clone.quaternion.x) < 1e-6);
  assert.ok(Math.abs(clone.quaternion.y) < 1e-6);
  assert.ok(Math.abs(clone.quaternion.z) < 1e-6);
  assert.ok(Math.abs(clone.quaternion.w - 1) < 1e-6);
  expectBoxEquals(getWorldBox(clone), referenceBox);
});

test('cloneColladaScenePreservingRootTransform applies shared coplanar shell fixups to raw b2 base_link Collada scenes', () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/base_link.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const loader = new ColladaLoader();
  const dae = loader.parse(
    normalizeColladaUpAxis(colladaText).content,
    THREE.LoaderUtils.extractUrlBase(meshPath),
  );
  assert.ok(dae);

  const { clone } = cloneColladaScenePreservingRootTransform(dae.scene);
  let firstMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  clone.traverse((child) => {
    if (!firstMesh && (child as THREE.Mesh).isMesh) {
      firstMesh = child as THREE.Mesh;
    }
  });

  assert.ok(firstMesh);
  assert.ok(Array.isArray(firstMesh.material));
  const materials = firstMesh.material as THREE.Material[];

  assert.equal(materials.length, 4);
  assert.equal(materials[0]?.name, '磨砂铝合金.011');
  assert.equal(materials[1]?.name, 'logo.001');
  assert.equal(materials[2]?.name, '材质.023');
  assert.equal(materials[3]?.name, '材质.024');
  assert.equal(isCoplanarOffsetMaterial(materials[0]), false);
  assert.equal(isCoplanarOffsetMaterial(materials[1]), true);
  assert.equal(isCoplanarOffsetMaterial(materials[2]), true);
  assert.equal(isCoplanarOffsetMaterial(materials[3]), true);
});

test('cloneColladaScenePreservingRootTransform skips override mesh collection when preserving authored materials', () => {
  const meshPath = 'test/gazebo_models/cessna/meshes/body.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const loader = new ColladaLoader();
  const dae = loader.parse(colladaText, THREE.LoaderUtils.extractUrlBase(meshPath));
  assert.ok(dae);

  const defaultClone = cloneColladaScenePreservingRootTransform(dae.scene);
  const preservedClone = cloneColladaScenePreservingRootTransform(dae.scene, false, true);

  assert.ok(defaultClone.overrideMeshes.length > 0);
  assert.equal(preservedClone.overrideMeshes.length, 0);
});

test('cloneColladaScenePreservingRootTransform still collects textured meshes for explicit preview overrides', () => {
  const root = new THREE.Group();
  const texturedMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'),
    map: new THREE.Texture(),
  });
  const texturedMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), texturedMaterial);
  root.add(texturedMesh);

  const defaultClone = cloneColladaScenePreservingRootTransform(root);
  const preservedClone = cloneColladaScenePreservingRootTransform(root, false, true);

  assert.equal(defaultClone.overrideMeshes.length, 1);
  assert.equal((defaultClone.overrideMeshes[0] as THREE.Mesh).isMesh, true);
  assert.equal(preservedClone.overrideMeshes.length, 0);
});

test('cloneColladaScenePreservingRootTransform removes embedded Collada lights from preview clones', () => {
  const root = new THREE.Group();
  root.add(new THREE.PointLight(0xffffff, 1));
  root.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x999999 }),
    ),
  );

  const { clone } = cloneColladaScenePreservingRootTransform(root);

  const lights: THREE.Light[] = [];
  clone.traverse((child) => {
    if ((child as THREE.Light).isLight) {
      lights.push(child as THREE.Light);
    }
  });

  assert.equal(lights.length, 0);
});
