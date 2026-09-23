import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { cacheStaticShadowMaps } from './staticShadowCache';
import { requestShadowMapRefresh, runWithShadowMapUpdatesPaused } from './shadowMapRefresh';

function createHarness() {
  let passes = 0;
  const renderer = {
    localClippingEnabled: false,
    clippingPlanes: [] as THREE.Plane[],
    shadowMap: {
      enabled: true, autoUpdate: true, needsUpdate: false,
      type: THREE.PCFSoftShadowMap as THREE.ShadowMapType, cullFace: THREE.BackSide,
      render(lights: THREE.Light[], _scene: THREE.Scene, _camera: THREE.Camera) {
        if (!this.enabled || lights.length === 0 || (!this.autoUpdate && !this.needsUpdate)) return;
        passes++;
        this.needsUpdate = false;
        for (const light of lights) if (light.shadow) light.shadow.needsUpdate = false;
      },
    },
  };
  const scene = new THREE.Scene();
  const joint = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.castShadow = true;
  joint.add(mesh);
  scene.add(joint);
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.position.set(3, 4, 5);
  scene.add(light, light.target);
  const camera = new THREE.PerspectiveCamera();
  const lights: THREE.Light[] = [light];
  const original = renderer.shadowMap.render;
  const release = cacheStaticShadowMaps(renderer);
  const render = () => {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    renderer.shadowMap.render(lights, scene, camera);
  };
  return { renderer, scene, joint, mesh, light, lights, camera, original, release, render, get passes() { return passes; } };
}

test('unchanged rigid shadows skip GPU passes without changing the renderer policy', () => {
  const h = createHarness();
  h.render();
  for (let i = 0; i < 10; i++) h.render();
  assert.equal(h.passes, 1);
  h.camera.position.x++;
  h.mesh.material.color.set('red');
  h.render();
  assert.equal(h.passes, 1, 'camera motion and diffuse color do not change directional depth');
  assert.equal(h.renderer.shadowMap.autoUpdate, true);
  h.release();
  assert.equal(h.renderer.shadowMap.render, h.original);
});

test('live pose changes refresh once per render and a held still pose reuses its shadow', () => {
  const h = createHarness();
  h.render();
  for (let step = 1; step <= 5; step++) {
    h.joint.rotation.z = step * 0.1;
    // Multiple input/store notifications before the frame share one dirty flag.
    requestShadowMapRefresh(h.renderer);
    requestShadowMapRefresh(h.renderer);
    requestShadowMapRefresh(h.renderer);
    h.render();
    assert.equal(h.passes, step + 1);
    for (let heldFrame = 0; heldFrame < 5; heldFrame++) h.render();
    assert.equal(h.passes, step + 1, 'holding the pose must not regenerate shadows');
  }
  h.joint.position.x = 2;
  h.render();
  assert.equal(h.passes, 7, 'moving the whole component updates its shadow');
  h.camera.position.x = 3;
  h.render();
  assert.equal(h.passes, 7, 'camera-only navigation keeps the same directional depth');
  assert.equal(h.renderer.shadowMap.autoUpdate, true);
  h.release();
});

test('joint/component transforms, parent visibility, casting and layers invalidate cached depth', () => {
  const h = createHarness();
  h.render();
  const changes = [
    () => { h.joint.rotation.z = 0.7; },
    () => { h.joint.position.x = 2; },
    () => { h.joint.visible = false; },
    () => { h.joint.visible = true; },
    () => { h.mesh.castShadow = false; },
    () => { h.mesh.castShadow = true; },
    () => { h.camera.layers.set(2); },
    () => { h.mesh.layers.set(2); },
  ];
  for (const change of changes) {
    const before = h.passes; change(); h.render(); h.render();
    assert.equal(h.passes, before + 1);
  }
  h.release();
});

test('async mesh arrival, replacement, geometry uploads, draw ranges and groups invalidate', () => {
  const h = createHarness(); h.render();
  const extra = new THREE.Mesh(new THREE.SphereGeometry(), h.mesh.material); extra.castShadow = true;
  const changes = [
    () => { h.joint.add(extra); },
    () => { h.joint.remove(extra); },
    () => { h.mesh.geometry = new THREE.BoxGeometry(2, 3, 4); },
    () => { h.mesh.geometry.attributes.position.needsUpdate = true; },
    () => { h.mesh.geometry.index!.needsUpdate = true; },
    () => { h.mesh.geometry.setDrawRange(0, 3); },
    () => { h.mesh.geometry.groups[0].count = 2; },
    () => { h.mesh.geometry.computeBoundingSphere(); h.mesh.geometry.boundingSphere!.radius++; },
  ];
  for (const change of changes) {
    const before = h.passes; change(); h.render(); h.render(); assert.equal(h.passes, before + 1);
  }
  h.release();
});

