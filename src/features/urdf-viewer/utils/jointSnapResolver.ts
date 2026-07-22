import * as THREE from 'three';

import type { AssemblySceneProjection } from '@/core/robot';
import {
  collectSnapCandidatesFromFace,
  getFaceCenter,
  getFaceNormal,
  getFaceVertices,
  getGeometryCenter,
  type SnapPointKind,
} from '@/core/geometry/meshSnapPoints';
import {
  detectPlanarFaceRegion,
  getGeometryFaceCount,
  DEFAULT_MESH_FEATURE_MAX_FACES,
  type PlanarFaceRegion,
} from '@/core/geometry/planarFaceRegion';
import {
  detectCylinderFaceRegion,
  type CylinderFaceRegion,
} from '@/core/geometry/cylinderFaceRegion';
import { makeFrameFromPointAndNormal } from '@/core/geometry/snapGeometry';

import { getObjectWorldCenter, getObjectWorldPoseMatrix } from './measurements.ts';

export interface ResolvedJointSnapCandidate {
  id: string;
  kind: SnapPointKind;
  pointWorld: THREE.Vector3;
  poseWorld: THREE.Matrix4;
  boundaryLoopIndex?: number;
  isHole?: boolean;
  confidence?: number;
}

export interface ResolvedJointSnapBoundaryCircle {
  candidateId: string;
  centerWorld: THREE.Vector3;
  radiusLocal: number;
  confidence: number;
}

export interface ResolvedJointSnapBoundaryLoop {
  id: string;
  pointsWorld: THREE.Vector3[];
  isHole: boolean;
  circle?: ResolvedJointSnapBoundaryCircle;
}

export interface ResolvedJointSnapRegion {
  id: string;
  faceIndices: number[];
  /** Flat world-space vertices; each consecutive three form a triangle. */
  trianglesWorld: THREE.Vector3[];
  boundaryLoops: ResolvedJointSnapBoundaryLoop[];
  outerBoundaryLoopIndex: number | null;
  centerWorld: THREE.Vector3;
  normalWorld: THREE.Vector3;
  featureKind: 'surface' | 'planar' | 'cylindrical';
  confidence: number;
  truncated: boolean;
  cylinderAxis?: {
    candidateId: string;
    originWorld: THREE.Vector3;
    directionWorld: THREE.Vector3;
    radiusLocal: number;
    heightLocal: number;
    coverageRadians: number;
    rmsRatio: number;
  };
  /** True when face-budget/degenerate fallback could only describe the hit triangle. */
  isFallback: boolean;
}

export interface ResolvedJointSnap {
  componentId: string;
  linkId: string;
  linkWorldMatrix: THREE.Matrix4;
  candidates: ResolvedJointSnapCandidate[];
  region: ResolvedJointSnapRegion;
  /** Smart region-level choice, even when `chosen` is overridden to a free point. */
  recommended: ResolvedJointSnapCandidate;
  chosen: ResolvedJointSnapCandidate;
}

export interface JointSnapResolveOptions {
  camera?: THREE.Camera;
  domSize?: { width: number; height: number };
  freePointOverride?: boolean;
}

/** Minimal structural view of a raycast hit (decoupled from THREE.Intersection for testability). */
export interface JointSnapHit {
  object: THREE.Object3D;
  point: THREE.Vector3;
  faceIndex?: number | null;
}

type MaybeUrdfLink = THREE.Object3D & { isURDFLink?: boolean };

interface WorldPoseInput {
  pointWorld: THREE.Vector3;
  normalLocal?: THREE.Vector3;
  normalMatrix: THREE.Matrix3;
  matrixWorld: THREE.Matrix4;
  hintTangentWorld: THREE.Vector3;
}

interface ScreenDistanceInput {
  a: THREE.Vector3;
  b: THREE.Vector3;
  camera: THREE.Camera;
  domSize: { width: number; height: number };
}

interface LocalResolvedCandidate {
  id: string;
  kind: SnapPointKind;
  pointLocal: THREE.Vector3;
  normalLocal?: THREE.Vector3;
  boundaryLoopIndex?: number;
  isHole?: boolean;
  confidence?: number;
  orientationKind?: 'surfaceNormal' | 'axisDirection';
}

