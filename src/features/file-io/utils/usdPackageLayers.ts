import * as THREE from 'three';

import type {
  RobotClosedLoopConstraint,
  RobotState,
  UrdfJoint,
  UrdfLink,
} from '../../../types/index.ts';
import { computeUsdInertiaProperties } from '../../../shared/utils/inertiaUsd.ts';
import {
  USD_GEOMETRY_TYPES as GEOMETRY_TYPES,
  getUsdGeometryType as getGeometryType,
} from './usdSceneNodeFactory.ts';
import {
  escapeUsdString,
  formatUsdFloat,
  formatUsdTuple,
  makeUsdIndent,
  quaternionToUsdTuple,
  sanitizeUsdIdentifier,
  serializeUsdPrimSpecWithMetadata,
} from './usdTextFormatting.ts';

export type UsdLinkPathMaps = {
  linkPaths: Map<string, string>;
  childIdsByParent: Map<string, string[]>;
};

export type UsdPackageLayerContents = {
  rootLayerContent: string;
  baseLayerContent: string;
  physicsLayerContent: string;
  sensorLayerContent: string;
  robotLayerContent?: string;
};

export type UsdArchivePackage = {
  archiveFileName: string;
  rootLayerPath: string;
  archiveFiles: Map<string, Blob>;
};

export type UsdPackageLayoutProfile = 'legacy' | 'isaacsim' | 'genesis';
export type ResolvedUsdPackageLayoutProfile = 'legacy' | 'isaacsim';
export type UsdLayerFileFormat = 'usd' | 'usda';

export interface UsdPackageLayoutOptions {
  layoutProfile?: UsdPackageLayoutProfile;
  fileFormat?: UsdLayerFileFormat;
}

type OmittedIsaacRootAnchor = {
  articulationRootLinkId: string;
  omittedJointIds: Set<string>;
  omittedLinkIds: Set<string>;
};

export const resolveUsdPackageLayoutProfile = (
  layoutProfile?: UsdPackageLayoutProfile,
): ResolvedUsdPackageLayoutProfile => {
  if (layoutProfile == null) {
    return 'legacy';
  }
  return layoutProfile === 'genesis' ? 'isaacsim' : layoutProfile;
};

const createIdentityBlob = (content: string): Blob => {
  return new Blob([content], { type: 'text/plain;charset=utf-8' });
};

const getUsdLayerExtension = (fileFormat: UsdLayerFileFormat = 'usd'): 'usd' | 'usda' => {
  return fileFormat === 'usda' ? 'usda' : 'usd';
};

const resolveUsdConfigStem = (
  packageRoot: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  if (layoutProfile === 'isaacsim') {
    // Isaac Sim exports keep sidecar stems aligned with the root prim name.
    return packageRoot;
  }
  return `${packageRoot}${packageRoot.includes('description') ? '' : '_description'}`;
};

const rpyToQuaternion = (r: number, p: number, y: number): THREE.Quaternion => {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
};

const ZERO_EPSILON = 1e-9;
const ISAACSIM_DEFAULT_JOINT_STIFFNESS = 625;
const ISAACSIM_DEFAULT_JOINT_DAMPING = 0.25;
const ISAACSIM_DEFAULT_ENABLED_SELF_COLLISIONS = true;
const ISAACSIM_DEFAULT_SOLVER_POSITION_ITERATION_COUNT = 32;
const ISAACSIM_DEFAULT_SOLVER_VELOCITY_ITERATION_COUNT = 1;
const ISAACSIM_DEFAULT_PHYSX_SCENE_BROADPHASE_TYPE = 'MBP';
const ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_CCD = true;
const ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_GPU_DYNAMICS = false;
const ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_STABILIZATION = true;
const ISAACSIM_DEFAULT_PHYSX_SCENE_SOLVER_TYPE = 'TGS';

const hasExportableGeometry = (geometry: UrdfLink['visual'] | UrdfLink['collision'] | undefined): boolean => {
  return geometry !== undefined && getGeometryType(geometry.type) !== GEOMETRY_TYPES.NONE;
};

