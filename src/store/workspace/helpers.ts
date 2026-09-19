import type {
  AssemblyComponent,
  AssemblyState,
  BridgeJoint,
  RobotData,
  WorkspaceActivityEntry,
} from '@/types';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import {
  assertCanonicalWorkspace,
  createDefaultWorkspace,
} from '@/core/robot/canonicalWorkspace';
import type { WorkspaceBridgePatch, WorkspaceStoreData } from './types';
import { applyWorkspaceJointPropertyPatch } from './propertyPatches';

export const MAX_WORKSPACE_HISTORY = 50;
export const MAX_WORKSPACE_ACTIVITY = 200;
export const JOINT_MOTION_EPSILON = 1e-9;

export function cloneWorkspace(workspace: AssemblyState): AssemblyState {
  const clone = structuredClone(workspace);
  assertCanonicalWorkspace(clone);
  return clone;
}

export function workspaceSnapshotsEqual(
  left: AssemblyState,
  right: AssemblyState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createWorkspaceActivity(label: string): WorkspaceActivityEntry {
  return {
    id: `workspace_activity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    label,
  };
}

export function resolveActiveComponentId(
  workspace: AssemblyState,
  requestedId: string | null | undefined,
): string {
  if (
    requestedId &&
    Object.prototype.hasOwnProperty.call(workspace.components, requestedId)
  ) {
    return requestedId;
  }

  const firstComponentId = Object.keys(workspace.components)[0];
  if (!firstComponentId) {
    throw new Error('Canonical workspace must contain at least one component.');
  }
  return firstComponentId;
}

export function createInitialWorkspaceStoreData(name?: string): WorkspaceStoreData {
  const workspace = createDefaultWorkspace(name);
  return {
    workspace,
    activeComponentId: resolveActiveComponentId(workspace, null),
    history: { past: [], future: [], activity: [] },
    revision: 0,
    jointMotionRevision: 0,
    pendingAutoGroundComponentIds: [],
    transaction: null,
  };
}

interface DeletedRobotReferences {
  deletedLinkIds: ReadonlySet<string>;
  deletedJointIds: ReadonlySet<string>;
  deletedLinkNames?: ReadonlySet<string>;
  deletedSiteRefs?: ReadonlySet<string>;
  deletedGeometryRefs?: ReadonlySet<string>;
}

export function repairRobotReferencesAfterDeletion(
  robot: RobotData,
  {
    deletedLinkIds,
    deletedJointIds,
    deletedLinkNames = new Set(),
    deletedSiteRefs = new Set(),
    deletedGeometryRefs = new Set(),
  }: DeletedRobotReferences,
): void {
  robot.closedLoopConstraints = robot.closedLoopConstraints?.filter(
    (constraint) =>
      robot.links[constraint.linkAId] !== undefined &&
      robot.links[constraint.linkBId] !== undefined,
  );
  if (robot.closedLoopConstraints?.length === 0) {
    delete robot.closedLoopConstraints;
  }

  Object.values(robot.joints).forEach((joint) => {
    if (joint.mimic && !robot.joints[joint.mimic.joint]) {
      delete joint.mimic;
    }
  });

  if (robot.materials) {
    [...deletedLinkIds, ...deletedLinkNames].forEach((key) => {
      delete robot.materials?.[key];
    });
    if (Object.keys(robot.materials).length === 0) {
      delete robot.materials;
    }
  }

  const inspection = robot.inspectionContext?.mjcf;
  if (!inspection) {
    return;
  }
  if (deletedLinkIds.size > 0 || deletedLinkNames.size > 0) {
    inspection.bodiesWithSites = inspection.bodiesWithSites.filter(
      (body) =>
        !deletedLinkIds.has(body.bodyId) && !deletedLinkNames.has(body.bodyId),
    );
    inspection.siteCount = inspection.bodiesWithSites.reduce(
      (total, body) => total + body.siteCount,
      0,
    );
  }
  inspection.tendons = inspection.tendons.flatMap((tendon) => {
    const attachments = tendon.attachments.filter((attachment) => {
      if (attachment.sidesite && deletedSiteRefs.has(attachment.sidesite)) {
        return false;
      }
      if (!attachment.ref) {
        return true;
      }
      if (attachment.type === 'joint') {
        return !deletedJointIds.has(attachment.ref);
      }
      if (attachment.type === 'site') {
        return !deletedSiteRefs.has(attachment.ref);
      }
      if (attachment.type === 'geom') {
        return !deletedGeometryRefs.has(attachment.ref);
      }
      return true;
    });
    if (attachments.length === 0) {
      return [];
    }
    return [{
      ...tendon,
      attachments,
      attachmentRefs: attachments.flatMap((attachment) => {
        const ref = attachment.ref ?? attachment.sidesite;
        return ref ? [ref] : [];
      }),
    }];
  });
  inspection.tendonCount = inspection.tendons.length;
  inspection.tendonActuatorCount = inspection.tendons.reduce(
    (total, tendon) => total + tendon.actuatorNames.length,
    0,
  );
}

export function appendPendingAutoGroundComponentId(
  pendingComponentIds: string[],
  componentId: string,
): void {
  if (!pendingComponentIds.includes(componentId)) {
    pendingComponentIds.push(componentId);
  }
}

export function removePendingAutoGroundComponentIds(
  pendingComponentIds: string[],
  componentIds: Iterable<string>,
): void {
  const ids = new Set(componentIds);
  for (let index = pendingComponentIds.length - 1; index >= 0; index -= 1) {
    if (ids.has(pendingComponentIds[index]!)) {
      pendingComponentIds.splice(index, 1);
    }
  }
}

export function repairPendingAutoGroundComponentIds(
  pendingComponentIds: string[],
  workspace: AssemblyState,
): string[] {
  return pendingComponentIds.filter((componentId) =>
    Object.prototype.hasOwnProperty.call(workspace.components, componentId),
  );
}

function sanitizeWorkspaceId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'component';
}

export function createUniqueComponentIdentity(
  workspace: AssemblyState,
  preferredId: string | undefined,
  preferredName: string,
): { id: string; name: string } {
  const existingIds = new Set(Object.keys(workspace.components));
  const existingNames = new Set(Object.values(workspace.components).map((component) => component.name));
  const baseId = sanitizeWorkspaceId(preferredId ?? preferredName);
  const baseName = preferredName.trim() || baseId;

  let id = baseId;
  let idSuffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}_${idSuffix}`;
    idSuffix += 1;
  }

  let name = baseName;
  let nameSuffix = 2;
  while (existingNames.has(name)) {
    name = `${baseName} ${nameSuffix}`;
    nameSuffix += 1;
  }

  return { id, name };
}

export function createUniqueEntityId(
  existingIds: Iterable<string>,
  prefix: 'link' | 'joint' | 'bridge',
): string {
  const ids = new Set(existingIds);
  const timeBase = `${prefix}_${Date.now()}`;
  let id = timeBase;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${timeBase}_${suffix}`;
    suffix += 1;
  }
  return id;
}

export function removeInvalidBridges(workspace: AssemblyState): string[] {
  const removedBridgeIds: string[] = [];
  Object.entries(workspace.bridges).forEach(([bridgeId, bridge]) => {
    const parent = workspace.components[bridge.parentComponentId];
    const child = workspace.components[bridge.childComponentId];
    const parentLinkExists = Boolean(
      parent && Object.prototype.hasOwnProperty.call(parent.robot.links, bridge.parentLinkId),
    );
    const childLinkExists = Boolean(
      child && Object.prototype.hasOwnProperty.call(child.robot.links, bridge.childLinkId),
    );
    if (!parentLinkExists || !childLinkExists) {
      delete workspace.bridges[bridgeId];
      removedBridgeIds.push(bridgeId);
    }
  });
  return removedBridgeIds;
}

export function removeComponentOrCreateDefault(
  workspace: AssemblyState,
  componentId: string,
): AssemblyState {
  if (!Object.prototype.hasOwnProperty.call(workspace.components, componentId)) {
    return workspace;
  }

  delete workspace.components[componentId];
  removeInvalidBridges(workspace);
  if (Object.keys(workspace.components).length > 0) {
    return workspace;
  }
  const fallback = createDefaultWorkspace(workspace.name);
  fallback.transform = structuredClone(workspace.transform);
  return fallback;
}

function hasExactComponentLink(component: AssemblyComponent, linkId: string): boolean {
  return Object.prototype.hasOwnProperty.call(component.robot.links, linkId);
}

export function assertBridgeCanBeApplied(
  workspace: AssemblyState,
  bridge: BridgeJoint,
  options?: { ignoreBridgeId?: string },
): void {
  const parent = workspace.components[bridge.parentComponentId];
  const child = workspace.components[bridge.childComponentId];
  if (!parent) {
    throw new Error(`Bridge parent component "${bridge.parentComponentId}" does not exist.`);
  }
  if (!child) {
    throw new Error(`Bridge child component "${bridge.childComponentId}" does not exist.`);
  }
  if (
    bridge.parentComponentId === bridge.childComponentId &&
    bridge.parentLinkId === bridge.childLinkId
  ) {
    throw new Error(
      'Bridge parent and child links must differ within the same component.',
    );
  }
  if (!hasExactComponentLink(parent, bridge.parentLinkId)) {
    throw new Error(
      `Bridge parent link "${bridge.parentLinkId}" is not a source-local link on component "${parent.id}".`,
    );
  }
  if (!hasExactComponentLink(child, bridge.childLinkId)) {
    throw new Error(
      `Bridge child link "${bridge.childLinkId}" is not a source-local link on component "${child.id}".`,
    );
  }

  // Same-component bridges are self-loops: they become closed-loop constraints
  // and must not occupy the structural incoming-bridge slot of the component.
  if (bridge.parentComponentId !== bridge.childComponentId) {
    const existingIncomingBridge = Object.values(workspace.bridges).find(
      (candidate) =>
        candidate.id !== options?.ignoreBridgeId &&
        candidate.parentComponentId !== candidate.childComponentId &&
        candidate.childComponentId === bridge.childComponentId,
    );
    if (existingIncomingBridge) {
      throw new Error(
        `Component "${bridge.childComponentId}" already has incoming bridge "${existingIncomingBridge.id}".`,
      );
    }
  }

  if (
    wouldBridgeCreateUnsupportedAssemblyCycle(
      Object.values(workspace.bridges),
      bridge,
      bridge.joint.type,
      options,
    )
  ) {
    throw new Error(
      `Bridge "${bridge.id}" would create an unsupported non-fixed component cycle.`,
    );
  }
}

export function shouldRealignBridge(
  currentBridge: BridgeJoint,
  patch: WorkspaceBridgePatch,
): boolean {
  if (
    patch.parentComponentId !== undefined ||
    patch.parentLinkId !== undefined ||
    patch.childComponentId !== undefined ||
    patch.childLinkId !== undefined
  ) {
    return true;
  }

  const joint = patch.joint;
  if (!joint) {
    return false;
  }
  const nextJoint = applyWorkspaceJointPropertyPatch(currentBridge.joint, joint);
  return (
    (joint.parentLinkId !== undefined &&
      joint.parentLinkId !== currentBridge.joint.parentLinkId) ||
    (joint.childLinkId !== undefined &&
      joint.childLinkId !== currentBridge.joint.childLinkId) ||
    (joint.origin !== undefined &&
      (nextJoint.origin.xyz.x !== currentBridge.joint.origin.xyz.x ||
        nextJoint.origin.xyz.y !== currentBridge.joint.origin.xyz.y ||
        nextJoint.origin.xyz.z !== currentBridge.joint.origin.xyz.z ||
        nextJoint.origin.rpy.r !== currentBridge.joint.origin.rpy.r ||
        nextJoint.origin.rpy.p !== currentBridge.joint.origin.rpy.p ||
        nextJoint.origin.rpy.y !== currentBridge.joint.origin.rpy.y))
  );
}
