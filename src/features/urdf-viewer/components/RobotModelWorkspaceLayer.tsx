import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import type { RobotModelSceneState } from '@/shared/components/3d/robot/types';
import { useAssemblyComponentAutoGrounding } from '../hooks/useAssemblyComponentAutoGrounding';
import type { RobotModelProps } from '../types';
import { AssemblyTransformControls } from './AssemblyTransformControls';

interface RobotModelWorkspaceLayerProps {
  scene: RobotModelSceneState;
  model: RobotModelProps;
  transformLocked: boolean;
  transformActive: boolean;
}

/** Workspace placement and measured grounding belong to the Studio scene attachment. */
export function RobotModelWorkspaceLayer({
  scene, model, transformLocked, transformActive,
}: RobotModelWorkspaceLayerProps) {
  const snapshotRenderActive = useSnapshotRenderActive();
  useAssemblyComponentAutoGrounding({
    groundPlaneOffset: model.groundPlaneOffset ?? 0,
    onResolved: model.onAssemblyComponentAutoGroundResolved,
    pendingComponentIds: model.pendingAutoGroundComponentIds,
    requestSceneRefresh: scene.requestSceneRefresh,
    runtimeRobot: scene.robot,
    scenePlacement: model.scenePlacement ?? null,
    workspace: model.workspace ?? null,
  });

  if (snapshotRenderActive || transformLocked || !transformActive ||
    !model.sceneProjection || !model.scenePlacement ||
    !model.transformMode || model.transformMode === 'select') return null;

  return (
    <AssemblyTransformControls
      runtimeRobot={scene.robot}
      sceneProjection={model.sceneProjection}
      scenePlacement={model.scenePlacement}
      workspaceSelection={model.workspaceSelection ?? null}
      transformMode={model.transformMode}
      assemblyRoot={scene.assemblyRoot}
      directComponentRoot={scene.directComponentRoot}
      onAssemblyTransform={model.onAssemblyTransform}
      onComponentTransform={model.onComponentTransform}
      onBridgeTransform={model.onBridgeTransform}
      onTransformPendingChange={model.onTransformPending}
    />
  );
}
