import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser';
import { buildRuntimeRobotFromState } from '@/core/parsers/urdf/loader/buildRuntimeRobotFromState';

import { syncCoplanarGroundDepth } from './coplanarGroundDepth';
import { syncLoadedRobotScene } from '../renderers/loadedRobotSceneSync';

function createFloor(width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.1),
    new THREE.MeshStandardMaterial(),
  );
  mesh.position.z = -0.05;
  mesh.userData.isVisualMesh = true;
  return mesh;
}

function createScene(): { robot: THREE.Group; ground: THREE.Mesh; floor: THREE.Mesh } {
  const robot = new THREE.Group();
  const ground = createFloor(1000, 1000);
  const floor = createFloor(4.8, 4.8);
  robot.add(ground, floor);
  return { robot, ground, floor };
}


test('only the containing ground yields a coplanar depth tie, without changing geometry', () => {
  const { robot, ground, floor } = createScene();
  const originalVertices = ground.geometry.getAttribute('position').array.slice();
  const originalPosition = ground.position.clone();
  const originalMaterial = ground.material;
  const floorBefore = floor.onBeforeRender;
  assert.equal(syncCoplanarGroundDepth(robot, true), true);
  assert.equal(ground.userData.coplanarGroundDepthOffset, true);
  assert.equal(floor.userData.coplanarGroundDepthOffset, undefined);
  assert.equal(floor.onBeforeRender, floorBefore);
  assert.notEqual(ground.material, originalMaterial);
  assert.deepEqual(ground.geometry.getAttribute('position').array, originalVertices);
  assert.deepEqual(ground.position, originalPosition);
  assert.equal(ground.visible, true);
  assert.equal(floor.visible, true);
  assert.equal(syncCoplanarGroundDepth(robot), false, 'unchanged sync reuses the private material');
});

test('ground shader composes authored hooks and supports logarithmic and ordinary depth', () => {
  const { robot, ground } = createScene();
  const first = new THREE.MeshStandardMaterial();
  const second = new THREE.MeshStandardMaterial();
  const texture = new THREE.Texture();
  first.map = texture;
  first.onBeforeCompile = (shader) => { shader.fragmentShader += '\n// authored hook'; };
  first.customProgramCacheKey = () => 'authored-cache-key';
  second.polygonOffset = true;
  second.polygonOffsetFactor = 7;
  second.polygonOffsetUnits = 8;
  ground.material = [first, second];
  syncCoplanarGroundDepth(robot, true);
  assert.ok(Array.isArray(ground.material));
  const replacements = ground.material;
  for (const material of replacements) {
    const shader = {
      uniforms: {}, vertexShader: '', fragmentShader: '#include <logdepthbuf_fragment>',
    } as Parameters<THREE.Material['onBeforeCompile']>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    assert.match(shader.fragmentShader, /#ifdef USE_LOGARITHMIC_DEPTH_BUFFER/);
    assert.match(shader.fragmentShader, /gl_FragDepth = min\(1.0, gl_FragDepth \+ 0.000002\)/);
    assert.equal(material.polygonOffset, true);
    assert.ok(material.polygonOffsetFactor >= 2);
    assert.ok(material.polygonOffsetUnits >= 2);
  }
  const shader = {
    uniforms: {}, vertexShader: '', fragmentShader: '#include <logdepthbuf_fragment>',
  } as Parameters<THREE.Material['onBeforeCompile']>[0];
  replacements[0]!.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.match(shader.fragmentShader, /authored hook/);
  assert.equal(replacements[0]!.customProgramCacheKey(), 'authored-cache-key|coplanar-ground-depth-v1');
  assert.equal((replacements[0] as THREE.MeshStandardMaterial).map, texture);
  assert.equal(first.polygonOffset, false, 'shared original material is untouched');
  assert.equal(second.polygonOffsetFactor, 7);
});

test('paint replacement and cleanup release private materials without disposing shared textures', () => {
  const { robot, ground, floor } = createScene();
  const original = ground.material as THREE.Material;
  const texture = new THREE.Texture();
  (original as THREE.MeshStandardMaterial).map = texture;
  let originalDisposed = 0;
  let textureDisposed = 0;
  original.addEventListener('dispose', () => { originalDisposed += 1; });
  texture.addEventListener('dispose', () => { textureDisposed += 1; });
  syncCoplanarGroundDepth(robot, true);
  const firstClone = ground.material as THREE.Material;
  let firstCloneDisposed = 0;
  firstClone.addEventListener('dispose', () => { firstCloneDisposed += 1; });
  floor.visible = false;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.material, original);
  assert.equal(firstCloneDisposed, 1);
  assert.equal(originalDisposed, 0, 'restored source material stays live');
  floor.visible = true;
  syncCoplanarGroundDepth(robot);
  const paintOld = ground.material as THREE.Material;
  ground.material = new THREE.MeshStandardMaterial({ color: 'red' });
  paintOld.dispose();
  assert.equal(originalDisposed, 1, 'displaced original is released with its clone');
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, true);
  const latest = ground.material as THREE.Material;
  latest.dispose();
  assert.equal(textureDisposed, 0, 'texture lifetime remains with the asset owner');
});

