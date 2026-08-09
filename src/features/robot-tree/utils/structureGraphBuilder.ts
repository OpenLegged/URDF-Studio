/**
 * Structure graph builder — turns an `AssemblyState` into a `StructureGraphNode[]`
 * tree for the structure graph dialog. Pure mapping over `@/types` + `@/core/robot`
 * tree roots + `@/shared/i18n` labels. No React.
 *
 * Boundary: feature layer (robot-tree). Imports `@/core/robot`
 * (getTreeRenderRootLinkIds), `@/core/utils/treeGraphLayout` (node types),
 * `@/shared/i18n` (TranslationKeys), `@/types` (AssemblyState/RobotData/RobotState/
 * UrdfJoint/EntityRef).
 */

import { getTreeRenderRootLinkIds } from '@/core/robot';
import type { GraphNodeKind, StructureGraphNode } from '@/core/utils/treeGraphLayout';
import type { TranslationKeys } from '@/shared/i18n';
import type { AssemblyState, EntityRef, RobotData, RobotState, UrdfJoint } from '@/types';

export function getNodeKindLabel(kind: GraphNodeKind, t: TranslationKeys): string {
  switch (kind) {
    case 'robot':
      return t.structureGraphRobot;
    case 'assembly':
      return t.structureGraphAssembly;
    case 'component':
      return t.structureGraphComponent;
    case 'link':
      return t.structureGraphLink;
    case 'joint':
      return t.structureGraphJoint;
    case 'bridge':
      return t.structureGraphBridge;
  }
}

function sortByDisplayName<T>(items: readonly T[], resolveName: (item: T) => string): T[] {
  return [...items].sort((left, right) => resolveName(left).localeCompare(resolveName(right)));
}

export function toRobotState(robot: RobotData | RobotState): RobotState {
  if ('selection' in robot) return robot;
  return { ...robot, selection: { type: null, id: null } };
}

export function buildChildJointsByParent(joints: Record<string, UrdfJoint>) {
  const result: Record<string, UrdfJoint[]> = {};
  Object.values(joints).forEach((joint) => {
    (result[joint.parentLinkId] ??= []).push(joint);
  });
  return result;
}

function buildLinkNode(
  robot: RobotData | RobotState,
  linkId: string,
  childJointsByParent: Record<string, RobotState['joints'][string][]>,
  t: TranslationKeys,
  scope: string,
  componentId: string,
  path: readonly string[] = [],
): StructureGraphNode | null {
  const link = robot.links[linkId];
  if (!link) return null;

  const nextPath = [...path, linkId];
  const hasCycle = path.includes(linkId);
  const childJoints = hasCycle ? [] : childJointsByParent[linkId] ?? [];
  const children = childJoints
    .map((joint) => {
      const childLink = buildLinkNode(
        robot,
        joint.childLinkId,
        childJointsByParent,
        t,
        scope,
        componentId,
        nextPath,
      );

      return {
        uid: `${scope}:joint:${joint.id}:${nextPath.join('/')}`,
        kind: 'joint' as const,
        id: joint.id,
        componentId,
        label: joint.name || joint.id,
        caption: joint.type,
        children: childLink ? [childLink] : [],
      };
    });

  return {
    uid: `${scope}:link:${linkId}:${nextPath.join('/')}`,
    kind: 'link',
    id: linkId,
    componentId,
    label: link.name || linkId,
    caption: t.structureGraphLink,
    children,
  };
}

export function buildRobotRootNode(
  robot: RobotData | RobotState,
  rootLinkIds: string[],
  childJointsByParent: Record<string, RobotState['joints'][string][]>,
  t: TranslationKeys,
  scope: string,
  componentId: string,
): StructureGraphNode {
  const robotState = toRobotState(robot);
  const resolvedRootLinkIds =
    rootLinkIds.length > 0 ? rootLinkIds : getTreeRenderRootLinkIds(robotState);
  const rootLinks = resolvedRootLinkIds
    .map((linkId) => buildLinkNode(robot, linkId, childJointsByParent, t, scope, componentId))
    .filter((node): node is StructureGraphNode => Boolean(node));

  return {
    uid: `${scope}:robot`,
    kind: 'robot',
    label: robotState.name || t.structureGraphRobot,
    caption: t.structureGraphRobot,
    componentId,
    targetLinkId: resolvedRootLinkIds[0] ?? robotState.rootLinkId,
    children: rootLinks,
  };
}

export function buildAssemblyRootNodes(
  assemblyState: AssemblyState,
  t: TranslationKeys,
): StructureGraphNode[] {
  const components = sortByDisplayName(
    Object.values(assemblyState.components),
    (component) => component.name,
  );
  const bridges = sortByDisplayName(Object.values(assemblyState.bridges), (bridge) => bridge.name);

  const componentNodes = components.map((component) => {
    const rootLinkIds = getTreeRenderRootLinkIds(toRobotState(component.robot));
    const componentChildJointsByParent = buildChildJointsByParent(component.robot.joints);
    const robotNode = buildRobotRootNode(
      component.robot,
      rootLinkIds,
      componentChildJointsByParent,
      t,
      `component:${component.id}`,
      component.id,
    );

    return {
      uid: `component:${component.id}`,
      kind: 'component' as const,
      id: component.id,
      componentId: component.id,
      targetLinkId: rootLinkIds[0] ?? component.robot.rootLinkId,
      label: component.name,
      caption: t.structureGraphComponent,
      children: robotNode.children,
    };
  });

  const bridgeNodes = bridges.map((bridge) => ({
    uid: `bridge:${bridge.id}`,
    kind: 'bridge' as const,
    id: bridge.id,
    label: bridge.name || bridge.id,
    caption: bridge.joint.type,
    children: [],
  }));

  return [...componentNodes, ...bridgeNodes];
}

export function getNodeEntityRef(node: StructureGraphNode): EntityRef | null {
  if (node.kind === 'assembly') return { type: 'assembly' };
  if (node.kind === 'component' && node.componentId) {
    return { type: 'component', componentId: node.componentId };
  }
  if (node.kind === 'bridge' && node.id) {
    return { type: 'bridge', bridgeId: node.id };
  }
  if (node.kind === 'robot' && node.componentId) {
    return node.targetLinkId
      ? { type: 'link', componentId: node.componentId, entityId: node.targetLinkId }
      : { type: 'component', componentId: node.componentId };
  }
  if ((node.kind === 'link' || node.kind === 'joint') && node.id && node.componentId) {
    return {
      type: node.kind,
      componentId: node.componentId,
      entityId: node.id,
    };
  }
  return null;
}
