import * as THREE from 'three';
import type { RootState } from '@react-three/fiber';
import {
  WORKSPACE_OVERLAY_LEFT_INSET_VAR,
  WORKSPACE_OVERLAY_RIGHT_INSET_VAR,
} from '../scene/viewerOverlaySafeArea';

export interface WorkspaceCameraVisibleViewport {
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface WorkspaceCameraRenderViewOffset {
  fullWidth: number;
  fullHeight: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface WorkspaceCameraSnapshot {
  kind: 'perspective';
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  up: { x: number; y: number; z: number };
  zoom: number;
  target: { x: number; y: number; z: number };
  aspectRatio: number;
  fov: number;
  near: number;
  far: number;
  visibleViewport?: WorkspaceCameraVisibleViewport | null;
}

interface OrbitControlsLike {
  target: THREE.Vector3;
  update?: () => void;
}

function vectorToObject(vector: THREE.Vector3) {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function quaternionToObject(quaternion: THREE.Quaternion) {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function isPerspectiveCamera(camera: THREE.Camera): camera is THREE.PerspectiveCamera {
  return camera instanceof THREE.PerspectiveCamera;
}

function sanitizePositiveDimension(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readCssPixelValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function readWorkspaceOverlayInsets(element?: HTMLElement | null) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return { left: 0, right: 0 };
  }

  const style = window.getComputedStyle(element);
  return {
    left: readCssPixelValue(style.getPropertyValue(WORKSPACE_OVERLAY_LEFT_INSET_VAR)),
    right: readCssPixelValue(style.getPropertyValue(WORKSPACE_OVERLAY_RIGHT_INSET_VAR)),
  };
}

export function resolveWorkspaceVisibleViewportRect({
  width,
  height,
  leftInset = 0,
  rightInset = 0,
}: {
  width: number;
  height: number;
  leftInset?: number;
  rightInset?: number;
}): WorkspaceCameraVisibleViewport | null {
  const fullWidth = Math.max(1, Math.round(sanitizePositiveDimension(width, 1)));
  const fullHeight = Math.max(1, Math.round(sanitizePositiveDimension(height, 1)));
  const safeLeftInset = Math.max(0, Math.round(sanitizePositiveDimension(leftInset, 0)));
  const safeRightInset = Math.max(0, Math.round(sanitizePositiveDimension(rightInset, 0)));
  const x = Math.min(fullWidth - 1, safeLeftInset);
  const maxRightInset = Math.max(0, fullWidth - x - 1);
  const right = Math.min(maxRightInset, safeRightInset);
  const visibleWidth = Math.max(1, fullWidth - x - right);

  if (x === 0 && right === 0 && visibleWidth === fullWidth) {
    return null;
  }

  return {
    fullWidth,
    fullHeight,
    x,
    y: 0,
    width: visibleWidth,
    height: fullHeight,
    aspectRatio: visibleWidth / fullHeight,
  };
}

export function resolveWorkspaceCameraRenderViewOffset(
  visibleViewport: WorkspaceCameraVisibleViewport | null | undefined,
  renderWidth: number,
  renderHeight: number,
): WorkspaceCameraRenderViewOffset | null {
  if (!visibleViewport) {
    return null;
  }

  const safeRenderWidth = Math.max(1, Math.round(sanitizePositiveDimension(renderWidth, 1)));
  const safeRenderHeight = Math.max(1, Math.round(sanitizePositiveDimension(renderHeight, 1)));
  const viewportWidth = Math.max(1, sanitizePositiveDimension(visibleViewport.width, 1));
  const viewportHeight = Math.max(1, sanitizePositiveDimension(visibleViewport.height, 1));
  const scaleX = safeRenderWidth / viewportWidth;
  const scaleY = safeRenderHeight / viewportHeight;
  const offsetX = Math.max(0, Math.round(Math.max(0, visibleViewport.x) * scaleX));
  const offsetY = Math.max(0, Math.round(Math.max(0, visibleViewport.y) * scaleY));
  const fullWidth = Math.max(
    offsetX + safeRenderWidth,
    Math.round(Math.max(viewportWidth, visibleViewport.fullWidth) * scaleX),
  );
  const fullHeight = Math.max(
    offsetY + safeRenderHeight,
    Math.round(Math.max(viewportHeight, visibleViewport.fullHeight) * scaleY),
  );

  if (
    offsetX === 0 &&
    offsetY === 0 &&
    fullWidth === safeRenderWidth &&
    fullHeight === safeRenderHeight
  ) {
    return null;
  }

  return {
    fullWidth,
    fullHeight,
    offsetX,
    offsetY,
    width: safeRenderWidth,
    height: safeRenderHeight,
  };
}

export function captureWorkspaceCameraSnapshot(
  state: Pick<RootState, 'camera' | 'controls' | 'size' | 'get'>,
  viewportElement?: HTMLElement | null,
): WorkspaceCameraSnapshot | null {
  const resolvedState = typeof state.get === 'function' ? state.get() : state;

  if (!isPerspectiveCamera(resolvedState.camera)) {
    return null;
  }

  const controls = resolvedState.controls as unknown as OrbitControlsLike | undefined;
  const target = controls?.target ?? new THREE.Vector3(0, 0, 0);
  const aspectRatio =
    resolvedState.size.width > 0 && resolvedState.size.height > 0
      ? resolvedState.size.width / resolvedState.size.height
      : 1;
  const overlayInsets = readWorkspaceOverlayInsets(viewportElement);
  const visibleViewport = resolveWorkspaceVisibleViewportRect({
    width: resolvedState.size.width,
    height: resolvedState.size.height,
    leftInset: overlayInsets.left,
    rightInset: overlayInsets.right,
  });

  return {
    kind: 'perspective',
    position: vectorToObject(resolvedState.camera.position),
    quaternion: quaternionToObject(resolvedState.camera.quaternion),
    up: vectorToObject(resolvedState.camera.up),
    zoom: resolvedState.camera.zoom,
    target: vectorToObject(target),
    aspectRatio,
    fov: resolvedState.camera.fov,
    near: resolvedState.camera.near,
    far: resolvedState.camera.far,
    visibleViewport,
  };
}

export interface ApplyWorkspaceCameraSnapshotOptions {
  /**
   * Overrides the perspective aspect ratio applied to the camera. A snapshot
   * stores the aspect ratio of the workspace it was captured in, which is only
   * correct when the destination render surface has the same shape. The
   * snapshot dialog preview intentionally renders into its own frame aspect
   * (viewport-follow or a fixed 16:9/1:1/… preset), so it passes the live
   * render-surface aspect here to avoid a squished image. When omitted the
   * snapshot's own aspect ratio is used (the full-resolution export path relies
   * on this to drive its view-offset framing).
   */
  aspectRatioOverride?: number | null;
}

export function applyWorkspaceCameraSnapshot(
  camera: THREE.Camera,
  controls: OrbitControlsLike | null | undefined,
  snapshot: WorkspaceCameraSnapshot | null | undefined,
  options?: ApplyWorkspaceCameraSnapshotOptions,
) {
  if (!snapshot || !isPerspectiveCamera(camera)) {
    return;
  }

  const overrideAspect = options?.aspectRatioOverride;
  const aspect =
    typeof overrideAspect === 'number' && Number.isFinite(overrideAspect) && overrideAspect > 0
      ? overrideAspect
      : snapshot.aspectRatio;

  camera.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
  camera.quaternion
    .set(snapshot.quaternion.x, snapshot.quaternion.y, snapshot.quaternion.z, snapshot.quaternion.w)
    .normalize();
  camera.up.set(snapshot.up.x, snapshot.up.y, snapshot.up.z);
  camera.zoom = snapshot.zoom;
  camera.aspect = aspect;
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  if (controls) {
    controls.target.set(snapshot.target.x, snapshot.target.y, snapshot.target.z);
    controls.update?.();
  }
}

export function resolveSnapshotPreviewSurfaceSize(aspectRatio: number) {
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const targetLongEdge = 960;

  if (safeAspectRatio >= 1) {
    return {
      width: targetLongEdge,
      height: Math.max(1, Math.round(targetLongEdge / safeAspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(targetLongEdge * safeAspectRatio)),
    height: targetLongEdge,
  };
}