const linkHasExportablePayload = (link: UrdfLink | undefined): boolean => {
  if (!link) {
    return false;
  }

  return (
    hasExportableGeometry(link.visual) ||
    hasExportableGeometry(link.collision) ||
    (link.visualBodies || []).some((body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE) ||
    (link.collisionBodies || []).some((body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE) ||
    (link.mjcfSites?.length ?? 0) > 0
  );
};

const isNearZero = (value: number | null | undefined): boolean => {
  return Math.abs(Number(value || 0)) <= ZERO_EPSILON;
};

const isMasslessLink = (link: UrdfLink | undefined): boolean => {
  if (!link?.inertial) {
    return true;
  }

  return (
    isNearZero(link.inertial.mass) &&
    isNearZero(link.inertial.inertia?.ixx) &&
    isNearZero(link.inertial.inertia?.ixy) &&
    isNearZero(link.inertial.inertia?.ixz) &&
    isNearZero(link.inertial.inertia?.iyy) &&
    isNearZero(link.inertial.inertia?.iyz) &&
    isNearZero(link.inertial.inertia?.izz)
  );
};

const resolveOmittedIsaacRootAnchor = (
  robot: RobotState,
  layoutProfile: ResolvedUsdPackageLayoutProfile,
): OmittedIsaacRootAnchor | null => {
  if (layoutProfile !== 'isaacsim' || robot.inspectionContext?.sourceFormat !== 'mjcf') {
    return null;
  }

  const rootLink = robot.links[robot.rootLinkId];
  if (!rootLink || linkHasExportablePayload(rootLink) || !isMasslessLink(rootLink)) {
    return null;
  }

  if (Object.values(robot.joints).some((joint) => joint.childLinkId === robot.rootLinkId)) {
    return null;
  }

  const childJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === robot.rootLinkId,
  );
  if (childJoints.length !== 1) {
    return null;
  }

  const childJoint = childJoints[0];
  const childJointType = String(childJoint?.type || '').toLowerCase();
  if ((childJointType !== 'fixed' && childJointType !== 'floating') || !robot.links[childJoint.childLinkId]) {
    return null;
  }

  return {
    articulationRootLinkId: childJoint.childLinkId,
    omittedJointIds: new Set([childJoint.id]),
    omittedLinkIds: new Set([robot.rootLinkId]),
  };
};

const getAxisToken = (axis: THREE.Vector3 | UrdfJoint['axis'] | undefined): 'X' | 'Y' | 'Z' => {
  const vector = axis
    ? new THREE.Vector3(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0)
    : new THREE.Vector3(1, 0, 0);

  if (vector.lengthSq() <= 1e-12) {
    return 'X';
  }

  const abs = {
    x: Math.abs(vector.x),
    y: Math.abs(vector.y),
    z: Math.abs(vector.z),
  };

  if (abs.y >= abs.x && abs.y >= abs.z) return 'Y';
  if (abs.z >= abs.x && abs.z >= abs.y) return 'Z';
  return 'X';
};

const jointTypeToUsdType = (
  joint: UrdfJoint,
):
  | 'PhysicsJoint'
  | 'PhysicsFixedJoint'
  | 'PhysicsRevoluteJoint'
  | 'PhysicsPrismaticJoint'
  | 'PhysicsSphericalJoint'
  | 'PhysicsDistanceJoint' => {
  const authoredUsdTypeName = String(joint.usdPhysics?.jointTypeName || '').trim();
  if (/^PhysicsJoint$/i.test(authoredUsdTypeName) || /(?:^|Physics)D6Joint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsJoint';
  }
  if (/^PhysicsFixedJoint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsFixedJoint';
  }
  if (/^PhysicsRevoluteJoint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsRevoluteJoint';
  }
  if (/^PhysicsPrismaticJoint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsPrismaticJoint';
  }
  if (/^PhysicsSphericalJoint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsSphericalJoint';
  }
  if (/^PhysicsDistanceJoint$/i.test(authoredUsdTypeName)) {
    return 'PhysicsDistanceJoint';
  }

  const type = String(joint.type || '').toLowerCase();
  if (type === 'revolute' || type === 'continuous') {
    return 'PhysicsRevoluteJoint';
  }
  if (type === 'prismatic') {
    return 'PhysicsPrismaticJoint';
  }
  if (type === 'ball' || type === 'spherical') {
    return 'PhysicsSphericalJoint';
  }
  if (type === 'floating') {
    return 'PhysicsJoint';
  }
  return 'PhysicsFixedJoint';
};

const radiansToDegrees = (value: number): number => {
  return (value * 180) / Math.PI;
};

const angularDriveGainToUsdUnits = (value: number): number => {
  return (Math.PI / 180) * value;
};

const angularVelocityToUsdUnits = (value: number): number => {
  return radiansToDegrees(value);
};

const resolveIsaacSimDriveGain = (
  sourceGain: number | null,
  defaultGain: number | null,
  shouldConvertAngularDriveGains: boolean,
): number | null => {
  const authoredSourceGain =
    sourceGain !== null && shouldConvertAngularDriveGains
      ? angularDriveGainToUsdUnits(sourceGain)
      : sourceGain;
  if (defaultGain === null) {
    return authoredSourceGain;
  }
  if (authoredSourceGain === null) {
    return defaultGain;
  }
  return Math.max(authoredSourceGain, defaultGain);
};

const getUsdDriveInstanceName = (typeName: string): 'angular' | 'linear' | null => {
  if (typeName === 'PhysicsRevoluteJoint') {
    return 'angular';
  }
  if (typeName === 'PhysicsPrismaticJoint') {
    return 'linear';
  }
  return null;
};

function normalizeUsdPhysicsQuaternionWxyz(
  value: ArrayLike<number> | null | undefined,
): THREE.Quaternion | null {
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
  if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
    return null;
  }

  return quaternion.normalize();
}

