import {
  GeometryType,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type AssemblyTransform,
  type RobotData,
} from '@/types';

import { IDENTITY_ASSEMBLY_TRANSFORM } from './assemblyTransformUtils';
import { normalizeComponentRobot } from './assemblyComponentPreparation';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from './assemblyBridgeTopology';
import { createAttachedChildLink } from './builders';
import {
  validateCanonicalClosedLoopConstraints,
  validateCanonicalRobotMaterials,
  validateCanonicalUrdfInspection,
  validateCanonicalVisualGeometryNested,
} from './canonicalRobotValidation';
import { DEFAULT_ROBOT_NAME } from './constants';

/** AssemblyState is canonical at the shared type boundary. */
export type CanonicalAssemblyComponent = AssemblyComponent;
export type CanonicalAssemblyState = AssemblyState;

export interface CreateSingleComponentWorkspaceOptions {
  workspaceName?: string;
  workspaceTransform?: AssemblyTransform;
  componentId?: string;
  componentName?: string;
  componentTransform?: AssemblyTransform;
  sourceFile?: string | null;
  visible?: boolean;
}

export interface CanonicalWorkspaceValidationIssue {
  path: string;
  message: string;
}

export interface CanonicalWorkspaceValidationResult {
  valid: boolean;
  issues: CanonicalWorkspaceValidationIssue[];
}

const DEFAULT_COMPONENT_ID = 'component_1';
const DEFAULT_ROOT_LINK_ID = 'base_link';
const WORKSPACE_KEYS = new Set(['name', 'transform', 'components', 'bridges']);
const COMPONENT_KEYS = new Set([
  'id',
  'name',
  'sourceFile',
  'robot',
  'renderableBounds',
  'transform',
  'visible',
  'editorLocked',
]);
const ROBOT_DATA_KEYS = new Set([
  'name',
  'version',
  'links',
  'joints',
  'rootLinkId',
  'materials',
  'closedLoopConstraints',
  'inspectionContext',
]);
const BRIDGE_KEYS = new Set([
  'id',
  'name',
  'parentComponentId',
  'parentLinkId',
  'childComponentId',
  'childLinkId',
  'joint',
]);
const GEOMETRY_TYPES = new Set<string>(Object.values(GeometryType));
const JOINT_TYPES = new Set<string>(Object.values(JointType));
const HARDWARE_INTERFACES = new Set(['effort', 'position', 'velocity']);
const ROBOT_SOURCE_FORMATS = new Set(['urdf', 'mjcf', 'usd', 'xacro', 'sdf', 'mesh']);
const INSPECTION_CONTEXT_KEYS = new Set(['sourceFormat', 'recovery', 'urdf', 'mjcf']);
const IMPORT_RECOVERY_KEYS = new Set([
  'diagnostics',
  'diagnosticCounts',
  'recoveredItemCount',
  'omittedDiagnosticCount',
]);
const IMPORT_RECOVERY_DIAGNOSTIC_KEYS = new Set([
  'code',
  'severity',
  'category',
  'message',
  'relatedIds',
  'source',
  'action',
]);
const IMPORT_RECOVERY_DIAGNOSTIC_SOURCE_KEYS = new Set(['tag', 'name', 'attribute']);
const DIAGNOSTIC_SEVERITIES = new Set(['info', 'warning', 'error']);
const DIAGNOSTIC_CATEGORIES = new Set([
  'source',
  'topology',
  'joint',
  'geometry',
  'material',
  'physical',
  'simulation',
]);
const IMPORT_RECOVERY_ACTIONS = new Set(['omitted', 'defaulted', 'downgraded']);
const USD_JOINT_PHYSICS_KEYS = new Set([
  'jointTypeName',
  'axisToken',
  'localPos0',
  'localRot0Wxyz',
  'localPos1',
  'localRot1Wxyz',
  'limitAxes',
  'driveAxes',
]);
const USD_JOINT_LIMIT_KEYS = new Set(['low', 'high']);
const USD_JOINT_DRIVE_KEYS = new Set([
  'type',
  'stiffness',
  'damping',
  'maxForce',
  'targetPosition',
  'targetVelocity',
]);
const MJCF_INSPECTION_KEYS = new Set([
  'siteCount',
  'tendonCount',
  'tendonActuatorCount',
  'bodiesWithSites',
  'tendons',
]);
const MJCF_BODY_SITE_KEYS = new Set(['bodyId', 'siteCount', 'siteNames']);
const MJCF_TENDON_KEYS = new Set([
  'className',
  'group',
  'name',
  'type',
  'limited',
  'range',
  'width',
  'stiffness',
  'springlength',
  'rgba',
  'attachmentRefs',
  'attachments',
  'actuatorNames',
]);
const MJCF_TENDON_ATTACHMENT_KEYS = new Set([
  'type',
  'ref',
  'sidesite',
  'divisor',
  'coef',
]);
const MJCF_SITE_KEYS = new Set([
  'name',
  'sourceName',
  'type',
  'size',
  'rgba',
  'pos',
  'quat',
  'group',
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createLookup<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function createDefaultRobot(name: string): RobotData {
  const rootLink = createAttachedChildLink({
    id: DEFAULT_ROOT_LINK_ID,
    name: DEFAULT_ROOT_LINK_ID,
  });

  return {
    name,
    rootLinkId: rootLink.id,
    links: { [rootLink.id]: rootLink },
    joints: {},
  };
}

/** Create the canonical non-empty workspace used for a blank project. */
export function createDefaultWorkspace(
  name: string = DEFAULT_ROBOT_NAME,
): CanonicalAssemblyState {
  return createSingleComponentWorkspace(createDefaultRobot(name), {
    workspaceName: name,
    componentName: name,
  });
}

/** Wrap parser-owned RobotData without changing its source-local entity IDs. */
export function createSingleComponentWorkspace(
  robot: RobotData,
  options: CreateSingleComponentWorkspaceOptions = {},
): CanonicalAssemblyState {
  const normalizedRobot = normalizeComponentRobot(robot);
  const componentId =
    options.componentId === undefined ? DEFAULT_COMPONENT_ID : options.componentId;
  const component: AssemblyComponent = {
    id: componentId,
    name: options.componentName === undefined ? normalizedRobot.name : options.componentName,
    sourceFile: options.sourceFile === undefined ? null : options.sourceFile,
    robot: normalizedRobot,
    transform: structuredClone(
      options.componentTransform === undefined
        ? IDENTITY_ASSEMBLY_TRANSFORM
        : options.componentTransform,
    ),
    visible: options.visible === undefined ? true : options.visible,
  };

  const workspace: AssemblyState = {
    name: options.workspaceName === undefined ? normalizedRobot.name : options.workspaceName,
    transform: structuredClone(
      options.workspaceTransform === undefined
        ? IDENTITY_ASSEMBLY_TRANSFORM
        : options.workspaceTransform,
    ),
    components: { [componentId]: component },
    bridges: {},
  };

  assertCanonicalWorkspace(workspace);
  return workspace;
}

function addIssue(
  issues: CanonicalWorkspaceValidationIssue[],
  path: string,
  message: string,
): void {
  issues.push({ path, message });
}

function validateAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      addIssue(
        issues,
        path ? `${path}.${key}` : key,
        'is not a canonical workspace field',
      );
    }
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addIssue(issues, path, 'must be a non-empty string');
    return false;
  }
  return true;
}

