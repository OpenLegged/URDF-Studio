import { UrdfJoint, JointType, type JointHardwareInterface } from '@/types';
import { parseVec3, parseOrigin, parseFloatSafe, parseOptionalFiniteFloat } from './utils';
import { addUrdfRecoveryDiagnostic, type UrdfRecoveryDiagnostics } from './recovery';

const AXIS_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const VALID_JOINT_TYPES = new Set<string>(Object.values(JointType));
const MIMIC_COMPATIBLE_JOINT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

function resolveMalformedMimicJointType(
  jointEl: Element,
  jointElementsByName: ReadonlyMap<string, Element>,
): JointType | null {
  if (jointEl.getAttribute('type')?.trim().toLowerCase() !== 'mimic') {
    return null;
  }

  const mimicTarget = jointEl.querySelector('mimic')?.getAttribute('joint')?.trim();
  if (!mimicTarget) {
    return null;
  }

  const targetType = jointElementsByName.get(mimicTarget)?.getAttribute('type')?.trim();
  if (!targetType || !VALID_JOINT_TYPES.has(targetType)) {
    return null;
  }

  const resolvedType = targetType as JointType;
  return MIMIC_COMPATIBLE_JOINT_TYPES.has(resolvedType) ? resolvedType : null;
}

function hasFiniteVector(rawValue: string | null, expectedLength: number): boolean {
  if (!rawValue?.trim()) return false;
  const values = rawValue.trim().split(/\s+/).map(Number);
  return values.length === expectedLength && values.every(Number.isFinite);
}

function hasInvalidAuthoredNumber(element: Element | null, attributes: readonly string[]): boolean {
  return Boolean(
    element &&
    attributes.some((attribute) => {
      const value = element.getAttribute(attribute);
      return value !== null && (value.trim() === '' || !Number.isFinite(Number(value)));
    }),
  );
}

const findOriginElement = (jointEl: Element): Element | null => {
  const queryResult = jointEl.querySelector('origin');
  if (queryResult) {
    return queryResult;
  }

  // Fallbacks keep parsing robust for XML DOMs with partial selector support.
  for (let index = 0; index < jointEl.children.length; index += 1) {
    const child = jointEl.children[index];
    if (child.tagName === 'origin') {
      return child;
    }
  }

  for (let index = 0; index < jointEl.childNodes.length; index += 1) {
    const node = jointEl.childNodes[index];
    if (node.nodeType === 1 && (node as Element).tagName === 'origin') {
      return node as Element;
    }
  }

  return null;
};

const parseJointHardware = (hardwareEl: Element | null): UrdfJoint['hardware'] => {
  if (!hardwareEl) {
    return {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
      hardwareInterface: undefined,
    };
  }

  const motorDirection = Number.parseInt(
    hardwareEl.querySelector('motorDirection')?.textContent || '1',
    10,
  );

  return {
    brand: hardwareEl.querySelector('brand')?.textContent || '',
    motorType: hardwareEl.querySelector('motorType')?.textContent || 'None',
    motorId: hardwareEl.querySelector('motorId')?.textContent || '',
    motorDirection: motorDirection === -1 ? -1 : 1,
    armature: parseFloatSafe(hardwareEl.querySelector('armature')?.textContent, 0),
    hardwareInterface:
      (hardwareEl.querySelector('hardwareInterface')
        ?.textContent as JointHardwareInterface | null) || undefined,
  };
};

