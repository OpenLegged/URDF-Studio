import { DEFAULT_JOINT, JointType, type BridgeJoint, type UrdfJoint } from '@/types';
import { resolveAlignedAssemblyComponentTransformForBridge } from '@/core/robot/assemblyBridgeAlignment';
import { isEntityEditorLocked } from '@/core/robot/editorLock';

import {
  assertBridgeCanBeApplied,
  createUniqueEntityId,
  removePendingAutoGroundComponentIds,
  shouldRealignBridge,
} from './helpers';
import type { WorkspaceRuntime } from './runtime';
import type {
  WorkspaceActions,
  WorkspaceStoreGet,
  WorkspaceStoreSet,
} from './types';
import { applyWorkspaceJointPropertyPatch } from './propertyPatches';

type BridgeActions = Pick<
  WorkspaceActions,
  'updateAssemblyTransform' | 'addBridge' | 'updateBridge' | 'removeBridge'
>;

export function createBridgeActions(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  runtime: WorkspaceRuntime,
): BridgeActions {
  return {
    updateAssemblyTransform: (transform, options) =>
      runtime.applyMutation(
        'Transform workspace',
        (draft) => {
          draft.transform = structuredClone(transform);
        },
        options,
      ),

    addBridge: (params, options) => {
      if (!runtime.isOperationAllowed(options)) {
        throw new Error('Workspace is busy with an exclusive transaction.');
      }
      const id =
        params.id ?? createUniqueEntityId(Object.keys(get().workspace.bridges), 'bridge');
      if (get().workspace.bridges[id]) {
        throw new Error(`Bridge "${id}" already exists.`);
      }
      if (
        isEntityEditorLocked(get().workspace, {
          type: 'link',
          componentId: params.parentComponentId,
          entityId: params.parentLinkId,
        })
        || isEntityEditorLocked(get().workspace, {
          type: 'link',
          componentId: params.childComponentId,
          entityId: params.childLinkId,
        })
      ) {
        throw new Error('Locked links cannot be used to create a bridge.');
      }
      const defaultJoint = structuredClone(DEFAULT_JOINT);
      const joint: UrdfJoint = {
        ...defaultJoint,
        ...structuredClone(params.joint),
        id,
        name: params.joint.name ?? params.name,
        type: params.joint.type ?? JointType.FIXED,
        parentLinkId: params.parentLinkId,
        childLinkId: params.childLinkId,
        origin: params.joint.origin
          ? structuredClone(params.joint.origin)
          : {
              xyz: { x: 0, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
      };
      const bridge: BridgeJoint = {
        id,
        name: params.name,
        parentComponentId: params.parentComponentId,
        parentLinkId: params.parentLinkId,
        childComponentId: params.childComponentId,
        childLinkId: params.childLinkId,
        joint,
      };

      const changed = runtime.applyMutation(
        'Add bridge',
        (draft) => {
          assertBridgeCanBeApplied(draft, bridge);
          draft.bridges[id] = structuredClone(bridge);
          const alignedTransform = resolveAlignedAssemblyComponentTransformForBridge(
            draft,
            bridge,
          );
          if (alignedTransform) {
            draft.components[bridge.childComponentId]!.transform = alignedTransform;
          }
        },
        options,
      );
      if (!changed) {
        throw new Error(`Bridge "${id}" was not added.`);
      }
      set((state) => {
        removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [
          bridge.childComponentId,
        ]);
      });
      return bridge;
    },

    updateBridge: (bridgeId, patch, options) => {
      const current = get().workspace.bridges[bridgeId];
      if (
        !current
        || isEntityEditorLocked(get().workspace, { type: 'bridge', bridgeId })
      ) {
        return false;
      }
      const nextParentComponentId = patch.parentComponentId ?? current.parentComponentId;
      const nextParentLinkId = patch.joint?.parentLinkId
        ?? patch.parentLinkId
        ?? current.parentLinkId;
      const nextChildComponentId = patch.childComponentId ?? current.childComponentId;
      const nextChildLinkId = patch.joint?.childLinkId
        ?? patch.childLinkId
        ?? current.childLinkId;
      if (
        isEntityEditorLocked(get().workspace, {
          type: 'link',
          componentId: nextParentComponentId,
          entityId: nextParentLinkId,
        })
        || isEntityEditorLocked(get().workspace, {
          type: 'link',
          componentId: nextChildComponentId,
          entityId: nextChildLinkId,
        })
      ) {
        return false;
      }
      const realign = shouldRealignBridge(current, patch);
      const changed = runtime.applyMutation(
        'Update bridge',
        (draft) => {
          const bridge = draft.bridges[bridgeId];
          if (!bridge) {
            return;
          }
          const parentLinkId =
            patch.joint?.parentLinkId ?? patch.parentLinkId ?? bridge.parentLinkId;
          const childLinkId =
            patch.joint?.childLinkId ?? patch.childLinkId ?? bridge.childLinkId;
          const name = patch.name ?? patch.joint?.name ?? bridge.name;
          const next: BridgeJoint = {
            ...bridge,
            ...structuredClone(patch),
            id: bridge.id,
            name,
            parentLinkId,
            childLinkId,
            joint: {
              ...applyWorkspaceJointPropertyPatch(
                bridge.joint,
                patch.joint ?? {},
              ),
              id: bridge.joint.id,
              name,
              parentLinkId,
              childLinkId,
            },
          };
          assertBridgeCanBeApplied(draft, next, { ignoreBridgeId: bridgeId });
          draft.bridges[bridgeId] = next;
          if (realign) {
            const alignedTransform = resolveAlignedAssemblyComponentTransformForBridge(
              draft,
              next,
            );
            if (alignedTransform) {
              draft.components[next.childComponentId]!.transform = alignedTransform;
            }
          }
        },
        options,
      );
      if (changed && realign) {
        const childComponentId =
          patch.childComponentId ?? current.childComponentId;
        set((state) => {
          removePendingAutoGroundComponentIds(state.pendingAutoGroundComponentIds, [
            childComponentId,
          ]);
        });
      }
      return changed;
    },

    removeBridge: (bridgeId, options) => {
      if (isEntityEditorLocked(get().workspace, { type: 'bridge', bridgeId })) {
        return false;
      }
      return runtime.applyMutation(
        'Remove bridge',
        (draft) => {
          if (draft.bridges[bridgeId]) {
            delete draft.bridges[bridgeId];
          }
        },
        options,
      );
    },
  };
}