function validateFiniteNumber(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(issues, path, 'must be a finite number');
  }
}

function validateFiniteNumberArray(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
  expectedLength?: number,
): value is number[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array');
    return false;
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    addIssue(issues, path, `must contain exactly ${expectedLength} numbers`);
  }
  value.forEach((entry, index) => validateFiniteNumber(entry, `${path}.${index}`, issues));
  return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): value is string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array');
    return false;
  }
  let valid = true;
  value.forEach((entry, index) => {
    if (!validateNonEmptyString(entry, `${path}.${index}`, issues)) valid = false;
  });
  return valid;
}

function validateVector3(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateFiniteNumber(value.x, `${path}.x`, issues);
  validateFiniteNumber(value.y, `${path}.y`, issues);
  validateFiniteNumber(value.z, `${path}.z`, issues);
}

function validateEuler(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object');
    return;
  }

  validateFiniteNumber(value.r, `${path}.r`, issues);
  validateFiniteNumber(value.p, `${path}.p`, issues);
  validateFiniteNumber(value.y, `${path}.y`, issues);
}

function validateQuaternion(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be a quaternion object');
    return;
  }
  validateFiniteNumber(value.x, `${path}.x`, issues);
  validateFiniteNumber(value.y, `${path}.y`, issues);
  validateFiniteNumber(value.z, `${path}.z`, issues);
  validateFiniteNumber(value.w, `${path}.w`, issues);
}

function validateOrigin(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be a complete origin');
    return;
  }
  validateVector3(value.xyz, `${path}.xyz`, issues);
  validateEuler(value.rpy, `${path}.rpy`, issues);
  if (value.quatXyzw !== undefined) {
    validateQuaternion(value.quatXyzw, `${path}.quatXyzw`, issues);
  }
}

function validateVisualGeometry(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be a visual geometry object');
    return;
  }
  validateCanonicalVisualGeometryNested(value, path, issues);
  if (typeof value.type !== 'string' || !GEOMETRY_TYPES.has(value.type)) {
    addIssue(issues, `${path}.type`, 'must be a supported geometry type');
  }
  validateVector3(value.dimensions, `${path}.dimensions`, issues);
  validateOrigin(value.origin, `${path}.origin`, issues);
  if (value.color !== undefined && typeof value.color !== 'string') {
    addIssue(issues, `${path}.color`, 'must be a string when provided');
  }
  if (value.visible !== undefined && typeof value.visible !== 'boolean') {
    addIssue(issues, `${path}.visible`, 'must be a boolean when provided');
  }
}

function validateVisualGeometryArray(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array');
    return;
  }
  value.forEach((entry, index) => validateVisualGeometry(entry, `${path}.${index}`, issues));
}

function validateLinkInertial(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an inertial object');
    return;
  }
  validateFiniteNumber(value.mass, `${path}.mass`, issues);
  if (value.origin !== undefined) validateOrigin(value.origin, `${path}.origin`, issues);
  if (!isRecord(value.inertia)) {
    addIssue(issues, `${path}.inertia`, 'must be an inertia tensor');
    return;
  }
  for (const field of ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz']) {
    validateFiniteNumber(value.inertia[field], `${path}.inertia.${field}`, issues);
  }
}

function validateMjcfSites(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array');
    return;
  }
  value.forEach((site, index) => {
    const sitePath = `${path}.${index}`;
    if (!isRecord(site)) {
      addIssue(issues, sitePath, 'must be an MJCF site object');
      return;
    }
    validateAllowedKeys(site, MJCF_SITE_KEYS, sitePath, issues);
    validateNonEmptyString(site.name, `${sitePath}.name`, issues);
    validateNonEmptyString(site.type, `${sitePath}.type`, issues);
    if (site.sourceName !== undefined) {
      validateNonEmptyString(site.sourceName, `${sitePath}.sourceName`, issues);
    }
    if (site.size !== undefined) {
      validateFiniteNumberArray(site.size, `${sitePath}.size`, issues);
    }
    if (site.rgba !== undefined) {
      validateFiniteNumberArray(site.rgba, `${sitePath}.rgba`, issues, 4);
    }
    if (site.pos !== undefined) {
      validateFiniteNumberArray(site.pos, `${sitePath}.pos`, issues, 3);
    }
    if (site.quat !== undefined) {
      validateFiniteNumberArray(site.quat, `${sitePath}.quat`, issues, 4);
    }
    if (site.group !== undefined) {
      validateFiniteNumber(site.group, `${sitePath}.group`, issues);
    }
  });
}

function validateTransform(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be a complete transform');
    return;
  }

  validateVector3(value.position, `${path}.position`, issues);
  validateEuler(value.rotation, `${path}.rotation`, issues);
}

function validateRenderableBounds(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be complete renderable bounds');
    return;
  }

  validateVector3(value.min, `${path}.min`, issues);
  validateVector3(value.max, `${path}.max`, issues);
}

function validateMapKey(
  key: string,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  validateNonEmptyString(key, path, issues);
}

