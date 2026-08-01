import {
  entityRefKey,
  type AssemblyState,
  type BridgeEntityRef,
  type ComponentEntityRef,
  type EntityRef,
  type InteractionSelection,
  type JointQuaternion,
  type UrdfJoint,
  type WorkspaceSelection,
} from '@/types';

import type { AssemblySceneProjection } from '@/core/robot/assemblySceneProjection';
import type { AssemblyScenePlacement } from '@/core/robot/assemblyScenePlacement';
import type { ViewerJointChangeContext } from '../types';
import type { WorkspaceJointInteractionPreview } from '@/store/jointInteractionPreviewStore';

export {
  createAssemblyScenePlacement,
  createAssemblyScenePlacement as createWorkspaceScenePlacement,
  type AssemblyComponentSceneTransformTarget as ComponentSceneTransformTarget,
  type AssemblyScenePlacement as WorkspaceScenePlacement,
} from '@/core/robot/assemblyScenePlacement';

export const EMPTY_RENDERER_SELECTION: InteractionSelection = {
  type: null,
  id: null,
};

export interface WorkspaceJointMotionGroup {
  readonly componentId: string;
  readonly jointAngles: Readonly<Record<string, number>>;
  readonly jointQuaternions: Readonly<Record<string, JointQuaternion>>;
}

export interface ProjectedWorkspaceJointMotionState {
  readonly jointAngles: Record<string, number>;
  readonly jointMotion: Record<
    string,
    { angle?: number; quaternion?: JointQuaternion }
  >;
}

/**
 * Project only transient joint pose onto stable renderer IDs. This lets the
 * expensive topology/resource projection stay unchanged during joint drags.
 */
export function projectWorkspaceJointMotionToRenderer(
  workspace: AssemblyState,
  projection: AssemblySceneProjection,
): ProjectedWorkspaceJointMotionState {
  const jointAngles: Record<string, number> = {};
  const jointMotion: ProjectedWorkspaceJointMotionState['jointMotion'] = {};

  Object.values(workspace.components).forEach((component) => {
    Object.entries(component.robot.joints).forEach(([entityId, joint]) => {
      const globalId = projection.entityRefKeyToGlobal.get(entityRefKey({
        type: 'joint',
        componentId: component.id,
        entityId,
      }));
      if (!globalId) {
        return;
      }
      const motion: { angle?: number; quaternion?: JointQuaternion } = {};
      if (typeof joint.angle === 'number' && Number.isFinite(joint.angle)) {
        jointAngles[globalId] = joint.angle;
        motion.angle = joint.angle;
      }
      if (joint.quaternion) {
        motion.quaternion = { ...joint.quaternion };
      }
      jointMotion[globalId] = motion;
    });
  });

  Object.values(workspace.bridges).forEach((bridge) => {
    const globalId = projection.entityRefKeyToGlobal.get(entityRefKey({
      type: 'bridge',
      bridgeId: bridge.id,
    }));
    if (!globalId) {
      return;
    }
    const motion: { angle?: number; quaternion?: JointQuaternion } = {};
    if (typeof bridge.joint.angle === 'number' && Number.isFinite(bridge.joint.angle)) {
      jointAngles[globalId] = bridge.joint.angle;
      motion.angle = bridge.joint.angle;
    }
    if (bridge.joint.quaternion) {
      motion.quaternion = { ...bridge.joint.quaternion };
    }
    jointMotion[globalId] = motion;
  });

  return { jointAngles, jointMotion };
}

export interface RendererJointInteractionPreview {
  readonly activeJointId: string | null;
  readonly jointAngles: Readonly<Record<string, number>>;
  readonly jointQuaternions: Readonly<Record<string, JointQuaternion>>;
  readonly jointOrigins: Readonly<Record<string, UrdfJoint['origin']>>;
}

interface RendererSelectionDetails {
  readonly subType?: 'visual' | 'collision';
  readonly objectIndex?: number;
  readonly helperKind?: InteractionSelection['helperKind'];
  readonly highlightObjectId?: number;
}

function copySelectionDetails(
  selection: RendererSelectionDetails,
): Pick<
  InteractionSelection,
  'subType' | 'objectIndex' | 'helperKind' | 'highlightObjectId'
> {
  return {
    ...(selection.subType ? { subType: selection.subType } : {}),
    ...(selection.objectIndex !== undefined ? { objectIndex: selection.objectIndex } : {}),
    ...(selection.helperKind ? { helperKind: selection.helperKind } : {}),
    ...(selection.highlightObjectId !== undefined
      ? { highlightObjectId: selection.highlightObjectId }
      : {}),
  };
}

/**
 * Renderer identity is an implementation detail. Canonical ownership remains
 * explicit and crosses this boundary only through the projection maps.
 */
export function projectWorkspaceSelectionToRenderer(
  projection: AssemblySceneProjection,
  selection: WorkspaceSelection | undefined,
): InteractionSelection {
  if (!selection) {
    return EMPTY_RENDERER_SELECTION;
  }

  const { entity } = selection;
  if (entity.type === 'assembly') {
    return EMPTY_RENDERER_SELECTION;
  }

  if (entity.type === 'component') {
    const rootTarget = projection.componentRootTargets.get(entity.componentId);
    if (!rootTarget) {
      return EMPTY_RENDERER_SELECTION;
    }
    const linkRef: EntityRef = {
      type: 'link',
      componentId: entity.componentId,
      entityId: rootTarget.rootLinkId,
    };
    const linkId = projection.entityRefKeyToGlobal.get(entityRefKey(linkRef));
    if (!linkId) {
      return EMPTY_RENDERER_SELECTION;
    }
    return { type: 'link', id: linkId };
  }

  const id = projection.entityRefKeyToGlobal.get(entityRefKey(entity));
  if (!id) {
    return EMPTY_RENDERER_SELECTION;
  }

  return {
    type: entity.type === 'bridge' ? 'joint' : entity.type,
    id,
    ...copySelectionDetails(selection),
  };
}

