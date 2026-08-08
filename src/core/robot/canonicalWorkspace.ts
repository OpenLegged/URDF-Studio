import {
  type AssemblyComponent,
  type AssemblyState,
  type AssemblyTransform,
  type RobotData,
} from '@/types';

import { IDENTITY_ASSEMBLY_TRANSFORM } from './assemblyTransformUtils';
import { normalizeComponentRobot } from './assemblyComponentPreparation';
import { createAttachedChildLink } from './builders';
import {
  validateCanonicalClosedLoopConstraints,
  validateCanonicalRobotMaterials,
} from './canonicalRobotValidation';
import { DEFAULT_ROBOT_NAME } from './constants';
import {
  DEFAULT_COMPONENT_ID,
  DEFAULT_ROOT_LINK_ID,
  WORKSPACE_KEYS,
  COMPONENT_KEYS,
  ROBOT_DATA_KEYS,
  isRecord,
  createLookup,
  addIssue,
  validateAllowedKeys,
  validateNonEmptyString,
  validateTransform,
  validateRenderableBounds,
  validateMapKey,
  validateRobotLinks,
  validateRobotJoints,
  validateTendonIdentities,
  ValidatedRobot,
  ValidatedComponent,
  validateBridges,
  type CanonicalWorkspaceValidationIssue,
  type CanonicalWorkspaceValidationResult,
} from './canonicalWorkspaceHelpers';

export type {
  CanonicalWorkspaceValidationIssue,
  CanonicalWorkspaceValidationResult,
} from './canonicalWorkspaceHelpers';

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
export function createDefaultWorkspace(name: string = DEFAULT_ROBOT_NAME): CanonicalAssemblyState {
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
  const rootLinkIdValid = validateNonEmptyString(value.rootLinkId, `${path}.rootLinkId`, issues);
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
      addIssue(issues, `${path}.editorLocked`, 'must be a boolean when provided');
    }
    validateTransform(componentValue.transform, `${path}.transform`, issues);
    if (componentValue.renderableBounds !== undefined) {
      validateRenderableBounds(componentValue.renderableBounds, `${path}.renderableBounds`, issues);
    }
    const robot = validateRobot(componentValue.robot, `${path}.robot`, issues);
    components[componentKey] = { robot };
  }
  return components;
}

/** Return all canonical workspace invariant violations without mutating the input. */
export function validateCanonicalWorkspace(value: unknown): CanonicalWorkspaceValidationResult {
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
export function assertCanonicalWorkspace(value: unknown): asserts value is CanonicalAssemblyState {
  const result = validateCanonicalWorkspace(value);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new Error(`Invalid canonical workspace: ${detail}`);
  }
}
