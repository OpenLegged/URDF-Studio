import * as THREE from 'three';

export interface PlanarFaceRegionOptions {
  /** Absolute cosine threshold; the default is approximately one degree. */
  coplanarCosThreshold?: number;
  /** Local-space point-to-seed-plane tolerance. Defaults to the weld tolerance. */
  planeDistanceTolerance?: number;
  /** Local-space duplicate-vertex tolerance. Defaults to max(1e-8, diagonal * 1e-6). */
  weldTolerance?: number;
  /** Connected-region traversal budget. Regions over budget return null. */
  maxFaces?: number;
  minBoundaryVertices?: number;
  maxCircleRmsRatio?: number;
}

export interface PlanarBoundaryLoop {
  points: THREE.Vector3[];
  isHole: boolean;
  /** Absolute projected area in local-space units squared. */
  area: number;
}

export interface PlanarCircleCandidate {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  rmsRatio: number;
  confidence: number;
  boundaryLoopIndex: number;
  isHole: boolean;
}

export interface PlanarFaceRegion {
  faceIndices: number[];
  /** Flat local-space triangle vertices; each consecutive three form a triangle. */
  triangles: THREE.Vector3[];
  boundaryLoops: PlanarBoundaryLoop[];
  outerBoundaryLoopIndex: number | null;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  circleCandidates: PlanarCircleCandidate[];
}

interface ResolvedOptions {
  coplanarCosThreshold: number;
  planeDistanceTolerance: number;
  maxFaces: number;
  minBoundaryVertices: number;
  maxCircleRmsRatio: number;
}

export interface TopologyFace {
  sourceVertices: [number, number, number];
  weldedVertices: [number, number, number];
  normal: THREE.Vector3 | null;
  area: number;
}

export interface WeldedTopology {
  faces: TopologyFace[];
  faceNeighbors: number[][];
  edgeFaces: Map<string, number[]>;
  weldedPositions: THREE.Vector3[];
  planarRegionCache: Map<string, PlanarFaceRegion | null>;
}

interface TopologyCache {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  index: THREE.BufferAttribute | null;
  positionCount: number;
  indexCount: number;
  positionVersion: number;
  indexVersion: number;
  weldTolerance: number;
  topology: WeldedTopology;
}

export interface PlaneBasis {
  u: THREE.Vector3;
  v: THREE.Vector3;
}

interface FindWeldedVertexInput {
  point: THREE.Vector3;
  min: THREE.Vector3;
  tolerance: number;
  buckets: Map<string, number[]>;
  weldedPositions: THREE.Vector3[];
}

interface FaceLiesOnPlaneInput {
  face: TopologyFace;
  seedNormal: THREE.Vector3;
  seedPoint: THREE.Vector3;
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  options: ResolvedOptions;
}

interface FitCircleCandidatesInput {
  loops: PlanarBoundaryLoop[];
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  basis: PlaneBasis;
  options: ResolvedOptions;
}

const TOPOLOGY_CACHE_KEY = '__planarRegionTopologyCache';
const DEFAULT_COPLANAR_COS_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(3));
export const DEFAULT_MESH_FEATURE_MAX_FACES = 50000;
const DEFAULT_MIN_BOUNDARY_VERTICES = 6;
const DEFAULT_MAX_CIRCLE_RMS_RATIO = 0.05;
const MIN_POSITION_TOLERANCE = 1e-8;
const DEGENERATE_EPSILON_SQ = 1e-20;
const SOLVE_EPSILON = 1e-12;

function buildNeighborCellOffsets(): Array<[number, number, number]> {
  // The home cell comes first because STL/OBJ triangle seams are usually exact
  // duplicates; most lookups then avoid probing the other 26 cells.
  const offsets: Array<[number, number, number]> = [[0, 0, 0]];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx === 0 && dy === 0 && dz === 0) {
          continue;
        }
        offsets.push([dx, dy, dz]);
      }
    }
  }
  return offsets;
}

const NEIGHBOR_CELL_OFFSETS = buildNeighborCellOffsets();

