import * as THREE from 'three';

export const DEFAULT_WORKSPACE_ORBIT_CLIPPING = {
  minDistance: 0.002,
  // Keep the perspective depth range tighter so dense shells do not start
  // z-fighting and leaking bright internals at medium/far zoom levels.
  // Paired with renderer-level logarithmicDepthBuffer, the ordinary 0.01 near
  // floor keeps enough precision for closely-stacked MJCF inner geoms. Close
  // inspection relaxes this floor only before it would clip the orbit target.
  nearFactor: 0.01,
  minNear: 0.01,
  maxNear: 0.25,
  farFactor: 140,
  minFar: 20,
  maxFar: 6000,
} as const;

export interface WorkspaceOrbitClippingOptions {
  minDistance?: number;
  nearFactor?: number;
  minNear?: number;
  maxNear?: number;
  farFactor?: number;
  minFar?: number;
  maxFar?: number;
  sceneBounds?: THREE.Box3 | null;
}

type OrbitTargetLike = {
  target: THREE.Vector3;
};

function getMaxDistanceFromTargetToBounds(
  target: THREE.Vector3,
  bounds: THREE.Box3,
): number | null {
  if (bounds.isEmpty()) {
    return null;
  }

  const corners: [number, number, number][] = [
    [bounds.min.x, bounds.min.y, bounds.min.z],
    [bounds.min.x, bounds.min.y, bounds.max.z],
    [bounds.min.x, bounds.max.y, bounds.min.z],
    [bounds.min.x, bounds.max.y, bounds.max.z],
    [bounds.max.x, bounds.min.y, bounds.min.z],
    [bounds.max.x, bounds.min.y, bounds.max.z],
    [bounds.max.x, bounds.max.y, bounds.min.z],
    [bounds.max.x, bounds.max.y, bounds.max.z],
  ];

  let maxDistance = 0;
  for (const [x, y, z] of corners) {
    const distance = target.distanceTo(_corner.set(x, y, z));
    if (!Number.isFinite(distance)) {
      return null;
    }
    maxDistance = Math.max(maxDistance, distance);
  }

  return maxDistance;
}

const _corner = new THREE.Vector3();

type WorkspaceNearPlaneConfig = Required<
  Omit<WorkspaceOrbitClippingOptions, 'sceneBounds'>
>;

function resolveWorkspaceNearPlane(
  distance: number,
  config: WorkspaceNearPlaneConfig,
): number {
  // Preserve the tighter depth range used at ordinary viewing distances, but
  // keep the orbit target safely beyond the near plane during close inspection.
  // Otherwise a small minDistance lets the camera move closer while the fixed
  // 1 cm near floor clips the detail the user is trying to inspect.
  const closeInspectionNearFloor = Math.max(
    config.minDistance * 0.1,
    distance * 0.1,
  );
  const adaptiveMinNear = Math.min(config.minNear, closeInspectionNearFloor);
  return THREE.MathUtils.clamp(
    distance * config.nearFactor,
    adaptiveMinNear,
    config.maxNear,
  );
}

export function syncWorkspacePerspectiveClipPlanes(
  camera: THREE.Camera,
  controls: OrbitTargetLike,
  options: WorkspaceOrbitClippingOptions = {},
): boolean {
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    return false;
  }

  const config = {
    ...DEFAULT_WORKSPACE_ORBIT_CLIPPING,
    ...options,
  };

  const distance = Math.max(
    camera.position.distanceTo(controls.target),
    config.minDistance,
  );
  const nextNear = resolveWorkspaceNearPlane(distance, config);
  const distanceBasedFar = Math.max(
    nextNear + 10,
    THREE.MathUtils.clamp(
      distance * config.farFactor,
      config.minFar,
      config.maxFar,
    ),
  );
  const targetDistanceToSceneBounds = config.sceneBounds
    ? getMaxDistanceFromTargetToBounds(controls.target, config.sceneBounds)
    : null;
  const boundsLimitedFar = targetDistanceToSceneBounds === null
    ? null
    : Math.max(
      nextNear + 10,
      THREE.MathUtils.clamp(
        distance + targetDistanceToSceneBounds + Math.max(2, targetDistanceToSceneBounds * 0.08),
        config.minFar,
        config.maxFar,
      ),
    );
  const nextFar = boundsLimitedFar === null
    ? distanceBasedFar
    : Math.min(distanceBasedFar, boundsLimitedFar);

  if (
    Math.abs(camera.near - nextNear) < 1e-5
    && Math.abs(camera.far - nextFar) < 1e-2
  ) {
    return false;
  }

  camera.near = nextNear;
  camera.far = nextFar;
  camera.updateProjectionMatrix();
  return true;
}

/**
 * Orthographic twin of {@link syncWorkspacePerspectiveClipPlanes}.
 *
 * Orthographic cameras still have near/far depth planes, so the same
 * distance-based near/far strategy keeps dense geometry from clipping without
 * affecting the orthographic frustum (left/right/top/bottom/zoom), which is
 * what the user controls via orbit zoom.
 */
export function syncWorkspaceOrthographicClipPlanes(
  camera: THREE.Camera,
  controls: OrbitTargetLike,
  options: WorkspaceOrbitClippingOptions = {},
): boolean {
  if (!(camera instanceof THREE.OrthographicCamera)) {
    return false;
  }

  const config = {
    ...DEFAULT_WORKSPACE_ORBIT_CLIPPING,
    ...options,
  };

  const distance = Math.max(
    camera.position.distanceTo(controls.target),
    config.minDistance,
  );
  const nextNear = resolveWorkspaceNearPlane(distance, config);
  const distanceBasedFar = Math.max(
    nextNear + 10,
    THREE.MathUtils.clamp(
      distance * config.farFactor,
      config.minFar,
      config.maxFar,
    ),
  );
  const targetDistanceToSceneBounds = config.sceneBounds
    ? getMaxDistanceFromTargetToBounds(controls.target, config.sceneBounds)
    : null;
  const boundsLimitedFar = targetDistanceToSceneBounds === null
    ? null
    : Math.max(
      nextNear + 10,
      THREE.MathUtils.clamp(
        distance + targetDistanceToSceneBounds + Math.max(2, targetDistanceToSceneBounds * 0.08),
        config.minFar,
        config.maxFar,
      ),
    );
  const nextFar = boundsLimitedFar === null
    ? distanceBasedFar
    : Math.min(distanceBasedFar, boundsLimitedFar);

  if (
    Math.abs(camera.near - nextNear) < 1e-5
    && Math.abs(camera.far - nextFar) < 1e-2
  ) {
    return false;
  }

  camera.near = nextNear;
  camera.far = nextFar;
  camera.updateProjectionMatrix();
  return true;
}

/**
 * Sync near/far clip planes regardless of camera projection. Dispatches to the
 * perspective or orthographic implementation so callers (e.g. orbit controls)
 * stay projection-agnostic.
 */
export function syncWorkspaceClipPlanes(
  camera: THREE.Camera,
  controls: OrbitTargetLike,
  options: WorkspaceOrbitClippingOptions = {},
): boolean {
  if (camera instanceof THREE.OrthographicCamera) {
    return syncWorkspaceOrthographicClipPlanes(camera, controls, options);
  }
  return syncWorkspacePerspectiveClipPlanes(camera, controls, options);
}