function validateRobotLinks(
  linksValue: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): Record<string, Record<string, unknown>> | null {
  if (!isRecord(linksValue)) {
    addIssue(issues, path, 'must be a link map');
    return null;
  }

  const links = createLookup<Record<string, unknown>>();
  for (const [linkKey, linkValue] of Object.entries(linksValue)) {
    const linkPath = `${path}.${linkKey}`;
    validateMapKey(linkKey, `${linkPath}.id`, issues);
    if (!isRecord(linkValue)) {
      addIssue(issues, linkPath, 'must be a link object');
      continue;
    }
    if (linkValue.id !== linkKey) {
      addIssue(issues, `${linkPath}.id`, `must equal map key "${linkKey}"`);
    }
    validateNonEmptyString(linkValue.name, `${linkPath}.name`, issues);
    validateVisualGeometry(linkValue.visual, `${linkPath}.visual`, issues);
    validateVisualGeometryArray(linkValue.visualBodies, `${linkPath}.visualBodies`, issues);
    validateVisualGeometry(linkValue.collision, `${linkPath}.collision`, issues);
    validateVisualGeometryArray(
      linkValue.collisionBodies,
      `${linkPath}.collisionBodies`,
      issues,
    );
    validateLinkInertial(linkValue.inertial, `${linkPath}.inertial`, issues);
    validateMjcfSites(linkValue.mjcfSites, `${linkPath}.mjcfSites`, issues);
    if (linkValue.visible !== undefined && typeof linkValue.visible !== 'boolean') {
      addIssue(issues, `${linkPath}.visible`, 'must be a boolean when provided');
    }
    if (
      linkValue.editorLocked !== undefined &&
      typeof linkValue.editorLocked !== 'boolean'
    ) {
      addIssue(
        issues,
        `${linkPath}.editorLocked`,
        'must be a boolean when provided',
      );
    }
    links[linkKey] = linkValue;
  }
  return links;
}

function validateJointFields(
  joint: Record<string, unknown>,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (typeof joint.type !== 'string' || !JOINT_TYPES.has(joint.type)) {
    addIssue(issues, `${path}.type`, 'must be a supported joint type');
  }
  validateOrigin(joint.origin, `${path}.origin`, issues);
  if (joint.axis !== undefined) validateVector3(joint.axis, `${path}.axis`, issues);

  if (joint.usdPhysics !== undefined) {
    const usdPhysicsPath = `${path}.usdPhysics`;
    if (!isRecord(joint.usdPhysics)) {
      addIssue(issues, usdPhysicsPath, 'must be a USD joint physics object');
    } else {
      const usdPhysics = joint.usdPhysics;
      validateAllowedKeys(usdPhysics, USD_JOINT_PHYSICS_KEYS, usdPhysicsPath, issues);
      for (const field of ['jointTypeName', 'axisToken'] as const) {
        if (usdPhysics[field] !== undefined && typeof usdPhysics[field] !== 'string') {
          addIssue(issues, `${usdPhysicsPath}.${field}`, 'must be a string when provided');
        }
      }
      for (const field of ['localPos0', 'localPos1'] as const) {
        if (usdPhysics[field] !== undefined) {
          validateVector3(usdPhysics[field], `${usdPhysicsPath}.${field}`, issues);
        }
      }
      for (const field of ['localRot0Wxyz', 'localRot1Wxyz'] as const) {
        if (usdPhysics[field] !== undefined) {
          validateFiniteNumberArray(usdPhysics[field], `${usdPhysicsPath}.${field}`, issues, 4);
        }
      }
      for (const [field, allowedKeys, numericFields] of [
        ['limitAxes', USD_JOINT_LIMIT_KEYS, ['low', 'high']],
        [
          'driveAxes',
          USD_JOINT_DRIVE_KEYS,
          ['stiffness', 'damping', 'maxForce', 'targetPosition', 'targetVelocity'],
        ],
      ] as const) {
        const axes = usdPhysics[field];
        if (axes === undefined) continue;
        if (!isRecord(axes)) {
          addIssue(issues, `${usdPhysicsPath}.${field}`, 'must be an axis map');
          continue;
        }
        Object.entries(axes).forEach(([axis, axisValue]) => {
          const axisPath = `${usdPhysicsPath}.${field}.${axis}`;
          if (!isRecord(axisValue)) {
            addIssue(issues, axisPath, 'must be an axis settings object');
            return;
          }
          validateAllowedKeys(axisValue, allowedKeys, axisPath, issues);
          numericFields.forEach((numericField) => {
            const value = axisValue[numericField];
            if (value !== undefined && value !== null) {
              validateFiniteNumber(value, `${axisPath}.${numericField}`, issues);
            }
          });
          if (
            field === 'driveAxes'
            && axisValue.type !== undefined
            && axisValue.type !== null
            && typeof axisValue.type !== 'string'
          ) {
            addIssue(issues, `${axisPath}.type`, 'must be a string or null');
          }
        });
      }
    }
  }

  if (joint.limit !== undefined) {
    if (!isRecord(joint.limit)) {
      addIssue(issues, `${path}.limit`, 'must be a joint limit object');
    } else {
      for (const field of ['lower', 'upper', 'effort', 'velocity']) {
        if (joint.limit[field] !== undefined) {
          validateFiniteNumber(joint.limit[field], `${path}.limit.${field}`, issues);
        }
      }
    }
  }

  if (!isRecord(joint.dynamics)) {
    addIssue(issues, `${path}.dynamics`, 'must be a joint dynamics object');
  } else {
    validateFiniteNumber(joint.dynamics.damping, `${path}.dynamics.damping`, issues);
    validateFiniteNumber(joint.dynamics.friction, `${path}.dynamics.friction`, issues);
    if (joint.dynamics.stiffness !== undefined) {
      validateFiniteNumber(joint.dynamics.stiffness, `${path}.dynamics.stiffness`, issues);
    }
  }

  if (!isRecord(joint.hardware)) {
    addIssue(issues, `${path}.hardware`, 'must be a joint hardware object');
  } else {
    validateFiniteNumber(joint.hardware.armature, `${path}.hardware.armature`, issues);
    if (typeof joint.hardware.motorType !== 'string') {
      addIssue(issues, `${path}.hardware.motorType`, 'must be a string');
    }
    if (typeof joint.hardware.motorId !== 'string') {
      addIssue(issues, `${path}.hardware.motorId`, 'must be a string');
    }
    if (joint.hardware.brand !== undefined && typeof joint.hardware.brand !== 'string') {
      addIssue(issues, `${path}.hardware.brand`, 'must be a string when provided');
    }
    if (joint.hardware.motorDirection !== 1 && joint.hardware.motorDirection !== -1) {
      addIssue(issues, `${path}.hardware.motorDirection`, 'must be 1 or -1');
    }
    if (
      joint.hardware.hardwareInterface !== undefined
      && (
        typeof joint.hardware.hardwareInterface !== 'string'
        || !HARDWARE_INTERFACES.has(joint.hardware.hardwareInterface)
      )
    ) {
      addIssue(
        issues,
        `${path}.hardware.hardwareInterface`,
        'must be effort, position, or velocity',
      );
    }
  }

  if (joint.angle !== undefined) validateFiniteNumber(joint.angle, `${path}.angle`, issues);
  if (joint.quaternion !== undefined) {
    validateQuaternion(joint.quaternion, `${path}.quaternion`, issues);
  }
  if (joint.referencePosition !== undefined) {
    validateFiniteNumber(joint.referencePosition, `${path}.referencePosition`, issues);
  }
  if (joint.mimic !== undefined) {
    if (!isRecord(joint.mimic)) {
      addIssue(issues, `${path}.mimic`, 'must be a joint mimic object');
    } else {
      validateNonEmptyString(joint.mimic.joint, `${path}.mimic.joint`, issues);
      if (joint.mimic.multiplier !== undefined) {
        validateFiniteNumber(joint.mimic.multiplier, `${path}.mimic.multiplier`, issues);
      }
      if (joint.mimic.offset !== undefined) {
        validateFiniteNumber(joint.mimic.offset, `${path}.mimic.offset`, issues);
      }
    }
  }
  for (const [field, allowedFields] of [
    ['calibration', new Set(['referencePosition', 'rising', 'falling'])],
    ['safetyController', new Set(['softLowerLimit', 'softUpperLimit', 'kPosition', 'kVelocity'])],
  ] as const) {
    const value = joint[field];
    if (value === undefined) continue;
    if (!isRecord(value)) {
      addIssue(issues, `${path}.${field}`, `must be a joint ${field} object`);
      continue;
    }
    validateAllowedKeys(value, allowedFields, `${path}.${field}`, issues);
    Object.entries(value).forEach(([key, nestedValue]) =>
      validateFiniteNumber(nestedValue, `${path}.${field}.${key}`, issues));
  }
}

