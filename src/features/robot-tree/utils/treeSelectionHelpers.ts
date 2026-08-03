import type React from 'react';

import { areEntityRefsEqual } from '@/types';
import type { EntityRef, UrdfJoint, WorkspaceSelection } from '@/types';

/** Whether the workspace selection points at exactly this entity. */
export function selectionTargets(selection: WorkspaceSelection, ref: EntityRef): boolean {
  return selection !== null && areEntityRefsEqual(selection.entity, ref);
}

/**
 * Run a row's primary action for keyboard users.
 *
 * Ignores keys bubbling up from nested controls so that activating a child
 * button does not also activate the row that contains it.
 */
export function runOnActivationKey(
  event: React.KeyboardEvent<HTMLElement>,
  action: () => void,
): void {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
    return;
  }
  event.preventDefault();
  action();
}

/** Whether the selection is the component itself or anything owned by it. */
export function selectionTargetsComponent(
  selection: WorkspaceSelection,
  componentId: string,
): boolean {
  if (!selection) return false;
  const ref = selection.entity;
  return ref.type === 'component'
    ? ref.componentId === componentId
    : (ref.type === 'link' || ref.type === 'joint' || ref.type === 'tendon')
      && ref.componentId === componentId;
}

/** Group joints by parent link so a tree row can find its children in O(1). */
export function buildChildJointsByParent(
  joints: Record<string, UrdfJoint>,
): Record<string, UrdfJoint[]> {
  const result: Record<string, UrdfJoint[]> = {};
  Object.values(joints).forEach((joint) => {
    (result[joint.parentLinkId] ??= []).push(joint);
  });
  return result;
}