function resolveUsdPhysicsLocalPos1(joint: UrdfJoint): [number, number, number] {
  const source = joint.usdPhysics?.localPos1;
  if (!source) {
    return [0, 0, 0];
  }

  const x = Number(source.x);
  const y = Number(source.y);
  const z = Number(source.z);
  if (![x, y, z].every((entry) => Number.isFinite(entry))) {
    return [0, 0, 0];
  }

  return [x, y, z];
}

const USD_PHYSICS_AXIS_INSTANCE_ORDER = ['transX', 'transY', 'transZ', 'rotX', 'rotY', 'rotZ'];

function sortUsdPhysicsAxisInstances(left: string, right: string): number {
  const leftIndex = USD_PHYSICS_AXIS_INSTANCE_ORDER.indexOf(left);
  const rightIndex = USD_PHYSICS_AXIS_INSTANCE_ORDER.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    return (leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER) -
      (rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER);
  }
  return left.localeCompare(right);
}

function getUsdPhysicsAxisKeys(value: Record<string, unknown> | null | undefined): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value)
    .filter((key) => /^[A-Za-z0-9_]+$/.test(key))
    .sort(sortUsdPhysicsAxisInstances);
}

function formatOptionalUsdNumber(value: number | null | undefined): string | null {
  return Number.isFinite(Number(value)) ? formatUsdFloat(Number(value)) : null;
}

