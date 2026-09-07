import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applySnapshotBackgroundStyle,
  applySnapshotLightingPreset,
  applySnapshotSceneVisibility,
  applySnapshotShadowQuality,
  SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS,
  SNAPSHOT_ENVIRONMENT_PRESET_RENDER_SETTINGS,
} from './snapshotSceneQuality.ts';

function createSnapshotBackgroundTestRenderer() {
  const clearColor = new THREE.Color('#000000');
  let clearAlpha = 1;
  return {
    getClearColor: (target: THREE.Color) => target.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => {
      clearColor.set(color);
      clearAlpha = alpha ?? clearAlpha;
    },
  } as unknown as THREE.WebGLRenderer;
}

test('applySnapshotSceneVisibility keeps visual content while hiding snapshot-excluded helpers', () => {
  const scene = new THREE.Scene();
  const visualMesh = new THREE.Object3D();
  const collisionMesh = new THREE.Object3D();
  const helper = new THREE.Object3D();
  const selectableHelper = new THREE.Object3D();
  const groundShadowPlane = new THREE.Object3D();
  const snapshotGroundShadowPlane = new THREE.Object3D();
  const snapshotContactShadows = new THREE.Object3D();
  const grid = new THREE.Object3D();

  collisionMesh.userData.isCollisionMesh = true;
  helper.userData.isHelper = true;
  selectableHelper.userData.isSelectableHelper = true;
  groundShadowPlane.name = 'GroundShadowPlane';
  groundShadowPlane.userData.isHelper = true;
  snapshotGroundShadowPlane.name = 'SnapshotGroundShadowPlane';
  snapshotGroundShadowPlane.userData.isHelper = true;
  snapshotContactShadows.name = 'SnapshotContactShadows';
  snapshotContactShadows.userData.isHelper = true;
  grid.name = 'ReferenceGrid';
  grid.userData.isHelper = true;

  scene.add(
    visualMesh,
    collisionMesh,
    helper,
    selectableHelper,
    groundShadowPlane,
    snapshotGroundShadowPlane,
    snapshotContactShadows,
    grid,
  );

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: false });

  assert.equal(visualMesh.visible, true);
  assert.equal(collisionMesh.visible, false);
  assert.equal(helper.visible, false);
  assert.equal(selectableHelper.visible, false);
  assert.equal(groundShadowPlane.visible, false);
  assert.equal(snapshotGroundShadowPlane.visible, true);
  assert.equal(snapshotContactShadows.visible, true);
  assert.equal(grid.visible, true);

  restore();

  assert.equal(collisionMesh.visible, true);
  assert.equal(helper.visible, true);
  assert.equal(selectableHelper.visible, true);
  assert.equal(groundShadowPlane.visible, true);
  assert.equal(snapshotGroundShadowPlane.visible, true);
  assert.equal(snapshotContactShadows.visible, true);
  assert.equal(grid.visible, true);
});

test('applySnapshotSceneVisibility hides the grid when requested', () => {
  const scene = new THREE.Scene();
  const grid = new THREE.Object3D();
  grid.name = 'ReferenceGrid';
  grid.userData.isHelper = true;
  scene.add(grid);

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: true });
  assert.equal(grid.visible, false);

  restore();
  assert.equal(grid.visible, true);
});

test('applySnapshotSceneVisibility hides known runtime helper names and viewer helper objects', () => {
  const scene = new THREE.Scene();
  const namedHelper = new THREE.Object3D();
  namedHelper.name = '__origin_axes__';
  const viewerHelper = new THREE.Object3D();
  viewerHelper.userData.viewerHelperKind = 'center-of-mass';

  scene.add(namedHelper, viewerHelper);

  const restore = applySnapshotSceneVisibility(scene, { hideGrid: false });

  assert.equal(namedHelper.visible, false);
  assert.equal(viewerHelper.visible, false);

  restore();

  assert.equal(namedHelper.visible, true);
  assert.equal(viewerHelper.visible, true);
});

