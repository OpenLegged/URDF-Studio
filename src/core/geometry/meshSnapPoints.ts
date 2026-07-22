import * as THREE from 'three';

/**
 * Snap point feature kinds for Fusion 360 style joint-origin picking.
 *
 * - `surface`: raw raycast hit point on the mesh surface.
 * - `faceCenter`: centroid of the hit triangle.
 * - `bboxCenter`: legacy bounding box center of the whole link object.
 * - `geometryCenter`: volume centroid of a closed mesh, or its local bounds center.
 * - `circleCenter`: fitted center of a coplanar circular face region.
 * - `cylinderAxis`: center point on a fitted cylindrical feature axis.
 * - `vertex`: nearest mesh vertex.
 * - `edgeMidpoint`: midpoint of the nearest triangle edge.
 *
 * All functions here are pure and operate in the geometry's LOCAL space; the
 * caller is responsible for transforming results to world space with the
 * object's `matrixWorld`.
 */
export type SnapPointKind =
  | 'surface'
  | 'faceCenter'
  | 'bboxCenter'
  | 'geometryCenter'
  | 'circleCenter'
  | 'cylinderAxis'
  | 'vertex'
  | 'edgeMidpoint';

export interface LocalSnapPoint {
  kind: SnapPointKind;
  pointLocal: THREE.Vector3;
  /** Geometric (not interpolated) face normal in local space, when available. */
  normalLocal?: THREE.Vector3;
}

const DEGENERATE_EPSILON_SQ = 1e-16;
const GEOMETRY_CENTER_CACHE_KEY = '__meshSnapGeometryCenterCache';

export interface GeometryCenterResult {
  pointLocal: THREE.Vector3;
  kind: 'volumeCentroid' | 'boundingBox';
}

interface GeometryCenterCache {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  index: THREE.BufferAttribute | null;
  positionVersion: number;
  indexVersion: number;
  result: GeometryCenterResult;
}

interface CenterFace {
  welded: [number, number, number];
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

interface CenterEdgeOccurrence {
  faceIndex: number;
  direction: 1 | -1;
}

interface WeldCenterVertexInput {
  point: THREE.Vector3;
  min: THREE.Vector3;
  tolerance: number;
  buckets: Map<string, number[]>;
  positions: THREE.Vector3[];
}

function attributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
}

function cloneGeometryCenter(result: GeometryCenterResult): GeometryCenterResult {
  return { pointLocal: result.pointLocal.clone(), kind: result.kind };
}

function centerEdgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function weldCenterVertex(input: WeldCenterVertexInput): number {
  const { point, min, tolerance, buckets, positions } = input;
  const cell = [
    Math.floor((point.x - min.x) / tolerance),
    Math.floor((point.y - min.y) / tolerance),
    Math.floor((point.z - min.z) / tolerance),
  ];
  const toleranceSq = tolerance * tolerance;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const nearby = buckets.get(`${cell[0] + dx}_${cell[1] + dy}_${cell[2] + dz}`);
        const match = nearby?.find((index) => positions[index].distanceToSquared(point) <= toleranceSq);
        if (match != null) {
          return match;
        }
      }
    }
  }
  const index = positions.length;
  positions.push(point.clone());
  const key = `${cell[0]}_${cell[1]}_${cell[2]}`;
  buckets.set(key, [...(buckets.get(key) ?? []), index]);
  return index;
}

function boundingBoxCenter(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): { center: THREE.Vector3; min: THREE.Vector3; diagonal: number } | null {
  if (position.count === 0 || position.itemSize < 3) {
    return null;
  }
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      return null;
    }
    min.min(point);
    max.max(point);
  }
  return { center: min.clone().add(max).multiplyScalar(0.5), min, diagonal: min.distanceTo(max) };
}

function getFaceVertexIndices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [number, number, number] | null {
  if (!Number.isInteger(faceIndex) || faceIndex < 0) {
    return null;
  }

  const index = geometry.getIndex();
  const base = faceIndex * 3;

  if (index) {
    if (base + 2 >= index.count) {
      return null;
    }
    return [index.getX(base), index.getX(base + 1), index.getX(base + 2)];
  }

  const position = geometry.getAttribute('position');
  if (!position || base + 2 >= position.count) {
    return null;
  }
  return [base, base + 1, base + 2];
}