test('material visibility, shadow side, alpha and depth settings retain correct invalidation', () => {
  const h = createHarness(); h.render();
  const changes = [
    () => { h.mesh.material.visible = false; },
    () => { h.mesh.material.visible = true; },
    () => { h.mesh.material.side = THREE.DoubleSide; },
    () => { h.mesh.material.shadowSide = THREE.FrontSide; },
    () => { h.mesh.material.alphaTest = 0.5; },
    () => { h.mesh.material.depthWrite = false; },
  ];
  for (const change of changes) {
    const before = h.passes; change(); h.render(); h.render(); assert.equal(h.passes, before + 1);
  }
  h.mesh.material.alphaMap = new THREE.Texture();
  const before = h.passes; h.render(); h.render(); assert.equal(h.passes, before + 2, 'animated alpha uses ordinary updating');
  h.release();
});

test('light target, projection, resolution and explicit refreshes cannot reuse stale shadow maps', () => {
  const h = createHarness(); h.render();
  const changes = [
    () => { h.light.position.x++; },
    () => { h.light.target.position.x++; },
    () => { h.light.shadow.camera.up.set(0, 0, 1); },
    () => { h.light.shadow.camera.left--; h.light.shadow.camera.updateProjectionMatrix(); },
    () => { h.light.shadow.mapSize.set(256, 256); },
    () => { h.light.shadow.map = new THREE.WebGLRenderTarget(256, 256); },
    () => { h.light.shadow.map = null; },
    () => { h.light.shadow.needsUpdate = true; },
    () => { requestShadowMapRefresh(h.renderer); },
  ];
  for (const change of changes) {
    const before = h.passes; change(); h.render(); h.render(); assert.equal(h.passes, before + 1);
  }
  h.release();
});

test('outline auxiliary passes leave the primary scene cache and pending updates intact', () => {
  const h = createHarness(); h.render();
  runWithShadowMapUpdatesPaused(h.renderer, () => {
    h.joint.visible = false; h.render(); h.joint.visible = true;
  });
  h.render(); assert.equal(h.passes, 1);
  requestShadowMapRefresh(h.renderer);
  runWithShadowMapUpdatesPaused(h.renderer, () => { h.render(); });
  h.render(); assert.equal(h.passes, 2);
  h.release();
});

test('custom, deformed and clipping paths preserve automatic shadow rendering', () => {
  const cases = [
    (h: ReturnType<typeof createHarness>) => { h.mesh.customDepthMaterial = new THREE.MeshDepthMaterial(); },
    (h: ReturnType<typeof createHarness>) => { h.mesh.onBeforeShadow = () => {}; },
    (h: ReturnType<typeof createHarness>) => { h.light.shadow.updateMatrices = () => {}; },
    (h: ReturnType<typeof createHarness>) => { h.mesh.geometry.morphAttributes.position = [h.mesh.geometry.attributes.position]; },
    (h: ReturnType<typeof createHarness>) => { h.renderer.localClippingEnabled = true; },
    (h: ReturnType<typeof createHarness>) => { h.renderer.shadowMap.type = THREE.VSMShadowMap; },
    (h: ReturnType<typeof createHarness>) => { h.mesh.material.displacementMap = new THREE.Texture(); },
    (h: ReturnType<typeof createHarness>) => { const skin = new THREE.SkinnedMesh(h.mesh.geometry, h.mesh.material); skin.castShadow = true; h.scene.add(skin); },
  ];
  for (const configure of cases) {
    const h = createHarness(); configure(h); h.render(); h.render(); assert.equal(h.passes, 2); h.release();
  }
});

test('fullscreen outline/compositor scenes without lights cannot replace the primary cache', () => {
  const h = createHarness(); h.render();
  h.renderer.shadowMap.render([], new THREE.Scene(), new THREE.OrthographicCamera());
  h.render(); assert.equal(h.passes, 1);
  requestShadowMapRefresh(h.renderer);
  h.renderer.shadowMap.render([], new THREE.Scene(), h.camera);
  assert.equal(h.renderer.shadowMap.needsUpdate, true);
  h.render(); assert.equal(h.passes, 2);
  h.release();
});

test('renderer-scoped ownership supports multiple lighting instances and StrictMode remounts', () => {
  const h = createHarness();
  const wrapper = h.renderer.shadowMap.render;
  const releaseSecond = cacheStaticShadowMaps(h.renderer);
  assert.equal(h.renderer.shadowMap.render, wrapper);
  h.release(); h.release();
  assert.equal(h.renderer.shadowMap.render, wrapper);
  releaseSecond(); assert.equal(h.renderer.shadowMap.render, h.original);
  const releaseRemount = cacheStaticShadowMaps(h.renderer);
  h.render(); h.render(); assert.equal(h.passes, 1);
  releaseRemount();
});

test('failed render never commits a cached state and cleanup preserves later renderer wrappers', () => {
  const h = createHarness(); h.release();
  const original = h.renderer.shadowMap.render;
  let fail = true;
  h.renderer.shadowMap.render = (...args) => { if (fail) throw new Error('render failure'); original.call(h.renderer.shadowMap, ...args); };
  const release = cacheStaticShadowMaps(h.renderer);
  assert.throws(h.render, /render failure/);
  fail = false; h.render(); h.render(); assert.equal(h.passes, 1);
  const inner = h.renderer.shadowMap.render;
  const outer: typeof inner = (...args) => inner(...args);
  h.renderer.shadowMap.render = outer;
  release(); assert.equal(h.renderer.shadowMap.render, outer);
  h.render(); assert.equal(h.passes, 2, 'released nested wrapper forwards without caching');
});