interface ResolveRegionToWorldInput {
  localRegion: PlanarFaceRegion;
  geometry: THREE.BufferGeometry;
  matrixWorld: THREE.Matrix4;
  normalMatrix: THREE.Matrix3;
  loopCandidateIds: Map<number, string>;
  isFallback: boolean;
  truncated: boolean;
  cylinderRegion?: CylinderFaceRegion;
}

interface CollectLocalCandidatesInput {
  geometry: THREE.BufferGeometry;
  faceIndex: number;
  localHit: THREE.Vector3;
  snapFilter: SnapPointKind[] | null;
  truncated: boolean;
  detectedRegion: PlanarFaceRegion | null;
  cylinderRegion: CylinderFaceRegion | null;
}

interface ResolveWorldCandidatesInput {
  candidates: LocalResolvedCandidate[];
  matrixWorld: THREE.Matrix4;
  normalMatrix: THREE.Matrix3;
  hintTangentWorld: THREE.Vector3;
}

const SNAP_PROFILE: Record<SnapPointKind, { priority: number; radiusPx: number }> = {
  // Outer circular faces are region-level origins. Circular holes use a finite
  // radius in `snapProfileForCandidate` so they do not steal a whole plate.
  circleCenter: { priority: 100, radiusPx: Number.POSITIVE_INFINITY },
  cylinderAxis: { priority: 110, radiusPx: Number.POSITIVE_INFINITY },
  // Once a planar region is highlighted, clicking anywhere on it commits its
  // stable area center. Ctrl/Cmd is the explicit escape hatch to a raw point.
  faceCenter: { priority: 60, radiusPx: Number.POSITIVE_INFINITY },
  vertex: { priority: 55, radiusPx: 16 },
  edgeMidpoint: { priority: 50, radiusPx: 16 },
  bboxCenter: { priority: 45, radiusPx: 200 },
  geometryCenter: { priority: 48, radiusPx: 200 },
  surface: { priority: 0, radiusPx: 0 },
};

function snapProfileForCandidate(
  candidate: ResolvedJointSnapCandidate,
): { priority: number; radiusPx: number } {
  if (candidate.kind === 'circleCenter' && candidate.isHole === true) {
    return { priority: SNAP_PROFILE.circleCenter.priority, radiusPx: 24 };
  }
  if (candidate.kind === 'circleCenter' && (candidate.confidence ?? 1) < 0.85) {
    return { priority: SNAP_PROFILE.circleCenter.priority, radiusPx: 24 };
  }
  return SNAP_PROFILE[candidate.kind];
}

