import { useCallback, useMemo } from 'react';
import type { AssemblyState, EntityRef, RobotData, WorkspaceSelection } from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { beginCoordinatedWorkspaceTransaction } from '@/app/utils/pendingHistory';
import type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '@/features/property-editor';

interface UseCollisionOptimizationWorkflowParams {
  assemblyState: AssemblyState;
  focusOn: (ref: EntityRef) => void;
  pulseSelection: (selection: WorkspaceSelection) => void;
  setSelection: (selection: WorkspaceSelection) => void;
}

export function useCollisionOptimizationWorkflow({
  assemblyState,
  focusOn,
  pulseSelection,
  setSelection,
}: UseCollisionOptimizationWorkflowParams) {
  const collisionOptimizationSource = useMemo<CollisionOptimizationSource>(() => ({
    kind: 'assembly',
    assembly: assemblyState,
  }), [assemblyState]);

  const handlePreviewCollisionOptimizationTarget = useCallback(
    (target: CollisionTargetRef) => {
      if (!target.componentId) return;
      const ref = {
        type: 'link' as const,
        componentId: target.componentId,
        entityId: target.linkId,
      };
      const nextSelection = {
        entity: ref,
        subType: 'collision' as const,
        objectIndex: target.objectIndex,
      };

      setSelection(nextSelection);
      pulseSelection(nextSelection);
      focusOn(ref);
    },
    [focusOn, pulseSelection, setSelection],
  );

  const handleApplyCollisionOptimization = useCallback(
    async (operations: CollisionOptimizationOperation[]) => {
      if (operations.length === 0) {
        return;
      }

      const { applyCollisionOptimizationOperationsToLinks } = await import(
        '@/features/property-editor/collision_optimization'
      );

      const operationsByComponent = new Map<string, CollisionOptimizationOperation[]>();
      operations.forEach((operation) => {
        if (!operation.componentId) return;
        const bucket = operationsByComponent.get(operation.componentId) ?? [];
        bucket.push(operation);
        operationsByComponent.set(operation.componentId, bucket);
      });

      const currentWorkspace = useWorkspaceStore.getState().workspace;
      const replacements = Array.from(operationsByComponent, ([componentId, componentOperations]) => {
        const component = currentWorkspace.components[componentId];
        if (!component) return null;
        return [componentId, {
          ...component.robot,
          links: applyCollisionOptimizationOperationsToLinks(
            component.robot.links,
            componentOperations,
          ),
        }] as const;
      }).filter((entry): entry is readonly [string, RobotData] => entry !== null);

      if (replacements.length > 0) {
        const operationId = beginCoordinatedWorkspaceTransaction('Optimize collisions');
        try {
          replacements.forEach(([componentId, robot]) => {
            const replaced = useWorkspaceStore.getState().replaceComponentRobot(
              componentId,
              robot,
              { operationId, label: 'Optimize collisions' },
            );
            if (!replaced) {
              throw new Error(`Failed to optimize collisions for component "${componentId}".`);
            }
          });
          if (!useWorkspaceStore.getState().commitWorkspaceTransaction(operationId)) {
            throw new Error('Failed to commit collision optimization.');
          }
        } catch (error) {
          useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
          throw error;
        }
        const assets = useAssetsStore.getState();
        replacements.forEach(([componentId]) => assets.removeComponentSourceDraft(componentId));
      }
    },
    [],
  );

  return {
    collisionOptimizationSource,
    handlePreviewCollisionOptimizationTarget,
    handleApplyCollisionOptimization,
  };
}
