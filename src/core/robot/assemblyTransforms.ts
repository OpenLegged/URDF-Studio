import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType } from '@/types';
import type { AssemblyState, AssemblyTransform, RobotData, UrdfJoint, UrdfLink } from '@/types';
import { createAssemblySceneProjection } from './assemblySceneProjection';
import { createAssemblyScenePlacement } from './assemblyScenePlacement';

import { cloneAssemblyTransform, isIdentityAssemblyTransform } from './assemblyTransformUtils';

export { cloneAssemblyTransform, isIdentityAssemblyTransform } from './assemblyTransformUtils';
export { IDENTITY_ASSEMBLY_TRANSFORM } from './assemblyTransformUtils';

export const ASSEMBLY_EXPORT_ROOT_LINK_ID = '__assembly_root';
const ASSEMBLY_EXPORT_ROOT_JOINT_PREFIX = '__assembly_root_joint_';
const ASSEMBLY_COMPONENT_ROOT_LINK_PREFIX = '__assembly_component_root_';
const ASSEMBLY_COMPONENT_ROOT_JOINT_PREFIX = '__assembly_component_joint_';

function allocateSyntheticEntityId(
  usedIds: Set<string>,
  preferredId: string,
  kind: 'link' | 'joint',
): string {
  let candidate = preferredId;
  let suffix = 1;
  while (usedIds.has(candidate)) {
    candidate = `${preferredId}__${kind}${suffix === 1 ? '' : `_${suffix}`}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

export function isAssemblyComponentIndividuallyTransformable(
  assemblyState: AssemblyState | null | undefined,
  componentId: string,
): boolean {
  if (!assemblyState?.components[componentId]) {
    return false;
  }

  return !Object.values(assemblyState.bridges).some(
    (bridge) => bridge.parentComponentId !== bridge.childComponentId &&
      (bridge.parentComponentId === componentId || bridge.childComponentId === componentId),
  );
}

function createSyntheticTransformLink(id: string, name: string): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
      inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    },
  };
}

function createFixedTransformJoint(
  id: string,
  name: string,
  parentLinkId: string,
  childLinkId: string,
  transform: AssemblyTransform,
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId,
    origin: {
      xyz: { ...transform.position },
      rpy: { ...transform.rotation },
    },
    axis: undefined,
    limit: undefined,
    dynamics: { damping: 0, friction: 0 },
  };
}

function cloneVisibleAssemblyState(assemblyState: AssemblyState): AssemblyState {
  const clonedAssembly = structuredClone(assemblyState);
  const visibleComponents = Object.fromEntries(
    Object.entries(clonedAssembly.components).filter(
      ([, component]) => component.visible !== false,
    ),
  );
  const visibleComponentIds = new Set(Object.keys(visibleComponents));
  const visibleBridges = Object.fromEntries(
    Object.entries(clonedAssembly.bridges).filter(
      ([, bridge]) =>
        visibleComponentIds.has(bridge.parentComponentId) &&
        visibleComponentIds.has(bridge.childComponentId),
    ),
  );

  return {
    ...clonedAssembly,
    components: visibleComponents,
    bridges: visibleBridges,
  };
}

function buildSingleComponentExportRobotData(visibleAssembly: AssemblyState): RobotData | null {
  const components = Object.values(visibleAssembly.components);
  if (
    components.length !== 1 ||
    Object.keys(visibleAssembly.bridges).length > 0 ||
    !isIdentityAssemblyTransform(visibleAssembly.transform)
  ) {
    return null;
  }

  const [component] = components;
  if (!component || !isIdentityAssemblyTransform(component.transform)) {
    return null;
  }

  return structuredClone(component.robot);
}

export function buildExportableAssemblyRobotData(assemblyState: AssemblyState): RobotData {
  const visibleAssembly = cloneVisibleAssemblyState(assemblyState);
  const singleComponentRobot = buildSingleComponentExportRobotData(visibleAssembly);
  if (singleComponentRobot) {
    return singleComponentRobot;
  }

  const projection = createAssemblySceneProjection(visibleAssembly);
  const placement = createAssemblyScenePlacement(visibleAssembly, projection);
  let placedRobot = placement.robotData;

  if (
    placement.renderStrategy === 'direct-component' &&
    placement.directComponentId &&
    placement.directComponentTransform &&
    !isIdentityAssemblyTransform(placement.directComponentTransform)
  ) {
    const usedIds = new Set([
      ...Object.keys(placedRobot.links),
      ...Object.keys(placedRobot.joints),
      ...(placedRobot.closedLoopConstraints ?? []).map((constraint) => constraint.id),
      ...(placedRobot.inspectionContext?.mjcf?.tendons ?? []).map((tendon) => tendon.name),
    ]);
    const wrapperRootLinkId = allocateSyntheticEntityId(
      usedIds,
      `${ASSEMBLY_COMPONENT_ROOT_LINK_PREFIX}${placement.directComponentId}`,
      'link',
    );
    const wrapperJointId = allocateSyntheticEntityId(
      usedIds,
      `${ASSEMBLY_COMPONENT_ROOT_JOINT_PREFIX}${placement.directComponentId}`,
      'joint',
    );
    placedRobot = {
      ...placedRobot,
      links: {
        ...placedRobot.links,
        [wrapperRootLinkId]: createSyntheticTransformLink(wrapperRootLinkId, wrapperRootLinkId),
      },
      joints: {
        ...placedRobot.joints,
        [wrapperJointId]: createFixedTransformJoint(
          wrapperJointId,
          wrapperJointId,
          wrapperRootLinkId,
          placedRobot.rootLinkId,
          placement.directComponentTransform,
        ),
      },
      rootLinkId: wrapperRootLinkId,
    };
  }

  if (isIdentityAssemblyTransform(visibleAssembly.transform)) {
    return placedRobot;
  }

  const assemblyTransform = cloneAssemblyTransform(visibleAssembly.transform);
  if (!placedRobot.rootLinkId || !placedRobot.links[placedRobot.rootLinkId]) {
    return placedRobot;
  }

  const usedMergedEntityIds = new Set([
    ...Object.keys(placedRobot.links),
    ...Object.keys(placedRobot.joints),
    ...(placedRobot.closedLoopConstraints ?? []).map((constraint) => constraint.id),
    ...(placedRobot.inspectionContext?.mjcf?.tendons ?? []).map((tendon) => tendon.name),
  ]);
  const assemblyRootLinkId = allocateSyntheticEntityId(
    usedMergedEntityIds,
    ASSEMBLY_EXPORT_ROOT_LINK_ID,
    'link',
  );
  const links: Record<string, UrdfLink> = {
    ...placedRobot.links,
    [assemblyRootLinkId]: createSyntheticTransformLink(assemblyRootLinkId, assemblyRootLinkId),
  };
  const joints: Record<string, UrdfJoint> = {
    ...placedRobot.joints,
  };
  const wrapperJointId = allocateSyntheticEntityId(
    usedMergedEntityIds,
    `${ASSEMBLY_EXPORT_ROOT_JOINT_PREFIX}${visibleAssembly.name}`,
    'joint',
  );
  joints[wrapperJointId] = createFixedTransformJoint(
    wrapperJointId,
    wrapperJointId,
    assemblyRootLinkId,
    placedRobot.rootLinkId,
    assemblyTransform,
  );

  return {
    ...placedRobot,
    links,
    joints,
    rootLinkId: assemblyRootLinkId,
  };
}