function attributeVersion(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sourceFaceVertices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [number, number, number] | null {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const base = faceIndex * 3;
  const count = index?.count ?? position?.count ?? 0;
  if (!position || !Number.isInteger(faceIndex) || faceIndex < 0 || base + 2 >= count) {
    return null;
  }

  const vertices: [number, number, number] = index
    ? [index.getX(base), index.getX(base + 1), index.getX(base + 2)]
    : [base, base + 1, base + 2];
  if (
    vertices.some(
      (vertexIndex) =>
        !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count,
    )
  ) {
    return null;
  }
  return vertices;
}

/** Number of complete triangles addressable by the geometry draw topology. */
export function getGeometryFaceCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const elementCount = geometry.getIndex()?.count ?? position?.count ?? 0;
  return elementCount % 3 === 0 ? elementCount / 3 : 0;
}

function measureBounds(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): { min: THREE.Vector3; diagonal: number } | null {
  if (position.count === 0 || position.itemSize < 3) {
    return null;
  }

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const point = new THREE.Vector3();
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    point.fromBufferAttribute(position, vertexIndex);
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      return null;
    }
    min.min(point);
    max.max(point);
  }
  return { min, diagonal: max.distanceTo(min) };
}

function findWeldedVertex(
  input: FindWeldedVertexInput,
): { weldedIndex: number; bucketKey: string } {
  const { point, min, tolerance, buckets, weldedPositions } = input;
  const cellX = Math.floor((point.x - min.x) / tolerance);
  const cellY = Math.floor((point.y - min.y) / tolerance);
  const cellZ = Math.floor((point.z - min.z) / tolerance);
  const toleranceSq = tolerance * tolerance;

  for (const [dx, dy, dz] of NEIGHBOR_CELL_OFFSETS) {
    const nearby = buckets.get(`${cellX + dx}_${cellY + dy}_${cellZ + dz}`);
    if (!nearby) {
      continue;
    }
    for (const weldedIndex of nearby) {
      if (weldedPositions[weldedIndex].distanceToSquared(point) <= toleranceSq) {
        return { weldedIndex, bucketKey: '' };
      }
    }
  }

  return { weldedIndex: -1, bucketKey: `${cellX}_${cellY}_${cellZ}` };
}

function weldVertices(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  min: THREE.Vector3,
  tolerance: number,
): { sourceToWelded: number[]; weldedPositions: THREE.Vector3[] } {
  const sourceToWelded: number[] = [];
  const weldedPositions: THREE.Vector3[] = [];
  const weldedCounts: number[] = [];
  const buckets = new Map<string, number[]>();
  const point = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    point.fromBufferAttribute(position, vertexIndex);
    const match = findWeldedVertex({ point, min, tolerance, buckets, weldedPositions });
    if (match.weldedIndex >= 0) {
      const count = weldedCounts[match.weldedIndex] + 1;
      weldedPositions[match.weldedIndex]
        .multiplyScalar((count - 1) / count)
        .addScaledVector(point, 1 / count);
      weldedCounts[match.weldedIndex] = count;
      sourceToWelded.push(match.weldedIndex);
      continue;
    }

    const weldedIndex = weldedPositions.length;
    weldedPositions.push(point.clone());
    weldedCounts.push(1);
    sourceToWelded.push(weldedIndex);
    const bucket = buckets.get(match.bucketKey);
    if (bucket) {
      bucket.push(weldedIndex);
    } else {
      buckets.set(match.bucketKey, [weldedIndex]);
    }
  }

  return { sourceToWelded, weldedPositions };
}