function findLinkAncestor(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if ((current as MaybeUrdfLink).isURDFLink || current.type === 'URDFLink') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function resolveComponentAndLink(
  projection: AssemblySceneProjection,
  linkObject: THREE.Object3D,
): { componentId: string; linkId: string } | null {
  const semanticLinkId =
    typeof linkObject.userData.semanticLinkId === 'string'
      ? linkObject.userData.semanticLinkId
      : linkObject.name;
  const ref = projection.globalToEntityRef.get(semanticLinkId);
  if (ref?.type !== 'link') {
    return null;
  }
  return { componentId: ref.componentId, linkId: ref.entityId };
}

function toWorldPose(input: WorldPoseInput): THREE.Matrix4 {
  const { pointWorld, normalLocal, normalMatrix, matrixWorld, hintTangentWorld } = input;
  // Surface normals must use the inverse-transpose so non-uniform mesh scale
  // does not skew the snap frame orientation.
  const normalWorld = normalLocal
    ? normalLocal.clone().applyMatrix3(normalMatrix).normalize()
    : new THREE.Vector3(0, 0, 1).transformDirection(matrixWorld);
  return makeFrameFromPointAndNormal(pointWorld, normalWorld, hintTangentWorld);
}

function screenDistancePx(input: ScreenDistanceInput): number {
  const { a, b, camera, domSize } = input;
  const aNdc = a.clone().project(camera);
  const bNdc = b.clone().project(camera);
  const ax = (aNdc.x * 0.5 + 0.5) * domSize.width;
  const ay = (-aNdc.y * 0.5 + 0.5) * domSize.height;
  const bx = (bNdc.x * 0.5 + 0.5) * domSize.width;
  const by = (-bNdc.y * 0.5 + 0.5) * domSize.height;
  return Math.hypot(ax - bx, ay - by);
}

function fallbackRegionFromFace(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localHit: THREE.Vector3,
): PlanarFaceRegion {
  const vertices = getFaceVertices(geometry, faceIndex) ?? [];
  const center = getFaceCenter(geometry, faceIndex) ?? localHit.clone();
  const normal = getFaceNormal(geometry, faceIndex) ?? new THREE.Vector3(0, 0, 1);
  return {
    faceIndices: [faceIndex],
    triangles: vertices.map((vertex) => vertex.clone()),
    boundaryLoops: vertices.length === 3
      ? [{ points: vertices.map((vertex) => vertex.clone()), isHole: false, area: 0 }]
      : [],
    outerBoundaryLoopIndex: vertices.length === 3 ? 0 : null,
    center,
    normal,
    circleCandidates: [],
  };
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function positionAttributeVersion(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) {
    return -1;
  }
  return position instanceof THREE.InterleavedBufferAttribute
    ? position.data.version
    : position.version;
}

function resolvedRegionId(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  faceIndices: number[],
): string {
  const positionVersion = positionAttributeVersion(geometry);
  const indexVersion = geometry.getIndex()?.version ?? -1;
  const faceSignature = faceIndices.join(',');
  const matrixSignature = matrixWorld.elements.map((value) => value.toPrecision(12)).join(',');
  return `${geometry.uuid}:p${positionVersion}:i${indexVersion}:r${hashText(faceSignature)}:m${hashText(matrixSignature)}`;
}

function appendCircleCandidates(
  region: PlanarFaceRegion,
  candidates: LocalResolvedCandidate[],
): Map<number, string> {
  const loopCandidateIds = new Map<number, string>();
  for (const circle of region.circleCandidates) {
    const duplicate = candidates.find((candidate) => {
      if (candidate.kind !== 'circleCenter') {
        return false;
      }
      const tolerance = Math.max(1e-8, circle.radius * 1e-6);
      return candidate.pointLocal.distanceToSquared(circle.center) <= tolerance * tolerance;
    });
    if (duplicate) {
      loopCandidateIds.set(circle.boundaryLoopIndex, duplicate.id);
      continue;
    }
    const id = `circleCenter:${circle.boundaryLoopIndex}`;
    candidates.push({
      id,
      kind: 'circleCenter',
      pointLocal: circle.center.clone(),
      normalLocal: circle.normal.clone(),
      boundaryLoopIndex: circle.boundaryLoopIndex,
      isHole: circle.isHole,
      confidence: circle.confidence,
    });
    loopCandidateIds.set(circle.boundaryLoopIndex, id);
  }
  return loopCandidateIds;
}

function appendLogicalBoundaryCandidates(
  region: PlanarFaceRegion,
  localHit: THREE.Vector3,
  candidates: LocalResolvedCandidate[],
  filter: SnapPointKind[] | null,
) {
  const includeVertex = !filter || filter.includes('vertex');
  const includeEdge = !filter || filter.includes('edgeMidpoint');
  if ((!includeVertex && !includeEdge) || region.boundaryLoops.length === 0) {
    return;
  }

  let nearestVertex: { point: THREE.Vector3; id: string; distance: number } | null = null;
  let nearestEdge: { point: THREE.Vector3; id: string; distance: number } | null = null;
  for (let loopIndex = 0; loopIndex < region.boundaryLoops.length; loopIndex += 1) {
    const loop = region.boundaryLoops[loopIndex];
    for (let pointIndex = 0; pointIndex < loop.points.length; pointIndex += 1) {
      const point = loop.points[pointIndex];
      const vertexDistance = point.distanceToSquared(localHit);
      if (!nearestVertex || vertexDistance < nearestVertex.distance) {
        nearestVertex = {
          point,
          id: `vertex:${loopIndex}:${pointIndex}`,
          distance: vertexDistance,
        };
      }
      const next = loop.points[(pointIndex + 1) % loop.points.length];
      const midpoint = point.clone().add(next).multiplyScalar(0.5);
      const edgeDistance = midpoint.distanceToSquared(localHit);
      if (!nearestEdge || edgeDistance < nearestEdge.distance) {
        nearestEdge = {
          point: midpoint,
          id: `edgeMidpoint:${loopIndex}:${pointIndex}`,
          distance: edgeDistance,
        };
      }
    }
  }
  if (includeVertex && nearestVertex) {
    candidates.push({
      id: nearestVertex.id,
      kind: 'vertex',
      pointLocal: nearestVertex.point.clone(),
      normalLocal: region.normal.clone(),
    });
  }
  if (includeEdge && nearestEdge) {
    candidates.push({
      id: nearestEdge.id,
      kind: 'edgeMidpoint',
      pointLocal: nearestEdge.point,
      normalLocal: region.normal.clone(),
    });
  }
}

function resolveRegionToWorld(input: ResolveRegionToWorldInput): ResolvedJointSnapRegion {
  const {
    localRegion,
    geometry,
    matrixWorld,
    normalMatrix,
    loopCandidateIds,
    isFallback,
    truncated,
    cylinderRegion,
  } = input;
  const featureFaceIndices = cylinderRegion?.faceIndices ?? localRegion.faceIndices;
  const id = resolvedRegionId(geometry, matrixWorld, featureFaceIndices);
  const normalWorld = cylinderRegion
    ? cylinderRegion.axis.clone().transformDirection(matrixWorld)
    : localRegion.normal.clone().applyMatrix3(normalMatrix).normalize();
  const boundaryLoops = cylinderRegion ? [] : localRegion.boundaryLoops.map((loop, boundaryLoopIndex) => {
    const circle = localRegion.circleCandidates.find(
      (candidate) => candidate.boundaryLoopIndex === boundaryLoopIndex,
    );
    const candidateId = loopCandidateIds.get(boundaryLoopIndex);
    return {
      id: `${id}:boundary:${boundaryLoopIndex}`,
      pointsWorld: loop.points.map((point) => point.clone().applyMatrix4(matrixWorld)),
      isHole: loop.isHole,
      ...(circle && candidateId
        ? {
            circle: {
              candidateId,
              centerWorld: circle.center.clone().applyMatrix4(matrixWorld),
              radiusLocal: circle.radius,
              confidence: circle.confidence,
            },
          }
        : {}),
    };
  });
  return {
    id,
    faceIndices: [...featureFaceIndices],
    trianglesWorld: (cylinderRegion?.triangles ?? localRegion.triangles)
      .map((point) => point.clone().applyMatrix4(matrixWorld)),
    boundaryLoops,
    outerBoundaryLoopIndex: cylinderRegion ? null : localRegion.outerBoundaryLoopIndex,
    centerWorld: (cylinderRegion?.center ?? localRegion.center).clone().applyMatrix4(matrixWorld),
    normalWorld,
    featureKind: truncated ? 'surface' : cylinderRegion ? 'cylindrical' : isFallback ? 'surface' : 'planar',
    confidence: truncated ? 0 : cylinderRegion?.confidence ?? (isFallback ? 0 : 1),
    truncated,
    ...(cylinderRegion
      ? {
          cylinderAxis: {
            candidateId: 'cylinderAxis',
            originWorld: cylinderRegion.center.clone().applyMatrix4(matrixWorld),
            directionWorld: cylinderRegion.axis.clone().transformDirection(matrixWorld),
            radiusLocal: cylinderRegion.radius,
            heightLocal: cylinderRegion.height,
            coverageRadians: cylinderRegion.coverageRadians,
            rmsRatio: cylinderRegion.rmsRatio,
          },
        }
      : {}),
    isFallback,
  };
}

function appendPlanarFeatureCandidates(input: {
  region: PlanarFaceRegion;
  cylinderRegion: CylinderFaceRegion | null;
  localHit: THREE.Vector3;
  snapFilter: SnapPointKind[] | null;
  candidates: LocalResolvedCandidate[];
}): Map<number, string> {
  const { region, cylinderRegion, localHit, snapFilter, candidates } = input;
  if (cylinderRegion) {
    return new Map();
  }
  appendLogicalBoundaryCandidates(region, localHit, candidates, snapFilter);
  if (!snapFilter || snapFilter.includes('faceCenter')) {
    candidates.push({
      id: 'faceCenter',
      kind: 'faceCenter',
      pointLocal: region.center.clone(),
      normalLocal: region.normal.clone(),
    });
  }
  return !snapFilter || snapFilter.includes('circleCenter')
    ? appendCircleCandidates(region, candidates)
    : new Map();
}

function appendCylinderAxisCandidate(
  region: CylinderFaceRegion | null,
  snapFilter: SnapPointKind[] | null,
  candidates: LocalResolvedCandidate[],
) {
  if (!region || (snapFilter && !snapFilter.includes('cylinderAxis'))) {
    return;
  }
  candidates.push({
    id: 'cylinderAxis',
    kind: 'cylinderAxis',
    pointLocal: region.center.clone(),
    normalLocal: region.axis.clone(),
    confidence: region.confidence,
    orientationKind: 'axisDirection',
  });
}

function appendGeometryCenterCandidate(input: {
  geometry: THREE.BufferGeometry;
  detectedRegion: PlanarFaceRegion | null;
  cylinderRegion: CylinderFaceRegion | null;
  snapFilter: SnapPointKind[] | null;
  truncated: boolean;
  candidates: LocalResolvedCandidate[];
}) {
  const { geometry, detectedRegion, cylinderRegion, snapFilter, truncated, candidates } = input;
  if (
    truncated
    || (!detectedRegion && !cylinderRegion)
    || (snapFilter && !snapFilter.includes('geometryCenter'))
  ) {
    return;
  }
  const center = getGeometryCenter(geometry);
  if (!center) {
    return;
  }
  candidates.push({
    id: 'geometryCenter',
    kind: 'geometryCenter',
    pointLocal: center.pointLocal,
    normalLocal: cylinderRegion?.axis.clone() ?? detectedRegion?.normal.clone(),
    orientationKind: cylinderRegion ? 'axisDirection' : 'surfaceNormal',
  });
}

function collectLocalFeatureCandidates(input: CollectLocalCandidatesInput): {
  candidates: LocalResolvedCandidate[];
  loopCandidateIds: Map<number, string>;
} {
  const {
    geometry,
    faceIndex,
    localHit,
    snapFilter,
    truncated,
    detectedRegion,
    cylinderRegion,
  } = input;
  const primitiveFilter: SnapPointKind[] = truncated
    ? ['surface']
    : (snapFilter ?? ['surface']).filter((kind) => kind === 'surface');
  const candidates: LocalResolvedCandidate[] = collectSnapCandidatesFromFace(
    geometry,
    faceIndex,
    localHit,
    primitiveFilter,
  ).map((candidate) => ({
    id: candidate.kind,
    kind: candidate.kind,
    pointLocal: candidate.pointLocal,
    normalLocal: candidate.normalLocal,
  }));

  const loopCandidateIds = detectedRegion
    ? appendPlanarFeatureCandidates({
        region: detectedRegion,
        cylinderRegion,
        localHit,
        snapFilter,
        candidates,
      })
    : new Map<number, string>();
  appendCylinderAxisCandidate(cylinderRegion, snapFilter, candidates);
  appendGeometryCenterCandidate({
    geometry,
    detectedRegion,
    cylinderRegion,
    snapFilter,
    truncated,
    candidates,
  });
  return { candidates, loopCandidateIds };
}

function resolveWorldCandidates(
  input: ResolveWorldCandidatesInput,
): ResolvedJointSnapCandidate[] {
  const { candidates, matrixWorld, normalMatrix, hintTangentWorld } = input;
  return candidates.map((candidate) => {
    const pointWorld = candidate.pointLocal.clone().applyMatrix4(matrixWorld);
    const poseWorld = candidate.orientationKind === 'axisDirection' && candidate.normalLocal
      ? makeFrameFromPointAndNormal(
          pointWorld,
          candidate.normalLocal.clone().transformDirection(matrixWorld),
          hintTangentWorld,
        )
      : toWorldPose({
          pointWorld,
          normalLocal: candidate.normalLocal,
          normalMatrix,
          matrixWorld,
          hintTangentWorld,
        });
    return {
      id: candidate.id,
      kind: candidate.kind,
      pointWorld,
      poseWorld,
      ...(candidate.boundaryLoopIndex == null
        ? {}
        : { boundaryLoopIndex: candidate.boundaryLoopIndex }),
      ...(candidate.isHole == null ? {} : { isHole: candidate.isHole }),
      ...(candidate.confidence == null ? {} : { confidence: candidate.confidence }),
    };
  });
}

export function chooseSnapCandidate(
  candidates: ResolvedJointSnapCandidate[],
  hitPoint: THREE.Vector3,
  options: JointSnapResolveOptions = {},
): ResolvedJointSnapCandidate {
  const surface = candidates.find((candidate) => candidate.kind === 'surface');
  if (options.freePointOverride) {
    return surface ?? candidates[0];
  }

  const hasScreenMetric =
    Boolean(options.camera) &&
    Boolean(options.domSize) &&
    (options.domSize?.width ?? 0) > 0 &&
    (options.domSize?.height ?? 0) > 0;
  const eligible = candidates
    .map((candidate) => {
      const profile = snapProfileForCandidate(candidate);
      if (profile.radiusPx <= 0) {
        return null;
      }
      const distance = hasScreenMetric
        ? screenDistancePx({
            a: candidate.pointWorld,
            b: hitPoint,
            camera: options.camera!,
            domSize: options.domSize!,
          })
        : candidate.pointWorld.distanceTo(hitPoint);
      if (hasScreenMetric && distance > profile.radiusPx) {
        return null;
      }
      return { candidate, distance, profile };
    })
    .filter((entry): entry is {
      candidate: ResolvedJointSnapCandidate;
      distance: number;
      profile: { priority: number; radiusPx: number };
    } => entry !== null);

  if (eligible.length === 0) {
    return surface ?? candidates[0];
  }

  eligible.sort((a, b) => {
    const priorityDelta = b.profile.priority - a.profile.priority;
    return priorityDelta || a.distance - b.distance;
  });
  return eligible[0].candidate;
}

/**
 * Resolve a raycast hit on the merged assembly runtime into joint-origin snap
 * candidates (world space). Returns null when the hit cannot be attributed to a
 * component link or carries no usable face.
 */
export function resolveJointSnapFromHit(
  hit: JointSnapHit,
  projection: AssemblySceneProjection,
  snapFilter: SnapPointKind[] | null,
  options: JointSnapResolveOptions = {},
): ResolvedJointSnap | null {
  const mesh = hit.object as THREE.Mesh;
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geometry || hit.faceIndex == null) {
    return null;
  }

  const linkObject = findLinkAncestor(mesh);
  if (!linkObject) {
    return null;
  }

  const resolved = resolveComponentAndLink(projection, linkObject);
  if (!resolved) {
    return null;
  }

  const matrixWorld = mesh.matrixWorld;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  const localHit = mesh.worldToLocal(hit.point.clone());
  // Use a stable in-plane hint so the snap frame's tangent does not jitter.
  const hintTangentWorld = new THREE.Vector3(1, 0, 0).transformDirection(linkObject.matrixWorld);

  const truncated = getGeometryFaceCount(geometry) > DEFAULT_MESH_FEATURE_MAX_FACES;
  const detectedRegion = truncated ? null : detectPlanarFaceRegion(geometry, hit.faceIndex);
  const cylinderRegion = truncated ? null : detectCylinderFaceRegion(geometry, hit.faceIndex);
  const localRegion = detectedRegion ?? fallbackRegionFromFace(geometry, hit.faceIndex, localHit);
  const { candidates: localCandidates, loopCandidateIds } = collectLocalFeatureCandidates({
    geometry,
    faceIndex: hit.faceIndex,
    localHit,
    snapFilter,
    truncated,
    detectedRegion,
    cylinderRegion,
  });
  const candidates = resolveWorldCandidates({
    candidates: localCandidates,
    matrixWorld,
    normalMatrix,
    hintTangentWorld,
  });

  if (!truncated && snapFilter?.includes('bboxCenter')) {
    const center = getObjectWorldCenter(linkObject);
    const faceNormalLocal = localCandidates.find((candidate) => candidate.normalLocal)?.normalLocal;
    candidates.push({
      id: 'bboxCenter',
      kind: 'bboxCenter',
      pointWorld: center,
      poseWorld: toWorldPose({
        pointWorld: center,
        normalLocal: faceNormalLocal,
        normalMatrix,
        matrixWorld,
        hintTangentWorld,
      }),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  const recommended = chooseSnapCandidate(candidates, hit.point, {
    ...options,
    freePointOverride: false,
  });
  const chosen = options.freePointOverride
    ? chooseSnapCandidate(candidates, hit.point, options)
    : recommended;

  return {
    componentId: resolved.componentId,
    linkId: resolved.linkId,
    linkWorldMatrix: getObjectWorldPoseMatrix(linkObject),
    candidates,
    region: resolveRegionToWorld({
      localRegion,
      geometry,
      matrixWorld,
      normalMatrix,
      loopCandidateIds,
      isFallback: !detectedRegion,
      truncated,
      ...(cylinderRegion ? { cylinderRegion } : {}),
    }),
    recommended,
    chosen,
  };
}