test('private ground cleanup keeps an original material shared by another mesh live', () => {
  const { robot, ground } = createScene();
  const original = ground.material as THREE.Material;
  const sibling = createFloor(1, 1);
  sibling.position.z = 3;
  sibling.material = original;
  robot.add(sibling);
  let disposed = 0;
  original.addEventListener('dispose', () => { disposed += 1; });
  syncCoplanarGroundDepth(robot, true);
  const clone = ground.material as THREE.Material;
  ground.material = new THREE.MeshStandardMaterial();
  clone.dispose();
  assert.equal(disposed, 0);
  assert.equal(sibling.material, original);
  assert.equal(original.polygonOffset, false);
});

test('paint cloned from the display material restores the authored ordinary depth settings', () => {
  const { robot, ground, floor } = createScene();
  const original = ground.material as THREE.Material;
  original.polygonOffset = false;
  original.polygonOffsetFactor = -3;
  original.polygonOffsetUnits = -4;
  syncCoplanarGroundDepth(robot, true);
  const displayed = ground.material as THREE.Material;
  const painted = displayed.clone();
  ground.material = painted;
  displayed.dispose();
  assert.equal(painted.polygonOffset, true, 'Three clones the display offset');
  syncCoplanarGroundDepth(robot);
  assert.equal(painted.polygonOffset, false, 'the new baseline recovers authored settings');
  floor.visible = false;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.material, painted);
  assert.equal(painted.polygonOffset, false);
  assert.equal(painted.polygonOffsetFactor, -3);
  assert.equal(painted.polygonOffsetUnits, -4);
  const shader = {
    uniforms: {}, vertexShader: '', fragmentShader: '#include <logdepthbuf_fragment>',
  } as Parameters<THREE.Material['onBeforeCompile']>[0];
  painted.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  assert.doesNotMatch(shader.fragmentShader, /gl_FragDepth = min/);
});

test('late source texture updates refresh the private clone on load completion sync', () => {
  const { robot, ground } = createScene();
  const original = ground.material as THREE.MeshStandardMaterial;
  syncCoplanarGroundDepth(robot, true);
  const previous = ground.material;
  const texture = new THREE.Texture();
  original.map = texture;
  original.needsUpdate = true;
  assert.equal(syncCoplanarGroundDepth(robot), true);
  assert.notEqual(ground.material, previous);
  assert.equal((ground.material as THREE.MeshStandardMaterial).map, texture);
  assert.equal(ground.userData.coplanarGroundDepthOffset, true);
});

test('a late live texture update survives restoring the source material', () => {
  const { robot, ground, floor } = createScene();
  const original = ground.material as THREE.MeshStandardMaterial;
  syncCoplanarGroundDepth(robot, true);
  const live = ground.material as THREE.MeshStandardMaterial;
  const texture = new THREE.Texture();
  live.map = texture;
  live.needsUpdate = true;
  floor.visible = false;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.material, original);
  assert.equal(original.map, texture);
  assert.equal(original.polygonOffset, false);
});