function buildTopology(
  geometry: THREE.BufferGeometry,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  weldTolerance: number,
  bounds: { min: THREE.Vector3; diagonal: number },
): WeldedTopology | null {
  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  if (elementCount % 3 !== 0) {
    return null;
  }

  const { sourceToWelded, weldedPositions } = weldVertices(
    position,
    bounds.min,
    weldTolerance,
  );
  const faces: TopologyFace[] = [];
  const edgeFaces = new Map<string, number[]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let faceIndex = 0; faceIndex < elementCount / 3; faceIndex += 1) {
    const sourceVertices = sourceFaceVertices(geometry, faceIndex);
    if (!sourceVertices) {
      return null;
    }
    const weldedVertices: [number, number, number] = [
      sourceToWelded[sourceVertices[0]],
      sourceToWelded[sourceVertices[1]],
      sourceToWelded[sourceVertices[2]],
    ];
    a.fromBufferAttribute(position, sourceVertices[0]);
    b.fromBufferAttribute(position, sourceVertices[1]);
    c.fromBufferAttribute(position, sourceVertices[2]);
    const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    const crossLength = cross.length();
    const normal = crossLength * crossLength > DEGENERATE_EPSILON_SQ
      ? cross.multiplyScalar(1 / crossLength)
      : null;
    faces.push({ sourceVertices, weldedVertices, normal, area: crossLength * 0.5 });

    if (!normal || new Set(weldedVertices).size < 3) {
      continue;
    }
    for (const [edgeStart, edgeEnd] of [
      [weldedVertices[0], weldedVertices[1]],
      [weldedVertices[1], weldedVertices[2]],
      [weldedVertices[2], weldedVertices[0]],
    ] as Array<[number, number]>) {
      const key = edgeKey(edgeStart, edgeEnd);
      const adjacent = edgeFaces.get(key);
      if (adjacent) {
        adjacent.push(faceIndex);
      } else {
        edgeFaces.set(key, [faceIndex]);
      }
    }
  }

  const faceNeighbors = Array.from({ length: faces.length }, () => [] as number[]);
  for (const adjacent of edgeFaces.values()) {
    for (let first = 0; first < adjacent.length; first += 1) {
      for (let second = first + 1; second < adjacent.length; second += 1) {
        faceNeighbors[adjacent[first]].push(adjacent[second]);
        faceNeighbors[adjacent[second]].push(adjacent[first]);
      }
    }
  }
  return {
    faces,
    faceNeighbors,
    edgeFaces,
    weldedPositions,
    planarRegionCache: new Map(),
  };
}

export function getCachedTopology(
  geometry: THREE.BufferGeometry,
  requestedWeldTolerance?: number,
): { topology: WeldedTopology; weldTolerance: number } | null {
  const position = geometry.getAttribute('position');
  if (!position) {
    return null;
  }
  const index = geometry.getIndex();
  const cached = geometry.userData[TOPOLOGY_CACHE_KEY] as TopologyCache | undefined;
  if (
    cached
    && cached.position === position
    && cached.index === index
    && cached.positionCount === position.count
    && cached.indexCount === (index?.count ?? 0)
    && cached.positionVersion === attributeVersion(position)
    && cached.indexVersion === (index?.version ?? -1)
    && (requestedWeldTolerance == null || cached.weldTolerance === requestedWeldTolerance)
  ) {
    return { topology: cached.topology, weldTolerance: cached.weldTolerance };
  }

  // Bounds are O(vertex count), so they belong strictly on the cache-miss path;
  // hover resolution commonly calls this function every 33 ms.
  const bounds = measureBounds(position);
  if (!bounds) {
    return null;
  }
  const weldTolerance = requestedWeldTolerance
    ?? Math.max(MIN_POSITION_TOLERANCE, bounds.diagonal * 1e-6);
  if (!(weldTolerance > 0) || !Number.isFinite(weldTolerance)) {
    return null;
  }

  const topology = buildTopology(geometry, position, weldTolerance, bounds);
  if (!topology) {
    return null;
  }
  const nextCache = {
    position,
    index,
    positionCount: position.count,
    indexCount: index?.count ?? 0,
    positionVersion: attributeVersion(position),
    indexVersion: index?.version ?? -1,
    weldTolerance,
    topology,
  } satisfies TopologyCache;
  // Geometry clones serialize enumerable userData. Keep this potentially large
  // runtime-only cache non-enumerable so clone/export paths never copy it.
  Object.defineProperty(geometry.userData, TOPOLOGY_CACHE_KEY, {
    value: nextCache,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return { topology, weldTolerance };
}

function resolveOptions(
  weldTolerance: number,
  options: PlanarFaceRegionOptions | undefined,
): ResolvedOptions {
  return {
    coplanarCosThreshold: options?.coplanarCosThreshold ?? DEFAULT_COPLANAR_COS_THRESHOLD,
    planeDistanceTolerance: options?.planeDistanceTolerance ?? weldTolerance * 12,
    maxFaces: options?.maxFaces ?? DEFAULT_MESH_FEATURE_MAX_FACES,
    minBoundaryVertices: options?.minBoundaryVertices ?? DEFAULT_MIN_BOUNDARY_VERTICES,
    maxCircleRmsRatio: options?.maxCircleRmsRatio ?? DEFAULT_MAX_CIRCLE_RMS_RATIO,
  };
}

function faceLiesOnPlane(input: FaceLiesOnPlaneInput): boolean {
  const { face, seedNormal, seedPoint, position, options } = input;
  if (!face.normal || Math.abs(face.normal.dot(seedNormal)) < options.coplanarCosThreshold) {
    return false;
  }
  const point = new THREE.Vector3();
  return face.sourceVertices.every((vertexIndex) => {
    point.fromBufferAttribute(position, vertexIndex);
    return Math.abs(point.clone().sub(seedPoint).dot(seedNormal)) <= options.planeDistanceTolerance;
  });
}

function collectCoplanarFaces(
  topology: WeldedTopology,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  faceIndex: number,
  options: ResolvedOptions,
): number[] | null {
  const seedFace = topology.faces[faceIndex];
  if (!seedFace?.normal) {
    return null;
  }
  const seedPoint = new THREE.Vector3().fromBufferAttribute(position, seedFace.sourceVertices[0]);
  const included = new Set<number>([faceIndex]);
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of topology.faceNeighbors[queue[cursor]]) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      if (!faceLiesOnPlane({
        face: topology.faces[neighbor],
        seedNormal: seedFace.normal,
        seedPoint,
        position,
        options,
      })) {
        continue;
      }
      included.add(neighbor);
      if (included.size > options.maxFaces) {
        return null;
      }
      queue.push(neighbor);
    }
  }
  return [...included].sort((a, b) => a - b);
}