const serializeJointDefinition = (
  joint: UrdfJoint,
  linkPaths: Map<string, string>,
  lines: string[],
  depth: number,
  options: {
    layoutProfile?: ResolvedUsdPackageLayoutProfile;
  } = {},
): void => {
  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const typeName = jointTypeToUsdType(joint);
  const parentPath = linkPaths.get(joint.parentLinkId);
  const childPath = linkPaths.get(joint.childLinkId);

  if (!parentPath || !childPath) {
    return;
  }

  const supportsAxis = typeName === 'PhysicsRevoluteJoint' || typeName === 'PhysicsPrismaticJoint';
  const axisToken = getAxisToken(joint.axis);
  const driveInstanceName = getUsdDriveInstanceName(typeName);
  const usdLimitAxisKeys =
    typeName === 'PhysicsJoint' ? getUsdPhysicsAxisKeys(joint.usdPhysics?.limitAxes) : [];
  const usdDriveAxisKeys =
    typeName === 'PhysicsJoint' ? getUsdPhysicsAxisKeys(joint.usdPhysics?.driveAxes) : [];
  const shouldUseIsaacDefaults = options.layoutProfile === 'isaacsim' && driveInstanceName !== null;
  const sourceDriveStiffness =
    Number.isFinite(joint.dynamics?.stiffness) && Math.abs(Number(joint.dynamics?.stiffness)) > 1e-9
      ? Number(joint.dynamics?.stiffness)
      : null;
  const sourceDriveDamping =
    Number.isFinite(joint.dynamics?.damping) && Math.abs(joint.dynamics.damping) > 1e-9
      ? joint.dynamics.damping
      : null;
  const shouldConvertAngularDriveGains =
    options.layoutProfile === 'isaacsim' && driveInstanceName === 'angular';
  const defaultDriveStiffness = shouldUseIsaacDefaults ? ISAACSIM_DEFAULT_JOINT_STIFFNESS : null;
  const defaultDriveDamping = shouldUseIsaacDefaults ? ISAACSIM_DEFAULT_JOINT_DAMPING : null;
  const driveStiffness = resolveIsaacSimDriveGain(
    sourceDriveStiffness,
    defaultDriveStiffness,
    shouldConvertAngularDriveGains,
  );
  const driveDamping = resolveIsaacSimDriveGain(
    sourceDriveDamping,
    defaultDriveDamping,
    shouldConvertAngularDriveGains,
  );
  const jointLimit = joint.limit;
  const finiteJointLower = formatOptionalUsdNumber(jointLimit?.lower);
  const finiteJointUpper = formatOptionalUsdNumber(jointLimit?.upper);
  const hasFiniteJointBounds = finiteJointLower !== null && finiteJointUpper !== null;
  const jointEffort = jointLimit?.effort;
  const jointVelocity = jointLimit?.velocity;
  const driveMaxForce =
    typeof jointEffort === 'number' && Number.isFinite(jointEffort) && Math.abs(jointEffort) > 1e-9
      ? jointEffort
      : null;
  const maxJointVelocity =
    options.layoutProfile === 'isaacsim' &&
    driveInstanceName !== null &&
    typeof jointVelocity === 'number' &&
    Number.isFinite(jointVelocity) &&
    Math.abs(jointVelocity) > 1e-9
      ? driveInstanceName === 'angular'
        ? angularVelocityToUsdUnits(jointVelocity)
        : jointVelocity
      : null;
  const shouldEmitDrive =
    driveInstanceName !== null &&
    (driveStiffness !== null || driveDamping !== null || driveMaxForce !== null);
  const jointApiSchemas: string[] = [];
  if (options.layoutProfile === 'isaacsim' && driveInstanceName !== null) {
    jointApiSchemas.push(`"PhysicsJointStateAPI:${driveInstanceName}"`, '"PhysxJointAPI"');
  }
  usdLimitAxisKeys.forEach((axis) => {
    jointApiSchemas.push(`"PhysicsLimitAPI:${axis}"`);
  });
  usdDriveAxisKeys.forEach((axis) => {
    jointApiSchemas.push(`"PhysicsDriveAPI:${axis}"`);
  });
  if (shouldEmitDrive) {
    jointApiSchemas.push(`"PhysicsDriveAPI:${driveInstanceName}"`);
  }
  if (options.layoutProfile === 'isaacsim' && driveInstanceName !== null) {
    jointApiSchemas.push('"IsaacJointAPI"');
  }

  serializeUsdPrimSpecWithMetadata(
    lines,
    depth,
    `def ${typeName} "${sanitizeUsdIdentifier(joint.id || joint.name || 'joint')}"`,
    jointApiSchemas.length > 0 ? [`prepend apiSchemas = [${jointApiSchemas.join(', ')}]`] : [],
  );
  lines.push(`${indent}{`);
  lines.push(`${childIndent}rel physics:body0 = <${parentPath}>`);
  lines.push(`${childIndent}rel physics:body1 = <${childPath}>`);

  if (supportsAxis) {
    lines.push(`${childIndent}uniform token physics:axis = "${axisToken}"`);
  }
  lines.push(
    `${childIndent}custom string urdf:jointType = "${escapeUsdString(String(joint.type || 'fixed').toLowerCase())}"`,
  );
  lines.push(
    `${childIndent}custom float3 urdf:axisLocal = ${formatUsdTuple([
      joint.axis?.x ?? 1,
      joint.axis?.y ?? 0,
      joint.axis?.z ?? 0,
    ])}`,
  );

  if (
    typeName === 'PhysicsRevoluteJoint' &&
    String(joint.type || '').toLowerCase() !== 'continuous' &&
    hasFiniteJointBounds
  ) {
    lines.push(
      `${childIndent}float physics:lowerLimit = ${formatUsdFloat(radiansToDegrees(Number(jointLimit?.lower)))}`,
    );
    lines.push(
      `${childIndent}float physics:upperLimit = ${formatUsdFloat(radiansToDegrees(Number(jointLimit?.upper)))}`,
    );
  } else if (typeName === 'PhysicsPrismaticJoint' && hasFiniteJointBounds) {
    lines.push(`${childIndent}float physics:lowerLimit = ${finiteJointLower}`);
    lines.push(`${childIndent}float physics:upperLimit = ${finiteJointUpper}`);
  }
  usdLimitAxisKeys.forEach((axis) => {
    const limit = joint.usdPhysics?.limitAxes?.[axis];
    const low = formatOptionalUsdNumber(limit?.low);
    const high = formatOptionalUsdNumber(limit?.high);
    if (low !== null) {
      lines.push(`${childIndent}float limit:${axis}:physics:low = ${low}`);
    }
    if (high !== null) {
      lines.push(`${childIndent}float limit:${axis}:physics:high = ${high}`);
    }
  });

  if (shouldEmitDrive) {
    lines.push(`${childIndent}uniform token drive:${driveInstanceName}:physics:type = "force"`);
    if (driveStiffness !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:stiffness = ${formatUsdFloat(driveStiffness)}`,
      );
    }
    if (driveDamping !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:damping = ${formatUsdFloat(driveDamping)}`,
      );
    }
    if (driveMaxForce !== null) {
      lines.push(
        `${childIndent}float drive:${driveInstanceName}:physics:maxForce = ${formatUsdFloat(driveMaxForce)}`,
      );
    }
    if (options.layoutProfile === 'isaacsim') {
      lines.push(`${childIndent}float drive:${driveInstanceName}:physics:targetPosition = 0`);
    }
  }
  usdDriveAxisKeys.forEach((axis) => {
    const drive = joint.usdPhysics?.driveAxes?.[axis];
    const driveType = String(drive?.type || '').trim();
    if (driveType) {
      lines.push(
        `${childIndent}uniform token drive:${axis}:physics:type = "${escapeUsdString(driveType)}"`,
      );
    }
    (['stiffness', 'damping', 'maxForce', 'targetPosition', 'targetVelocity'] as const).forEach(
      (propertyName) => {
        const formatted = formatOptionalUsdNumber(drive?.[propertyName]);
        if (formatted !== null) {
          lines.push(`${childIndent}float drive:${axis}:physics:${propertyName} = ${formatted}`);
        }
      },
    );
  });

  if (maxJointVelocity !== null) {
    lines.push(
      `${childIndent}float physxJoint:maxJointVelocity = ${formatUsdFloat(maxJointVelocity)}`,
    );
  }

  lines.push(
    `${childIndent}point3f physics:localPos0 = ${formatUsdTuple([
      joint.origin?.xyz?.x ?? 0,
      joint.origin?.xyz?.y ?? 0,
      joint.origin?.xyz?.z ?? 0,
    ])}`,
  );
  const originQuaternion = rpyToQuaternion(
    joint.origin?.rpy?.r ?? 0,
    joint.origin?.rpy?.p ?? 0,
    joint.origin?.rpy?.y ?? 0,
  );
  const localRot1Quaternion =
    normalizeUsdPhysicsQuaternionWxyz(joint.usdPhysics?.localRot1Wxyz) ??
    new THREE.Quaternion();
  const localRot0Quaternion = originQuaternion.clone().multiply(localRot1Quaternion);
  const localPos1 = resolveUsdPhysicsLocalPos1(joint);
  lines.push(
    `${childIndent}custom point3f urdf:originXyz = ${formatUsdTuple([
      joint.origin?.xyz?.x ?? 0,
      joint.origin?.xyz?.y ?? 0,
      joint.origin?.xyz?.z ?? 0,
    ])}`,
  );
  lines.push(
    `${childIndent}custom quatf urdf:originQuatWxyz = ${quaternionToUsdTuple(originQuaternion)}`,
  );
  lines.push(
    `${childIndent}quatf physics:localRot0 = ${quaternionToUsdTuple(localRot0Quaternion)}`,
  );
  lines.push(`${childIndent}point3f physics:localPos1 = ${formatUsdTuple(localPos1)}`);
  lines.push(
    `${childIndent}quatf physics:localRot1 = ${quaternionToUsdTuple(localRot1Quaternion)}`,
  );
  lines.push(`${indent}}`);
};

