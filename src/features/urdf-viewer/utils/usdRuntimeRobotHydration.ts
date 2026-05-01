import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
} from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import type { UrdfVisual } from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import {
  getUsdDescriptorSectionChildToken,
  resolveUsdDescriptorTargetLinkPath,
} from './usdDescriptorLinkResolution';
import { resolveUsdPrimitiveGeometryFromDescriptor } from './usdPrimitiveGeometry';
import { resolveUsdMeshApproximationGeometry } from './usdViewerRobotAdapter';

interface UsdRuntimeTransformInterface {
  getPreferredLinkWorldTransform?: (linkPath: string) => unknown;
  getJointInfoForLink?: (
    linkPath: string,
  ) => { angleDeg?: number | null } | null | undefined;
  getWorldTransformForPrimPath?: (primPath: string) => unknown;
}

type DescriptorRole = 'visual' | 'collision';

interface DescriptorEntry {
  descriptor: UsdSceneMeshDescriptor;
  ordinal: number;
  groupKey: string;
}

interface DescriptorGroup {
  groupKey: string;
  entries: DescriptorEntry[];
}

const IDENTITY_MATRIX = new THREE.Matrix4();
const ROOT_TRANSFORM_EPSILON = 1e-6;
const ORIGIN_EPSILON = 1e-9;

function toMatrix4(value: unknown): THREE.Matrix4 | null {
  if (!value) {
    return null;
  }

  if (value instanceof THREE.Matrix4) {
    return value.clone();
  }

  if (
    Array.isArray(value) ||
    (typeof value === 'object' && typeof (value as ArrayLike<number>).length === 'number')
  ) {
    const numeric = Array.from(value as ArrayLike<number>).map((entry) => Number(entry));
    if (numeric.length >= 16 && numeric.every((entry) => Number.isFinite(entry))) {
      return new THREE.Matrix4().fromArray(numeric.slice(0, 16));
    }
  }

  return null;
}

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function degreesToRadians(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return (numeric * Math.PI) / 180;
}

function getDescriptorRole(descriptor: UsdSceneMeshDescriptor): DescriptorRole {
  const sectionName = String(descriptor.sectionName || '')
    .trim()
    .toLowerCase();
  if (
    sectionName === 'collisions' ||
    sectionName === 'collision' ||
    sectionName === 'colliders' ||
    sectionName === 'collider'
  ) {
    return 'collision';
  }

  const candidateText =
    `${descriptor.meshId || ''} ${descriptor.resolvedPrimPath || ''}`.toLowerCase();
  return /\/coll(?:isions?|iders?)(?:$|[/.])/.test(candidateText) ? 'collision' : 'visual';
}