function collectRegionGeometry(
  topology: WeldedTopology,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  faceIndices: number[],
  seedNormal: THREE.Vector3,
): { triangles: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 } | null {
  const triangles: THREE.Vector3[] = [];
  const weightedCenter = new THREE.Vector3();
  const weightedNormal = new THREE.Vector3();
  let totalArea = 0;

  for (const faceIndex of faceIndices) {
    const face = topology.faces[faceIndex];
    const vertices = face.sourceVertices.map((vertexIndex) =>
      new THREE.Vector3().fromBufferAttribute(position, vertexIndex),
    ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    triangles.push(...vertices);
    if (!face.normal || !(face.area > 0)) {
      continue;
    }
    const centroid = vertices[0].clone().add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
    weightedCenter.addScaledVector(centroid, face.area);
    const alignedNormal = face.normal.dot(seedNormal) < 0 ? face.normal.clone().negate() : face.normal;
    weightedNormal.addScaledVector(alignedNormal, face.area);
    totalArea += face.area;
  }
  if (!(totalArea > 0) || weightedNormal.lengthSq() < DEGENERATE_EPSILON_SQ) {
    return null;
  }
  return {
    triangles,
    center: weightedCenter.multiplyScalar(1 / totalArea),
    normal: weightedNormal.normalize(),
  };
}

function boundaryEdges(topology: WeldedTopology, faceIndices: number[]): Array<[number, number]> {
  const regionFaces = new Set(faceIndices);
  const result: Array<[number, number]> = [];
  const emitted = new Set<string>();
  for (const faceIndex of faceIndices) {
    const vertices = topology.faces[faceIndex].weldedVertices;
    for (const [a, b] of [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as Array<[number, number]>) {
      const key = edgeKey(a, b);
      if (emitted.has(key)) {
        continue;
      }
      const adjacent = topology.edgeFaces.get(key) ?? [];
      const regionAdjacentCount = adjacent.filter((candidate) => regionFaces.has(candidate)).length;
      if (regionAdjacentCount === 1) {
        result.push(a < b ? [a, b] : [b, a]);
      }
      emitted.add(key);
    }
  }
  return result.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
}

function traceBoundaryLoops(
  topology: WeldedTopology,
  edges: Array<[number, number]>,
): THREE.Vector3[][] {
  const neighbors = new Map<number, number[]>();
  for (const [a, b] of edges) {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  }
  for (const adjacent of neighbors.values()) {
    adjacent.sort((a, b) => a - b);
  }

  const unused = new Set(edges.map(([a, b]) => edgeKey(a, b)));
  const loops: THREE.Vector3[][] = [];
  for (const [edgeStart, edgeEnd] of edges) {
    if (!unused.has(edgeKey(edgeStart, edgeEnd))) {
      continue;
    }
    const indices = [edgeStart];
    let previous = edgeStart;
    let current = edgeEnd;
    unused.delete(edgeKey(previous, current));

    while (current !== edgeStart && indices.length <= edges.length) {
      indices.push(current);
      const next = (neighbors.get(current) ?? []).find(
        (candidate) => candidate !== previous && unused.has(edgeKey(current, candidate)),
      );
      if (next == null) {
        break;
      }
      previous = current;
      current = next;
      unused.delete(edgeKey(previous, current));
    }
    if (current === edgeStart && indices.length >= 3) {
      loops.push(indices.map((index) => topology.weldedPositions[index].clone()));
    }
  }
  return loops;
}

export function buildPlaneBasis(normal: THREE.Vector3): PlaneBasis {
  const fallback = Math.abs(normal.x) < 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const u = fallback.sub(normal.clone().multiplyScalar(fallback.dot(normal))).normalize();
  return { u, v: new THREE.Vector3().crossVectors(normal, u).normalize() };
}

function projectLoop(
  points: THREE.Vector3[],
  origin: THREE.Vector3,
  basis: PlaneBasis,
): Array<{ x: number; y: number }> {
  return points.map((point) => {
    const offset = point.clone().sub(origin);
    return { x: offset.dot(basis.u), y: offset.dot(basis.v) };
  });
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let doubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    doubleArea += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(doubleArea) * 0.5;
}

function determinant3(matrix: number[][]): number {
  return (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  );
}

function replaceColumn(matrix: number[][], column: number, values: number[]): number[][] {
  return matrix.map((row, rowIndex) =>
    row.map((value, columnIndex) => (columnIndex === column ? values[rowIndex] : value)),
  );
}

export function kasaCircleFit(
  points: Array<{ x: number; y: number }>,
  weights?: number[],
): { center: { x: number; y: number }; radius: number } | null {
  if (points.length < 3 || (weights && weights.length !== points.length)) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;
  let totalWeight = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const weight = weights?.[index] ?? 1;
    if (!(weight > 0) || !Number.isFinite(weight)) {
      return null;
    }
    const x2 = point.x * point.x;
    const y2 = point.y * point.y;
    totalWeight += weight;
    sumX += weight * point.x;
    sumY += weight * point.y;
    sumX2 += weight * x2;
    sumY2 += weight * y2;
    sumXY += weight * point.x * point.y;
    sumX3 += weight * x2 * point.x;
    sumY3 += weight * y2 * point.y;
    sumX2Y += weight * x2 * point.y;
    sumXY2 += weight * point.x * y2;
  }
  const matrix = [
    [sumX2, sumXY, sumX],
    [sumXY, sumY2, sumY],
    [sumX, sumY, totalWeight],
  ];
  const rhs = [sumX3 + sumXY2, sumX2Y + sumY3, sumX2 + sumY2];
  const determinant = determinant3(matrix);
  if (Math.abs(determinant) < SOLVE_EPSILON) {
    return null;
  }
  const a = determinant3(replaceColumn(matrix, 0, rhs)) / determinant;
  const b = determinant3(replaceColumn(matrix, 1, rhs)) / determinant;
  const c = determinant3(replaceColumn(matrix, 2, rhs)) / determinant;
  const radiusSquared = c + (a * a + b * b) * 0.25;
  if (!(radiusSquared > DEGENERATE_EPSILON_SQ) || !Number.isFinite(radiusSquared)) {
    return null;
  }
  return { center: { x: a * 0.5, y: b * 0.5 }, radius: Math.sqrt(radiusSquared) };
}

function fitCircleCandidates(input: FitCircleCandidatesInput): PlanarCircleCandidate[] {
  const { loops, origin, normal, basis, options } = input;
  const candidates: PlanarCircleCandidate[] = [];
  loops.forEach((loop, boundaryLoopIndex) => {
    if (loop.points.length < options.minBoundaryVertices) {
      return;
    }
    const points2d = projectLoop(loop.points, origin, basis);
    // Weight each sample by its local boundary support so uneven STL
    // tessellation does not bias the fitted center toward dense short edges.
    const weights = points2d.map((point, pointIndex) => {
      const previous = points2d[(pointIndex - 1 + points2d.length) % points2d.length];
      const next = points2d[(pointIndex + 1) % points2d.length];
      return (
        Math.hypot(point.x - previous.x, point.y - previous.y)
        + Math.hypot(next.x - point.x, next.y - point.y)
      ) * 0.5;
    });
    const fit = kasaCircleFit(points2d, weights);
    if (!fit) {
      return;
    }
    let residualSquared = 0;
    for (const point of points2d) {
      const residual = Math.hypot(point.x - fit.center.x, point.y - fit.center.y) - fit.radius;
      residualSquared += residual * residual;
    }
    const rmsRatio = Math.sqrt(residualSquared / points2d.length) / fit.radius;
    if (!Number.isFinite(rmsRatio) || rmsRatio > options.maxCircleRmsRatio) {
      return;
    }
    candidates.push({
      center: origin.clone()
        .addScaledVector(basis.u, fit.center.x)
        .addScaledVector(basis.v, fit.center.y),
      normal: normal.clone(),
      radius: fit.radius,
      rmsRatio,
      confidence: Math.max(0, 1 - rmsRatio / options.maxCircleRmsRatio)
        * (loop.points.length === 6 ? 0.6 : loop.points.length === 7 ? 0.75 : 1),
      boundaryLoopIndex,
      isHole: loop.isHole,
    });
  });
  return candidates;
}

function optionsCacheKey(options: ResolvedOptions): string {
  return [
    options.coplanarCosThreshold,
    options.planeDistanceTolerance,
    options.maxFaces,
    options.minBoundaryVertices,
    options.maxCircleRmsRatio,
  ].map((value) => value.toPrecision(8)).join(':');
}

/**
 * Resolves the connected planar surface containing `faceIndex`. The returned
 * descriptor is entirely in geometry-local space and owns its vectors, so a
 * viewer may transform it without mutating the cached topology.
 */
export function detectPlanarFaceRegion(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  options?: PlanarFaceRegionOptions,
): PlanarFaceRegion | null {
  const position = geometry.getAttribute('position');
  const maxFaces = options?.maxFaces ?? DEFAULT_MESH_FEATURE_MAX_FACES;
  if (getGeometryFaceCount(geometry) > maxFaces) {
    return null;
  }
  const cached = getCachedTopology(geometry, options?.weldTolerance);
  if (!position || !cached || !Number.isInteger(faceIndex) || faceIndex < 0) {
    return null;
  }
  const resolvedOptions = resolveOptions(cached.weldTolerance, options);
  if (!(resolvedOptions.maxFaces >= 1) || faceIndex >= cached.topology.faces.length) {
    return null;
  }
  const cachePrefix = optionsCacheKey(resolvedOptions);
  const cacheKey = `${cachePrefix}:${faceIndex}`;
  if (cached.topology.planarRegionCache.has(cacheKey)) {
    return cached.topology.planarRegionCache.get(cacheKey) ?? null;
  }
  const faceIndices = collectCoplanarFaces(
    cached.topology,
    position,
    faceIndex,
    resolvedOptions,
  );
  const seedNormal = cached.topology.faces[faceIndex]?.normal;
  if (!faceIndices || !seedNormal) {
    cached.topology.planarRegionCache.set(cacheKey, null);
    return null;
  }
  const regionGeometry = collectRegionGeometry(
    cached.topology,
    position,
    faceIndices,
    seedNormal,
  );
  if (!regionGeometry) {
    cached.topology.planarRegionCache.set(cacheKey, null);
    return null;
  }
  const basis = buildPlaneBasis(regionGeometry.normal);
  const loops = traceBoundaryLoops(cached.topology, boundaryEdges(cached.topology, faceIndices))
    .map((points) => ({
      points,
      isHole: false,
      area: polygonArea(projectLoop(points, regionGeometry.center, basis)),
    }))
    .sort((first, second) => second.area - first.area);
  loops.forEach((loop, loopIndex) => {
    loop.isHole = loopIndex > 0;
  });

  const region: PlanarFaceRegion = {
    faceIndices,
    triangles: regionGeometry.triangles,
    boundaryLoops: loops,
    outerBoundaryLoopIndex: loops.length > 0 ? 0 : null,
    center: regionGeometry.center,
    normal: regionGeometry.normal,
    circleCandidates: fitCircleCandidates({
      loops,
      origin: regionGeometry.center,
      normal: regionGeometry.normal,
      basis,
      options: resolvedOptions,
    }),
  };
  for (const memberFace of faceIndices) {
    cached.topology.planarRegionCache.set(`${cachePrefix}:${memberFace}`, region);
  }
  return region;
}