function validateRobotJoints(
  jointsValue: unknown,
  links: Record<string, Record<string, unknown>> | null,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): Record<string, Record<string, unknown>> | null {
  if (!isRecord(jointsValue)) {
    addIssue(issues, path, 'must be a joint map');
    return null;
  }

  const joints = createLookup<Record<string, unknown>>();
  for (const [jointKey, jointValue] of Object.entries(jointsValue)) {
    const jointPath = `${path}.${jointKey}`;
    validateMapKey(jointKey, `${jointPath}.id`, issues);
    if (!isRecord(jointValue)) {
      addIssue(issues, jointPath, 'must be a joint object');
      continue;
    }
    if (jointValue.id !== jointKey) {
      addIssue(issues, `${jointPath}.id`, `must equal map key "${jointKey}"`);
    }
    validateNonEmptyString(jointValue.name, `${jointPath}.name`, issues);
    validateJointFields(jointValue, jointPath, issues);

    for (const endpoint of ['parentLinkId', 'childLinkId'] as const) {
      const linkId = jointValue[endpoint];
      if (typeof linkId !== 'string' || !links?.[linkId]) {
        addIssue(
          issues,
          `${jointPath}.${endpoint}`,
          `references missing source-local link "${String(linkId)}"`,
        );
      }
    }
    if (
      typeof jointValue.parentLinkId === 'string' &&
      jointValue.parentLinkId === jointValue.childLinkId
    ) {
      addIssue(issues, `${jointPath}.childLinkId`, 'must differ from parentLinkId');
    }
    joints[jointKey] = jointValue;
  }

  for (const [jointKey, joint] of Object.entries(joints)) {
    if (!isRecord(joint.mimic)) {
      continue;
    }
    const targetJointId = joint.mimic.joint;
    if (typeof targetJointId !== 'string' || !joints[targetJointId]) {
      addIssue(
        issues,
        `${path}.${jointKey}.mimic.joint`,
        `references missing source-local joint "${String(targetJointId)}"`,
      );
    }
  }

  const incomingJointByChild = new Map<string, string>();
  const outgoingJoints = new Map<string, Array<{ childLinkId: string; jointId: string }>>();
  for (const [jointId, joint] of Object.entries(joints)) {
    const parentLinkId = joint.parentLinkId;
    const childLinkId = joint.childLinkId;
    if (
      typeof parentLinkId !== 'string'
      || typeof childLinkId !== 'string'
      || !links?.[parentLinkId]
      || !links[childLinkId]
    ) {
      continue;
    }
    const existingParentJoint = incomingJointByChild.get(childLinkId);
    if (existingParentJoint) {
      addIssue(
        issues,
        `${path}.${jointId}.childLinkId`,
        `duplicates parent joint "${existingParentJoint}" for link "${childLinkId}"`,
      );
    } else {
      incomingJointByChild.set(childLinkId, jointId);
    }
    const outgoing = outgoingJoints.get(parentLinkId) ?? [];
    outgoing.push({ childLinkId, jointId });
    outgoingJoints.set(parentLinkId, outgoing);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (linkId: string): void => {
    if (visited.has(linkId)) return;
    visiting.add(linkId);
    for (const edge of outgoingJoints.get(linkId) ?? []) {
      if (visiting.has(edge.childLinkId)) {
        addIssue(
          issues,
          `${path}.${edge.jointId}.childLinkId`,
          `creates a cyclic joint graph through link "${edge.childLinkId}"`,
        );
        continue;
      }
      visit(edge.childLinkId);
    }
    visiting.delete(linkId);
    visited.add(linkId);
  };
  Object.keys(links ?? {}).forEach(visit);
  return joints;
}

interface ReferenceAliases {
  targetsByAlias: Map<string, Set<string>>;
}

function createReferenceAliases(): ReferenceAliases {
  return { targetsByAlias: new Map() };
}

function addReferenceAlias(
  aliases: ReferenceAliases,
  alias: unknown,
  target: string,
): void {
  if (typeof alias !== 'string' || !alias.trim()) return;
  const targets = aliases.targetsByAlias.get(alias) ?? new Set<string>();
  targets.add(target);
  aliases.targetsByAlias.set(alias, targets);
}

function hasUniqueReference(aliases: ReferenceAliases, value: unknown): value is string {
  return typeof value === 'string' && aliases.targetsByAlias.get(value)?.size === 1;
}

function collectRobotReferenceAliases(
  links: Record<string, Record<string, unknown>> | null,
  joints: Record<string, Record<string, unknown>> | null,
): {
  links: ReferenceAliases;
  joints: ReferenceAliases;
  sites: ReferenceAliases;
} {
  const linkAliases = createReferenceAliases();
  const jointAliases = createReferenceAliases();
  const siteAliases = createReferenceAliases();

  Object.entries(links ?? {}).forEach(([linkId, link]) => {
    addReferenceAlias(linkAliases, linkId, linkId);
    addReferenceAlias(linkAliases, link.id, linkId);
    addReferenceAlias(linkAliases, link.name, linkId);
    if (Array.isArray(link.mjcfSites)) {
      link.mjcfSites.forEach((site, index) => {
        if (!isRecord(site)) return;
        const target = `${linkId}:site:${index}`;
        addReferenceAlias(siteAliases, site.name, target);
        addReferenceAlias(siteAliases, site.sourceName, target);
      });
    }
  });
  Object.entries(joints ?? {}).forEach(([jointId, joint]) => {
    addReferenceAlias(jointAliases, jointId, jointId);
    addReferenceAlias(jointAliases, joint.id, jointId);
    addReferenceAlias(jointAliases, joint.name, jointId);
  });

  return {
    links: linkAliases,
    joints: jointAliases,
    sites: siteAliases,
  };
}

function validateReference({
  aliases,
  value,
  path,
  referenceType,
  issues,
}: {
  aliases: ReferenceAliases;
  value: unknown;
  path: string;
  referenceType: string;
  issues: CanonicalWorkspaceValidationIssue[];
}): void {
  if (!hasUniqueReference(aliases, value)) {
    addIssue(
      issues,
      path,
      `references a missing or ambiguous source-local ${referenceType} "${String(value)}"`,
    );
  }
}

function validateImportRecovery(
  recovery: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (recovery === undefined) return;
  if (!isRecord(recovery)) {
    addIssue(issues, path, 'must be an import recovery report');
    return;
  }
  validateAllowedKeys(recovery, IMPORT_RECOVERY_KEYS, path, issues);
  validateFiniteNumber(recovery.recoveredItemCount, `${path}.recoveredItemCount`, issues);
  if (recovery.omittedDiagnosticCount !== undefined) {
    validateFiniteNumber(
      recovery.omittedDiagnosticCount,
      `${path}.omittedDiagnosticCount`,
      issues,
    );
  }
  if (!isRecord(recovery.diagnosticCounts)) {
    addIssue(issues, `${path}.diagnosticCounts`, 'must be a diagnostic count object');
  } else {
    const diagnosticCounts = recovery.diagnosticCounts;
    validateAllowedKeys(
      diagnosticCounts,
      DIAGNOSTIC_SEVERITIES,
      `${path}.diagnosticCounts`,
      issues,
    );
    DIAGNOSTIC_SEVERITIES.forEach((severity) =>
      validateFiniteNumber(
        diagnosticCounts[severity],
        `${path}.diagnosticCounts.${severity}`,
        issues,
      ));
  }
  if (!Array.isArray(recovery.diagnostics)) {
    addIssue(issues, `${path}.diagnostics`, 'must be an array');
    return;
  }
  recovery.diagnostics.forEach((diagnostic, index) => {
    const diagnosticPath = `${path}.diagnostics.${index}`;
    if (!isRecord(diagnostic)) {
      addIssue(issues, diagnosticPath, 'must be an import recovery diagnostic');
      return;
    }
    validateAllowedKeys(
      diagnostic,
      IMPORT_RECOVERY_DIAGNOSTIC_KEYS,
      diagnosticPath,
      issues,
    );
    for (const field of ['code', 'message'] as const) {
      validateNonEmptyString(diagnostic[field], `${diagnosticPath}.${field}`, issues);
    }
    if (
      typeof diagnostic.severity !== 'string'
      || !DIAGNOSTIC_SEVERITIES.has(diagnostic.severity)
    ) {
      addIssue(issues, `${diagnosticPath}.severity`, 'must be info, warning, or error');
    }
    if (
      typeof diagnostic.category !== 'string'
      || !DIAGNOSTIC_CATEGORIES.has(diagnostic.category)
    ) {
      addIssue(issues, `${diagnosticPath}.category`, 'must be a diagnostic category');
    }
    if (
      typeof diagnostic.action !== 'string'
      || !IMPORT_RECOVERY_ACTIONS.has(diagnostic.action)
    ) {
      addIssue(
        issues,
        `${diagnosticPath}.action`,
        'must be omitted, defaulted, or downgraded',
      );
    }
    if (diagnostic.relatedIds !== undefined) {
      validateStringArray(diagnostic.relatedIds, `${diagnosticPath}.relatedIds`, issues);
    }
    if (diagnostic.source !== undefined) {
      if (!isRecord(diagnostic.source)) {
        addIssue(issues, `${diagnosticPath}.source`, 'must be a diagnostic source object');
      } else {
        const source = diagnostic.source;
        validateAllowedKeys(
          source,
          IMPORT_RECOVERY_DIAGNOSTIC_SOURCE_KEYS,
          `${diagnosticPath}.source`,
          issues,
        );
        IMPORT_RECOVERY_DIAGNOSTIC_SOURCE_KEYS.forEach((field) => {
          if (source[field] !== undefined) {
            validateNonEmptyString(
              source[field],
              `${diagnosticPath}.source.${field}`,
              issues,
            );
          }
        });
      }
    }
  });
}


function validateTendonIdentities({
  inspectionContext,
  links,
  joints,
  path,
  issues,
}: {
  inspectionContext: unknown;
  links: Record<string, Record<string, unknown>> | null;
  joints: Record<string, Record<string, unknown>> | null;
  path: string;
  issues: CanonicalWorkspaceValidationIssue[];
}): void {
  if (inspectionContext === undefined) return;
  if (!isRecord(inspectionContext)) {
    addIssue(issues, path, 'must be an inspection context object');
    return;
  }
  validateAllowedKeys(inspectionContext, INSPECTION_CONTEXT_KEYS, path, issues);
  if (
    typeof inspectionContext.sourceFormat !== 'string'
    || !ROBOT_SOURCE_FORMATS.has(inspectionContext.sourceFormat)
  ) {
    addIssue(issues, `${path}.sourceFormat`, 'must be a supported source format');
  }
  validateCanonicalUrdfInspection(inspectionContext.urdf, `${path}.urdf`, issues);
  validateImportRecovery(inspectionContext.recovery, `${path}.recovery`, issues);
  const mjcf = inspectionContext.mjcf;
  if (mjcf === undefined) return;
  if (!isRecord(mjcf)) {
    addIssue(issues, `${path}.mjcf`, 'must be an MJCF inspection object');
    return;
  }
  validateAllowedKeys(mjcf, MJCF_INSPECTION_KEYS, `${path}.mjcf`, issues);
  validateFiniteNumber(mjcf.siteCount, `${path}.mjcf.siteCount`, issues);
  validateFiniteNumber(mjcf.tendonCount, `${path}.mjcf.tendonCount`, issues);
  validateFiniteNumber(
    mjcf.tendonActuatorCount,
    `${path}.mjcf.tendonActuatorCount`,
    issues,
  );
  const aliases = collectRobotReferenceAliases(links, joints);
  let derivedSiteCount = 0;
  if (!Array.isArray(mjcf.bodiesWithSites)) {
    addIssue(issues, `${path}.mjcf.bodiesWithSites`, 'must be an array');
  } else {
    mjcf.bodiesWithSites.forEach((body, index) => {
      const bodyPath = `${path}.mjcf.bodiesWithSites.${index}`;
      if (!isRecord(body)) {
        addIssue(issues, bodyPath, 'must be an MJCF body-site summary');
        return;
      }
      validateAllowedKeys(body, MJCF_BODY_SITE_KEYS, bodyPath, issues);
      if (validateNonEmptyString(body.bodyId, `${bodyPath}.bodyId`, issues)) {
        validateReference({
          aliases: aliases.links,
          value: body.bodyId,
          path: `${bodyPath}.bodyId`,
          referenceType: 'link',
          issues,
        });
      }
      validateFiniteNumber(body.siteCount, `${bodyPath}.siteCount`, issues);
      if (!Array.isArray(body.siteNames)) {
        addIssue(issues, `${bodyPath}.siteNames`, 'must be an array');
      } else {
        if (body.siteCount !== body.siteNames.length) {
          addIssue(issues, `${bodyPath}.siteCount`, 'must equal siteNames.length');
        }
        derivedSiteCount += body.siteNames.length;
        body.siteNames.forEach((name, nameIndex) => {
          const sitePath = `${bodyPath}.siteNames.${nameIndex}`;
          if (validateNonEmptyString(name, sitePath, issues)) {
            validateReference({
              aliases: aliases.sites,
              value: name,
              path: sitePath,
              referenceType: 'MJCF site',
              issues,
            });
          }
        });
      }
    });
  }
  if (typeof mjcf.siteCount === 'number' && mjcf.siteCount !== derivedSiteCount) {
    addIssue(issues, `${path}.mjcf.siteCount`, 'must equal the body-site summary count');
  }
  if (!Array.isArray(mjcf.tendons)) {
    addIssue(issues, `${path}.mjcf.tendons`, 'must be an array');
    return;
  }

  const tendonIds = new Set<string>();
  const actuatorIds = new Set<string>();
  mjcf.tendons.forEach((tendon, index) => {
    const tendonPath = `${path}.mjcf.tendons.${index}`;
    if (!isRecord(tendon)) {
      addIssue(issues, tendonPath, 'must be a tendon');
      return;
    }
    validateAllowedKeys(tendon, MJCF_TENDON_KEYS, tendonPath, issues);
    if (!validateNonEmptyString(tendon.name, `${tendonPath}.name`, issues)) {
      return;
    }
    if (tendonIds.has(tendon.name)) {
      addIssue(issues, `${tendonPath}.name`, `duplicates tendon id "${tendon.name}"`);
    }
    tendonIds.add(tendon.name);
    if (tendon.type !== 'fixed' && tendon.type !== 'spatial') {
      addIssue(issues, `${tendonPath}.type`, 'must be fixed or spatial');
    }
    if (tendon.className !== undefined) {
      validateNonEmptyString(tendon.className, `${tendonPath}.className`, issues);
    }
    if (tendon.group !== undefined) {
      validateFiniteNumber(tendon.group, `${tendonPath}.group`, issues);
    }
    if (tendon.limited !== undefined && typeof tendon.limited !== 'boolean') {
      addIssue(issues, `${tendonPath}.limited`, 'must be a boolean when provided');
    }
    if (tendon.range !== undefined) {
      validateFiniteNumberArray(tendon.range, `${tendonPath}.range`, issues, 2);
    }
    for (const field of ['width', 'stiffness', 'springlength'] as const) {
      if (tendon[field] !== undefined) {
        validateFiniteNumber(tendon[field], `${tendonPath}.${field}`, issues);
      }
    }
    if (tendon.rgba !== undefined) {
      validateFiniteNumberArray(tendon.rgba, `${tendonPath}.rgba`, issues, 4);
    }

    const attachmentRefs = tendon.attachmentRefs;
    const attachmentRefsValid = validateStringArray(
      attachmentRefs,
      `${tendonPath}.attachmentRefs`,
      issues,
    );
    if (!Array.isArray(tendon.attachments) || tendon.attachments.length === 0) {
      addIssue(issues, `${tendonPath}.attachments`, 'must be a non-empty array');
    } else {
      const derivedAttachmentRefs: string[] = [];
      tendon.attachments.forEach((attachment, attachmentIndex) => {
        const attachmentPath = `${tendonPath}.attachments.${attachmentIndex}`;
        if (!isRecord(attachment)) {
          addIssue(issues, attachmentPath, 'must be a tendon attachment object');
          return;
        }
        validateAllowedKeys(
          attachment,
          MJCF_TENDON_ATTACHMENT_KEYS,
          attachmentPath,
          issues,
        );
        if (
          attachment.type !== 'site'
          && attachment.type !== 'geom'
          && attachment.type !== 'joint'
          && attachment.type !== 'pulley'
        ) {
          addIssue(issues, `${attachmentPath}.type`, 'must be site, geom, joint, or pulley');
        }
        if (attachment.ref !== undefined) {
          validateNonEmptyString(attachment.ref, `${attachmentPath}.ref`, issues);
        }
        if (attachment.sidesite !== undefined) {
          validateNonEmptyString(
            attachment.sidesite,
            `${attachmentPath}.sidesite`,
            issues,
          );
        }
        if (attachment.divisor !== undefined) {
          validateFiniteNumber(attachment.divisor, `${attachmentPath}.divisor`, issues);
        }
        if (attachment.coef !== undefined) {
          validateFiniteNumber(attachment.coef, `${attachmentPath}.coef`, issues);
        }

        if (attachment.type === 'pulley') {
          if (attachment.divisor === undefined) {
            addIssue(issues, `${attachmentPath}.divisor`, 'is required for a pulley');
          }
        } else if (validateNonEmptyString(
          attachment.ref,
          `${attachmentPath}.ref`,
          issues,
        )) {
          // MJCF spatial tendons may reference helper sites/geoms that are kept
          // only in source inspection metadata and are not projected into the
          // canonical render graph. Joint attachments, however, point at the
          // canonical articulation and must still resolve.
          if (attachment.type === 'joint') {
            validateReference({
              aliases: aliases.joints,
              value: attachment.ref,
              path: `${attachmentPath}.ref`,
              referenceType: 'joint attachment',
              issues,
            });
          }
        }
        const attachmentRef = typeof attachment.ref === 'string'
          ? attachment.ref
          : typeof attachment.sidesite === 'string'
            ? attachment.sidesite
            : null;
        if (attachmentRef) derivedAttachmentRefs.push(attachmentRef);
      });
      if (
        attachmentRefsValid
        && (
          attachmentRefs.length !== derivedAttachmentRefs.length
          || attachmentRefs.some(
            (reference, referenceIndex) => reference !== derivedAttachmentRefs[referenceIndex],
          )
        )
      ) {
        addIssue(
          issues,
          `${tendonPath}.attachmentRefs`,
          'must exactly mirror attachments ref/sidesite order',
        );
      }
    }

    if (validateStringArray(tendon.actuatorNames, `${tendonPath}.actuatorNames`, issues)) {
      tendon.actuatorNames.forEach((actuatorName, actuatorIndex) => {
        if (actuatorIds.has(actuatorName)) {
          addIssue(
            issues,
            `${tendonPath}.actuatorNames.${actuatorIndex}`,
            `duplicates actuator name "${actuatorName}"`,
          );
        }
        actuatorIds.add(actuatorName);
      });
    }
  });
  if (typeof mjcf.tendonCount === 'number' && mjcf.tendonCount !== mjcf.tendons.length) {
    addIssue(issues, `${path}.mjcf.tendonCount`, 'must equal tendons.length');
  }
  if (
    typeof mjcf.tendonActuatorCount === 'number'
    && mjcf.tendonActuatorCount !== actuatorIds.size
  ) {
    addIssue(
      issues,
      `${path}.mjcf.tendonActuatorCount`,
      'must equal the unique actuatorNames count',
    );
  }
}

interface ValidatedRobot {
  links: Record<string, Record<string, unknown>> | null;
  joints: Record<string, Record<string, unknown>> | null;
}

function validateRobot(
  value: unknown,
  path: string,
  issues: CanonicalWorkspaceValidationIssue[],
): ValidatedRobot {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be RobotData');
    return { links: null, joints: null };
  }

  validateAllowedKeys(value, ROBOT_DATA_KEYS, path, issues);
  validateNonEmptyString(value.name, `${path}.name`, issues);
  if (value.version !== undefined && typeof value.version !== 'string') {
    addIssue(issues, `${path}.version`, 'must be a string');
  }
  const links = validateRobotLinks(value.links, `${path}.links`, issues);
  const joints = validateRobotJoints(value.joints, links, `${path}.joints`, issues);
  validateCanonicalRobotMaterials(value.materials, `${path}.materials`, issues);
  const rootLinkIdValid = validateNonEmptyString(
    value.rootLinkId,
    `${path}.rootLinkId`,
    issues,
  );
  if (rootLinkIdValid && !links?.[value.rootLinkId as string]) {
    addIssue(
      issues,
      `${path}.rootLinkId`,
      `references missing source-local link "${value.rootLinkId}"`,
    );
  }
  validateCanonicalClosedLoopConstraints({
    value: value.closedLoopConstraints,
    links,
    path: `${path}.closedLoopConstraints`,
    issues,
  });
  validateTendonIdentities({
    inspectionContext: value.inspectionContext,
    links,
    joints,
    path: `${path}.inspectionContext`,
    issues,
  });
  return { links, joints };
}

