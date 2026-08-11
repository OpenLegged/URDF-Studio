import * as THREE from 'three';

import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  type RobotClosedLoopConstraint,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import {
  axisFromViewerEntry,
  createPlaceholderVisual,
  createUniqueId,
  degreesToRadians,
  geometryTypeFromCollisionPrimitive,
  getDynamicsOriginRotation,
  getPathBasename,
  getPathParent,
  jointTypeFromViewerValue,
  normalizeUsdPath,
  quaternionComponentsToEuler,
  resolveUsdPhysicsFrameFromViewerEntry,
  toVector3,
  type ClosedLoopConstraintEntry,
  type JointCatalogEntry,
  type LinkDynamicsEntry,
  type MeshCountsEntry,
} from './usdAdapterConversions';

const ZERO_INERTIA = { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 } as const;
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

export function buildMeshOnlyHierarchyFallback({
  defaultPrimPath,
  linkPaths,
  linkParentPairs,
  jointCatalogEntries,
  rootLinkPaths,
}: {
  defaultPrimPath: string | null | undefined;
  linkPaths: Set<string>;
  linkParentPairs: Array<[string | null | undefined, string | null | undefined]>;
  jointCatalogEntries: JointCatalogEntry[];
  rootLinkPaths: string[];
}): {
  linkPaths: Set<string>;
  linkParentPairs: Array<[string | null, string | null]>;
  rootLinkPaths: string[];
} {
  const hasAuthoredHierarchy =
    jointCatalogEntries.length > 0 || linkParentPairs.length > 0 || rootLinkPaths.length > 0;
  if (hasAuthoredHierarchy || linkPaths.size === 0) {
    return {
      linkPaths,
      linkParentPairs: linkParentPairs.map(([childPath, parentPath]) => [
        normalizeUsdPath(childPath),
        normalizeUsdPath(parentPath) || null,
      ]),
      rootLinkPaths,
    };
  }

  const fallbackLinkPaths = new Set(linkPaths);
  const normalizedDefaultPrimPath = normalizeUsdPath(defaultPrimPath);
  const sharedRootSegments = Array.from(linkPaths)
    .map((path) => path.split('/').filter(Boolean))
    .reduce<string[]>((commonSegments, nextSegments, index) => {
      if (index === 0) {
        return nextSegments;
      }

      let sharedLength = 0;
      while (
        sharedLength < commonSegments.length &&
        sharedLength < nextSegments.length &&
        commonSegments[sharedLength] === nextSegments[sharedLength]
      ) {
        sharedLength += 1;
      }

      return commonSegments.slice(0, sharedLength);
    }, []);
  const normalizedRootPath =
    normalizedDefaultPrimPath ||
    (sharedRootSegments.length > 0 ? `/${sharedRootSegments.join('/')}` : '');

  if (normalizedRootPath) {
    fallbackLinkPaths.add(normalizedRootPath);
  }

  Array.from(linkPaths).forEach((path) => {
    let parentPath = getPathParent(path);
    while (parentPath && parentPath !== normalizedRootPath) {
      fallbackLinkPaths.add(parentPath);
      parentPath = getPathParent(parentPath);
    }
  });

  const fallbackRootLinkPaths = normalizedRootPath ? [normalizedRootPath] : [];
  const syntheticLinkParentPairs: Array<[string | null, string | null]> = [];
  Array.from(fallbackLinkPaths)
    .sort((left, right) => left.localeCompare(right))
    .forEach((path) => {
      if (!path) {
        return;
      }

      if (normalizedRootPath && path === normalizedRootPath) {
        syntheticLinkParentPairs.push([path, null]);
        return;
      }

      let parentPath = getPathParent(path);
      while (parentPath && !fallbackLinkPaths.has(parentPath)) {
        parentPath = getPathParent(parentPath);
      }

      syntheticLinkParentPairs.push([path, parentPath || normalizedRootPath || null]);
    });

  return {
    linkPaths: fallbackLinkPaths,
    linkParentPairs: syntheticLinkParentPairs,
    rootLinkPaths: fallbackRootLinkPaths,
  };
}