test('applySnapshotBackgroundStyle uses workspace fallback for viewport background without scene color', () => {
  const scene = new THREE.Scene();
  const gl = createSnapshotBackgroundTestRenderer();

  const result = applySnapshotBackgroundStyle(scene, gl, 'viewport', 'dark');

  assert.deepEqual(result.fill, {
    kind: 'solid',
    colors: ['#1f1f1f', '#1f1f1f'],
  });

  result.restore();
});

test('applySnapshotLightingPreset applies a visible rig change and restores it afterwards', () => {
  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight('#ffffff', 1);
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#cccccc', 1);
  const main = new THREE.DirectionalLight('#ffffff', 1);
  const fill = new THREE.DirectionalLight('#ffffff', 1);
  const rim = new THREE.DirectionalLight('#ffffff', 1);
  const camera = new THREE.DirectionalLight('#ffffff', 1);

  main.name = 'MainLight';
  fill.name = 'FillLightLeft';
  rim.name = 'RimLight';
  camera.name = 'CameraKeyLight';
  scene.add(ambient, hemisphere, main, fill, rim, camera);

  const gl = {
    toneMappingExposure: 1.1,
  } as THREE.WebGLRenderer;

  const restore = applySnapshotLightingPreset(scene, gl, 'contrast');

  assert.equal(ambient.intensity, 0.72);
  assert.equal(hemisphere.intensity, 0.82);
  assert.equal(main.intensity, 1.24);
  assert.equal(fill.intensity, 0.82);
  assert.equal(rim.intensity, 1.42);
  assert.equal(camera.intensity, 1.08);
  assert.equal(
    gl.toneMappingExposure,
    1.1 * SNAPSHOT_ENVIRONMENT_PRESET_RENDER_SETTINGS.contrast.toneMappingExposureMultiplier,
  );
  assert.equal(main.color.getHexString(), 'fff1d6');
  assert.equal(rim.color.getHexString(), 'cfe1ff');

  restore();

  assert.equal(ambient.intensity, 1);
  assert.equal(hemisphere.intensity, 1);
  assert.equal(main.intensity, 1);
  assert.equal(fill.intensity, 1);
  assert.equal(rim.intensity, 1);
  assert.equal(camera.intensity, 1);
  assert.equal(gl.toneMappingExposure, 1.1);
  assert.equal(main.color.getHexString(), 'ffffff');
  assert.equal(rim.color.getHexString(), 'ffffff');
});

test('HDRI presets keep the environment key aligned with the shadow-casting light', () => {
  assert.equal(SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS.city.environmentRotationZ, Math.PI);
  assert.ok(
    Math.abs(
      SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS.contrast.environmentRotationZ -
        SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS.city.environmentRotationZ -
        0.7,
    ) < 1e-12,
  );
});

test('applySnapshotShadowQuality switches shadow map strategy for soft captures and restores it', () => {
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight('#ffffff', 1);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.radius = 2;
  light.shadow.bias = -0.0001;
  light.shadow.normalBias = 0.02;
  (light.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples = 4;
  scene.add(light);

  const gl = {
    shadowMap: {
      enabled: true,
      autoUpdate: false,
      needsUpdate: false,
      type: THREE.PCFSoftShadowMap,
    },
    capabilities: {
      maxTextureSize: 4096,
    },
  } as unknown as THREE.WebGLRenderer;

  const restore = applySnapshotShadowQuality(scene, gl, 'high', 'soft');

  assert.equal(gl.shadowMap.type, THREE.VSMShadowMap);
  assert.equal(light.shadow.mapSize.x, 1741);
  assert.equal(light.shadow.mapSize.y, 1741);
  assert.equal(light.shadow.radius, 0);
  assert.equal(light.shadow.bias, -0.00016);
  assert.equal(light.shadow.normalBias, 0.035);
  assert.equal((light.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples, 10);

  restore();

  assert.equal(gl.shadowMap.type, THREE.PCFSoftShadowMap);
  assert.equal(light.shadow.mapSize.x, 1024);
  assert.equal(light.shadow.mapSize.y, 1024);
  assert.equal(light.shadow.radius, 2);
  assert.equal(light.shadow.bias, -0.0001);
  assert.equal(light.shadow.normalBias, 0.02);
  assert.equal((light.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples, 4);
});
