import { memo, useCallback, useRef } from 'react';
import { isWorkspaceSelectionEditorLocked } from '@/core/robot';
import { RobotModelKernel } from '@/shared/components/3d/robot/components/RobotModelKernel';
import type { RobotModelSceneState } from '@/shared/components/3d/robot/types';
import { useSelectionStore } from '@/store/selectionStore';
import { useUIStore } from '@/store/uiStore';
import { isWorkspaceTransformSelection } from '../utils/workspaceSceneProjection';
import type { RobotModelProps } from '../types';
import { RobotModelWorkspaceLayer } from './RobotModelWorkspaceLayer';

/** Studio owns persisted settings and shared interaction policy; the kernel owns its scene. */
export const RobotModel = memo(function RobotModel(props: RobotModelProps) {
  const cameraProjection = useUIStore((state) => state.viewOptions.cameraProjection);
  const renderQuality = useUIStore((state) => state.viewOptions.renderQuality);
  const showMjcfWorldLink = useUIStore((state) => state.viewOptions.showMjcfWorldLink);
  const hoverFrozen = useSelectionStore((state) => state.hoverFrozen);
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const hoverOwner = useRef(Symbol('robot-model')).current;
  const onHoverFrozenChange = useCallback(
    (frozen: boolean) => setHoverFrozen(hoverOwner, frozen),
    [hoverOwner, setHoverFrozen],
  );
  const transformLocked = Boolean(props.workspace &&
    isWorkspaceSelectionEditorLocked(props.workspace, props.workspaceSelection ?? null));
  const rootTransformActive = isWorkspaceTransformSelection(props.workspaceSelection);
  const hasRootTransformControls = Boolean(
    (props.active ?? true) && props.sceneProjection && props.scenePlacement && rootTransformActive,
  );
  const renderSceneAttachment = (scene: RobotModelSceneState) => (
    <RobotModelWorkspaceLayer
      scene={scene}
      model={props}
      transformLocked={transformLocked}
      transformActive={hasRootTransformControls}
    />
  );

  return (
    <RobotModelKernel
      {...props}
      cameraProjection={cameraProjection}
      renderQuality={renderQuality}
      showMjcfWorldLink={showMjcfWorldLink}
      hoverFrozen={hoverFrozen}
      onHoverFrozenChange={onHoverFrozenChange}
      transformLocked={transformLocked}
      rootTransformActive={rootTransformActive}
      hasRootTransformControls={hasRootTransformControls}
      rootTransform={props.scenePlacement?.assemblyTransform}
      contentTransform={props.scenePlacement?.directComponentTransform}
      renderSceneAttachment={renderSceneAttachment}
    />
  );
});
