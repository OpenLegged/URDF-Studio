import { createSourceSemanticRobotHash } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotData } from '@/types';
import {
  reconcileComponentEditableRobotSource,
  type ComponentSourceReconcileResult,
} from './component_source_reconcile';
import {
  synchronizeComponentSourceDraft,
  type ComponentSourceDraftSyncOutcome,
} from './component_source_draft_sync';

export interface ComponentSourceMutation {
  componentId: string;
  previousRobot?: RobotData;
}

export interface ComponentSourceMutationResult {
  reconciliation: ComponentSourceReconcileResult;
  synchronization: ComponentSourceDraftSyncOutcome;
}

export type ComponentSourceMutationCommand = (mutation: ComponentSourceMutation) => void;

/**
 * Finish source synchronization after a canonical component mutation has committed.
 * Owns format reconciliation, recovery and draft removal; never changes robot/history.
 * Unsupported text patches retain their authored seed for the source-preserving sync.
 */
export function synchronizeComponentSourceAfterMutation({
  componentId,
  previousRobot,
}: ComponentSourceMutation): ComponentSourceMutationResult {
  const nextRobot = useWorkspaceStore.getState().workspace.components[componentId]?.robot;
  const reconciliation = previousRobot && nextRobot
    ? reconcileComponentEditableRobotSource({
        componentId,
        expectedRobotSnapshotHash: createSourceSemanticRobotHash(previousRobot),
        previousRobot,
        nextRobot,
      })
    : { handled: false };

  if (reconciliation.outcome === 'invalidated' && reconciliation.reason) {
    console.info('Source-preserving reconciliation was invalidated:', reconciliation.reason);
  }
  const synchronization = synchronizeComponentSourceDraft(componentId, {
    force: !reconciliation.handled,
  });
  return { reconciliation, synchronization };
}