const serializeClosedLoopConstraintDefinition = (
  constraint: RobotClosedLoopConstraint,
  linkPaths: Map<string, string>,
  lines: string[],
  depth: number,
): void => {
  if (constraint.type !== 'connect') {
    return;
  }

  const linkAPath = linkPaths.get(constraint.linkAId);
  const linkBPath = linkPaths.get(constraint.linkBId);
  if (!linkAPath || !linkBPath) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const constraintId = String(
    constraint.id || `${constraint.linkAId}_${constraint.linkBId}_closed_loop`,
  );

  serializeUsdPrimSpecWithMetadata(
    lines,
    depth,
    `def PhysicsSphericalJoint "${sanitizeUsdIdentifier(constraintId)}"`,
  );
  lines.push(`${indent}{`);
  lines.push(`${childIndent}rel physics:body0 = <${linkAPath}>`);
  lines.push(`${childIndent}rel physics:body1 = <${linkBPath}>`);
  lines.push(`${childIndent}custom string urdf:jointType = "ball"`);
  lines.push(`${childIndent}custom string urdf:closedLoopId = "${escapeUsdString(constraintId)}"`);
  lines.push(
    `${childIndent}custom string urdf:closedLoopType = "${escapeUsdString(constraint.type)}"`,
  );
  lines.push(
    `${childIndent}custom point3f urdf:anchorWorld = ${formatUsdTuple([
      constraint.anchorWorld.x,
      constraint.anchorWorld.y,
      constraint.anchorWorld.z,
    ])}`,
  );
  lines.push(
    `${childIndent}point3f physics:localPos0 = ${formatUsdTuple([
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ])}`,
  );
  lines.push(
    `${childIndent}point3f physics:localPos1 = ${formatUsdTuple([
      constraint.anchorLocalB.x,
      constraint.anchorLocalB.y,
      constraint.anchorLocalB.z,
    ])}`,
  );
  lines.push(`${childIndent}quatf physics:localRot0 = (1, 0, 0, 0)`);
  lines.push(`${childIndent}quatf physics:localRot1 = (1, 0, 0, 0)`);
  lines.push(`${indent}}`);
};

