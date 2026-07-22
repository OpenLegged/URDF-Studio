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
  controller: ViewerSceneProps['controller'];
  hidden: boolean;
  measureTargetResolverRef: NonNullable<MeasureToolProps['measureTargetResolverRef']>;
  robotLinks: MeasureToolProps['robotLinks'];
  t: ViewerSceneProps['t'];
  selection?: ViewerSceneProps['selection'];
  hoveredSelection?: ViewerSceneProps['hoveredSelection'];
}

const MeasureToolLayer = ({
  controller,
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
      active={controller.toolMode === 'measure'}
      robot={controller.robot}
      robotLinks={robotLinks}
      measureState={controller.measureState}
      setMeasureState={controller.setMeasureState}
      measureAnchorMode={controller.measureAnchorMode}
      showDecomposition={controller.showMeasureDecomposition}
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
  showCollision = controller.showCollision,
  showCollisionAlwaysOnTop = controller.showCollisionAlwaysOnTop,
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
      onRobotResolved: controller.handleJointPanelRobotLoaded,
      onSelectionChange: controller.handleSelectWrapper,
      onActiveJointChange: controller.handleActiveJointChange,
      onJointAnglesChange: controller.handleRuntimeJointAnglesChange,
    }),
    [
      controller.handleActiveJointChange,
      controller.handleJointPanelRobotLoaded,
      controller.handleRuntimeJointAnglesChange,
      controller.handleSelectWrapper,
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
      robot: controller.robot,
      jointPanelRobot: controller.jointPanelRobot,
      includePrimaryRobot: false,
    });
    if (!runtimeRobot) {
      return;
    }

    setRegressionRuntimeRobot(runtimeRobot);
  }, [controller.jointPanelRobot, controller.robot, regressionRuntimeScopeKey]);

  const handleRobotLoaded = useCallback(
    (robot: Parameters<NonNullable<RobotModelProps['onRobotLoaded']>>[0]) => {
      controller.handleRobotLoaded(robot);
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
      controller.handleRobotLoaded,
      onRuntimeRobotLoaded,
      regressionRuntimeEnabled,
      scheduleSceneReadyForDisplay,
      sourceFile,
    ],
  );

  return (
    <>
      <MeasureToolLayer
        controller={controller}
        hidden={snapshotRenderActive}
        measureTargetResolverRef={measureTargetResolverRef}
        robotLinks={robotLinks}
        t={t}
        selection={selection}
        hoveredSelection={hoveredSelection}
      />

      <AssemblyJointPickLayer
        robot={controller.robot}
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
          showVisual={controller.showVisual}
          showIkHandles={controller.showIkHandles}
          showIkHandlesAlwaysOnTop={controller.showIkHandlesAlwaysOnTop}
          showCollisionAlwaysOnTop={showCollisionAlwaysOnTop}
          onSelect={controller.handleSelectWrapper}
          onHover={onHover}
          onMeshSelect={onMeshSelect}
          onUpdate={onUpdate}
          paintColor={controller.paintColor}
          paintSelectionScope={controller.paintSelectionScope}
          paintOperation={controller.paintOperation}
          paintInteractionRef={controller.paintInteractionRef}
          onPaintStatusChange={controller.setPaintStatus}
          onJointChange={controller.handleJointAngleChange}
          onJointChangeCommit={controller.handleJointChangeCommit}
          onJointMotionCommit={onJointMotionCommit}
          initialJointAngles={controller.getInitialJointAnglesForNextLoad()}
          registerSceneRefresh={controller.registerSceneRefresh}
          setIsDragging={controller.setIsDragging}
          ikRobotState={controller.closedLoopRobotState}
          onIkPreviewKinematicOverrides={controller.previewIkJointKinematics}
          onIkCommitKinematicOverrides={controller.commitIkJointKinematics}
          onClearIkPreviewKinematicOverrides={controller.clearIkJointKinematicsPreview}
          setActiveJoint={controller.handleActiveJointChange}
          justSelectedRef={controller.justSelectedRef}
          t={t}
          mode={mode}
          selection={selection}
          hoveredSelection={hoveredSelection}
          interactionEnabled={interactionEnabled}
          hoverSelectionEnabled={effectiveHoverSelectionEnabled}
          groundPlaneOffset={groundPlaneOffset}
          showInertia={controller.showInertia}
          showInertiaOverlay={controller.showInertiaOverlay}
          showCenterOfMass={controller.showCenterOfMass}
          showCoMOverlay={controller.showCoMOverlay}
          centerOfMassSize={controller.centerOfMassSize}
          showOrigins={controller.showOrigins}
          showOriginsOverlay={controller.showOriginsOverlay}
          originSize={controller.originSize}
          showMjcfSites={controller.showMjcfSites}
          showJointAxes={controller.showJointAxes}
          showJointAxesOverlay={controller.showJointAxesOverlay}
          jointAxisSize={controller.jointAxisSize}
          interactionLayerPriority={controller.interactionLayerPriority}
          modelOpacity={controller.modelOpacity}
          robotLinks={robotLinks}
          robotJoints={robotJoints}
          robotData={robotData}
          focusTarget={focusTarget}
          transformMode={controller.transformMode}
          toolMode={toolMode}
          measureMode={controller.measureState.mode}
          ikDragActive={ikDragActive}
          onCollisionTransformPreview={onCollisionTransformPreview}
          onCollisionTransformEnd={onCollisionTransform}
          isOrbitDragging={controller.isOrbitDragging}
          onTransformPending={controller.handleTransformPending}
          isSelectionLockedRef={controller.transformPendingRef}
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