test('visibility, move, resize, and removal restore the original material', () => {
  const { robot, ground, floor } = createScene();
  const originalMaterial = ground.material;
  syncCoplanarGroundDepth(robot, true);
  floor.visible = false;
  assert.equal(syncCoplanarGroundDepth(robot), true);
  assert.equal(ground.material, originalMaterial);
  floor.visible = true;
  assert.equal(syncCoplanarGroundDepth(robot), true);
  floor.position.z += 0.001;
  assert.equal(syncCoplanarGroundDepth(robot), true);
  assert.equal(ground.material, originalMaterial);
  floor.position.z = -0.05;
  syncCoplanarGroundDepth(robot);
  floor.scale.set(300, 300, 1);
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.material, originalMaterial);
  assert.equal(floor.userData.coplanarGroundDepthOffset, true, 'larger current surface yields');
  robot.remove(ground);
  syncCoplanarGroundDepth(robot);
  assert.equal(floor.userData.coplanarGroundDepthOffset, undefined);
});

test('yaw and translation use actual containment, while tilted/disjoint/equal surfaces remain untouched', () => {
  const { robot, ground, floor } = createScene();
  ground.position.x = 20;
  floor.position.set(21, 2, -0.05);
  floor.rotation.z = Math.PI / 4;
  assert.equal(syncCoplanarGroundDepth(robot, true), true);
  floor.rotation.x = 0.1;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, undefined);
  floor.rotation.set(0, 0, Math.PI / 4);
  floor.position.x = 520;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, undefined);
  floor.position.copy(ground.position);
  floor.rotation.set(0, 0, 0);
  floor.geometry = new THREE.BoxGeometry(1000, 1000, 0.1);
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, undefined);
  assert.equal(floor.userData.coplanarGroundDepthOffset, undefined);
});

test('collision surfaces, mesh bounds, and disabled source formats never acquire the floor bias', () => {
  const { robot, ground, floor } = createScene();
  assert.equal(syncCoplanarGroundDepth(robot), false);
  floor.userData.isCollisionMesh = true;
  assert.equal(syncCoplanarGroundDepth(robot, true), false);
  floor.userData.isCollisionMesh = false;
  const geometry = new THREE.BufferGeometry().copy(floor.geometry);
  floor.geometry = geometry;
  assert.equal(syncCoplanarGroundDepth(robot), false, 'arbitrary mesh AABBs are not floor evidence');
  floor.geometry = new THREE.BoxGeometry(4.8, 4.8, 0.1);
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, true);
  assert.equal(syncCoplanarGroundDepth(robot, false), true);
  assert.equal(ground.userData.coplanarGroundDepthOffset, undefined);
});

test('a hidden scene restores materials and supports being shown again', () => {
  const { robot, ground } = createScene();
  syncCoplanarGroundDepth(robot, true);
  robot.visible = false;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, undefined);
  robot.visible = true;
  syncCoplanarGroundDepth(robot);
  assert.equal(ground.userData.coplanarGroundDepthOffset, true);
});

test('actual MJCF runtime keeps authored ground, room floor, and colliders intact', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    Document: dom.window.Document,
    Element: dom.window.Element,
  });
  const data = parseMJCF(`<mujoco><worldbody>
    <geom name="background" type="box" size="500 500 0.05" pos="0 0 -0.05"/>
    <body name="room" pos="0 0 -0.05">
      <geom name="floor" type="box" size="2.4 2.4 0.05"/>
    </body>
  </worldbody></mujoco>`);
  assert.ok(data);
  const original = JSON.stringify(data);
  const robot = await buildRuntimeRobotFromState({
    ...data,
    manager: new THREE.LoadingManager(),
    loadMeshCb: (_path, _manager, done) => done(null),
  });
  syncLoadedRobotScene({
    robot,
    robotLinks: data.links,
    sourceFormat: 'mjcf',
    showVisual: true,
    showCollision: true,
    showMjcfWorldLink: true,
  });
  const offsetMeshes: THREE.Object3D[] = [];
  robot.traverse((object) => {
    if (object.userData.coplanarGroundDepthOffset) offsetMeshes.push(object);
    if (object.userData.isCollisionMesh) {
      assert.equal(object.userData.coplanarGroundDepthOffset, undefined);
    }
  });
  assert.equal(offsetMeshes.length, 1);
  assert.equal(offsetMeshes[0]!.parent?.userData.geometryName, 'background');
  assert.equal(JSON.stringify(data), original, 'display policy cannot rewrite source data');
});