const parseJointLimit = (
  jointType: JointType,
  limitEl: Element | null,
): UrdfJoint['limit'] | undefined => {
  if (!LIMIT_IMPORT_TYPES.has(jointType) || !limitEl) {
    return undefined;
  }

  const lower = parseOptionalFiniteFloat(limitEl.getAttribute('lower'));
  const upper = parseOptionalFiniteFloat(limitEl.getAttribute('upper'));
  const effort = parseOptionalFiniteFloat(limitEl.getAttribute('effort'));
  const velocity = parseOptionalFiniteFloat(limitEl.getAttribute('velocity'));
  const limit: NonNullable<UrdfJoint['limit']> = {
    ...(lower !== undefined ? { lower } : {}),
    ...(upper !== undefined ? { upper } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(velocity !== undefined ? { velocity } : {}),
  };

  return Object.keys(limit).length > 0 ? limit : undefined;
};

const parseJointCalibration = (
  calibrationEl: Element | null,
): {
  calibration?: UrdfJoint['calibration'];
  referencePosition?: number;
} => {
  const referencePosition = parseOptionalFiniteFloat(
    calibrationEl?.getAttribute('reference_position'),
  );
  if (!calibrationEl) {
    return referencePosition !== undefined ? { referencePosition } : {};
  }

  const rising = parseOptionalFiniteFloat(calibrationEl.getAttribute('rising'));
  const falling = parseOptionalFiniteFloat(calibrationEl.getAttribute('falling'));
  const calibration = {
    ...(referencePosition !== undefined ? { referencePosition } : {}),
    ...(rising !== undefined ? { rising } : {}),
    ...(falling !== undefined ? { falling } : {}),
  };

  return {
    ...(Object.keys(calibration).length > 0 ? { calibration } : {}),
    ...(referencePosition !== undefined ? { referencePosition } : {}),
  };
};

const parseJointSafetyController = (
  safetyControllerEl: Element | null,
): UrdfJoint['safetyController'] | undefined => {
  if (!safetyControllerEl) {
    return undefined;
  }

  const softLowerLimit = parseOptionalFiniteFloat(
    safetyControllerEl.getAttribute('soft_lower_limit'),
  );
  const softUpperLimit = parseOptionalFiniteFloat(
    safetyControllerEl.getAttribute('soft_upper_limit'),
  );
  const kPosition = parseOptionalFiniteFloat(safetyControllerEl.getAttribute('k_position'));
  const kVelocity = parseOptionalFiniteFloat(safetyControllerEl.getAttribute('k_velocity'));
  const safetyController = {
    ...(softLowerLimit !== undefined ? { softLowerLimit } : {}),
    ...(softUpperLimit !== undefined ? { softUpperLimit } : {}),
    ...(kPosition !== undefined ? { kPosition } : {}),
    ...(kVelocity !== undefined ? { kVelocity } : {}),
  };

  return Object.keys(safetyController).length > 0 ? safetyController : undefined;
};

const parseJointMimic = (mimicEl: Element | null): UrdfJoint['mimic'] | undefined => {
  if (!mimicEl) {
    return undefined;
  }

  const mimicJoint = mimicEl.getAttribute('joint');
  if (!mimicJoint) {
    return undefined;
  }

  return {
    joint: mimicJoint,
    ...(mimicEl.hasAttribute('multiplier')
      ? { multiplier: parseFloatSafe(mimicEl.getAttribute('multiplier'), 1) }
      : {}),
    ...(mimicEl.hasAttribute('offset')
      ? { offset: parseFloatSafe(mimicEl.getAttribute('offset'), 0) }
      : {}),
  };
};

function buildJointElementsByName(robotEl: Element): Map<string, Element> {
  const jointElementsByName = new Map<string, Element>();
  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName !== 'joint') return;
    const name = child.getAttribute('name')?.trim();
    if (name) jointElementsByName.set(name, child);
  });
  return jointElementsByName;
}

function resolveJointIdentityAndType(
  jointEl: Element,
  jointElementsByName: Map<string, Element>,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
): { jointName: string; jointType: JointType } | null {
  const jointName = jointEl.getAttribute('name')?.trim();
  if (!jointName) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_unnamed_joint_omitted',
      category: 'topology',
      message: 'A joint without a usable name was omitted.',
      action: 'omitted',
      tag: 'joint',
      attribute: 'name',
    });
    return null;
  }

  const authoredJointType = jointEl.getAttribute('type')?.trim();
  const rawJointType = authoredJointType || JointType.FIXED;
  if (!authoredJointType) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_joint_type_defaulted',
      category: 'joint',
      message: `Joint "${jointName}" omitted its required type and was imported as fixed for legacy compatibility.`,
      action: 'defaulted',
      tag: 'joint',
      name: jointName,
      attribute: 'type',
      relatedIds: [jointName],
    });
  }

  const recoveredMimicJointType = resolveMalformedMimicJointType(jointEl, jointElementsByName);
  const effectiveJointType = recoveredMimicJointType ?? rawJointType;
  if (!VALID_JOINT_TYPES.has(effectiveJointType)) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_unsupported_joint_omitted',
      category: 'joint',
      message: `Joint "${jointName}" used unsupported type "${rawJointType}" and was omitted.`,
      action: 'omitted',
      tag: 'joint',
      name: jointName,
      attribute: 'type',
      relatedIds: [jointName],
    });
    return null;
  }

  if (recoveredMimicJointType) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_mimic_joint_type_recovered',
      category: 'joint',
      message: `Joint "${jointName}" used non-standard type "mimic" and inherited type "${recoveredMimicJointType}" from its mimic target.`,
      action: 'downgraded',
      tag: 'joint',
      name: jointName,
      attribute: 'type',
      relatedIds: [jointName],
    });
  }

  return { jointName, jointType: effectiveJointType as JointType };
}