/** Validate standalone parser/renderer RobotData at external cache boundaries. */
export function validateCanonicalRobotData(
  value: unknown,
  path = 'robotData',
): CanonicalWorkspaceValidationResult {
  const issues: CanonicalWorkspaceValidationIssue[] = [];
  validateRobot(value, path, issues);
  return { valid: issues.length === 0, issues };
}

/** Fail fast when a standalone RobotData sidecar is malformed. */
export function assertCanonicalRobotData(
  value: unknown,
  path = 'robotData',
): asserts value is RobotData {
  const result = validateCanonicalRobotData(value, path);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new Error(`Invalid canonical RobotData: ${detail}`);
  }
}

interface ValidatedComponent {
  robot: ValidatedRobot;
}

function validateComponents(
  value: unknown,
  issues: CanonicalWorkspaceValidationIssue[],
): Record<string, ValidatedComponent> {
  if (!isRecord(value)) {
    addIssue(issues, 'components', 'must be a component map');
    return {};
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    addIssue(issues, 'components', 'must contain at least one component');
  }

  const components = createLookup<ValidatedComponent>();
  for (const [componentKey, componentValue] of entries) {
    const path = `components.${componentKey}`;
    validateMapKey(componentKey, `${path}.id`, issues);
    if (!isRecord(componentValue)) {
      addIssue(issues, path, 'must be a component object');
      continue;
    }
    validateAllowedKeys(componentValue, COMPONENT_KEYS, path, issues);
    if (componentValue.id !== componentKey) {
      addIssue(issues, `${path}.id`, `must equal map key "${componentKey}"`);
    }
    validateNonEmptyString(componentValue.name, `${path}.name`, issues);
    if (componentValue.sourceFile !== null) {
      validateNonEmptyString(componentValue.sourceFile, `${path}.sourceFile`, issues);
    }
    if (typeof componentValue.visible !== 'boolean') {
      addIssue(issues, `${path}.visible`, 'must be a boolean');
    }
    if (
      componentValue.editorLocked !== undefined &&
      typeof componentValue.editorLocked !== 'boolean'
    ) {
      addIssue(
        issues,
        `${path}.editorLocked`,
        'must be a boolean when provided',
      );
    }
    validateTransform(componentValue.transform, `${path}.transform`, issues);
    if (componentValue.renderableBounds !== undefined) {
      validateRenderableBounds(
        componentValue.renderableBounds,
        `${path}.renderableBounds`,
        issues,
      );
    }
    const robot = validateRobot(componentValue.robot, `${path}.robot`, issues);
    components[componentKey] = { robot };
  }
  return components;
}