function getVertex(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) {
  return new THREE.Vector3().fromBufferAttribute(position, i);
}

/** Returns the three local-space vertices of the triangle at `faceIndex`. */
export function getFaceVertices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const indices = getFaceVertexIndices(geometry, faceIndex);
  const position = geometry.getAttribute('position');
  if (!indices || !position) {
    return null;
  }

  // Guard against malformed index buffers so a stray index never reads
  // `undefined` from the attribute and propagates NaN into the alignment math.
  if (indices.some((vertexIndex) => vertexIndex < 0 || vertexIndex >= position.count)) {
    return null;
  }

  return [getVertex(position, indices[0]), getVertex(position, indices[1]), getVertex(position, indices[2])];
}

/** Centroid of the triangle at `faceIndex` (local space). */
export function getFaceCenter(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  return vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
}

/**
 * Geometric face normal at `faceIndex` (local space). Uses the cross product of
 * the triangle edges rather than interpolated vertex normals so the resulting
 * frame stays flat and stable for face-to-face mating.
 */
export function getFaceNormal(geometry: THREE.BufferGeometry, faceIndex: number): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  const edge1 = vertices[1].clone().sub(vertices[0]);
  const edge2 = vertices[2].clone().sub(vertices[0]);
  const normal = new THREE.Vector3().crossVectors(edge1, edge2);
  if (normal.lengthSq() < DEGENERATE_EPSILON_SQ) {
    return null;
  }

  return normal.normalize();
}

interface CenterNeighbor {
  faceIndex: number;
  multiplier: 1 | -1;
}

function buildCenterFaces(input: {
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  bounds: { center: THREE.Vector3; min: THREE.Vector3; diagonal: number };
}): CenterFace[] | null {
  const { geometry, position, bounds } = input;
  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  if (elementCount < 12 || elementCount % 3 !== 0) {
    return null;
  }
  const tolerance = Math.max(1e-8, bounds.diagonal * 1e-6);
  const buckets = new Map<string, number[]>();
  const weldedPositions: THREE.Vector3[] = [];
  const sourceToWelded = new Map<number, number>();
  const faces: CenterFace[] = [];

  for (let faceIndex = 0; faceIndex < elementCount / 3; faceIndex += 1) {
    const source = getFaceVertexIndices(geometry, faceIndex);
    if (!source || source.some((vertexIndex) => vertexIndex >= position.count)) {
      return null;
    }
    const points = source.map((vertexIndex) =>
      new THREE.Vector3().fromBufferAttribute(position, vertexIndex),
    ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const welded: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const known = sourceToWelded.get(source[corner]);
      const next = known ?? weldCenterVertex({
        point: points[corner],
        min: bounds.min,
        tolerance,
        buckets,
        positions: weldedPositions,
      });
      sourceToWelded.set(source[corner], next);
      welded.push(next);
    }
    if (new Set(welded).size < 3) {
      return null;
    }
    faces.push({ welded: welded as [number, number, number], points });
  }
  return faces;
}

function buildClosedAdjacency(faces: CenterFace[]): CenterNeighbor[][] | null {
  const edges = new Map<string, CenterEdgeOccurrence[]>();
  faces.forEach((face, faceIndex) => {
    for (const [from, to] of [
      [face.welded[0], face.welded[1]],
      [face.welded[1], face.welded[2]],
      [face.welded[2], face.welded[0]],
    ] as Array<[number, number]>) {
      const key = centerEdgeKey(from, to);
      edges.set(key, [
        ...(edges.get(key) ?? []),
        { faceIndex, direction: from < to ? 1 : -1 },
      ]);
    }
  });
  if ([...edges.values()].some((occurrences) => occurrences.length !== 2)) {
    return null;
  }

  const adjacency = Array.from({ length: faces.length }, () => [] as CenterNeighbor[]);
  for (const occurrences of edges.values()) {
    const [first, second] = occurrences;
    const multiplier: 1 | -1 = first.direction === second.direction ? -1 : 1;
    adjacency[first.faceIndex].push({ faceIndex: second.faceIndex, multiplier });
    adjacency[second.faceIndex].push({ faceIndex: first.faceIndex, multiplier });
  }
  return adjacency;
}