export const parseJoints = (
  robotEl: Element,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
): Record<string, UrdfJoint> => {
  const joints: Record<string, UrdfJoint> = {};
  const jointElementsByName = buildJointElementsByName(robotEl);

  for (const child of Array.from(robotEl.children)) {
    if (child.tagName !== 'joint') continue;
    const jointEl = child;
    const resolvedJoint = resolveJointIdentityAndType(
      jointEl,
      jointElementsByName,
      recoveryDiagnostics,
    );
    if (!resolvedJoint) continue;
    const { jointName, jointType } = resolvedJoint;

    try {
      const id = jointName;
      const parentEl = jointEl.querySelector('parent');
      const childEl = jointEl.querySelector('child');
      const originEl = findOriginElement(jointEl);
      const axisEl = jointEl.querySelector('axis');
      const calibrationEl = jointEl.querySelector('calibration');
      const limitEl = jointEl.querySelector('limit');
      const dynamicsEl = jointEl.querySelector('dynamics');
      const safetyControllerEl = jointEl.querySelector('safety_controller');
      const hardwareEl = jointEl.querySelector('hardware');
      const mimicEl = jointEl.querySelector('mimic');

      let axis = AXIS_IMPORT_TYPES.has(jointType)
        ? parseVec3(axisEl?.getAttribute('xyz') || '1 0 0')
        : undefined;
      if (
        axisEl &&
        (!hasFiniteVector(axisEl.getAttribute('xyz'), 3) ||
          !axis ||
          Math.hypot(axis.x, axis.y, axis.z) <= 1e-12)
      ) {
        axis = { x: 1, y: 0, z: 0 };
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_axis_defaulted',
          category: 'joint',
          message: `Joint "${jointName}" had an invalid axis and was given the URDF default axis.`,
          action: 'defaulted',
          tag: 'axis',
          name: jointName,
          attribute: 'xyz',
          relatedIds: [jointName],
        });
      }

      if (
        originEl &&
        ((originEl.hasAttribute('xyz') && !hasFiniteVector(originEl.getAttribute('xyz'), 3)) ||
          (originEl.hasAttribute('rpy') && !hasFiniteVector(originEl.getAttribute('rpy'), 3)))
      ) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_origin_defaulted',
          category: 'joint',
          message: `Joint "${jointName}" had invalid origin values and their unusable components were defaulted to 0.`,
          action: 'defaulted',
          tag: 'origin',
          name: jointName,
          relatedIds: [jointName],
        });
      }
      if (hasInvalidAuthoredNumber(limitEl, ['lower', 'upper', 'effort', 'velocity'])) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_limit_values_omitted',
          category: 'joint',
          message: `Joint "${jointName}" had non-finite limit values; only those values were omitted.`,
          action: 'omitted',
          tag: 'limit',
          name: jointName,
          relatedIds: [jointName],
        });
      }
      if (hasInvalidAuthoredNumber(calibrationEl, ['reference_position', 'rising', 'falling'])) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_calibration_values_omitted',
          category: 'joint',
          message: `Joint "${jointName}" had non-finite calibration values; only those values were omitted.`,
          action: 'omitted',
          tag: 'calibration',
          name: jointName,
          relatedIds: [jointName],
        });
      }
      if (
        hasInvalidAuthoredNumber(safetyControllerEl, [
          'soft_lower_limit',
          'soft_upper_limit',
          'k_position',
          'k_velocity',
        ])
      ) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_safety_values_omitted',
          category: 'joint',
          message: `Joint "${jointName}" had non-finite safety-controller values; only those values were omitted.`,
          action: 'omitted',
          tag: 'safety_controller',
          name: jointName,
          relatedIds: [jointName],
        });
      }
      if (hasInvalidAuthoredNumber(dynamicsEl, ['damping', 'friction'])) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_joint_dynamics_defaulted',
          category: 'simulation',
          message: `Joint "${jointName}" had invalid dynamics values and those values were defaulted to 0.`,
          action: 'defaulted',
          tag: 'dynamics',
          name: jointName,
          relatedIds: [jointName],
        });
      }

      if (joints[id]) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_duplicate_joint_omitted',
          category: 'topology',
          message: `An earlier joint named "${jointName}" was replaced by the later definition.`,
          action: 'omitted',
          tag: 'joint',
          name: jointName,
          relatedIds: [jointName],
        });
      }

      const limit = parseJointLimit(jointType, limitEl);
      const { calibration, referencePosition } = parseJointCalibration(calibrationEl);
      const safetyController = parseJointSafetyController(safetyControllerEl);
      joints[id] = {
        id,
        name: jointName,
        type: jointType,
        parentLinkId: parentEl?.getAttribute('link')?.trim() || '',
        childLinkId: childEl?.getAttribute('link')?.trim() || '',
        origin: parseOrigin(originEl),
        axis,
        limit,
        dynamics: {
          damping: parseFloatSafe(dynamicsEl?.getAttribute('damping'), 0),
          friction: parseFloatSafe(dynamicsEl?.getAttribute('friction'), 0),
        },
        hardware: parseJointHardware(hardwareEl),
        ...(calibration ? { calibration } : {}),
        ...(safetyController ? { safetyController } : {}),
        ...(referencePosition !== undefined ? { referencePosition } : {}),
        mimic: parseJointMimic(mimicEl),
      };
    } catch {
      addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
        code: 'urdf_joint_omitted',
        category: 'joint',
        message: `Joint "${jointName}" could not be read and was omitted while its siblings were preserved.`,
        action: 'omitted',
        tag: 'joint',
        name: jointName,
        relatedIds: [jointName],
      });
    }
  }

  return joints;
};
