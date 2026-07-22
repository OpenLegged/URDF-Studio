import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  applyWorkspaceCameraSnapshot,
  captureWorkspaceCameraSnapshot,
  resolveWorkspaceCameraRenderViewOffset,
  resolveSnapshotPreviewSurfaceSize,
  resolveWorkspaceVisibleViewportRect,
} from './workspaceCameraSnapshot';

test('captureWorkspaceCameraSnapshot reads the current camera and orbit target', () => {
  const camera = new THREE.PerspectiveCamera(52, 2, 0.1, 500);
  camera.position.set(4, 5, 6);
  camera.up.set(0, 1, 0);
  camera.zoom = 1.5;
  camera.lookAt(new THREE.Vector3(1, 2, 3));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const snapshot = captureWorkspaceCameraSnapshot({
    camera,
    controls: {
      target: new THREE.Vector3(1, 2, 3),
    },
    size: {
      width: 1200,
      height: 600,
    },
  } as any);

  assert.ok(snapshot, 'expected a workspace camera snapshot');
  assert.equal(snapshot?.aspectRatio, 2);
  assert.deepEqual(snapshot?.target, { x: 1, y: 2, z: 3 });
  assert.deepEqual(snapshot?.position, { x: 4, y: 5, z: 6 });
  assert.equal(snapshot?.zoom, 1.5);
  assert.equal(snapshot?.kind, 'perspective');
  assert.equal(snapshot?.fov, 52);
});

test('resolveWorkspaceVisibleViewportRect crops expanded workspace sidebars', () => {
  const viewport = resolveWorkspaceVisibleViewportRect({
    width: 1200,
    height: 600,
    leftInset: 264,
    rightInset: 310,
  });

  assert.deepEqual(viewport, {
    fullWidth: 1200,
    fullHeight: 600,
    x: 264,
    y: 0,
    width: 626,
    height: 600,
    aspectRatio: 626 / 600,
  });
});

test('resolveWorkspaceVisibleViewportRect returns null when the full canvas is visible', () => {
  assert.equal(
    resolveWorkspaceVisibleViewportRect({
      width: 1200,
      height: 600,
      leftInset: 0,
      rightInset: 0,
    }),
    null,
  );
});

test('resolveWorkspaceCameraRenderViewOffset scales the visible viewport to export pixels', () => {
  const viewport = resolveWorkspaceVisibleViewportRect({
    width: 1200,
    height: 600,
    leftInset: 264,
    rightInset: 310,
  });
  const viewOffset = resolveWorkspaceCameraRenderViewOffset(viewport, 1252, 1200);

  assert.deepEqual(viewOffset, {
    fullWidth: 2400,
    fullHeight: 1200,
    offsetX: 528,
    offsetY: 0,
    width: 1252,
    height: 1200,
  });
});

test('captureWorkspaceCameraSnapshot reads the live controls target from the current R3F store state', () => {
  const camera = new THREE.PerspectiveCamera(52, 2, 0.1, 500);
  camera.position.set(4, 5, 6);
  camera.up.set(0, 1, 0);
  camera.lookAt(new THREE.Vector3(1, 2, 3));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const liveControls = {
    target: new THREE.Vector3(1, 2, 3),
  };
  const staleCreatedState = {
    camera,
    controls: null,
    size: {
      width: 1200,
      height: 600,
    },
    get: () => ({
      camera,
      controls: liveControls,
      size: {
        width: 1200,
        height: 600,
      },
    }),
  };

  const snapshot = captureWorkspaceCameraSnapshot(staleCreatedState as any);

  assert.ok(snapshot, 'expected a workspace camera snapshot');
  assert.deepEqual(snapshot?.target, { x: 1, y: 2, z: 3 });
});

test('applyWorkspaceCameraSnapshot restores camera transform and orbit target', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  let controlsUpdated = false;
  const controls = {
    target: new THREE.Vector3(),
    update: () => {
      controlsUpdated = true;
    },
  };

  applyWorkspaceCameraSnapshot(camera, controls as any, {
    kind: 'perspective',
    position: { x: -3, y: 1.5, z: 9 },
    quaternion: { x: 0.05, y: 0.35, z: -0.1, w: 0.93 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1.25,
    target: { x: 2, y: -1, z: 0.5 },
    aspectRatio: 1.6,
    fov: 48,
    near: 0.25,
    far: 420,
  });

  assert.equal(camera.position.x, -3);
  assert.equal(camera.position.y, 1.5);
  assert.equal(camera.position.z, 9);
  assert.equal(camera.zoom, 1.25);
  assert.equal(camera.aspect, 1.6);
  assert.equal(camera.fov, 48);
  assert.equal(camera.near, 0.25);
  assert.equal(camera.far, 420);
  assert.ok(
    camera.quaternion.angleTo(new THREE.Quaternion(0.05, 0.35, -0.1, 0.93).normalize()) < 1e-6,
  );
  assert.deepEqual(controls.target.toArray(), [2, -1, 0.5]);
  assert.equal(controlsUpdated, true);
});

test('applyWorkspaceCameraSnapshot honours aspectRatioOverride for mismatched surfaces', () => {
  const snapshot = {
    kind: 'perspective' as const,
    position: { x: 0, y: 0, z: 5 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
    target: { x: 0, y: 0, z: 0 },
    aspectRatio: 1.6,
    fov: 50,
    near: 0.1,
    far: 100,
  };

  // A preview surface that differs from the captured workspace uses its own
  // aspect so the model is not squished; the view angle is still inherited.
  const previewCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  applyWorkspaceCameraSnapshot(previewCamera, null, snapshot, { aspectRatioOverride: 1 });
  assert.equal(previewCamera.aspect, 1);
  assert.equal(previewCamera.fov, 50);
  assert.equal(previewCamera.position.z, 5);

  // Invalid or absent overrides fall back to the snapshot's own aspect ratio so
  // the full-resolution export path keeps its view-offset framing.
  for (const override of [undefined, null, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const exportCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    applyWorkspaceCameraSnapshot(exportCamera, null, snapshot, { aspectRatioOverride: override });
    assert.equal(exportCamera.aspect, 1.6);
  }
});

test('resolveSnapshotPreviewSurfaceSize preserves the frozen viewport aspect ratio', () => {
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(2), { width: 960, height: 480 });
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(0.5), { width: 480, height: 960 });
  assert.deepEqual(resolveSnapshotPreviewSurfaceSize(0), { width: 960, height: 960 });
});