function validateBridgeEndpoint({
  bridge,
  bridgePath,
  role,
  components,
  issues,
}: {
  bridge: Record<string, unknown>;
  bridgePath: string;
  role: 'parent' | 'child';
  components: Record<string, ValidatedComponent>;
  issues: CanonicalWorkspaceValidationIssue[];
}): void {
  const componentField = `${role}ComponentId`;
  const linkField = `${role}LinkId`;
  const componentId = bridge[componentField];
  const linkId = bridge[linkField];
  const component = typeof componentId === 'string' ? components[componentId] : undefined;

  if (!component) {
    addIssue(
      issues,
      `${bridgePath}.${componentField}`,
      `references missing component "${String(componentId)}"`,
    );
    return;
  }
  if (typeof linkId !== 'string' || !component.robot.links?.[linkId]) {
    addIssue(
      issues,
      `${bridgePath}.${linkField}`,
      `references missing source-local link "${String(linkId)}" on component "${componentId}"`,
    );
  }
}

function validateBridgeJoint(
  bridge: Record<string, unknown>,
  bridgePath: string,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  const joint = bridge.joint;
  if (!isRecord(joint)) {
    addIssue(issues, `${bridgePath}.joint`, 'must be a joint object');
    return;
  }

  validateNonEmptyString(joint.id, `${bridgePath}.joint.id`, issues);
  if (joint.id !== bridge.id) {
    addIssue(
      issues,
      `${bridgePath}.joint.id`,
      'must equal the bridge id',
    );
  }
  validateNonEmptyString(joint.name, `${bridgePath}.joint.name`, issues);
  validateJointFields(joint, `${bridgePath}.joint`, issues);
  if (joint.parentLinkId !== bridge.parentLinkId) {
    addIssue(
      issues,
      `${bridgePath}.joint.parentLinkId`,
      'must equal the bridge parentLinkId',
    );
  }
  if (joint.childLinkId !== bridge.childLinkId) {
    addIssue(
      issues,
      `${bridgePath}.joint.childLinkId`,
      'must equal the bridge childLinkId',
    );
  }
}

