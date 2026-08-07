import type {
  AssemblyComponent,
  AssemblyState,
  EntityRef,
  RobotData,
  WorkspaceSelection,
} from '@/types';
import { resolveLinkKey } from './identity';

export interface LinkEditorLockState {
  locked: boolean;
  source: 'self' | 'ancestor' | null;
  sourceLinkId: string | null;
}

type RobotTopology = Pick<RobotData, 'joints' | 'links'>;

/** Resolves an authored link lock, including locks inherited from parent links. */
export function resolveRobotLinkEditorLock(
  robot: RobotTopology,
  linkId: string,
): LinkEditorLockState {
  const resolvedLinkId = resolveLinkKey(robot.links, linkId) ?? linkId;
  if (!robot.links[resolvedLinkId]) {
    return { locked: false, source: null, sourceLinkId: null };
  }
  if (robot.links[resolvedLinkId]?.editorLocked === true) {
    return { locked: true, source: 'self', sourceLinkId: resolvedLinkId };
  }

  const parentsByChild = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const childLinkId = resolveLinkKey(robot.links, joint.childLinkId) ?? joint.childLinkId;
    const parentLinkId = resolveLinkKey(robot.links, joint.parentLinkId) ?? joint.parentLinkId;
    const parents = parentsByChild.get(childLinkId) ?? [];
    parents.push(parentLinkId);
    parentsByChild.set(childLinkId, parents);
  });

  const visited = new Set([resolvedLinkId]);
  const pending = [...(parentsByChild.get(resolvedLinkId) ?? [])];
  while (pending.length > 0) {
    const candidateId = pending.shift();
    if (!candidateId || visited.has(candidateId)) continue;
    visited.add(candidateId);
    if (robot.links[candidateId]?.editorLocked === true) {
      return { locked: true, source: 'ancestor', sourceLinkId: candidateId };
    }
    pending.push(...(parentsByChild.get(candidateId) ?? []));
  }

  return { locked: false, source: null, sourceLinkId: null };
}

export function hasComponentEditorLocks(component: AssemblyComponent): boolean {
  return component.editorLocked === true
    || Object.values(component.robot.links).some((link) => link.editorLocked === true);
}

function isComponentLocked(workspace: AssemblyState, componentId: string): boolean {
  return workspace.components[componentId]?.editorLocked === true;
}

function isComponentLinkLocked(
  workspace: AssemblyState,
  componentId: string,
  linkId: string,
): boolean {
  const component = workspace.components[componentId];
  return Boolean(
    component
    && (
      component.editorLocked === true
      || resolveRobotLinkEditorLock(component.robot, linkId).locked
    ),
  );
}

/**
 * Canonical editor-lock rule. Tree selection and visibility remain available,
 * while authored data, transforms, joint motion, and viewport picking are blocked.
 */
export function isEntityEditorLocked(
  workspace: AssemblyState,
  ref: EntityRef,
): boolean {
  if (ref.type === 'assembly') {
    return false;
  }

  if (ref.type === 'component') {
    return isComponentLocked(workspace, ref.componentId);
  }

  if (ref.type === 'bridge') {
    const bridge = workspace.bridges[ref.bridgeId];
    return Boolean(
      bridge
      && (
        isComponentLinkLocked(
          workspace,
          bridge.parentComponentId,
          bridge.parentLinkId,
        )
        || isComponentLinkLocked(
          workspace,
          bridge.childComponentId,
          bridge.childLinkId,
        )
      ),
    );
  }

  const component = workspace.components[ref.componentId];
  if (!component || component.editorLocked === true) {
    return Boolean(component);
  }

  if (ref.type === 'link') {
    return resolveRobotLinkEditorLock(component.robot, ref.entityId).locked;
  }

  if (ref.type === 'joint') {
    const joint = component.robot.joints[ref.entityId];
    return Boolean(
      joint
      && (
        resolveRobotLinkEditorLock(component.robot, joint.parentLinkId).locked
        || resolveRobotLinkEditorLock(component.robot, joint.childLinkId).locked
      ),
    );
  }

  // Tendons can span several links, so any authored link lock protects them
  // from bulk edits that could otherwise bypass a locked branch.
  return ref.type === 'tendon' && hasComponentEditorLocks(component);
}

export function isWorkspaceSelectionEditorLocked(
  workspace: AssemblyState,
  selection: WorkspaceSelection,
): boolean {
  return selection ? isEntityEditorLocked(workspace, selection.entity) : false;
}