export function createLinkFromViewerMetadata(
  linkPath: string,
  meshCounts: MeshCountsEntry,
  dynamicsEntry?: LinkDynamicsEntry | null,
): UrdfLink {
  const visualCount = Number(meshCounts.visualMeshCount || 0);
  const collisionCount = Number(meshCounts.collisionMeshCount || 0);
  const collisionPrimitiveGeometries = Array.isArray(meshCounts.collisionPrimitiveGeometries)
    ? meshCounts.collisionPrimitiveGeometries
    : [];
  const collisionType =
    collisionCount > 0
      ? geometryTypeFromCollisionPrimitive(meshCounts.collisionPrimitiveCounts)
      : GeometryType.NONE;
  const createCollisionVisual = (index: number) => {
    const primitiveGeometry = collisionPrimitiveGeometries[index];
    const primitiveType = String(primitiveGeometry?.primitiveType || '').trim().toLowerCase();
    const typedCollisionType = primitiveType
      ? geometryTypeFromCollisionPrimitive({ [primitiveType]: 1 })
      : collisionType;
    const visual = createPlaceholderVisual(typedCollisionType, DEFAULT_LINK.collision.color);
    return {
      ...visual,
      dimensions:
        primitiveGeometry?.dimensions && typeof primitiveGeometry.dimensions.length === 'number'
          ? toVector3(primitiveGeometry.dimensions, visual.dimensions)
          : visual.dimensions,
      origin: {
        ...visual.origin,
        xyz:
          primitiveGeometry?.originXyz && typeof primitiveGeometry.originXyz.length === 'number'
            ? toVector3(primitiveGeometry.originXyz, visual.origin.xyz)
            : visual.origin.xyz,
      },
    };
  };

  return {
    ...DEFAULT_LINK,
    id: '',
    name: getPathBasename(linkPath) || 'link',
    visual:
      visualCount > 0
        ? // USD scene snapshots only tell us that a link has authored visual geometry.
          // The link path itself is not a loadable mesh asset, so keep meshPath empty to
          // avoid invalid mesh-analysis lookups such as "/go2_description/base".
          createPlaceholderVisual(GeometryType.MESH, DEFAULT_LINK.visual.color)
        : createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.visual.color),
    collision:
      collisionCount > 0
        ? createCollisionVisual(0)
        : createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.collision.color),
    collisionBodies:
      collisionCount > 1
        ? Array.from({ length: collisionCount - 1 }, (_, index) => createCollisionVisual(index + 1))
        : [],
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: Number.isFinite(Number(dynamicsEntry?.mass))
        ? Number(dynamicsEntry?.mass)
        : 0,
      origin: {
        xyz: toVector3(dynamicsEntry?.centerOfMassLocal, DEFAULT_LINK.inertial.origin?.xyz),
        rpy: getDynamicsOriginRotation(dynamicsEntry),
      },
      inertia:
        Array.isArray(dynamicsEntry?.diagonalInertia) ||
        (dynamicsEntry?.diagonalInertia && typeof dynamicsEntry.diagonalInertia.length === 'number')
          ? {
              ixx: Number(dynamicsEntry?.diagonalInertia?.[0]) || 0,
              ixy: 0,
              ixz: 0,
              iyy: Number(dynamicsEntry?.diagonalInertia?.[1]) || 0,
              iyz: 0,
              izz: Number(dynamicsEntry?.diagonalInertia?.[2]) || 0,
            }
          : { ...ZERO_INERTIA },
    },
  };
}

function toThreeQuaternionWxyz(value: ArrayLike<number> | null | undefined): THREE.Quaternion | null {
  if (!value || typeof value.length !== 'number' || value.length < 4) {
    return null;
  }

  const w = Number(value[0]);
  const x = Number(value[1]);
  const y = Number(value[2]);
  const z = Number(value[3]);
  if (![w, x, y, z].every((entry) => Number.isFinite(entry))) {
    return null;
  }

  const quaternion = new THREE.Quaternion(x, y, z, w);
  if (quaternion.lengthSq() <= 1e-12) {
    return new THREE.Quaternion();
  }
  return quaternion.normalize();
}

function toThreeVector3(value: ArrayLike<number> | null | undefined): THREE.Vector3 | null {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return null;
  }

  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (![x, y, z].every((entry) => Number.isFinite(entry))) {
    return null;
  }

  return new THREE.Vector3(x, y, z);
}