function rendererTypeMatchesEntityRef(
  rendererType: Exclude<InteractionSelection['type'], null>,
  ref: EntityRef,
): boolean {
  if (ref.type === 'bridge') {
    return rendererType === 'joint';
  }
  return ref.type === rendererType;
}

/** Fail closed for stale or foreign renderer IDs; never infer an owner from text. */
export function resolveRendererSelectionToWorkspace(
  projection: AssemblySceneProjection,
  selection: InteractionSelection | null | undefined,
): WorkspaceSelection {
  if (!selection?.type || !selection.id) {
    return null;
  }

  const entity = projection.globalToEntityRef.get(selection.id);
  if (!entity || !rendererTypeMatchesEntityRef(selection.type, entity)) {
    return null;
  }

  return {
    entity,
    ...copySelectionDetails(selection),
  };
}

export function resolveWorkspaceFocusTarget(
  projection: AssemblySceneProjection,
  placement: AssemblyScenePlacement,
  target: EntityRef | null | undefined,
): string | null {
  if (!target) {
    return null;
  }

  if (target.type === 'assembly') {
    return placement.robotData.rootLinkId || null;
  }
  if (target.type === 'component') {
    return projection.componentRootTargets.get(target.componentId)?.rootLinkId ?? null;
  }
  return projection.entityRefKeyToGlobal.get(entityRefKey(target)) ?? null;
}

/**
 * Resolve runtime-keyed motion through the projection maps and group it by
 * canonical component. Authored joint names are intentionally ignored because
 * they are not globally unique.
 */
export function groupProjectedJointMotionByComponent(
  projection: AssemblySceneProjection,
  context: ViewerJointChangeContext | null | undefined,
): WorkspaceJointMotionGroup[] {
  const groups = new Map<
    string,
    {
      jointAngles: Record<string, number>;
      jointQuaternions: Record<string, JointQuaternion>;
    }
  >();
  const getGroup = (componentId: string) => {
    const existing = groups.get(componentId);
    if (existing) {
      return existing;
    }
    const created: {
      jointAngles: Record<string, number>;
      jointQuaternions: Record<string, JointQuaternion>;
    } = { jointAngles: {}, jointQuaternions: {} };
    groups.set(componentId, created);
    return created;
  };

  Object.entries(context?.jointAngles ?? {}).forEach(([globalId, angle]) => {
    const ref = projection.globalToEntityRef.get(globalId);
    if (ref?.type !== 'joint' || !Number.isFinite(angle)) {
      return;
    }
    getGroup(ref.componentId).jointAngles[ref.entityId] = angle;
  });
  Object.entries(context?.jointQuaternions ?? {}).forEach(([globalId, quaternion]) => {
    const ref = projection.globalToEntityRef.get(globalId);
    if (ref?.type !== 'joint' || !quaternion) {
      return;
    }
    getGroup(ref.componentId).jointQuaternions[ref.entityId] = { ...quaternion };
  });

  return Array.from(groups, ([componentId, values]) => ({ componentId, ...values }));
}

export function projectJointPreviewToWorkspaceComponents(
  projection: AssemblySceneProjection,
  preview: RendererJointInteractionPreview,
): Record<string, WorkspaceJointInteractionPreview> {
  const result: Record<string, WorkspaceJointInteractionPreview> = {};
  const getPreview = (componentId: string): WorkspaceJointInteractionPreview => {
    const existing = result[componentId];
    if (existing) {
      return existing;
    }
    const created: WorkspaceJointInteractionPreview = {
      activeJointId: null,
      jointAngles: {},
      jointQuaternions: {},
      jointOrigins: {},
    };
    result[componentId] = created;
    return created;
  };
  const resolveJoint = (globalId: string) => {
    const ref = projection.globalToEntityRef.get(globalId);
    return ref?.type === 'joint' ? ref : null;
  };

  Object.entries(preview.jointAngles).forEach(([globalId, angle]) => {
    const ref = resolveJoint(globalId);
    if (ref && Number.isFinite(angle)) {
      getPreview(ref.componentId).jointAngles[ref.entityId] = angle;
    }
  });
  Object.entries(preview.jointQuaternions).forEach(([globalId, quaternion]) => {
    const ref = resolveJoint(globalId);
    if (ref) {
      getPreview(ref.componentId).jointQuaternions[ref.entityId] = { ...quaternion };
    }
  });
  Object.entries(preview.jointOrigins).forEach(([globalId, origin]) => {
    const ref = resolveJoint(globalId);
    if (ref) {
      getPreview(ref.componentId).jointOrigins[ref.entityId] = structuredClone(origin);
    }
  });
  if (preview.activeJointId) {
    const activeRef = resolveJoint(preview.activeJointId);
    if (activeRef) {
      getPreview(activeRef.componentId).activeJointId = activeRef.entityId;
    }
  }
  return result;
}

export function isWorkspaceTransformSelection(
  selection: WorkspaceSelection | undefined,
): selection is NonNullable<WorkspaceSelection> & {
  entity: ComponentEntityRef | BridgeEntityRef | { type: 'assembly' };
} {
  return Boolean(
    selection &&
      (selection.entity.type === 'assembly' ||
        selection.entity.type === 'component' ||
        selection.entity.type === 'bridge') &&
      !selection.helperKind,
  );
}