function orientCenterFaces(
  adjacency: CenterNeighbor[][],
): { signs: Int8Array; components: number[][] } | null {
  const signs = new Int8Array(adjacency.length);
  const components: number[][] = [];
  for (let seed = 0; seed < adjacency.length; seed += 1) {
    if (signs[seed] !== 0) {
      continue;
    }
    const component: number[] = [];
    const queue = [seed];
    signs[seed] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const faceIndex = queue[cursor];
      component.push(faceIndex);
      for (const neighbor of adjacency[faceIndex]) {
        const required = signs[faceIndex] * neighbor.multiplier;
        if (signs[neighbor.faceIndex] === 0) {
          signs[neighbor.faceIndex] = required;
          queue.push(neighbor.faceIndex);
        } else if (signs[neighbor.faceIndex] !== required) {
          return null;
        }
      }
    }
    components.push(component);
  }
  return { signs, components };
}

function integrateVolumeCenter(input: {
  faces: CenterFace[];
  signs: Int8Array;
  components: number[][];
  reference: THREE.Vector3;
  diagonal: number;
}): THREE.Vector3 | null {
  const { faces, signs, components, reference, diagonal } = input;
  const combinedCenter = new THREE.Vector3();
  let totalVolume = 0;
  for (const component of components) {
    const centerNumerator = new THREE.Vector3();
    let signedVolume = 0;
    for (const faceIndex of component) {
      const [a, b, c] = faces[faceIndex].points.map((point) =>
        point.clone().sub(reference),
      ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      const tetraVolume = signs[faceIndex] * a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
      const tetraCenter = a.clone().add(b).add(c).multiplyScalar(0.25).add(reference);
      centerNumerator.addScaledVector(tetraCenter, tetraVolume);
      signedVolume += tetraVolume;
    }
    if (Math.abs(signedVolume) <= Math.max(1e-15, diagonal ** 3 * 1e-12)) {
      return null;
    }
    const componentVolume = Math.abs(signedVolume);
    combinedCenter.addScaledVector(centerNumerator.multiplyScalar(1 / signedVolume), componentVolume);
    totalVolume += componentVolume;
  }
  return totalVolume > 0 ? combinedCenter.multiplyScalar(1 / totalVolume) : null;
}

function computeVolumeCenter(
  geometry: THREE.BufferGeometry,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  bounds: { center: THREE.Vector3; min: THREE.Vector3; diagonal: number },
): THREE.Vector3 | null {
  const faces = buildCenterFaces({ geometry, position, bounds });
  if (!faces) {
    return null;
  }
  const adjacency = buildClosedAdjacency(faces);
  const oriented = adjacency ? orientCenterFaces(adjacency) : null;
  return oriented
    ? integrateVolumeCenter({
        faces,
        signs: oriented.signs,
        components: oriented.components,
        reference: bounds.center,
        diagonal: bounds.diagonal,
      })
    : null;
}

/**
 * Returns a stable local-space center for a mesh geometry. Closed, orientable
 * triangle manifolds use a true volume centroid. Open, non-manifold or
 * degenerate meshes fall back to the geometry bounding-box center. Triangle
 * winding is repaired per connected shell before integrating the volume.
 */
export function getGeometryCenter(geometry: THREE.BufferGeometry): GeometryCenterResult | null {
  const position = geometry.getAttribute('position');
  if (!position) {
    return null;
  }
  const index = geometry.getIndex();
  const cached = geometry.userData[GEOMETRY_CENTER_CACHE_KEY] as GeometryCenterCache | undefined;
  if (
    cached
    && cached.position === position
    && cached.index === index
    && cached.positionVersion === attributeVersion(position)
    && cached.indexVersion === (index?.version ?? -1)
  ) {
    return cloneGeometryCenter(cached.result);
  }

  const bounds = boundingBoxCenter(position);
  if (!bounds) {
    return null;
  }
  const volumeCenter = computeVolumeCenter(geometry, position, bounds);
  const result: GeometryCenterResult = volumeCenter
    ? { pointLocal: volumeCenter, kind: 'volumeCentroid' }
    : { pointLocal: bounds.center.clone(), kind: 'boundingBox' };
  const nextCache = {
    position,
    index,
    positionVersion: attributeVersion(position),
    indexVersion: index?.version ?? -1,
    result: cloneGeometryCenter(result),
  } satisfies GeometryCenterCache;
  Object.defineProperty(geometry.userData, GEOMETRY_CENTER_CACHE_KEY, {
    value: nextCache,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return cloneGeometryCenter(result);
}

/** Of the three triangle vertices, the one closest to `localPoint`. */
export function getNearestVertexOnFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  let nearest = vertices[0];
  let nearestDistance = nearest.distanceToSquared(localPoint);
  for (let i = 1; i < vertices.length; i += 1) {
    const distance = vertices[i].distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = vertices[i];
      nearestDistance = distance;
    }
  }

  return nearest.clone();
}

/** Of the three triangle edge midpoints, the one closest to `localPoint`. */
export function getNearestEdgeMidpointOnFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): THREE.Vector3 | null {
  const vertices = getFaceVertices(geometry, faceIndex);
  if (!vertices) {
    return null;
  }

  const midpoints = [
    vertices[0].clone().add(vertices[1]).multiplyScalar(0.5),
    vertices[1].clone().add(vertices[2]).multiplyScalar(0.5),
    vertices[2].clone().add(vertices[0]).multiplyScalar(0.5),
  ];

  let nearest = midpoints[0];
  let nearestDistance = nearest.distanceToSquared(localPoint);
  for (let i = 1; i < midpoints.length; i += 1) {
    const distance = midpoints[i].distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = midpoints[i];
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Nearest vertex in the whole geometry within `radius` of `localPoint`.
 *
 * No spatial index (three-mesh-bvh is intentionally not a dependency), so high
 * vertex counts are bounded by `maxSamples` stepped sampling. Prefer
 * {@link getNearestVertexOnFace} for the common case; this is the opt-in global
 * vertex snap.
 */
export function getNearestVertexInRadius(
  geometry: THREE.BufferGeometry,
  localPoint: THREE.Vector3,
  radius: number,
  maxSamples = 20000,
): THREE.Vector3 | null {
  const position = geometry.getAttribute('position');
  if (!position || !(radius > 0)) {
    return null;
  }

  const radiusSq = radius * radius;
  const step = Math.max(1, Math.ceil(position.count / Math.max(1, maxSamples)));
  const candidate = new THREE.Vector3();
  let nearest: THREE.Vector3 | null = null;
  let nearestDistance = radiusSq;

  for (let i = 0; i < position.count; i += step) {
    candidate.fromBufferAttribute(position, i);
    const distance = candidate.distanceToSquared(localPoint);
    if (distance < nearestDistance) {
      nearest = candidate.clone();
      nearestDistance = distance;
    }
  }

  return nearest;
}

/**
 * Collect the candidate snap points for the hit triangle, filtered by `filter`
 * (null = all face-level kinds). `surface` and `bboxCenter` are produced by the
 * caller (raw hit / object bounds), not here.
 */
export function collectSnapCandidatesFromFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localHit: THREE.Vector3,
  filter: SnapPointKind[] | null,
): LocalSnapPoint[] {
  const includes = (kind: SnapPointKind) => !filter || filter.includes(kind);
  const normalLocal = getFaceNormal(geometry, faceIndex) ?? undefined;
  const candidates: LocalSnapPoint[] = [];

  if (includes('surface')) {
    candidates.push({ kind: 'surface', pointLocal: localHit.clone(), normalLocal });
  }

  if (includes('faceCenter')) {
    const faceCenter = getFaceCenter(geometry, faceIndex);
    if (faceCenter) {
      candidates.push({ kind: 'faceCenter', pointLocal: faceCenter, normalLocal });
    }
  }

  if (includes('vertex')) {
    const vertex = getNearestVertexOnFace(geometry, faceIndex, localHit);
    if (vertex) {
      candidates.push({ kind: 'vertex', pointLocal: vertex, normalLocal });
    }
  }

  if (includes('edgeMidpoint')) {
    const edgeMidpoint = getNearestEdgeMidpointOnFace(geometry, faceIndex, localHit);
    if (edgeMidpoint) {
      candidates.push({ kind: 'edgeMidpoint', pointLocal: edgeMidpoint, normalLocal });
    }
  }

  return candidates;
}
