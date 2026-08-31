import { createSourceSemanticRobotHash } from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyState } from '@/types';
import { reconcileComponentEditableRobotSource } from './useEditableSourcePatches';

/** Reconcile editable drafts across history, then drop any draft that remains stale. */
export function reconcileComponentSourceDraftsWithWorkspace(
  previousWorkspace?: AssemblyState,
): void {
  const workspace = useWorkspaceStore.getState().workspace;
  const assets = useAssetsStore.getState();
  if (previousWorkspace) {
    Object.entries(assets.componentSourceDrafts).forEach(([componentId, draft]) => {
      const previousComponent = previousWorkspace.components[componentId];
      const currentComponent = workspace.components[componentId];
      if (!previousComponent || !currentComponent) return;
      const previousHash = createSourceSemanticRobotHash(previousComponent.robot);
      const currentHash = createSourceSemanticRobotHash(currentComponent.robot);
      if (previousHash === currentHash || draft.robotSnapshotHash !== previousHash) return;
      reconcileComponentEditableRobotSource({
        componentId,
        expectedRobotSnapshotHash: previousHash,
        previousRobot: previousComponent.robot,
        nextRobot: currentComponent.robot,
      });
    });
  }

  const refreshedAssets = useAssetsStore.getState();
  const currentDrafts = refreshedAssets.componentSourceDrafts;
  const nextDrafts = Object.fromEntries(
    Object.entries(currentDrafts).filter(([componentId, draft]) => {
      const component = workspace.components[componentId];
      return Boolean(
        component &&
          draft.componentId === componentId &&
          draft.robotSnapshotHash === createSourceSemanticRobotHash(component.robot),
      );
    }),
  );

  if (Object.keys(nextDrafts).length !== Object.keys(currentDrafts).length) {
    refreshedAssets.replaceComponentSourceDrafts(nextDrafts);
  }
}
