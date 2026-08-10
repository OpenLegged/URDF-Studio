import type { RobotClosedLoopConstraint, RobotState, UrdfJoint } from '../../../types/index.ts';
import { computeUsdInertiaProperties } from '../../../shared/utils/inertiaUsd.ts';
import {
  escapeUsdString,
  formatUsdFloat,
  formatUsdTuple,
  makeUsdIndent,
  quaternionToUsdTuple,
  sanitizeUsdIdentifier,
  serializeUsdPrimSpecWithMetadata,
} from './usdTextFormatting.ts';
import {
  ISAACSIM_DEFAULT_ENABLED_SELF_COLLISIONS,
  ISAACSIM_DEFAULT_JOINT_DAMPING,
  ISAACSIM_DEFAULT_JOINT_STIFFNESS,
  ISAACSIM_DEFAULT_SOLVER_POSITION_ITERATION_COUNT,
  ISAACSIM_DEFAULT_SOLVER_VELOCITY_ITERATION_COUNT,
  ZERO_EPSILON,
} from './usdIsaacSimDefaults.ts';
import {
  getAxisToken,
  normalizeUsdJointAxisToken,
  type UsdJointAxisToken,
} from './usdJointAxisUtils.ts';
import {
  angularVelocityToUsdUnits,
  getUsdDriveInstanceName,
  resolveIsaacSimDriveGain,
} from './usdUnitConversion.ts';
import {
  appendUsdJointDriveAttributes,
  appendUsdJointFrameAttributes,
  appendUsdJointLimitAttributes,
  appendUsdJointPhysxAttributes,
  getPlanarJointLimitAxes,
  getUsdPhysicsAxisKeys,
  supportsPhysxMimicJoint,
  type UsdJointTypeName,
} from './usdJointAttributeWriters.ts';
import type { ResolvedUsdPackageLayoutProfile } from './usdPackageTypes.ts';

const jointTypeToUsdType = (joint: UrdfJoint): UsdJointTypeName => {
  const authoredUsdTypeName = String(joint.usdPhysics?.jointTypeName || '').trim();
  if (
    /^PhysicsJoint$/i.test(authoredUsdTypeName) ||
    /(?:^|Physics)D6Joint$/i.test(authoredUsdTypeName)
  ) {
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
  if (type === 'planar') {
    return 'PhysicsJoint';
  }
  return 'PhysicsFixedJoint';
};

export const serializeJointDefinition = (
  joint: UrdfJoint,
  linkPaths: Map<string, string>,
  lines: string[],
  depth: number,
  options: {
    layoutProfile?: ResolvedUsdPackageLayoutProfile;
    mimicReferenceJointPath?: string;
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

  const supportsAxisAttribute =
    typeName === 'PhysicsRevoluteJoint' || typeName === 'PhysicsPrismaticJoint';
  const supportsAxisFrame =
    supportsAxisAttribute || String(joint.type || '').toLowerCase() === 'planar';
  const axisToken: UsdJointAxisToken =
    normalizeUsdJointAxisToken(joint.usdPhysics?.axisToken) ?? getAxisToken(joint.axis);
  const driveInstanceName = getUsdDriveInstanceName(typeName);
  const usdLimitAxes =
    typeName === 'PhysicsJoint'
      ? {
          ...(String(joint.type || '').toLowerCase() === 'planar'
            ? getPlanarJointLimitAxes(axisToken)
            : {}),
          ...(joint.usdPhysics?.limitAxes || {}),
        }
      : {};
  const usdLimitAxisKeys = getUsdPhysicsAxisKeys(usdLimitAxes);
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
  const jointEffort = joint.limit?.effort;
  const jointVelocity = joint.limit?.velocity;
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
  const shouldEmitPhysxMimic =
    options.layoutProfile === 'isaacsim' &&
    supportsPhysxMimicJoint(joint) &&
    driveInstanceName !== null &&
    Boolean(options.mimicReferenceJointPath);
  const mimicAxisInstance = `rot${axisToken}`;
  // Only a resolved PhysX mimic binding replaces the independent drive. An invalid
  // or omitted master must retain the normal drive so the joint stays controllable.
  const shouldEmitDrive =
    driveInstanceName !== null &&
    !shouldEmitPhysxMimic &&
    (driveStiffness !== null || driveDamping !== null || driveMaxForce !== null);
  const jointFriction =
    options.layoutProfile === 'isaacsim' &&
    driveInstanceName !== null &&
    Number.isFinite(joint.dynamics?.friction) &&
    Number(joint.dynamics?.friction) > ZERO_EPSILON
      ? Number(joint.dynamics?.friction)
      : null;
  const jointArmature =
    options.layoutProfile === 'isaacsim' &&
    driveInstanceName !== null &&
    Number.isFinite(joint.hardware?.armature) &&
    Number(joint.hardware?.armature) > ZERO_EPSILON
      ? Number(joint.hardware?.armature)
      : null;
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
  if (shouldEmitPhysxMimic) {
    jointApiSchemas.push(`"PhysxMimicJointAPI:${mimicAxisInstance}"`);
  }
  if (options.layoutProfile === 'isaacsim' && driveInstanceName !== null && !shouldEmitPhysxMimic) {
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

  if (supportsAxisAttribute) {
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

  appendUsdJointLimitAttributes({
    joint,
    typeName,
    usdLimitAxes,
    usdLimitAxisKeys,
    lines,
    childIndent,
  });
  appendUsdJointDriveAttributes({
    joint,
    driveInstanceName,
    driveStiffness,
    driveDamping,
    driveMaxForce,
    shouldEmitDrive,
    usdDriveAxisKeys,
    lines,
    childIndent,
    isIsaacSim: options.layoutProfile === 'isaacsim',
  });
  appendUsdJointPhysxAttributes({
    joint,
    driveInstanceName,
    maxJointVelocity,
    jointFriction,
    jointArmature,
    shouldEmitPhysxMimic,
    mimicAxisInstance,
    mimicReferenceJointPath: options.mimicReferenceJointPath,
    lines,
    childIndent,
  });
  appendUsdJointFrameAttributes({
    joint,
    supportsAxisFrame,
    axisToken,
    lines,
    childIndent,
  });
  lines.push(`${indent}}`);
};

export const serializeClosedLoopConstraintDefinition = (
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

export const serializeLinkPhysicsOverride = (
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

  lines.push(`${indent}}`);
};

export const serializeNestedLinkPhysicsOverrides = (
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

export { jointTypeToUsdType };
