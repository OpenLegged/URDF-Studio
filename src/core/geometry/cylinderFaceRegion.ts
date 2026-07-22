import * as THREE from 'three';

import {
  buildPlaneBasis,
  DEFAULT_MESH_FEATURE_MAX_FACES,
  getCachedTopology,
  getGeometryFaceCount,
  kasaCircleFit,
  type WeldedTopology,
} from './planarFaceRegion.ts';

export interface CylinderFaceRegion {
  faceIndices: number[];
  /** Flat local-space triangle vertices; each consecutive three form a triangle. */
  triangles: THREE.Vector3[];
  center: THREE.Vector3;
  axis: THREE.Vector3;
  radius: number;
  height: number;
  rmsRatio: number;
  coverageRadians: number;
  radialFaceCount: number;
  confidence: number;
}

interface CylinderRegionCache {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  index: THREE.BufferAttribute | null;
  positionVersion: number;
  indexVersion: number;
  regions: Map<string, CylinderFaceRegion | null>;
}

interface FitCylinderInput {
  topology: WeldedTopology;
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  faceIndex: number;
  axis: THREE.Vector3;
  maxFaces: number;
}

const CYLINDER_CACHE_KEY = '__cylinderFaceRegionCache';
const MIN_RADIAL_FACES = 8;
const MIN_COVERAGE = THREE.MathUtils.degToRad(300);
const MAX_RADIAL_RMS_RATIO = 0.03;
const AXIS_NORMAL_TOLERANCE = Math.sin(THREE.MathUtils.degToRad(5));
const UNIQUE_ANGLE_TOLERANCE = THREE.MathUtils.degToRad(2);

function attributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
}

function getRegionCache(geometry: THREE.BufferGeometry): CylinderRegionCache | null {
  const position = geometry.getAttribute('position');
  if (!position) {
    return null;
  }
  const index = geometry.getIndex();
  const cached = geometry.userData[CYLINDER_CACHE_KEY] as CylinderRegionCache | undefined;
  if (
    cached
    && cached.position === position
    && cached.index === index
    && cached.positionVersion === attributeVersion(position)
    && cached.indexVersion === (index?.version ?? -1)
  ) {
    return cached;
  }
  const next = {
    position,
    index,
    positionVersion: attributeVersion(position),
    indexVersion: index?.version ?? -1,
    regions: new Map(),
  } satisfies CylinderRegionCache;
  Object.defineProperty(geometry.userData, CYLINDER_CACHE_KEY, {
    value: next,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return next;
}

function collectConnectedFaces(
  topology: WeldedTopology,
  faceIndex: number,
  maxFaces: number,
): number[] | null {
  if (!topology.faces[faceIndex]?.normal) {
    return null;
  }
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of topology.faceNeighbors[queue[cursor]]) {
      if (visited.has(neighbor) || !topology.faces[neighbor].normal) {
        continue;
      }
      visited.add(neighbor);
      if (visited.size > maxFaces) {
        return null;
      }
      queue.push(neighbor);
    }
  }
  return queue;
}

function canonicalAxis(axis: THREE.Vector3): THREE.Vector3 {
  const result = axis.clone().normalize();
  const components = [Math.abs(result.x), Math.abs(result.y), Math.abs(result.z)];
  const dominant = components.reduce(
    (best, value, index) => value > components[best] ? index : best,
    0,
  );
  return result.getComponent(dominant) < 0 ? result.negate() : result;
}

function cylinderAxisCandidates(
  topology: WeldedTopology,
  connectedFaces: number[],
  faceIndex: number,
): THREE.Vector3[] {
  const seedNormal = topology.faces[faceIndex].normal;
  if (!seedNormal) {
    return [];
  }
  const axes: THREE.Vector3[] = [];
  for (const candidateFace of connectedFaces) {
    const normal = topology.faces[candidateFace].normal;
    if (!normal) {
      continue;
    }
    const cross = new THREE.Vector3().crossVectors(seedNormal, normal);
    if (cross.lengthSq() < 1e-5) {
      continue;
    }
    const axis = canonicalAxis(cross);
    if (axes.some((known) => Math.abs(known.dot(axis)) > 0.9999)) {
      continue;
    }
    axes.push(axis);
    if (axes.length >= 128) {
      break;
    }
  }
  return axes;
}

function collectSideFaces(input: {
  topology: WeldedTopology;
  faceIndex: number;
  axis: THREE.Vector3;
  maxFaces: number;
}): number[] | null {
  const { topology, faceIndex, axis, maxFaces } = input;
  const liesOnSide = (candidate: number) => {
    const normal = topology.faces[candidate].normal;
    return Boolean(normal) && Math.abs(normal!.dot(axis)) <= AXIS_NORMAL_TOLERANCE;
  };
  if (!liesOnSide(faceIndex)) {
    return null;
  }
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of topology.faceNeighbors[queue[cursor]]) {
      if (visited.has(neighbor) || !liesOnSide(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      if (visited.size > maxFaces) {
        return null;
      }
      queue.push(neighbor);
    }
  }
  return queue;
}

function uniqueCircularAngles(angles: number[]): number[] {
  const sorted = angles
    .map((angle) => angle < 0 ? angle + Math.PI * 2 : angle)
    .sort((a, b) => a - b);
  const unique: number[] = [];
  for (const angle of sorted) {
    if (unique.length === 0 || angle - unique[unique.length - 1] > UNIQUE_ANGLE_TOLERANCE) {
      unique.push(angle);
    }
  }
  if (
    unique.length > 1
    && unique[0] + Math.PI * 2 - unique[unique.length - 1] <= UNIQUE_ANGLE_TOLERANCE
  ) {
    unique.pop();
  }
  return unique;
}

