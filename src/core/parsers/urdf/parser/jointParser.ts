import { UrdfJoint, JointType, type JointHardwareInterface } from '@/types';
import { parseVec3, parseOrigin, parseFloatSafe, parseOptionalFiniteFloat } from './utils';

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
      (hardwareEl.querySelector('hardwareInterface')?.textContent as JointHardwareInterface | null) ||
      undefined,
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

export const parseJoints = (robotEl: Element): Record<string, UrdfJoint> => {
  const joints: Record<string, UrdfJoint> = {};

  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName !== 'joint') return;
    const jointEl = child;
    const jointName = jointEl.getAttribute('name');
    if (!jointName) return;
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

    const jointType = (jointEl.getAttribute('type') as JointType) || JointType.REVOLUTE;
    const axis = AXIS_IMPORT_TYPES.has(jointType)
      ? parseVec3(axisEl?.getAttribute('xyz') || '1 0 0')
      : undefined;
    const limit = parseJointLimit(jointType, limitEl);
    const { calibration, referencePosition } = parseJointCalibration(calibrationEl);
    const safetyController = parseJointSafetyController(safetyControllerEl);

    joints[id] = {
      id,
      name: jointName,
      type: jointType,
      parentLinkId: parentEl?.getAttribute('link') || '',
      childLinkId: childEl?.getAttribute('link') || '',
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
  });

  return joints;
};