function composeUsdPhysicsFrameMatrix(
  position: ArrayLike<number> | null | undefined,
  rotationWxyz: ArrayLike<number> | null | undefined,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    toThreeVector3(position) ?? new THREE.Vector3(),
    toThreeQuaternionWxyz(rotationWxyz) ?? new THREE.Quaternion(),
    UNIT_SCALE,
  );
}

function resolveJointOriginFromViewerEntry(entry: JointCatalogEntry): NonNullable<UrdfJoint['origin']> {
  const hasLocalParentFrame =
    (entry.localPos0 && typeof entry.localPos0.length === 'number') ||
    (entry.localRot0Wxyz && typeof entry.localRot0Wxyz.length === 'number');
  const hasLocalChildFrame =
    (entry.localPos1 && typeof entry.localPos1.length === 'number') ||
    (entry.localRot1Wxyz && typeof entry.localRot1Wxyz.length === 'number');

  if (hasLocalParentFrame && hasLocalChildFrame) {
    const parentFrame = composeUsdPhysicsFrameMatrix(entry.localPos0, entry.localRot0Wxyz);
    const childFrame = composeUsdPhysicsFrameMatrix(entry.localPos1, entry.localRot1Wxyz);
    const jointTransform = parentFrame.multiply(childFrame.invert());
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    jointTransform.decompose(position, quaternion, scale);

    return {
      xyz: {
        x: position.x,
        y: position.y,
        z: position.z,
      },
      rpy: quaternionComponentsToEuler(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
    };
  }

  const originXyz =
    entry.originXyz && typeof entry.originXyz.length === 'number'
      ? toVector3(entry.originXyz)
      : entry.localPos0 && typeof entry.localPos0.length === 'number'
        ? toVector3(entry.localPos0)
        : toVector3(entry.localPivotInLink);
  const originQuatWxyz =
    entry.originQuatWxyz && typeof entry.originQuatWxyz.length === 'number'
      ? Array.from(entry.originQuatWxyz).slice(0, 4)
      : entry.localRot0Wxyz && typeof entry.localRot0Wxyz.length === 'number'
        ? Array.from(entry.localRot0Wxyz).slice(0, 4)
        : null;

  return {
    xyz: originXyz,
    rpy: originQuatWxyz
      ? quaternionComponentsToEuler(
          originQuatWxyz[1],
          originQuatWxyz[2],
          originQuatWxyz[3],
          originQuatWxyz[0],
        )
      : { r: 0, p: 0, y: 0 },
  };
}

export function createJointFromViewerEntry(
  entry: JointCatalogEntry,
  linkIdByPath: Map<string, string>,
  usedJointIds: Set<string>,
): UrdfJoint | null {
  const childPath = normalizeUsdPath(entry.linkPath || entry.childLinkPath);
  const parentPath = normalizeUsdPath(entry.parentLinkPath);
  if (!childPath || !parentPath) return null;

  const childLinkId = linkIdByPath.get(childPath);
  const parentLinkId = linkIdByPath.get(parentPath);
  if (!childLinkId || !parentLinkId) return null;

  const jointName = String(
    entry.jointName || getPathBasename(entry.jointPath) || `${getPathBasename(childPath)}_joint`,
  ).trim();
  const jointId = createUniqueId(jointName || 'joint', usedJointIds, `${parentPath}_${childPath}`);
  const jointType = jointTypeFromViewerValue(entry.jointTypeName || entry.jointType);
  const lower = degreesToRadians(entry.lowerLimitDeg);
  const upper = degreesToRadians(entry.upperLimitDeg);
  const angle = degreesToRadians(entry.angleDeg);
  const driveDamping =
    typeof entry.driveDamping === 'number' && Number.isFinite(entry.driveDamping)
      ? entry.driveDamping
      : undefined;
  const driveMaxForce =
    typeof entry.driveMaxForce === 'number' && Number.isFinite(entry.driveMaxForce)
      ? entry.driveMaxForce
      : undefined;
  const origin = resolveJointOriginFromViewerEntry(entry);
  const usdPhysics = resolveUsdPhysicsFrameFromViewerEntry(entry);

  return {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointName || jointId,
    type: jointType,
    parentLinkId,
    childLinkId,
    ...(typeof angle === 'number' && Number.isFinite(angle) ? { angle } : {}),
    origin,
    axis: axisFromViewerEntry(entry),
    dynamics: {
      ...DEFAULT_JOINT.dynamics,
      ...(driveDamping !== undefined ? { damping: driveDamping } : {}),
    },
    limit: {
      ...DEFAULT_JOINT.limit,
      ...(lower !== undefined ? { lower } : {}),
      ...(upper !== undefined ? { upper } : {}),
      ...(driveMaxForce !== undefined ? { effort: driveMaxForce } : {}),
    },
    ...(usdPhysics ? { usdPhysics } : {}),
  };
}

export function createClosedLoopConstraintFromUsdEntry(
  entry: ClosedLoopConstraintEntry,
  linkIdByPath: Map<string, string>,
): RobotClosedLoopConstraint | null {
  const resolveClosedLoopLinkId = (linkPath: string): string | null => {
    const exactLinkId = linkIdByPath.get(linkPath) || null;
    const linkName = getPathBasename(linkPath);
    if (!linkName) {
      return exactLinkId;
    }

    for (const [candidatePath, candidateLinkId] of linkIdByPath.entries()) {
      if (candidateLinkId === linkName && getPathBasename(candidatePath) === linkName) {
        return candidateLinkId;
      }
    }

    return exactLinkId;
  };

  const linkAPath = normalizeUsdPath(entry.linkAPath);
  const linkBPath = normalizeUsdPath(entry.linkBPath);
  if (!linkAPath || !linkBPath) {
    return null;
  }

  const linkAId = resolveClosedLoopLinkId(linkAPath);
  const linkBId = resolveClosedLoopLinkId(linkBPath);
  if (!linkAId || !linkBId) {
    return null;
  }

  const constraintType = String(entry.constraintType || '')
    .trim()
    .toLowerCase();
  if (constraintType && constraintType !== 'connect') {
    return null;
  }

  const hasAuthoredAnchorWorld =
    entry.anchorWorld &&
    typeof entry.anchorWorld.length === 'number' &&
    entry.anchorWorld.length >= 3;
  const constraint: RobotClosedLoopConstraint = {
    id:
      String(entry.id || `${linkAId}_${linkBId}_closed_loop`).trim() ||
      `${linkAId}_${linkBId}_closed_loop`,
    type: 'connect',
    linkAId,
    linkBId,
    anchorLocalA: toVector3(entry.anchorLocalA),
    anchorLocalB: toVector3(entry.anchorLocalB),
    anchorWorld: hasAuthoredAnchorWorld ? toVector3(entry.anchorWorld) : { x: 0, y: 0, z: 0 },
  };
  return hasAuthoredAnchorWorld
    ? ({ ...constraint, __usdAuthoredAnchorWorld: true } as RobotClosedLoopConstraint)
    : constraint;
}

export function populateClosedLoopConstraintWorldAnchors(
  constraints: RobotClosedLoopConstraint[],
  links: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
  rootLinkId: string,
): RobotClosedLoopConstraint[] {
  if (constraints.length === 0) {
    return constraints;
  }

  const linkWorldMatrices = computeLinkWorldMatrices({ links, joints, rootLinkId });
  return constraints.map((constraint) => {
    if ((constraint as RobotClosedLoopConstraint & { __usdAuthoredAnchorWorld?: true }).__usdAuthoredAnchorWorld) {
      const { __usdAuthoredAnchorWorld: _authoredAnchorWorld, ...nextConstraint } =
        constraint as RobotClosedLoopConstraint & { __usdAuthoredAnchorWorld?: true };
      return nextConstraint;
    }

    const linkAMatrix = linkWorldMatrices[constraint.linkAId];
    if (!linkAMatrix) {
      return constraint;
    }

    const anchorWorld = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkAMatrix);

    return {
      ...constraint,
      anchorWorld: {
        x: anchorWorld.x,
        y: anchorWorld.y,
        z: anchorWorld.z,
      },
    };
  });
}