function angularCoverage(angles: number[]): number {
  let maxGap = Math.PI * 2;
  if (angles.length > 1) {
    maxGap = 0;
    for (let index = 0; index < angles.length; index += 1) {
      const next = index + 1 < angles.length ? angles[index + 1] : angles[0] + Math.PI * 2;
      maxGap = Math.max(maxGap, next - angles[index]);
    }
  }
  return Math.PI * 2 - maxGap;
}

function fitCylinderForAxis(input: FitCylinderInput): CylinderFaceRegion | null {
  const { topology, position, faceIndex, axis, maxFaces } = input;
  const faceIndices = collectSideFaces({ topology, faceIndex, axis, maxFaces });
  if (!faceIndices || faceIndices.length < MIN_RADIAL_FACES) {
    return null;
  }
  const basis = buildPlaneBasis(axis);
  const weldedIndices = new Set<number>();
  faceIndices.forEach((sideFace) => {
    topology.faces[sideFace].weldedVertices.forEach((vertex) => weldedIndices.add(vertex));
  });
  const projected = [...weldedIndices].map((vertexIndex) => {
    const point = topology.weldedPositions[vertexIndex];
    return { x: point.dot(basis.u), y: point.dot(basis.v) };
  });
  const circle = kasaCircleFit(projected);
  if (!circle) {
    return null;
  }
  const residualSquared = projected.reduce((sum, point) => {
    const residual = Math.hypot(point.x - circle.center.x, point.y - circle.center.y) - circle.radius;
    return sum + residual * residual;
  }, 0);
  const rmsRatio = Math.sqrt(residualSquared / projected.length) / circle.radius;
  if (!Number.isFinite(rmsRatio) || rmsRatio > MAX_RADIAL_RMS_RATIO) {
    return null;
  }

  const triangles: THREE.Vector3[] = [];
  const radialAngles: number[] = [];
  let minAxis = Number.POSITIVE_INFINITY;
  let maxAxis = Number.NEGATIVE_INFINITY;
  for (const sideFace of faceIndices) {
    const face = topology.faces[sideFace];
    const vertices = face.sourceVertices.map((vertexIndex) =>
      new THREE.Vector3().fromBufferAttribute(position, vertexIndex),
    ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    triangles.push(...vertices);
    vertices.forEach((point) => {
      const coordinate = point.dot(axis);
      minAxis = Math.min(minAxis, coordinate);
      maxAxis = Math.max(maxAxis, coordinate);
    });
    const centroid = vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
    const radial = basis.u.clone().multiplyScalar(centroid.dot(basis.u) - circle.center.x)
      .addScaledVector(basis.v, centroid.dot(basis.v) - circle.center.y)
      .normalize();
    const normal = face.normal!.clone();
    radialAngles.push(Math.atan2(
      (normal.dot(radial) < 0 ? normal.negate() : normal).dot(basis.v),
      normal.dot(basis.u),
    ));
  }
  const uniqueAngles = uniqueCircularAngles(radialAngles);
  const coverageRadians = angularCoverage(uniqueAngles);
  if (
    uniqueAngles.length < MIN_RADIAL_FACES
    || coverageRadians + 1e-8 < MIN_COVERAGE
    || !(maxAxis > minAxis)
  ) {
    return null;
  }
  const center = basis.u.clone().multiplyScalar(circle.center.x)
    .addScaledVector(basis.v, circle.center.y)
    .addScaledVector(axis, (minAxis + maxAxis) * 0.5);
  const confidence = Math.max(0, 1 - rmsRatio / MAX_RADIAL_RMS_RATIO)
    * Math.min(1, coverageRadians / (Math.PI * 2));
  return {
    faceIndices: [...faceIndices].sort((a, b) => a - b),
    triangles,
    center,
    axis: axis.clone(),
    radius: circle.radius,
    height: maxAxis - minAxis,
    rmsRatio,
    coverageRadians,
    radialFaceCount: uniqueAngles.length,
    confidence,
  };
}

/** Fits a connected, near-complete cylindrical mesh side containing `faceIndex`. */
export function detectCylinderFaceRegion(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  options?: { weldTolerance?: number; maxFaces?: number },
): CylinderFaceRegion | null {
  const maxFaces = options?.maxFaces ?? DEFAULT_MESH_FEATURE_MAX_FACES;
  if (
    !Number.isInteger(faceIndex)
    || faceIndex < 0
    || getGeometryFaceCount(geometry) > maxFaces
  ) {
    return null;
  }
  const cachedTopology = getCachedTopology(geometry, options?.weldTolerance);
  const cache = getRegionCache(geometry);
  if (!cachedTopology || !cache || faceIndex >= cachedTopology.topology.faces.length) {
    return null;
  }
  const cachePrefix = `${maxFaces}:${options?.weldTolerance ?? 'default'}`;
  const cacheKey = `${cachePrefix}:${faceIndex}`;
  if (cache.regions.has(cacheKey)) {
    return cache.regions.get(cacheKey) ?? null;
  }
  const connected = collectConnectedFaces(cachedTopology.topology, faceIndex, maxFaces);
  let best: CylinderFaceRegion | null = null;
  if (connected) {
    for (const axis of cylinderAxisCandidates(cachedTopology.topology, connected, faceIndex)) {
      const candidate = fitCylinderForAxis({
        topology: cachedTopology.topology,
        position: cache.position,
        faceIndex,
        axis,
        maxFaces,
      });
      if (
        candidate
        && (!best || candidate.confidence > best.confidence
          || (candidate.confidence === best.confidence && candidate.faceIndices.length > best.faceIndices.length))
      ) {
        best = candidate;
      }
    }
  }
  cache.regions.set(cacheKey, best);
  best?.faceIndices.forEach((memberFace) => cache.regions.set(`${cachePrefix}:${memberFace}`, best));
  return best;
}
