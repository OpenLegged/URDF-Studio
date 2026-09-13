import { useCallback } from 'react';

import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import {
  createStableJsonSnapshot,
  stripTransientJointMotionFromJoint,
} from '@/core/robot/semanticSnapshot';
import type { BridgeJoint, ComponentSourceDraft, RobotData } from '@/types';
import type { SourceCodeEditorApplyRequest } from '@/features/code-editor';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { GroupSourceCodeDocumentChangeTarget } from '@/app/utils/sourceCodeDocuments';
import { beginCoordinatedWorkspaceTransaction } from '@/app/utils/pendingHistory';
import { partitionFlattenedGroupEdit } from '@/app/utils/assemblyUrdfSourcePartition';
import {
  tryGenerateEditableRobotSource,
  resolveEditableRobotSourceFormat,
} from '@/app/utils/generateEditableRobotSource';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import { commitPreparedComponentSourceApply } from './useEditableSourceCodeApply';

function createBridgeSnapshot(bridge: BridgeJoint): string {
  return createStableJsonSnapshot({
    ...bridge,
    joint: stripTransientJointMotionFromJoint(bridge.joint),
  });
}

function provenanceMatchesCurrentWorkspace(
  target: GroupSourceCodeDocumentChangeTarget,
): boolean {
  const workspace = useWorkspaceStore.getState().workspace;
  for (const [componentId, baselineRobot] of target.provenance.componentRobotById) {
    const currentRobot = workspace.components[componentId]?.robot;
    if (
      !currentRobot
      || createSourceSemanticRobotHash(currentRobot)
        !== createSourceSemanticRobotHash(baselineRobot)
    ) {
      return false;
    }
  }
  for (const [bridgeId, baseline] of target.provenance.bridgeById) {
    const currentBridge = workspace.bridges[bridgeId];
    if (!currentBridge || createBridgeSnapshot(currentBridge) !== createBridgeSnapshot(baseline.bridge)) {
      return false;
    }
  }
  return true;
}

interface PreparedGroupSourceComponent {
  componentId: string;
  robot: RobotData;
  draft: ComponentSourceDraft | null;
}

function applyPreparedGroupComponent(prepared: PreparedGroupSourceComponent, operationId: string): boolean {
  const workspace = useWorkspaceStore.getState();
  if (prepared.draft) {
    return commitPreparedComponentSourceApply({
      ...prepared,
      draft: prepared.draft,
      expectedWorkspaceRevision: workspace.revision,
      workspaceMutationOptions: { operationId },
    });
  }
  const applied = workspace.replaceComponentRobotAtRevision(
    prepared.componentId,
    workspace.revision,
    prepared.robot,
    { operationId },
  );
  if (applied) useAssetsStore.getState().removeComponentSourceDraft(prepared.componentId);
  return applied;
}

/** Applies one flattened master/bridge edit as one compensating cross-store transaction. */
export function applyFlattenedGroupSourceEdit(
  editedText: string,
  target: GroupSourceCodeDocumentChangeTarget,
): boolean {
  const partitioned = partitionFlattenedGroupEdit(editedText, target.provenance);
  if (!partitioned.ok || !provenanceMatchesCurrentWorkspace(target)) return false;

  let preparedComponents: PreparedGroupSourceComponent[];
  try {
    preparedComponents = Array.from(partitioned.componentRobots ?? []).map(
      ([componentId, robot]) => {
        const normalizedRobot = normalizeComponentRobot(robot);
        const format = resolveEditableRobotSourceFormat(normalizedRobot);
        const content = tryGenerateEditableRobotSource({
          format,
          robotState: { ...normalizedRobot, selection: { type: null, id: null } },
          preserveMeshPaths: true,
        });
        return {
          componentId,
          robot: normalizedRobot,
          draft: content === null ? null : createComponentSourceDraft({
            componentId,
            format,
            content,
            robot: normalizedRobot,
          }),
        };
      },
    );
  } catch (error) {
    logRegressionError('[SourceCode] Failed to prepare flattened group source.', error);
    return false;
  }
  const bridgeEdits = partitioned.bridgeJointEdits ?? [];
  if (preparedComponents.length === 0 && bridgeEdits.length === 0) return true;

  const previousDrafts = structuredClone(useAssetsStore.getState().componentSourceDrafts);
  let operationId: string | null = null;
  try {
    operationId = beginCoordinatedWorkspaceTransaction('Apply flattened group source');
    for (const prepared of preparedComponents) {
      if (!applyPreparedGroupComponent(prepared, operationId)) {
        throw new Error(`Failed to apply component "${prepared.componentId}"`);
      }
    }
    for (const { bridgeId, joint } of bridgeEdits) {
      const changed = useWorkspaceStore.getState().updateBridge(
        bridgeId,
        {
          joint: {
            type: joint.type,
            origin: structuredClone(joint.origin),
            axis: joint.axis ? structuredClone(joint.axis) : undefined,
            limit: joint.limit ? structuredClone(joint.limit) : undefined,
            dynamics: structuredClone(joint.dynamics),
          },
        },
        { operationId },
      );
      if (!changed) throw new Error(`Failed to apply bridge "${bridgeId}"`);
    }
    if (!useWorkspaceStore.getState().commitWorkspaceTransaction(operationId)) {
      throw new Error('Failed to commit flattened group source transaction');
    }
    return true;
  } catch (error) {
    if (operationId && useWorkspaceStore.getState().transaction?.id === operationId) {
      useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
    }
    if (operationId) {
      useAssetsStore.getState().replaceComponentSourceDrafts(previousDrafts);
    }
    logRegressionError('[SourceCode] Failed to apply flattened group source.', error);
    return false;
  }
}

export function useFlattenedGroupSourceApply() {
  const handleCodeChange = useCallback(async (
    newCode: string,
    target: GroupSourceCodeDocumentChangeTarget | undefined,
    _applyRequest?: SourceCodeEditorApplyRequest,
  ): Promise<boolean> => target ? applyFlattenedGroupSourceEdit(newCode, target) : false, []);

  return { handleCodeChange };
}
