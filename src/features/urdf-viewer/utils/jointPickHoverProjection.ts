import * as THREE from 'three';

export interface JointPickViewportSize {
  width: number;
  height: number;
}

export interface JointPickScreenCandidate {
  pointWorld: THREE.Vector3;
}

interface FindCandidateNearPointerOptions<T extends JointPickScreenCandidate> {
  candidates: T[];
  pointer: THREE.Vector2;
  camera: THREE.Camera;
  viewport: JointPickViewportSize;
  radiusPx: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

function pointerToScreen(
  pointer: { x: number; y: number },
  viewport: JointPickViewportSize,
): ScreenPoint {
  return {
    x: (pointer.x * 0.5 + 0.5) * viewport.width,
    y: (-pointer.y * 0.5 + 0.5) * viewport.height,
  };
}

function projectToScreen(
  pointWorld: THREE.Vector3,
  camera: THREE.Camera,
  viewport: JointPickViewportSize,
): ScreenPoint | null {
  const projected = pointWorld.clone().project(camera);
  if (
    !Number.isFinite(projected.x)
    || !Number.isFinite(projected.y)
    || !Number.isFinite(projected.z)
    || projected.z < -1
    || projected.z > 1
  ) {
    return null;
  }
  return pointerToScreen(projected, viewport);
}

export function findCandidateNearPointer<T extends JointPickScreenCandidate>(
  options: FindCandidateNearPointerOptions<T>,
): T | null {
  const { candidates, pointer, camera, viewport, radiusPx } = options;
  if (viewport.width <= 0 || viewport.height <= 0 || radiusPx <= 0) {
    return null;
  }

  const screenPointer = pointerToScreen(pointer, viewport);
  const radiusSq = radiusPx * radiusPx;
  let nearest: T | null = null;
  let nearestDistanceSq = radiusSq;

  for (const candidate of candidates) {
    const projected = projectToScreen(candidate.pointWorld, camera, viewport);
    if (!projected) {
      continue;
    }
    const dx = projected.x - screenPointer.x;
    const dy = projected.y - screenPointer.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= nearestDistanceSq) {
      nearest = candidate;
      nearestDistanceSq = distanceSq;
    }
  }

  return nearest;
}

export function worldRadiusForPixels(
  pointWorld: THREE.Vector3,
  camera: THREE.Camera,
  viewportHeight: number,
  radiusPx: number,
): number {
  if (viewportHeight <= 0 || radiusPx <= 0) {
    return 0;
  }

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const orthographic = camera as THREE.OrthographicCamera;
    return (
      (Math.abs(orthographic.top - orthographic.bottom) / orthographic.zoom)
      * (radiusPx / viewportHeight)
    );
  }

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    const cameraSpacePoint = pointWorld.clone().applyMatrix4(perspective.matrixWorldInverse);
    const depth = Math.max(perspective.near, Math.abs(cameraSpacePoint.z));
    const verticalSpan =
      2 * depth * Math.tan(THREE.MathUtils.degToRad(perspective.getEffectiveFOV()) * 0.5);
    return verticalSpan * (radiusPx / viewportHeight);
  }

  return 0;
}

function signedPolygonArea(points: ScreenPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area * 0.5;
}

function containsPoint(points: ScreenPoint[], point: ScreenPoint): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = points.length - 1;
    currentIndex < points.length;
    previousIndex = currentIndex, currentIndex += 1) {
    const current = points[currentIndex];
    const previous = points[previousIndex];
    const crosses =
      (current.y > point.y) !== (previous.y > point.y)
      && point.x
        < ((previous.x - current.x) * (point.y - current.y))
          / (previous.y - current.y)
          + current.x;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function projectLoopToScreen(
  loopWorld: THREE.Vector3[],
  camera: THREE.Camera,
  viewport: JointPickViewportSize,
): ScreenPoint[] {
  return loopWorld
    .map((point) => projectToScreen(point, camera, viewport))
    .filter((point): point is ScreenPoint => point !== null);
}

export function isPointerInsideProjectedLoop(
  loopWorld: THREE.Vector3[],
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  viewport: JointPickViewportSize,
): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return false;
  }
  const projected = projectLoopToScreen(loopWorld, camera, viewport);
  return projected.length >= 3
    ? containsPoint(projected, pointerToScreen(pointer, viewport))
    : false;
}

/**
 * Tests the largest projected boundary only. Inner loops represent holes; they
 * intentionally remain active so a user can cross negative space to its center
 * candidate without dismissing the hovered planar region.
 */
export function isPointerInsideProjectedRegion(
  boundaryLoopsWorld: THREE.Vector3[][],
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  viewport: JointPickViewportSize,
): boolean {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return false;
  }

  let outerLoop: ScreenPoint[] | null = null;
  let outerArea = 0;
  for (const loop of boundaryLoopsWorld) {
    const projected = projectLoopToScreen(loop, camera, viewport);
    if (projected.length < 3) {
      continue;
    }
    const area = Math.abs(signedPolygonArea(projected));
    if (area > outerArea) {
      outerArea = area;
      outerLoop = projected;
    }
  }

  return outerLoop
    ? containsPoint(outerLoop, pointerToScreen(pointer, viewport))
    : false;
}