const serializeCollisionOverrides = (link: UrdfLink, lines: string[], depth: number): void => {
  const collisionVisuals = [
    ...(getGeometryType(link.collision?.type) !== GEOMETRY_TYPES.NONE ? [link.collision] : []),
    ...(link.collisionBodies || []).filter(
      (body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE,
    ),
  ];

  if (collisionVisuals.length === 0) {
    return;
  }

  const indent = makeUsdIndent(depth);
  lines.push(`${indent}over "collisions"`);
  lines.push(`${indent}{`);

  collisionVisuals.forEach((visual, index) => {
    const childIndent = makeUsdIndent(depth + 1);
    const apiSchemas =
      getGeometryType(visual.type) === GEOMETRY_TYPES.MESH
        ? '"PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"'
        : '"PhysicsCollisionAPI"';

    serializeUsdPrimSpecWithMetadata(lines, depth + 1, `over "collision_${index}"`, [
      `prepend apiSchemas = [${apiSchemas}]`,
    ]);
    lines.push(`${childIndent}{`);
    lines.push(`${makeUsdIndent(depth + 2)}bool physics:collisionEnabled = true`);
    if (getGeometryType(visual.type) === GEOMETRY_TYPES.MESH) {
      lines.push(`${makeUsdIndent(depth + 2)}uniform token physics:approximation = "convexHull"`);
    }
    lines.push(`${childIndent}}`);
  });

  lines.push(`${indent}}`);
};

const serializeLinkPhysicsOverride = (
  robot: RobotState,
  linkId: string,
  lines: string[],
  depth: number,
  options: {
    addArticulationRootApi?: boolean;
    layoutProfile?: ResolvedUsdPackageLayoutProfile;
  } = {},
): void => {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);
  const apiSchemas = [
    '"PhysicsRigidBodyAPI"',
    ...(link.inertial ? ['"PhysicsMassAPI"'] : []),
    ...(options.addArticulationRootApi ? ['"PhysicsArticulationRootAPI"'] : []),
    ...(options.addArticulationRootApi && options.layoutProfile === 'isaacsim'
      ? ['"PhysxArticulationAPI"']
      : []),
  ].join(', ');

  serializeUsdPrimSpecWithMetadata(lines, depth, `over "${sanitizeUsdIdentifier(linkId)}"`, [
    `prepend apiSchemas = [${apiSchemas}]`,
  ]);
  lines.push(`${indent}{`);

  if (link.inertial) {
    const usdInertia = computeUsdInertiaProperties(link.inertial);
    lines.push(`${childIndent}float physics:mass = ${formatUsdFloat(link.inertial.mass)}`);
    const inertialOrigin = link.inertial.origin?.xyz;
    if (inertialOrigin) {
      lines.push(
        `${childIndent}float3 physics:centerOfMass = ${formatUsdTuple([
          inertialOrigin.x ?? 0,
          inertialOrigin.y ?? 0,
          inertialOrigin.z ?? 0,
        ])}`,
      );
    }
    lines.push(
      `${childIndent}float3 physics:diagonalInertia = ${formatUsdTuple([
        usdInertia?.diagonalInertia[0] ?? 0,
        usdInertia?.diagonalInertia[1] ?? 0,
        usdInertia?.diagonalInertia[2] ?? 0,
      ])}`,
    );
    lines.push(
      `${childIndent}quatf physics:principalAxes = ${quaternionToUsdTuple(usdInertia?.principalAxesLocal)}`,
    );
  }

  if (options.addArticulationRootApi && options.layoutProfile === 'isaacsim') {
    lines.push(
      `${childIndent}bool physxArticulation:enabledSelfCollisions = ${ISAACSIM_DEFAULT_ENABLED_SELF_COLLISIONS ? 'true' : 'false'}`,
    );
    lines.push(
      `${childIndent}int physxArticulation:solverPositionIterationCount = ${ISAACSIM_DEFAULT_SOLVER_POSITION_ITERATION_COUNT}`,
    );
    lines.push(
      `${childIndent}int physxArticulation:solverVelocityIterationCount = ${ISAACSIM_DEFAULT_SOLVER_VELOCITY_ITERATION_COUNT}`,
    );
  }

  serializeCollisionOverrides(link, lines, depth + 1);

  lines.push(`${indent}}`);
};

const serializeNestedLinkPhysicsOverrides = (
  robot: RobotState,
  linkId: string,
  childIdsByParent: Map<string, string[]>,
  lines: string[],
  depth: number,
): void => {
  serializeLinkPhysicsOverride(robot, linkId, lines, depth);

  (childIdsByParent.get(linkId) || []).forEach((childLinkId) => {
    serializeNestedLinkPhysicsOverrides(robot, childLinkId, childIdsByParent, lines, depth + 1);
  });
};

export const buildUsdLinkPathMaps = (
  robot: RobotState,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): UsdLinkPathMaps => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const useFlatLinkPaths = layoutProfile === 'isaacsim';
  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });

  const linkPaths = new Map<string, string>();
  const visit = (linkId: string, parentPath: string) => {
    const path = useFlatLinkPaths
      ? `/${rootPrimName}/${sanitizeUsdIdentifier(linkId)}`
      : `${parentPath}/${sanitizeUsdIdentifier(linkId)}`;
    linkPaths.set(linkId, path);
    (childIdsByParent.get(linkId) || []).forEach((childLinkId) => visit(childLinkId, path));
  };

  visit(robot.rootLinkId, `/${rootPrimName}`);

  return { linkPaths, childIdsByParent };
};

