import {
  GeometryType,
  JointType,
  type RobotData,
  type RobotImportRecoveryDiagnostic,
  type RobotImportRecoveryReport,
  type RobotSourceDiagnosticSeverity,
  type UrdfJoint,
  type UrdfOrigin,
  type UrdfVisual,
  type Vector3,
} from '@/types';

const MAX_RETAINED_DIAGNOSTICS = 200;
const JOINT_TYPES = new Set<JointType>(Object.values(JointType));
const LIMIT_FIELDS = ['lower', 'upper', 'effort', 'velocity'] as const;
const CALIBRATION_FIELDS = ['referencePosition', 'rising', 'falling'] as const;
const SAFETY_FIELDS = ['softLowerLimit', 'softUpperLimit', 'kPosition', 'kVelocity'] as const;
const INERTIA_FIELDS = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;
const USD_DRIVE_NUMBER_FIELDS = [
  'stiffness',
  'damping',
  'maxForce',
  'targetPosition',
  'targetVelocity',
] as const;

interface RecoveryCollector {
  add: (diagnostic: RobotImportRecoveryDiagnostic) => void;
  build: () => RobotImportRecoveryReport | undefined;
}

function createRecoveryCollector(): RecoveryCollector {
  const diagnostics: RobotImportRecoveryDiagnostic[] = [];
  const diagnosticCounts: Record<RobotSourceDiagnosticSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  let recoveredItemCount = 0;

  return {
    add(diagnostic) {
      recoveredItemCount += 1;
      diagnosticCounts[diagnostic.severity] += 1;
      if (diagnostics.length < MAX_RETAINED_DIAGNOSTICS) {
        diagnostics.push(diagnostic);
      }
    },
    build() {
      if (recoveredItemCount === 0) return undefined;
      const omittedDiagnosticCount = recoveredItemCount - diagnostics.length;
      return {
        diagnostics,
        diagnosticCounts,
        recoveredItemCount,
        ...(omittedDiagnosticCount > 0 ? { omittedDiagnosticCount } : {}),
      };
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeVector3(
  value: Vector3,
  path: string,
  collector: RecoveryCollector,
): void {
  for (const field of ['x', 'y', 'z'] as const) {
    if (isFiniteNumber(value[field])) continue;
    value[field] = 0;
    collector.add({
      code: 'nonfinite_transform_component_defaulted',
      severity: 'warning',
      category: 'geometry',
      message: `${path}.${field} was non-finite and was defaulted to 0.`,
      action: 'defaulted',
    });
  }
}

function sanitizeOrigin(
  origin: UrdfOrigin,
  path: string,
  collector: RecoveryCollector,
): void {
  sanitizeVector3(origin.xyz, `${path}.xyz`, collector);
  for (const field of ['r', 'p', 'y'] as const) {
    if (isFiniteNumber(origin.rpy[field])) continue;
    origin.rpy[field] = 0;
    collector.add({
      code: 'nonfinite_transform_component_defaulted',
      severity: 'warning',
      category: 'geometry',
      message: `${path}.rpy.${field} was non-finite and was defaulted to 0.`,
      action: 'defaulted',
    });
  }
  if (
    origin.quatXyzw
    && !Object.values(origin.quatXyzw).every((value) => isFiniteNumber(value))
  ) {
    delete origin.quatXyzw;
    collector.add({
      code: 'nonfinite_origin_quaternion_omitted',
      severity: 'warning',
      category: 'geometry',
      message: `${path}.quatXyzw was non-finite and was omitted.`,
      action: 'omitted',
    });
  }
}

function downgradeGeometry(
  geometry: UrdfVisual,
  path: string,
  collector: RecoveryCollector,
): void {
  geometry.type = GeometryType.NONE;
  geometry.dimensions = { x: 0, y: 0, z: 0 };
  delete geometry.meshPath;
  delete geometry.assetRef;
  delete geometry.mjcfMesh;
  delete geometry.mjcfHfield;
  delete geometry.sdfHeightmap;
  delete geometry.polylinePoints;
  delete geometry.polylineHeight;
  collector.add({
    code: 'nonfinite_geometry_downgraded',
    severity: 'warning',
    category: 'geometry',
    message: `${path} contained non-finite geometry data and was disabled.`,
    action: 'downgraded',
  });
}

function sanitizeGeometry(
  geometry: UrdfVisual,
  path: string,
  collector: RecoveryCollector,
): void {
  sanitizeOrigin(geometry.origin, `${path}.origin`, collector);
  if (!Object.values(geometry.dimensions).every((value) => isFiniteNumber(value))) {
    downgradeGeometry(geometry, path, collector);
    return;
  }

  geometry.authoredMaterials?.forEach((material, materialIndex) => {
    for (const field of [
      'textureRotation',
      'opacity',
      'roughness',
      'metalness',
      'emissiveIntensity',
      'alphaTest',
    ] as const) {
      if (material[field] === undefined || isFiniteNumber(material[field])) continue;
      delete material[field];
      collector.add({
        code: 'nonfinite_material_value_omitted',
        severity: 'warning',
        category: 'material',
        message: `${path}.authoredMaterials.${materialIndex}.${field} was omitted.`,
        action: 'omitted',
      });
    }
    if (material.colorRgba?.some((value) => !isFiniteNumber(value))) {
      delete material.colorRgba;
      collector.add({
        code: 'nonfinite_material_color_omitted',
        severity: 'warning',
        category: 'material',
        message: `${path}.authoredMaterials.${materialIndex}.colorRgba was omitted.`,
        action: 'omitted',
      });
    }
  });
}

function sanitizeJointOptionalNumbers(
  joint: UrdfJoint,
  path: string,
  collector: RecoveryCollector,
): void {
  if (joint.limit) {
    for (const field of LIMIT_FIELDS) {
      if (joint.limit[field] === undefined || isFiniteNumber(joint.limit[field])) continue;
      delete joint.limit[field];
      collector.add({
        code: 'nonfinite_joint_limit_omitted',
        severity: 'warning',
        category: 'joint',
        message: `${path}.limit.${field} was non-finite and was omitted.`,
        relatedIds: [joint.id],
        action: 'omitted',
      });
    }
    if (LIMIT_FIELDS.every((field) => joint.limit?.[field] === undefined)) {
      delete joint.limit;
    }
  }

  if (joint.calibration) {
    for (const field of CALIBRATION_FIELDS) {
      if (
        joint.calibration[field] === undefined
        || isFiniteNumber(joint.calibration[field])
      ) {
        continue;
      }
      delete joint.calibration[field];
      collector.add({
        code: 'nonfinite_joint_calibration_omitted',
        severity: 'warning',
        category: 'joint',
        message: `${path}.calibration.${field} was non-finite and was omitted.`,
        relatedIds: [joint.id],
        action: 'omitted',
      });
    }
    if (CALIBRATION_FIELDS.every((field) => joint.calibration?.[field] === undefined)) {
      delete joint.calibration;
    }
  }

  if (joint.safetyController) {
    for (const field of SAFETY_FIELDS) {
      if (
        joint.safetyController[field] === undefined
        || isFiniteNumber(joint.safetyController[field])
      ) {
        continue;
      }
      delete joint.safetyController[field];
      collector.add({
        code: 'nonfinite_joint_safety_value_omitted',
        severity: 'warning',
        category: 'joint',
        message: `${path}.safetyController.${field} was non-finite and was omitted.`,
        relatedIds: [joint.id],
        action: 'omitted',
      });
    }
    if (SAFETY_FIELDS.every((field) => joint.safetyController?.[field] === undefined)) {
      delete joint.safetyController;
    }
  }

  if (joint.referencePosition !== undefined && !isFiniteNumber(joint.referencePosition)) {
    delete joint.referencePosition;
    collector.add({
      code: 'nonfinite_joint_reference_position_omitted',
      severity: 'warning',
      category: 'joint',
      message: `${path}.referencePosition was non-finite and was omitted.`,
      relatedIds: [joint.id],
      action: 'omitted',
    });
  }
}

function sanitizeJointRequiredNumbers(
  joint: UrdfJoint,
  path: string,
  sourceFormat: string,
  collector: RecoveryCollector,
): void {
  sanitizeOrigin(joint.origin, `${path}.origin`, collector);
  if (joint.axis && !Object.values(joint.axis).every((value) => isFiniteNumber(value))) {
    joint.axis = sourceFormat === 'urdf' || sourceFormat === 'xacro'
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 0, z: 1 };
    collector.add({
      code: 'nonfinite_joint_axis_defaulted',
      severity: 'warning',
      category: 'joint',
      message: `${path}.axis was non-finite and was replaced with the format default axis.`,
      relatedIds: [joint.id],
      action: 'defaulted',
    });
  }
  for (const field of ['damping', 'friction'] as const) {
    if (isFiniteNumber(joint.dynamics[field])) continue;
    joint.dynamics[field] = 0;
    collector.add({
      code: 'nonfinite_joint_dynamics_defaulted',
      severity: 'warning',
      category: 'simulation',
      message: `${path}.dynamics.${field} was non-finite and was defaulted to 0.`,
      relatedIds: [joint.id],
      action: 'defaulted',
    });
  }
  if (joint.dynamics.stiffness !== undefined && !isFiniteNumber(joint.dynamics.stiffness)) {
    delete joint.dynamics.stiffness;
    collector.add({
      code: 'nonfinite_joint_stiffness_omitted',
      severity: 'warning',
      category: 'simulation',
      message: `${path}.dynamics.stiffness was non-finite and was omitted.`,
      relatedIds: [joint.id],
      action: 'omitted',
    });
  }
  if (!isFiniteNumber(joint.hardware.armature)) {
    joint.hardware.armature = 0;
    collector.add({
      code: 'nonfinite_joint_armature_defaulted',
      severity: 'warning',
      category: 'simulation',
      message: `${path}.hardware.armature was non-finite and was defaulted to 0.`,
      relatedIds: [joint.id],
      action: 'defaulted',
    });
  }
  if (joint.hardware.motorDirection !== 1 && joint.hardware.motorDirection !== -1) {
    joint.hardware.motorDirection = 1;
    collector.add({
      code: 'invalid_motor_direction_defaulted',
      severity: 'warning',
      category: 'simulation',
      message: `${path}.hardware.motorDirection was invalid and was defaulted to 1.`,
      relatedIds: [joint.id],
      action: 'defaulted',
    });
  }
}

function sanitizeJointUsdPhysics(
  joint: UrdfJoint,
  path: string,
  collector: RecoveryCollector,
): void {
  const usdPhysics = joint.usdPhysics;
  if (!usdPhysics) return;
  for (const field of ['localPos0', 'localPos1'] as const) {
    if (usdPhysics[field]) {
      sanitizeVector3(usdPhysics[field], `${path}.usdPhysics.${field}`, collector);
    }
  }
  for (const field of ['localRot0Wxyz', 'localRot1Wxyz'] as const) {
    const rotation = usdPhysics[field];
    if (!rotation?.some((value) => !isFiniteNumber(value))) continue;
    delete usdPhysics[field];
    collector.add({
      code: 'nonfinite_usd_joint_rotation_omitted',
      severity: 'warning',
      category: 'simulation',
      message: `${path}.usdPhysics.${field} was non-finite and was omitted.`,
      relatedIds: [joint.id],
      action: 'omitted',
    });
  }
  Object.entries(usdPhysics.limitAxes ?? {}).forEach(([axis, limit]) => {
    for (const field of ['low', 'high'] as const) {
      if (limit[field] === undefined || limit[field] === null || isFiniteNumber(limit[field])) {
        continue;
      }
      delete limit[field];
      collector.add({
        code: 'nonfinite_usd_joint_limit_omitted',
        severity: 'warning',
        category: 'simulation',
        message: `${path}.usdPhysics.limitAxes.${axis}.${field} was omitted.`,
        relatedIds: [joint.id],
        action: 'omitted',
      });
    }
  });
  Object.entries(usdPhysics.driveAxes ?? {}).forEach(([axis, drive]) => {
    for (const field of USD_DRIVE_NUMBER_FIELDS) {
      if (drive[field] === undefined || drive[field] === null || isFiniteNumber(drive[field])) {
        continue;
      }
      delete drive[field];
      collector.add({
        code: 'nonfinite_usd_joint_drive_omitted',
        severity: 'warning',
        category: 'simulation',
        message: `${path}.usdPhysics.driveAxes.${axis}.${field} was omitted.`,
        relatedIds: [joint.id],
        action: 'omitted',
      });
    }
  });
}

function sanitizeMjcfSites(
  robotData: RobotData,
  collector: RecoveryCollector,
): void {
  Object.entries(robotData.links).forEach(([linkId, link]) => {
    link.mjcfSites?.forEach((site, siteIndex) => {
      for (const field of ['size', 'rgba', 'pos', 'quat'] as const) {
        const value = site[field];
        if (!value?.some((entry) => !isFiniteNumber(entry))) continue;
        delete site[field];
        collector.add({
          code: 'nonfinite_mjcf_site_value_omitted',
          severity: 'warning',
          category: 'simulation',
          message: `links.${linkId}.mjcfSites.${siteIndex}.${field} was omitted.`,
          relatedIds: [linkId, site.name],
          action: 'omitted',
        });
      }
      if (site.group !== undefined && !isFiniteNumber(site.group)) {
        delete site.group;
        collector.add({
          code: 'nonfinite_mjcf_site_group_omitted',
          severity: 'warning',
          category: 'simulation',
          message: `links.${linkId}.mjcfSites.${siteIndex}.group was omitted.`,
          relatedIds: [linkId, site.name],
          action: 'omitted',
        });
      }
    });
  });
}

/**
 * Converts parser output into finite, serializable RobotData without changing
 * ambiguous topology. The input is never mutated.
 */
export function recoverImportedRobotData(
  robotData: RobotData,
  sourceFormat: NonNullable<RobotData['inspectionContext']>['sourceFormat'],
  initialDiagnostics: readonly RobotImportRecoveryDiagnostic[] = [],
): RobotData {
  const recovered = structuredClone(robotData);
  const collector = createRecoveryCollector();
  initialDiagnostics.forEach((diagnostic) => collector.add(structuredClone(diagnostic)));

  Object.entries(recovered.links).forEach(([linkId, link]) => {
    sanitizeGeometry(link.visual, `links.${linkId}.visual`, collector);
    link.visualBodies?.forEach((geometry, index) =>
      sanitizeGeometry(geometry, `links.${linkId}.visualBodies.${index}`, collector));
    sanitizeGeometry(link.collision, `links.${linkId}.collision`, collector);
    link.collisionBodies?.forEach((geometry, index) =>
      sanitizeGeometry(geometry, `links.${linkId}.collisionBodies.${index}`, collector));

    if (link.inertial) {
      const inertiaIsFinite = INERTIA_FIELDS.every((field) =>
        isFiniteNumber(link.inertial?.inertia[field]));
      if (!isFiniteNumber(link.inertial.mass) || !inertiaIsFinite) {
        delete link.inertial;
        collector.add({
          code: 'nonfinite_inertial_omitted',
          severity: 'warning',
          category: 'physical',
          message: `links.${linkId}.inertial contained non-finite values and was omitted.`,
          relatedIds: [linkId],
          action: 'omitted',
        });
      } else if (link.inertial.origin) {
        sanitizeOrigin(link.inertial.origin, `links.${linkId}.inertial.origin`, collector);
      }
    }
  });

  for (const [jointId, joint] of Object.entries(recovered.joints)) {
    if (!JOINT_TYPES.has(joint.type)) {
      delete recovered.joints[jointId];
      collector.add({
        code: 'unsupported_joint_omitted',
        severity: 'warning',
        category: 'topology',
        message: `Joint "${jointId}" used an unsupported type and was omitted.`,
        relatedIds: [jointId],
        action: 'omitted',
      });
      continue;
    }
    if (!recovered.links[joint.parentLinkId] || !recovered.links[joint.childLinkId]) {
      delete recovered.joints[jointId];
      collector.add({
        code: 'dangling_joint_omitted',
        severity: 'warning',
        category: 'topology',
        message: `Joint "${jointId}" referenced a missing endpoint and was omitted.`,
        relatedIds: [jointId, joint.parentLinkId, joint.childLinkId],
        action: 'omitted',
      });
      continue;
    }
    sanitizeJointRequiredNumbers(joint, `joints.${jointId}`, sourceFormat, collector);
    sanitizeJointOptionalNumbers(joint, `joints.${jointId}`, collector);
    sanitizeJointUsdPhysics(joint, `joints.${jointId}`, collector);
  }

  Object.entries(recovered.joints).forEach(([jointId, joint]) => {
    if (joint.mimic && !recovered.joints[joint.mimic.joint]) {
      const missingTarget = joint.mimic.joint;
      delete joint.mimic;
      collector.add({
        code: 'unresolved_mimic_omitted',
        severity: 'warning',
        category: 'joint',
        message: `Joint "${jointId}" referenced missing mimic target "${missingTarget}"; mimic metadata was omitted.`,
        relatedIds: [jointId, missingTarget],
        action: 'omitted',
      });
    }
  });

  sanitizeMjcfSites(recovered, collector);

  const recovery = collector.build();
  if (recovery) {
    recovered.inspectionContext = {
      ...(recovered.inspectionContext ?? {
        sourceFormat,
      }),
      recovery,
    };
  }

  return recovered;
}
