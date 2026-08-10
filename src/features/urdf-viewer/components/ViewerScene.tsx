import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MeasureTool } from './MeasureTool';
import { AssemblyJointPickLayer } from './AssemblyJointPickLayer';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { setRegressionRuntimeRobot } from '@/shared/debug/regressionState';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import { RobotModel } from './RobotModel';
import type {
  MeasureToolProps,
  MeasureTargetResolver,
  RobotModelProps,
  ViewerRuntimeStageBridge,
} from '../types';
import { isContinuousHoverEnabledForToolMode } from '../utils/usdInteractionPolicy';
import { getViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
import type { ViewerSceneBaseProps } from '../utils/viewerSceneProps';
import { resolveRegressionRuntimeRobot } from '../utils/regressionRuntimeRobot';

export interface ViewerSceneProps extends ViewerSceneBaseProps {
  t: RobotModelProps['t'];
}

interface MeasureToolLayerProps {
  runtime: ViewerSceneProps['controller']['runtime'];
  toolbar: ViewerSceneProps['controller']['toolbar'];
  measureTool: ViewerSceneProps['controller']['measureTool'];
  hidden: boolean;
  measureTargetResolverRef: NonNullable<MeasureToolProps['measureTargetResolverRef']>;
  robotLinks: MeasureToolProps['robotLinks'];
  t: ViewerSceneProps['t'];
  selection?: ViewerSceneProps['selection'];
  hoveredSelection?: ViewerSceneProps['hoveredSelection'];
}

const MeasureToolLayer = ({
  runtime,
  toolbar,
  measureTool,
  hidden,
  measureTargetResolverRef,
  robotLinks,
  t,
  selection,
  hoveredSelection,
}: MeasureToolLayerProps) => {
  if (hidden) {
    return null;
  }

  return (
    <MeasureTool
      active={toolbar.toolMode === 'measure'}
      robot={runtime.robot}
      robotLinks={robotLinks}
      measureState={measureTool.measureState}
      setMeasureState={measureTool.setMeasureState}
      measureAnchorMode={measureTool.measureAnchorMode}
      showDecomposition={measureTool.showMeasureDecomposition}
      deleteTooltip={t.deleteMeasurement}
      measureTargetResolverRef={measureTargetResolverRef}
      selection={selection}
      hoveredSelection={hoveredSelection}
    />
  );
};

export const ViewerScene = ({
  controller,
  active = true,
  sourceFile,
  sourceFormat,
  allowUrdfXmlFallback = false,
  availableFiles,
  urdfContent,
  assets,
  onDocumentLoadEvent,
  onSceneReadyForDisplay,
  retainedRobot,
  onRuntimeRobotLoaded,
  sourceFilePath,
  groundPlaneOffset,
  mode,
  selection,
  hoveredSelection,
  interactionEnabled = true,
  hoverSelectionEnabled = true,
  onHover,
  onMeshSelect,
  onUpdate,
  onJointMotionCommit,
  robotLinks,
  robotJoints,
  robotData,
  showCollision = controller.optionsPanel.showCollision,
  showCollisionAlwaysOnTop = controller.optionsPanel.showCollisionAlwaysOnTop,
  focusTarget,
  onCollisionTransformPreview,
  onCollisionTransform,
  isMeshPreview = false,
  ikDragActive = false,
  runtimeInstanceKey = 0,
  workspace,
  sceneProjection,
  scenePlacement,
  workspaceSelection,
  onAssemblyTransform,
  onComponentTransform,
  onBridgeTransform,
  pendingAutoGroundComponentIds,
  onAssemblyComponentAutoGroundResolved,
  toolMode,
  t,
}: ViewerSceneProps) => {
  const snapshotRenderActive = useSnapshotRenderActive();
  const effectiveHoverSelectionEnabled =
    hoverSelectionEnabled && isContinuousHoverEnabledForToolMode(toolMode);
  const measureTargetResolverRef = useRef<MeasureTargetResolver | null>(null);
  const [runtimeRobotRevision, setRuntimeRobotRevision] = useState(0);
  const readyNotificationFrameARef = useRef<number | null>(null);
  const readyNotificationFrameBRef = useRef<number | null>(null);
  const regressionRuntimeEnabled = isRegressionDebugEnabled();
  const regressionRuntimeScopeKey =
    regressionRuntimeEnabled && sourceFile ? `${sourceFile.format}:${sourceFile.name}` : null;

  const runtimeBridge = useMemo<ViewerRuntimeStageBridge>(
    () => ({
      onRobotResolved: controller.runtime.handleJointPanelRobotLoaded,
      onSelectionChange: controller.interaction.handleSelectWrapper,
      onActiveJointChange: controller.interaction.handleActiveJointChange,
      onJointAnglesChange: controller.runtime.handleRuntimeJointAnglesChange,
    }),
    [
      controller.interaction.handleActiveJointChange,
      controller.interaction.handleSelectWrapper,
      controller.runtime.handleJointPanelRobotLoaded,
      controller.runtime.handleRuntimeJointAnglesChange,
    ],
  );

  const cancelScheduledSceneReadyNotification = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (readyNotificationFrameARef.current !== null) {
      window.cancelAnimationFrame(readyNotificationFrameARef.current);
      readyNotificationFrameARef.current = null;
    }

    if (readyNotificationFrameBRef.current !== null) {
      window.cancelAnimationFrame(readyNotificationFrameBRef.current);
      readyNotificationFrameBRef.current = null;
    }
  }, []);

  const scheduleSceneReadyForDisplay = useCallback(() => {
    if (!onSceneReadyForDisplay) {
      return;
    }

    if (typeof window === 'undefined') {
      onSceneReadyForDisplay();
      return;
    }

    cancelScheduledSceneReadyNotification();
    readyNotificationFrameARef.current = window.requestAnimationFrame(() => {
      readyNotificationFrameARef.current = null;
      readyNotificationFrameBRef.current = window.requestAnimationFrame(() => {
        readyNotificationFrameBRef.current = null;
        onSceneReadyForDisplay();
      });
    });
  }, [cancelScheduledSceneReadyNotification, onSceneReadyForDisplay]);

  useEffect(
    () => () => {
      cancelScheduledSceneReadyNotification();
    },
    [cancelScheduledSceneReadyNotification],
  );

  useEffect(() => {
    if (!regressionRuntimeScopeKey) {
      return;
    }

    return () => {
      setRegressionRuntimeRobot(null);
    };
  }, [regressionRuntimeScopeKey]);

  useEffect(() => {
    if (!regressionRuntimeScopeKey) {
      return;
    }

    const runtimeRobot = resolveRegressionRuntimeRobot({
      robot: controller.runtime.robot,
      jointPanelRobot: controller.runtime.jointPanelRobot,
      includePrimaryRobot: false,
    });
    if (!runtimeRobot) {
      return;
    }

    setRegressionRuntimeRobot(runtimeRobot);
  }, [controller.runtime.jointPanelRobot, controller.runtime.robot, regressionRuntimeScopeKey]);

  const handleRobotLoaded = useCallback(
    (robot: Parameters<NonNullable<RobotModelProps['onRobotLoaded']>>[0]) => {
      controller.runtime.handleRobotLoaded(robot);
      setRuntimeRobotRevision((revision) => revision + 1);
      if (regressionRuntimeEnabled && sourceFile) {
        setRegressionRuntimeRobot(
          resolveRegressionRuntimeRobot({
            robot,
            jointPanelRobot: null,
          }),
        );
      }
      onRuntimeRobotLoaded?.(robot);
      scheduleSceneReadyForDisplay();
    },
    [
      controller.runtime.handleRobotLoaded,
      onRuntimeRobotLoaded,
      regressionRuntimeEnabled,
      scheduleSceneReadyForDisplay,
      sourceFile,
    ],
  );

  return (
    <>
      <MeasureToolLayer
        runtime={controller.runtime}
        toolbar={controller.toolbar}
        measureTool={controller.measureTool}
        hidden={snapshotRenderActive}
        measureTargetResolverRef={measureTargetResolverRef}
        robotLinks={robotLinks}
        t={t}
        selection={selection}
        hoveredSelection={hoveredSelection}
      />

      <AssemblyJointPickLayer
        robot={controller.runtime.robot}
        runtimeRobotRevision={runtimeRobotRevision}
        workspace={workspace ?? null}
        sceneProjection={sceneProjection ?? null}
        hidden={snapshotRenderActive}
      />

      <Suspense fallback={null}>
        <RobotModel
          active={active}
          urdfContent={urdfContent}
          assets={assets}
          sourceFile={sourceFile}
          availableFiles={availableFiles}
          sourceFormat={sourceFormat ?? getViewerRobotSourceFormat(sourceFile?.format)}
          allowUrdfXmlFallback={allowUrdfXmlFallback}
          reloadToken={runtimeInstanceKey}
          initialRobot={retainedRobot}
          sourceFilePath={sourceFilePath}
          onRobotLoaded={handleRobotLoaded}
          onDocumentLoadEvent={onDocumentLoadEvent}
          runtimeBridge={runtimeBridge}
          showCollision={showCollision}
          showVisual={controller.optionsPanel.showVisual}
          showIkHandles={controller.optionsPanel.showIkHandles}
          showIkHandlesAlwaysOnTop={controller.optionsPanel.showIkHandlesAlwaysOnTop}
          showCollisionAlwaysOnTop={showCollisionAlwaysOnTop}
          onSelect={controller.interaction.handleSelectWrapper}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          onUpdate={onUpdate}
          paintColor={controller.paintTool.paintColor}
          paintSelectionScope={controller.paintTool.paintSelectionScope}
          paintOperation={controller.paintTool.paintOperation}
          paintInteractionRef={controller.paintTool.paintInteractionRef}
          onPaintStatusChange={controller.paintTool.setPaintStatus}
          onJointChange={controller.jointsPanel.handleJointAngleChange}
          onJointChangeCommit={controller.jointsPanel.handleJointChangeCommit}
          onJointMotionCommit={onJointMotionCommit}
          initialJointAngles={controller.runtime.getInitialJointAnglesForNextLoad()}
          registerSceneRefresh={controller.runtime.registerSceneRefresh}
          setIsDragging={controller.interaction.setIsDragging}
          ikRobotState={controller.runtime.closedLoopRobotState}
          onIkPreviewKinematicOverrides={controller.runtime.previewIkJointKinematics}
          onIkCommitKinematicOverrides={controller.runtime.commitIkJointKinematics}
          onClearIkPreviewKinematicOverrides={controller.runtime.clearIkJointKinematicsPreview}
          setActiveJoint={controller.interaction.handleActiveJointChange}
          justSelectedRef={controller.interaction.justSelectedRef}
          t={t}
          mode={mode}
          selection={selection}
          hoveredSelection={hoveredSelection}
          interactionEnabled={interactionEnabled}
          hoverSelectionEnabled={effectiveHoverSelectionEnabled}
          groundPlaneOffset={groundPlaneOffset}
          showInertia={controller.optionsPanel.showInertia}
          showInertiaOverlay={controller.optionsPanel.showInertiaOverlay}
          showCenterOfMass={controller.optionsPanel.showCenterOfMass}
          showCoMOverlay={controller.optionsPanel.showCoMOverlay}
          centerOfMassSize={controller.optionsPanel.centerOfMassSize}
          showOrigins={controller.optionsPanel.showOrigins}
          showOriginsOverlay={controller.optionsPanel.showOriginsOverlay}
          originSize={controller.optionsPanel.originSize}
          showMjcfSites={controller.optionsPanel.showMjcfSites}
          showJointAxes={controller.optionsPanel.showJointAxes}
          showJointAxesOverlay={controller.optionsPanel.showJointAxesOverlay}
          jointAxisSize={controller.optionsPanel.jointAxisSize}
          interactionLayerPriority={controller.interaction.interactionLayerPriority}
          modelOpacity={controller.optionsPanel.modelOpacity}
          robotLinks={robotLinks}
          robotJoints={robotJoints}
          robotData={robotData}
          focusTarget={focusTarget}
          transformMode={controller.interaction.transformMode}
          toolMode={toolMode}
          measureMode={controller.measureTool.measureState.mode}
          ikDragActive={ikDragActive}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransformEnd={onCollisionTransform}
          isOrbitDragging={controller.interaction.isOrbitDragging}
          onTransformPending={controller.interaction.handleTransformPending}
          isSelectionLockedRef={controller.interaction.transformPendingRef}
          isMeshPreview={isMeshPreview}
          workspace={workspace}
          sceneProjection={sceneProjection}
          scenePlacement={scenePlacement}
          workspaceSelection={workspaceSelection}
          onAssemblyTransform={onAssemblyTransform}
          onComponentTransform={onComponentTransform}
          onBridgeTransform={onBridgeTransform}
          pendingAutoGroundComponentIds={pendingAutoGroundComponentIds}
          onAssemblyComponentAutoGroundResolved={onAssemblyComponentAutoGroundResolved}
        />
      </Suspense>
    </>
  );
};