export const buildUsdPhysicsLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const omittedRootAnchor = resolveOmittedIsaacRootAnchor(robot, layoutProfile);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    subLayers = [',
    `        @${configStem}_base.${layerExtension}@`,
    '    ]',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  serializeUsdPrimSpecWithMetadata(
    lines,
    0,
    'def PhysicsScene "physicsScene"',
    layoutProfile === 'isaacsim' ? ['prepend apiSchemas = ["PhysxSceneAPI"]'] : [],
  );
  lines.push('{');
  lines.push('    vector3f physics:gravityDirection = (0, 0, -1)');
  lines.push('    float physics:gravityMagnitude = 9.81');
  if (layoutProfile === 'isaacsim') {
    lines.push(
      `    uniform token physxScene:broadphaseType = "${ISAACSIM_DEFAULT_PHYSX_SCENE_BROADPHASE_TYPE}"`,
    );
    lines.push(
      `    bool physxScene:enableCCD = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_CCD ? 'true' : 'false'}`,
    );
    lines.push(
      `    bool physxScene:enableGPUDynamics = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_GPU_DYNAMICS ? 'true' : 'false'}`,
    );
    lines.push(
      `    bool physxScene:enableStabilization = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_STABILIZATION ? 'true' : 'false'}`,
    );
    lines.push(
      `    uniform token physxScene:solverType = "${ISAACSIM_DEFAULT_PHYSX_SCENE_SOLVER_TYPE}"`,
    );
  }
  lines.push('}');
  lines.push('');

  serializeUsdPrimSpecWithMetadata(lines, 0, `over "${rootPrimName}"`, [
    ...(layoutProfile === 'isaacsim' ? [] : ['prepend apiSchemas = ["PhysicsArticulationRootAPI"]']),
  ]);
  lines.push('{');

  if (layoutProfile === 'isaacsim') {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      if (omittedRootAnchor?.omittedLinkIds.has(linkId)) {
        return;
      }
      serializeLinkPhysicsOverride(robot, linkId, lines, 1, {
        addArticulationRootApi:
          linkId === (omittedRootAnchor?.articulationRootLinkId || robot.rootLinkId),
        layoutProfile,
      });
    });
  } else {
    serializeNestedLinkPhysicsOverrides(
      robot,
      robot.rootLinkId,
      pathMaps.childIdsByParent,
      lines,
      1,
    );
  }

  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  Object.values(robot.joints).forEach((joint) => {
    if (omittedRootAnchor?.omittedJointIds.has(joint.id)) {
      return;
    }
    serializeJointDefinition(joint, pathMaps.linkPaths, lines, 2, { layoutProfile });
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    serializeClosedLoopConstraintDefinition(constraint, pathMaps.linkPaths, lines, 2);
  });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const buildUsdSensorLayerContent = (rootPrimName: string): string => {
  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
    `def Xform "${rootPrimName}"`,
    '{',
    '}',
    '',
  ].join('\n');
};