function validateBridges(
  value: unknown,
  components: Record<string, ValidatedComponent>,
  issues: CanonicalWorkspaceValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'bridges', 'must be a bridge map');
    return;
  }

  const acceptedTopologyBridges: Array<{
    id: string;
    parentComponentId: string;
    childComponentId: string;
  }> = [];
  const incomingBridgeByChildComponentId = new Map<string, string>();

  for (const [bridgeKey, bridgeValue] of Object.entries(value)) {
    const bridgePath = `bridges.${bridgeKey}`;
    validateMapKey(bridgeKey, `${bridgePath}.id`, issues);
    if (!isRecord(bridgeValue)) {
      addIssue(issues, bridgePath, 'must be a bridge object');
      continue;
    }
    validateAllowedKeys(bridgeValue, BRIDGE_KEYS, bridgePath, issues);
    if (bridgeValue.id !== bridgeKey) {
      addIssue(issues, `${bridgePath}.id`, `must equal map key "${bridgeKey}"`);
    }
    validateNonEmptyString(bridgeValue.name, `${bridgePath}.name`, issues);
    validateBridgeEndpoint({
      bridge: bridgeValue,
      bridgePath,
      role: 'parent',
      components,
      issues,
    });
    validateBridgeEndpoint({
      bridge: bridgeValue,
      bridgePath,
      role: 'child',
      components,
      issues,
    });
    validateBridgeJoint(bridgeValue, bridgePath, issues);

    const parentComponentId = bridgeValue.parentComponentId;
    const childComponentId = bridgeValue.childComponentId;
    const joint = bridgeValue.joint;
    if (
      typeof parentComponentId !== 'string'
      || typeof childComponentId !== 'string'
      || !isRecord(joint)
      || typeof joint.type !== 'string'
      || !JOINT_TYPES.has(joint.type)
    ) {
      continue;
    }
    if (parentComponentId === childComponentId) {
      addIssue(
        issues,
        `${bridgePath}.childComponentId`,
        'must differ from parentComponentId',
      );
      continue;
    }
    const existingIncomingBridge = incomingBridgeByChildComponentId.get(childComponentId);
    if (existingIncomingBridge) {
      addIssue(
        issues,
        `${bridgePath}.childComponentId`,
        `duplicates incoming bridge "${existingIncomingBridge}" for component "${childComponentId}"`,
      );
      continue;
    }
    const topologyBridge = {
      id: bridgeKey,
      parentComponentId,
      childComponentId,
    };
    if (
      wouldBridgeCreateUnsupportedAssemblyCycle(
        acceptedTopologyBridges,
        topologyBridge,
        joint.type as JointType,
      )
    ) {
      addIssue(
        issues,
        `${bridgePath}.joint.type`,
        'creates an unsupported non-fixed component cycle',
      );
      continue;
    }
    acceptedTopologyBridges.push(topologyBridge);
    incomingBridgeByChildComponentId.set(childComponentId, bridgeKey);
  }
}

/** Return all canonical workspace invariant violations without mutating the input. */
export function validateCanonicalWorkspace(
  value: unknown,
): CanonicalWorkspaceValidationResult {
  const issues: CanonicalWorkspaceValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: 'workspace', message: 'must be an object' }],
    };
  }

  validateAllowedKeys(value, WORKSPACE_KEYS, '', issues);
  validateNonEmptyString(value.name, 'name', issues);
  validateTransform(value.transform, 'transform', issues);
  const components = validateComponents(value.components, issues);
  validateBridges(value.bridges, components, issues);

  return { valid: issues.length === 0, issues };
}

/** Fail fast when data crossing a project/import boundary is not canonical. */
export function assertCanonicalWorkspace(
  value: unknown,
): asserts value is CanonicalAssemblyState {
  const result = validateCanonicalWorkspace(value);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new Error(`Invalid canonical workspace: ${detail}`);
  }
}