function parseDescriptorOrdinal(descriptor: UsdSceneMeshDescriptor, fallbackIndex: number): number {
  const meshId = String(descriptor.meshId || '');
  const match = meshId.match(/(?:\.proto_(?:mesh|[a-z]+)_id)(\d+)$/i);
  if (match) {
    const numeric = Number(match[1]);
    if (Number.isInteger(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return fallbackIndex;
}

function matrixToOrigin(matrix: THREE.Matrix4): NonNullable<UrdfVisual['origin']> {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);

  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(rotation.normalize(), 'ZYX');
  return {
    xyz: {
      x: position.x,
      y: position.y,
      z: position.z,
    },
    rpy: {
      r: euler.x,
      p: euler.y,
      y: euler.z,
    },
  };
}

function resolveLinkWorldMatrix(
  runtime: UsdRuntimeTransformInterface,
  resolution: ViewerRobotDataResolution,
  computedLinkWorldMatrices: Record<string, THREE.Matrix4>,
  linkPath: string | null | undefined,
): THREE.Matrix4 | null {
  const normalizedPath = normalizeUsdPath(linkPath);
  if (!normalizedPath) {
    return null;
  }

  const preferredLinkWorldMatrix = toMatrix4(
    runtime.getPreferredLinkWorldTransform?.(normalizedPath),
  );
  if (preferredLinkWorldMatrix) {
    return preferredLinkWorldMatrix;
  }

  const primLinkWorldMatrix = toMatrix4(runtime.getWorldTransformForPrimPath?.(normalizedPath));
  if (primLinkWorldMatrix) {
    return primLinkWorldMatrix;
  }

  const linkId = resolution.linkIdByPath[normalizedPath];
  const computedLinkWorldMatrix = linkId ? computedLinkWorldMatrices[linkId] : null;
  return computedLinkWorldMatrix?.clone() || null;
}

function resolvePrimWorldMatrix(
  runtime: UsdRuntimeTransformInterface,
  descriptor: UsdSceneMeshDescriptor,
): THREE.Matrix4 | null {
  const candidates = [
    normalizeUsdPath(descriptor.resolvedPrimPath || ''),
    normalizeUsdPath(descriptor.meshId || ''),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = toMatrix4(runtime.getWorldTransformForPrimPath?.(candidate));
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function buildDescriptorMap(
  snapshot: UsdSceneSnapshot | null | undefined,
  resolution: ViewerRobotDataResolution,
): Map<string, DescriptorEntry[]> {
  const descriptorsByLinkRole = new Map<string, DescriptorEntry[]>();
  const descriptors = Array.from(snapshot?.render?.meshDescriptors || []);
  const knownLinkPaths = Object.keys(resolution.linkIdByPath);

  descriptors.forEach((descriptor, index) => {
    const linkPath = resolveUsdDescriptorTargetLinkPath({
      descriptor,
      knownLinkPaths,
    });
    if (!linkPath) return;

    const linkId = resolution.linkIdByPath[linkPath];
    if (!linkId) return;

    const role = getDescriptorRole(descriptor);
    const key = `${linkId}:${role}`;
    const entries = descriptorsByLinkRole.get(key) || [];
    entries.push({
      descriptor,
      ordinal: parseDescriptorOrdinal(descriptor, index),
      groupKey: getUsdDescriptorSectionChildToken(descriptor) || '__default__',
    });
    descriptorsByLinkRole.set(key, entries);
  });

  descriptorsByLinkRole.forEach((entries) => {
    entries.sort((left, right) => {
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal;
      }
      return String(left.descriptor.meshId || '').localeCompare(
        String(right.descriptor.meshId || ''),
      );
    });
  });

  return descriptorsByLinkRole;
}

function groupDescriptorEntries(entries: DescriptorEntry[]): DescriptorGroup[] {
  const groups = new Map<string, DescriptorEntry[]>();

  entries.forEach((entry) => {
    const bucket = groups.get(entry.groupKey) || [];
    bucket.push(entry);
    groups.set(entry.groupKey, bucket);
  });

  return Array.from(groups.entries())
    .map(([groupKey, groupedEntries]) => ({
      groupKey,
      entries: groupedEntries.slice().sort((left, right) => left.ordinal - right.ordinal),
    }))
    .sort((left, right) => {
      const leftOrdinal = left.entries[0]?.ordinal ?? 0;
      const rightOrdinal = right.entries[0]?.ordinal ?? 0;
      return leftOrdinal - rightOrdinal;
    });
}

function collectVisualAttachmentLinkIds(
  resolution: ViewerRobotDataResolution,
  parentLinkId: string,
): string[] {
  const parentLinkPath = normalizeUsdPath(resolution.linkPathById[parentLinkId]);

  return Object.values(resolution.robotData.joints)
    .filter(
      (joint) =>
        joint.parentLinkId === parentLinkId &&
        joint.type === 'fixed' &&
        (() => {
          const childLinkPath = normalizeUsdPath(resolution.childLinkPathByJointId[joint.id]);
          return !childLinkPath || childLinkPath === parentLinkPath;
        })(),
    )
    .map((joint) => joint.childLinkId)
    .filter((childLinkId) => {
      const childLink = resolution.robotData.links[childLinkId];
      return Boolean(
        childLink &&
        childLink.visual.type !== GeometryType.NONE &&
        (childLink.inertial?.mass || 0) <= 1e-9,
      );
    });
}

function sanitizeSyntheticIdToken(value: string | null | undefined): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'visual';
}

function createUniqueSyntheticKey(existing: Record<string, unknown>, preferredKey: string): string {
  const baseKey = sanitizeSyntheticIdToken(preferredKey);
  if (!Object.prototype.hasOwnProperty.call(existing, baseKey)) {
    return baseKey;
  }

  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(existing, `${baseKey}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseKey}_${suffix}`;
}

function createSyntheticVisualAttachmentLink(
  resolution: ViewerRobotDataResolution,
  parentLinkId: string,
  parentLinkPath: string,
  descriptor: UsdSceneMeshDescriptor,
  ordinal: number,
): string {
  const resolvedPrimPath = normalizeUsdPath(descriptor.resolvedPrimPath || descriptor.meshId || '');
  const descriptorToken = sanitizeSyntheticIdToken(
    resolvedPrimPath.split('/').filter(Boolean).pop() || `${parentLinkId}_visual_${ordinal}`,
  );
  const linkId = createUniqueSyntheticKey(
    resolution.robotData.links,
    `${parentLinkId}_${descriptorToken}`,
  );
  const jointId = createUniqueSyntheticKey(resolution.robotData.joints, `fixed_${linkId}`);
  const normalizedParentLinkPath = normalizeUsdPath(parentLinkPath);

  resolution.robotData.links[linkId] = {
    ...DEFAULT_LINK,
    id: linkId,
    name: linkId,
    visible: true,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.MESH,
      origin: identityOrigin(),
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      origin: identityOrigin(),
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
    },
  };

  resolution.robotData.joints[jointId] = {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointId,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId: linkId,
    origin: identityOrigin(),
    axis: { x: 0, y: 0, z: 1 },
  };

  resolution.linkPathById = {
    ...resolution.linkPathById,
    [linkId]: normalizedParentLinkPath,
  };
  resolution.childLinkPathByJointId = {
    ...resolution.childLinkPathByJointId,
    [jointId]: normalizedParentLinkPath,
  };
  resolution.parentLinkPathByJointId = {
    ...resolution.parentLinkPathByJointId,
    [jointId]: normalizedParentLinkPath,
  };

  return linkId;
}

function ensureCollisionBodySlot(
  resolution: ViewerRobotDataResolution,
  linkId: string,
  collisionIndex: number,
): void {
  if (collisionIndex <= 0) {
    return;
  }

  const link = resolution.robotData.links[linkId];
  if (!link) {
    return;
  }

  const collisionBodies = [...(link.collisionBodies || [])];
  while (collisionBodies.length < collisionIndex) {
    collisionBodies.push({
      ...DEFAULT_LINK.collision,
      origin: identityOrigin(),
    });
  }
  link.collisionBodies = collisionBodies;
}

function originsApproximatelyEqual(
  left: NonNullable<UrdfVisual['origin']> | null | undefined,
  right: NonNullable<UrdfVisual['origin']> | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    Math.abs((left.xyz?.x || 0) - (right.xyz?.x || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.y || 0) - (right.xyz?.y || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.xyz?.z || 0) - (right.xyz?.z || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.r || 0) - (right.rpy?.r || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.p || 0) - (right.rpy?.p || 0)) <= ORIGIN_EPSILON &&
    Math.abs((left.rpy?.y || 0) - (right.rpy?.y || 0)) <= ORIGIN_EPSILON
  );
}

function shouldIgnoreSyntheticMeshApproximationOrigin(
  snapshot: UsdSceneSnapshot | null | undefined,
  descriptor: UsdSceneMeshDescriptor,
  geometry: UrdfVisual | null | undefined,
): boolean {
  if (!snapshot || !geometry?.origin || geometry.type === GeometryType.NONE) {
    return false;
  }

  if (resolveUsdPrimitiveGeometryFromDescriptor(descriptor, geometry)) {
    return false;
  }

  const approximation = resolveUsdMeshApproximationGeometry(snapshot, descriptor);
  if (!approximation?.origin) {
    return false;
  }

  return originsApproximatelyEqual(geometry.origin, approximation.origin);
}

function identityOrigin(): NonNullable<UrdfVisual['origin']> {
  return {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  };
}

function applyLocalOriginToVisual(
  visual: UrdfVisual,
  ownerLinkWorldMatrix: THREE.Matrix4,
  primWorldMatrix: THREE.Matrix4,
): UrdfVisual {
  const localMatrix = ownerLinkWorldMatrix
    .clone()
    .invert()
    .multiply(primWorldMatrix)
    .multiply(createOriginMatrix(visual.origin));
  return {
    ...visual,
    origin: matrixToOrigin(localMatrix),
  };
}

function applyLinkLocalFrameDeltaToOrigin(
  origin: NonNullable<UrdfVisual['origin']>,
  previousLinkLocalMatrix: THREE.Matrix4,
  nextLinkLocalMatrix: THREE.Matrix4,
): NonNullable<UrdfVisual['origin']> {
  return matrixToOrigin(
    nextLinkLocalMatrix
      .clone()
      .invert()
      .multiply(previousLinkLocalMatrix)
      .multiply(createOriginMatrix(origin)),
  );
}

function isIdentityTransform(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every(
    (value, index) => Math.abs(value - IDENTITY_MATRIX.elements[index]) <= ROOT_TRANSFORM_EPSILON,
  );
}

function createSyntheticWorldRootIfNeeded(
  resolution: ViewerRobotDataResolution,
  rootWorldMatrix: THREE.Matrix4 | null,
): void {
  if (!rootWorldMatrix || isIdentityTransform(rootWorldMatrix)) {
    return;
  }

  const originalRootLinkId = resolution.robotData.rootLinkId;
  if (!originalRootLinkId || originalRootLinkId === 'world') {
    return;
  }

  if (!resolution.robotData.links[originalRootLinkId]) {
    return;
  }

  if (!resolution.robotData.links.world) {
    resolution.robotData.links.world = {
      ...DEFAULT_LINK,
      id: 'world',
      name: 'world',
      visible: true,
      visual: {
        ...DEFAULT_LINK.visual,
        type: GeometryType.NONE,
      },
      collision: {
        ...DEFAULT_LINK.collision,
        type: GeometryType.NONE,
      },
      inertial: {
        ...DEFAULT_LINK.inertial,
        mass: 0,
      },
    };
  }

  const existingRootAnchor = Object.values(resolution.robotData.joints).find(
    (joint) => joint.parentLinkId === 'world' && joint.childLinkId === originalRootLinkId,
  );

  const rootAnchorJointId = existingRootAnchor?.id || `world_to_${originalRootLinkId}`;
  resolution.robotData.joints[rootAnchorJointId] = {
    ...DEFAULT_JOINT,
    ...(existingRootAnchor || {}),
    id: rootAnchorJointId,
    name: existingRootAnchor?.name || rootAnchorJointId,
    type: JointType.FIXED,
    parentLinkId: 'world',
    childLinkId: originalRootLinkId,
    origin: matrixToOrigin(rootWorldMatrix),
  };

  resolution.robotData.rootLinkId = 'world';
  resolution.linkPathById = {
    ...resolution.linkPathById,
    world: '',
  };
}

export function hydrateUsdViewerRobotResolutionFromRuntime(
  resolution: ViewerRobotDataResolution | null | undefined,
  snapshot: UsdSceneSnapshot | null | undefined,
  runtime: UsdRuntimeTransformInterface | null | undefined,
): ViewerRobotDataResolution | null {
  if (!resolution || !runtime) {
    return resolution ?? null;
  }

  const nextResolution: ViewerRobotDataResolution = {
    ...resolution,
    linkIdByPath: { ...resolution.linkIdByPath },
    linkPathById: { ...resolution.linkPathById },
    jointPathById: { ...resolution.jointPathById },
    childLinkPathByJointId: { ...resolution.childLinkPathByJointId },
    parentLinkPathByJointId: { ...resolution.parentLinkPathByJointId },
    robotData: structuredClone(resolution.robotData),
  };
  const originalJointLocalMatricesByChildLinkId = new Map<string, THREE.Matrix4>();
  const originalInertialOriginsByLinkId = new Map<string, NonNullable<UrdfVisual['origin']>>();
  Object.values(nextResolution.robotData.joints).forEach((joint) => {
    const childLinkPath =
      resolution.childLinkPathByJointId[joint.id] || resolution.linkPathById[joint.childLinkId];
    if (childLinkPath && joint.type !== JointType.FIXED) {
      const runtimeAngle = degreesToRadians(
        runtime.getJointInfoForLink?.(childLinkPath)?.angleDeg,
      );
      if (runtimeAngle !== undefined) {
        joint.angle = runtimeAngle;
      }
    }

    originalJointLocalMatricesByChildLinkId.set(
      joint.childLinkId,
      createOriginMatrix(joint.origin),
    );
  });
  Object.values(nextResolution.robotData.links).forEach((link) => {
    if (link.inertial?.origin) {
      originalInertialOriginsByLinkId.set(link.id, structuredClone(link.inertial.origin));
    }
  });
  let computedLinkWorldMatrices = computeLinkWorldMatrices(nextResolution.robotData);

  Object.values(nextResolution.robotData.joints).forEach((joint) => {
    const childLinkPath =
      resolution.childLinkPathByJointId[joint.id] || resolution.linkPathById[joint.childLinkId];
    const parentLinkPath =
      resolution.parentLinkPathByJointId[joint.id] || resolution.linkPathById[joint.parentLinkId];
    if (!childLinkPath || !parentLinkPath) {
      return;
    }

    const childWorldMatrix = resolveLinkWorldMatrix(
      runtime,
      nextResolution,
      computedLinkWorldMatrices,
      childLinkPath,
    );
    const parentWorldMatrix = resolveLinkWorldMatrix(
      runtime,
      nextResolution,
      computedLinkWorldMatrices,
      parentLinkPath,
    );
    if (!childWorldMatrix || !parentWorldMatrix) {
      return;
    }

    const jointLocalMatrix = parentWorldMatrix.clone().invert().multiply(childWorldMatrix);
    joint.origin = matrixToOrigin(jointLocalMatrix);
  });

  createSyntheticWorldRootIfNeeded(
    nextResolution,
    resolveLinkWorldMatrix(
      runtime,
      nextResolution,
      computedLinkWorldMatrices,
      resolution.linkPathById[nextResolution.robotData.rootLinkId],
    ),
  );

  computedLinkWorldMatrices = computeLinkWorldMatrices(nextResolution.robotData);
  const hydratedJointLocalMatricesByChildLinkId = new Map<string, THREE.Matrix4>();
  Object.values(nextResolution.robotData.joints).forEach((joint) => {
    hydratedJointLocalMatricesByChildLinkId.set(
      joint.childLinkId,
      createOriginMatrix(joint.origin),
    );
  });
  const descriptorsByLinkRole = buildDescriptorMap(snapshot, resolution);

  Object.entries(resolution.linkIdByPath).forEach(([linkPath, linkId]) => {
    const ownerLinkWorldMatrix = resolveLinkWorldMatrix(
      runtime,
      nextResolution,
      computedLinkWorldMatrices,
      linkPath,
    );
    if (!ownerLinkWorldMatrix) {
      return;
    }

    const link = nextResolution.robotData.links[linkId];
    if (!link) {
      return;
    }

    const originalInertialOrigin = originalInertialOriginsByLinkId.get(linkId);
    const originalLinkLocalMatrix = originalJointLocalMatricesByChildLinkId.get(linkId);
    const hydratedLinkLocalMatrix = hydratedJointLocalMatricesByChildLinkId.get(linkId);
    if (originalInertialOrigin && originalLinkLocalMatrix && hydratedLinkLocalMatrix) {
      link.inertial = {
        ...link.inertial,
        origin: applyLinkLocalFrameDeltaToOrigin(
          originalInertialOrigin,
          originalLinkLocalMatrix,
          hydratedLinkLocalMatrix,
        ),
      };
    }

    const visualAttachmentLinkIds = collectVisualAttachmentLinkIds(nextResolution, linkId);
    const visualDescriptorGroups = groupDescriptorEntries(
      descriptorsByLinkRole.get(`${linkId}:visual`) || [],
    );
    visualDescriptorGroups.forEach((group, index) => {
      const representativeEntry = group.entries[0];
      if (!representativeEntry) {
        return;
      }

      let targetLinkId = index === 0 ? linkId : visualAttachmentLinkIds[index - 1];
      if (!targetLinkId && index > 0) {
        targetLinkId = createSyntheticVisualAttachmentLink(
          nextResolution,
          linkId,
          linkPath,
          representativeEntry.descriptor,
          representativeEntry.ordinal,
        );
        visualAttachmentLinkIds.push(targetLinkId);
      }
      if (!targetLinkId) {
        return;
      }

      const primWorldMatrix = resolvePrimWorldMatrix(runtime, representativeEntry.descriptor);
      if (!primWorldMatrix) {
        return;
      }

      const targetLink = nextResolution.robotData.links[targetLinkId];
      if (!targetLink) {
        return;
      }

      const visualForHydration = shouldIgnoreSyntheticMeshApproximationOrigin(
        snapshot,
        representativeEntry.descriptor,
        targetLink.visual,
      )
        ? {
            ...targetLink.visual,
            origin: identityOrigin(),
          }
        : targetLink.visual;

      targetLink.visual = applyLocalOriginToVisual(
        visualForHydration,
        ownerLinkWorldMatrix,
        primWorldMatrix,
      );
    });

    const collisionDescriptorGroups = groupDescriptorEntries(
      descriptorsByLinkRole.get(`${linkId}:collision`) || [],
    );
    collisionDescriptorGroups.forEach((group, index) => {
      const representativeEntry = group.entries[0];
      if (!representativeEntry) {
        return;
      }

      if (index > 0) {
        ensureCollisionBodySlot(nextResolution, linkId, index);
      }

      const primWorldMatrix = resolvePrimWorldMatrix(runtime, representativeEntry.descriptor);
      if (!primWorldMatrix) {
        return;
      }

      const currentCollision = index === 0 ? link.collision : link.collisionBodies?.[index - 1];
      const collisionForHydration = shouldIgnoreSyntheticMeshApproximationOrigin(
        snapshot,
        representativeEntry.descriptor,
        currentCollision,
      )
        ? {
            ...currentCollision,
            origin: identityOrigin(),
          }
        : currentCollision;

      if (index === 0) {
        link.collision = {
          ...link.collision,
          origin: matrixToOrigin(
            ownerLinkWorldMatrix
              .clone()
              .invert()
              .multiply(primWorldMatrix)
              .multiply(createOriginMatrix(collisionForHydration.origin)),
          ),
        };
        return;
      }

      const collisionBodies = [...(link.collisionBodies || [])];
      if (!collisionBodies[index - 1] || !collisionForHydration) {
        return;
      }

      collisionBodies[index - 1] = {
        ...collisionBodies[index - 1],
        origin: matrixToOrigin(
          ownerLinkWorldMatrix
            .clone()
            .invert()
            .multiply(primWorldMatrix)
            .multiply(createOriginMatrix(collisionForHydration.origin)),
        ),
      };
      link.collisionBodies = collisionBodies;
    });
  });

  return nextResolution;
}