export const buildUsdRootLayerContent = (
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);

  if (layoutProfile === 'isaacsim') {
    return [
      '#usda 1.0',
      '(',
      '    customLayerData = {',
      '        string "urdfStudio:roundtripMetadata" = "1"',
      '    }',
      `    defaultPrim = "${rootPrimName}"`,
      '    metersPerUnit = 1',
      '    upAxis = "Z"',
      ')',
      '',
      `def Xform "${rootPrimName}" (`,
      '    variants = {',
      '        string Physics = "PhysX"',
      '        string Robot = "Robot"',
      '        string Sensor = "Sensors"',
      '    }',
      '    prepend variantSets = ["Physics", "Sensor", "Robot"]',
      ')',
      '{',
      '    variantSet "Physics" = {',
      '        "None" (',
      `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
      '        ) {',
      '            over "joints" (',
      '                active = false',
      '            )',
      '            {',
      '            }',
      '',
      '        }',
      '        "PhysX" (',
      `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Sensor" = {',
      '        "None" {',
      '',
      '        }',
      '        "Sensors" (',
      `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Robot" = {',
      '        "None" {',
      '',
      '        }',
      '        "Robot" (',
      `            prepend payload = @configuration/${configStem}_robot.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n');
  }

  return [
    '#usda 1.0',
    '(',
    '    customLayerData = {',
    '        string "urdfStudio:roundtripMetadata" = "1"',
    '    }',
    `    defaultPrim = "${rootPrimName}"`,
    '    upAxis = "Z"',
    '    metersPerUnit = 1',
    ')',
    '',
    `def Xform "${rootPrimName}" (`,
    '    variants = {',
    '        string Physics = "PhysX"',
    '        string Sensor = "Sensors"',
    '    }',
    '    prepend variantSets = ["Physics", "Sensor"]',
    ')',
    '{',
    '    quatd xformOp:orient = (1, 0, 0, 0)',
    '    double3 xformOp:scale = (1, 1, 1)',
    '    double3 xformOp:translate = (0, 0, 0)',
    '    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]',
    '    variantSet "Physics" = {',
    '        "None" (',
    `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
    '        ) {',
    '            over "joints" (',
    '                active = false',
    '            )',
    '            {',
    '            }',
    '',
    '        }',
    '        "PhysX" (',
    `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '    variantSet "Sensor" = {',
    '        "None" {',
    '',
    '        }',
    '        "Sensors" (',
    `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
};

const serializeIsaacLinkOverride = (
  linkId: string,
  robot: RobotState,
  lines: string[],
  depth: number,
): void => {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);

  serializeUsdPrimSpecWithMetadata(lines, depth, `over "${sanitizeUsdIdentifier(linkId)}"`, [
    'prepend apiSchemas = ["IsaacLinkAPI"]',
  ]);
  lines.push(`${indent}{`);
  lines.push(`${childIndent}string isaac:nameOverride`);

  lines.push(`${indent}}`);
};

const serializeNestedIsaacLinkOverrides = (
  linkId: string,
  robot: RobotState,
  childIdsByParent: Map<string, string[]>,
  lines: string[],
  depth: number,
): void => {
  serializeIsaacLinkOverride(linkId, robot, lines, depth);

  (childIdsByParent.get(linkId) || []).forEach((childLinkId) => {
    serializeNestedIsaacLinkOverrides(childLinkId, robot, childIdsByParent, lines, depth + 1);
  });
};

export const buildUsdRobotLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const omittedRootAnchor = resolveOmittedIsaacRootAnchor(robot, layoutProfile);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  const rootLinkPaths = Array.from(pathMaps.linkPaths.entries())
    .filter(([linkId]) => !omittedRootAnchor?.omittedLinkIds.has(linkId))
    .map(([, linkPath]) => `        <${linkPath}>,`);
  const jointPaths = Object.values(robot.joints)
    .filter((joint) => !omittedRootAnchor?.omittedJointIds.has(joint.id))
    .map(
      (joint) =>
        `        </${rootPrimName}/joints/${sanitizeUsdIdentifier(joint.id || joint.name || 'joint')}>,`,
    );

  serializeUsdPrimSpecWithMetadata(lines, 0, `def Xform "${rootPrimName}"`, [
    'prepend apiSchemas = ["IsaacRobotAPI"]',
  ]);
  lines.push('{');
  lines.push('    string isaac:description');
  lines.push('    string isaac:namespace');
  lines.push('    prepend rel isaac:physics:robotJoints = [');
  jointPaths.forEach((jointPath) => lines.push(jointPath));
  lines.push('    ]');
  lines.push('    prepend rel isaac:physics:robotLinks = [');
  rootLinkPaths.forEach((linkPath) => lines.push(linkPath));
  lines.push('    ]');
  lines.push('');

  if (layoutProfile !== 'isaacsim') {
    serializeNestedIsaacLinkOverrides(robot.rootLinkId, robot, pathMaps.childIdsByParent, lines, 1);
  } else {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      if (omittedRootAnchor?.omittedLinkIds.has(linkId)) {
        return;
      }
      serializeIsaacLinkOverride(linkId, robot, lines, 1);
    });
  }
  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  Object.values(robot.joints)
    .filter((joint) => !omittedRootAnchor?.omittedJointIds.has(joint.id))
    .forEach((joint, index) => {
      const jointName = sanitizeUsdIdentifier(joint.id || joint.name || 'joint');
      serializeUsdPrimSpecWithMetadata(lines, 2, `over "${jointName}"`, [
        'prepend apiSchemas = ["IsaacJointAPI"]',
    ]);
    lines.push('        {');
    lines.push('            string isaac:nameOverride');
    lines.push('            float[] isaac:physics:AccelerationLimit');
    lines.push(`            int isaac:physics:index = ${index}`);
    lines.push('            float[] isaac:physics:JerkLimit');
    lines.push('            int isaac:physics:Rot_X:DofOffset');
    lines.push('            int isaac:physics:Rot_Y:DofOffset');
    lines.push('            int isaac:physics:Rot_Z:DofOffset');
    lines.push('            int isaac:physics:Tr_X:DofOffset');
    lines.push('            int isaac:physics:Tr_Y:DofOffset');
    lines.push('            int isaac:physics:Tr_Z:DofOffset');
    lines.push('        }');
      lines.push('');
    });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
};

export const createUsdArchivePackage = (
  exportName: string,
  layerContents: UsdPackageLayerContents,
  assetFiles: Map<string, Blob> = new Map(),
  options: UsdPackageLayoutOptions = {},
): UsdArchivePackage => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const packageRoot = sanitizeUsdIdentifier(exportName || 'robot');
  const configStemBase = resolveUsdConfigStem(packageRoot, options);
  const usdRoot = layoutProfile === 'isaacsim' ? packageRoot : `${packageRoot}/usd`;
  const configurationRoot = `${usdRoot}/configuration`;
  const rootLayerPath = `${usdRoot}/${packageRoot}.${layerExtension}`;

  const layerFiles: Array<[string, Blob]> = [
    [rootLayerPath, createIdentityBlob(layerContents.rootLayerContent)],
    [
      `${configurationRoot}/${configStemBase}_base.${layerExtension}`,
      createIdentityBlob(layerContents.baseLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_physics.${layerExtension}`,
      createIdentityBlob(layerContents.physicsLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_sensor.${layerExtension}`,
      createIdentityBlob(layerContents.sensorLayerContent),
    ],
  ];

  if (layerContents.robotLayerContent) {
    layerFiles.push([
      `${configurationRoot}/${configStemBase}_robot.${layerExtension}`,
      createIdentityBlob(layerContents.robotLayerContent),
    ]);
  }

  return {
    archiveFileName: `${packageRoot}_${layerExtension}.zip`,
    rootLayerPath,
    archiveFiles: new Map<string, Blob>([
      ...layerFiles,
      ...Array.from(assetFiles.entries()).map(
        ([relativePath, blob]) => [`${usdRoot}/${relativePath}`, blob] as const,
      ),
    ]),
  };
};
