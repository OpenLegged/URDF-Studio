import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  GROUND_SHADOW_STYLE,
  LIGHTING_CONFIG,
  resolveCameraFollowLightingStyle,
} from '@/shared/components/3d/scene/constants.ts';

import {
  createUsdOffscreenGroundShadowPlane,
  createUsdOffscreenLightRig,
  disposeUsdOffscreenLightRig,
  syncUsdOffscreenGroundShadowPlane,
  syncUsdOffscreenLightRigWithCamera,
} from './usdOffscreenLighting.ts';

function assertVectorClose(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  message: string,
  epsilon = 1e-6,
): void {
  assert.ok(
    actual.distanceTo(expected) <= epsilon,
    `${message}: ${actual.toArray()} !== ${expected.toArray()}`,
  );
}

test('syncUsdOffscreenLightRigWithCamera keeps the key and fill lights camera-relative', () => {
  const scene = new THREE.Scene();
  const rig = createUsdOffscreenLightRig(scene);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 1000);

  camera.position.set(2.6, -2.6, 4.6);
  camera.lookAt(0.25, 0.5, 0.8);
  camera.updateMatrixWorld(true);

  syncUsdOffscreenLightRigWithCamera(rig, camera);

  const direction = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const target = new THREE.Vector3();

  camera.getWorldDirection(direction);
  target.copy(camera.position).addScaledVector(direction, 10);

  assertVectorClose(
    rig.cameraKeyLight.position,
    camera.position,
    'key light should sit on the camera',
  );
  assertVectorClose(
    rig.cameraKeyLight.target.position,
    target,
    'key light target should follow the camera forward vector',
  );

  const expectedSoftFrontPosition = camera.position
    .clone()
    .addScaledVector(up, 1.0)
    .addScaledVector(direction, 0.35);
  assertVectorClose(
    rig.cameraSoftFrontLight.position,
    expectedSoftFrontPosition,
    'soft-front light should stay slightly above and in front of the camera',
  );

  const expectedRightFillPosition = camera.position
    .clone()
    .addScaledVector(right, 2.8)
    .addScaledVector(up, 1.7)
    .addScaledVector(direction, 0.6);
  const expectedLeftFillPosition = camera.position
    .clone()
    .addScaledVector(right, -2.8)
    .addScaledVector(up, 1.7)
    .addScaledVector(direction, 0.6);

  assertVectorClose(
    rig.cameraFillRightLight.position,
    expectedRightFillPosition,
    'right fill light should offset along the camera right axis',
  );
  assertVectorClose(
    rig.cameraFillLeftLight.position,
    expectedLeftFillPosition,
    'left fill light should mirror the right fill light across the camera',
  );
});

test('disposeUsdOffscreenLightRig removes worker-only lights and targets from the scene', () => {
  const scene = new THREE.Scene();
  const rig = createUsdOffscreenLightRig(scene);
  const initialChildren = scene.children.length;

  assert.ok(initialChildren > 0, 'expected the light rig to attach objects to the scene');

  disposeUsdOffscreenLightRig(scene, rig);

  assert.equal(scene.children.length, 0);
});

test('createUsdOffscreenLightRig enables shadow casting on the shared main light only', () => {
  const scene = new THREE.Scene();
  const rig = createUsdOffscreenLightRig(scene);

  assert.equal(rig.mainLight.castShadow, true);
  assert.equal(rig.fillLightLeft.castShadow, false);
  assert.equal(rig.fillLightRight.castShadow, false);
  assert.equal(rig.rimLight.castShadow, false);
  assert.equal(rig.mainLight.shadow.mapSize.x, 1024);
  assert.equal(rig.mainLight.shadow.mapSize.y, 1024);
  assert.equal(
    rig.mainLight.intensity,
    resolveCameraFollowLightingStyle('light').mainLightIntensity,
  );
});

test('createUsdOffscreenLightRig uses the shared warm-key and cool-fill palette', () => {
  const scene = new THREE.Scene();
  const rig = createUsdOffscreenLightRig(scene);

  assert.equal(rig.mainLight.color.getHexString(), new THREE.Color(
    LIGHTING_CONFIG.mainLightColor,
  ).getHexString());
  assert.equal(rig.fillLightLeft.color.getHexString(), new THREE.Color(
    LIGHTING_CONFIG.fillLightColor,
  ).getHexString());
  assert.equal(rig.rimLight.color.getHexString(), new THREE.Color(
    LIGHTING_CONFIG.rimLightColor,
  ).getHexString());
});

test('ground shadow plane follows the worker ground offset', () => {
  const plane = createUsdOffscreenGroundShadowPlane();

  assert.equal(plane.receiveShadow, true);
  assert.equal(plane.castShadow, false);
  assert.equal(plane.name, 'GroundShadowPlane');

  syncUsdOffscreenGroundShadowPlane(plane, 1.25);
  assert.equal(plane.position.z < 1.25, true);
});

test('ground shadow plane uses the same per-theme opacity as the shared workspace ground shadow', () => {
  const darkPlane = createUsdOffscreenGroundShadowPlane('dark');
  const lightPlane = createUsdOffscreenGroundShadowPlane('light');

  assert.equal(
    (lightPlane.material as THREE.ShadowMaterial).opacity,
    GROUND_SHADOW_STYLE.light.opacity,
  );
  assert.equal(
    (darkPlane.material as THREE.ShadowMaterial).opacity,
    GROUND_SHADOW_STYLE.dark.opacity,
  );
});
