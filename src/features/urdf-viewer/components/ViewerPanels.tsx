import React from 'react';
import { MeasurePanel } from './MeasurePanel';
import { PaintPanel } from './PaintPanel';
import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { ViewerToolbar } from './ViewerToolbar';
import { translations, type Language } from '@/shared/i18n';
import { useManagedWindowLayer } from '@/store';
import type {
  ViewerControllerJointsPanelSurface,
  ViewerControllerLayoutSurface,
  ViewerControllerMeasureToolSurface,
  ViewerControllerOptionsPanelSurface,
  ViewerControllerPaintToolSurface,
  ViewerControllerToolbarSurface,
} from '../hooks/viewer-controller/viewerControllerSurfaces';
import { useResponsivePanelLayout } from '../hooks/useResponsivePanelLayout';

const LazyJointsPanel = React.lazy(async () => ({
  default: (await import('@/shared/components/Panel/JointsPanel')).JointsPanel,
}));

interface ViewerPanelsProps {
  lang: Language;
  toolbar: ViewerControllerToolbarSurface;
  layout: ViewerControllerLayoutSurface;
  optionsPanel: ViewerControllerOptionsPanelSurface;
  jointsPanel: ViewerControllerJointsPanelSurface;
  measureTool: ViewerControllerMeasureToolSurface;
  paintTool: ViewerControllerPaintToolSurface;
  isMjcfSource?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  preferEdgeDockedOptionsPanel?: boolean;
  paintModeSupported?: boolean;
  showToolbar?: boolean;
}

export const ViewerPanels = ({
  lang,
  toolbar,
  layout,
  optionsPanel,
  jointsPanel,
  measureTool,
  paintTool,
  isMjcfSource = false,
  onUpdate,
  showOptionsPanel = true,
  setShowOptionsPanel,
  showJointPanel = true,
  setShowJointPanel,
  preferEdgeDockedOptionsPanel = false,
  paintModeSupported = true,
  showToolbar = true,
}: ViewerPanelsProps) => {
  const t = translations[lang];
  const viewerOptionsLayer = useManagedWindowLayer('viewerOptions');
  const viewerJointsLayer = useManagedWindowLayer('viewerJoints');
  const measureToolLayer = useManagedWindowLayer('measureTool');
  const paintToolLayer = useManagedWindowLayer('paintTool');
  const { optionsDefaultPosition, jointsDefaultPosition, jointsPanelMaxHeight } =
    useResponsivePanelLayout({
      containerRef: layout.containerRef,
      optionsPanelRef: layout.optionsPanelRef,
      jointPanelRef: layout.jointPanelRef,
      showOptionsPanel,
      showJointPanel,
      preferEdgeDockedOptionsPanel,
    });

  return (
    <>
      {showToolbar ? (
        <ViewerToolbar
          activeMode={toolbar.toolMode}
          setMode={toolbar.handleToolModeChange}
          lang={lang}
        />
      ) : null}

      <ViewerOptionsPanel
        showOptionsPanel={showOptionsPanel}
        optionsPanelRef={layout.optionsPanelRef}
        optionsPanelPos={layout.optionsPanelPos}
        defaultPosition={optionsDefaultPosition}
        onMouseDown={(event) => layout.handleMouseDown('options', event)}
        t={t}
        isOptionsCollapsed={optionsPanel.isOptionsCollapsed}
        toggleOptionsCollapsed={optionsPanel.toggleOptionsCollapsed}
        setShowOptionsPanel={setShowOptionsPanel}
        showVisual={optionsPanel.showVisual}
        setShowVisual={optionsPanel.setShowVisual}
        showCollision={optionsPanel.showCollision}
        setShowCollision={optionsPanel.setShowCollision}
        showCollisionAlwaysOnTop={optionsPanel.showCollisionAlwaysOnTop}
        setShowCollisionAlwaysOnTop={optionsPanel.setShowCollisionAlwaysOnTop}
        modelOpacity={optionsPanel.modelOpacity}
        setModelOpacity={optionsPanel.setModelOpacity}
        showOrigins={optionsPanel.showOrigins}
        setShowOrigins={optionsPanel.setShowOrigins}
        showOriginsOverlay={optionsPanel.showOriginsOverlay}
        setShowOriginsOverlay={optionsPanel.setShowOriginsOverlay}
        originSize={optionsPanel.originSize}
        setOriginSize={optionsPanel.setOriginSize}
        originSizeMax={optionsPanel.originAxesSizeMax}
        showMjcfSiteToggle={isMjcfSource}
        showMjcfSites={optionsPanel.showMjcfSites}
        setShowMjcfSites={optionsPanel.setShowMjcfSites}
        showJointAxes={optionsPanel.showJointAxes}
        setShowJointAxes={optionsPanel.setShowJointAxes}
        showJointAxesOverlay={optionsPanel.showJointAxesOverlay}
        setShowJointAxesOverlay={optionsPanel.setShowJointAxesOverlay}
        jointAxisSize={optionsPanel.jointAxisSize}
        setJointAxisSize={optionsPanel.setJointAxisSize}
        showCenterOfMass={optionsPanel.showCenterOfMass}
        setShowCenterOfMass={optionsPanel.setShowCenterOfMass}
        showCoMOverlay={optionsPanel.showCoMOverlay}
        setShowCoMOverlay={optionsPanel.setShowCoMOverlay}
        centerOfMassSize={optionsPanel.centerOfMassSize}
        setCenterOfMassSize={optionsPanel.setCenterOfMassSize}
        showInertia={optionsPanel.showInertia}
        setShowInertia={optionsPanel.setShowInertia}
        showInertiaOverlay={optionsPanel.showInertiaOverlay}
        setShowInertiaOverlay={optionsPanel.setShowInertiaOverlay}
        onAutoFitGround={optionsPanel.handleAutoFitGround}
        groundPlaneOffset={optionsPanel.groundPlaneOffset}
        groundPlaneOffsetReadOnly={optionsPanel.groundPlaneOffsetReadOnly}
        setGroundPlaneOffset={optionsPanel.setGroundPlaneOffset}
        zIndex={viewerOptionsLayer.zIndex}
        onActivate={viewerOptionsLayer.onActivate}
      />

      {showJointPanel ? (
        <React.Suspense fallback={null}>
          <LazyJointsPanel
            showJointPanel={showJointPanel}
            robot={jointsPanel.jointPanelRobot ?? jointsPanel.robot}
            jointPanelRef={layout.jointPanelRef}
            jointPanelPos={layout.jointPanelPos}
            defaultPosition={jointsDefaultPosition}
            maxHeight={jointsPanelMaxHeight}
            onMouseDown={(event) => layout.handleMouseDown('joints', event)}
            t={t}
            handleResetJoints={jointsPanel.handleResetJoints}
            angleUnit={jointsPanel.angleUnit}
            setAngleUnit={jointsPanel.setAngleUnit}
            isJointsCollapsed={jointsPanel.isJointsCollapsed}
            toggleJointsCollapsed={jointsPanel.toggleJointsCollapsed}
            setShowJointPanel={setShowJointPanel}
            jointPanelStore={jointsPanel.jointPanelStore}
            setActiveJoint={jointsPanel.setActiveJoint}
            handleJointAngleChange={jointsPanel.handleJointAngleChange}
            handleJointChangeCommit={jointsPanel.handleJointChangeCommit}
            setIsDragging={jointsPanel.setIsDragging}
            onSelect={jointsPanel.handleSelectWrapper}
            onHover={jointsPanel.handleHoverWrapper}
            onUpdate={onUpdate}
            zIndex={viewerJointsLayer.zIndex}
            onActivate={viewerJointsLayer.onActivate}
          />
        </React.Suspense>
      ) : null}

      <MeasurePanel
        toolMode={measureTool.toolMode}
        measurePanelRef={layout.measurePanelRef}
        measurePanelPos={layout.measurePanelPos}
        onMouseDown={(event) => layout.handleMouseDown('measure', event)}
        onClose={measureTool.handleCloseMeasureTool}
        measureState={measureTool.measureState}
        setMeasureState={measureTool.setMeasureState}
        measureMode={measureTool.measureState.mode}
        setMeasureMode={measureTool.setMeasureMode}
        measureAnchorMode={measureTool.measureAnchorMode}
        setMeasureAnchorMode={measureTool.setMeasureAnchorMode}
        showMeasureDecomposition={measureTool.showMeasureDecomposition}
        setShowMeasureDecomposition={measureTool.setShowMeasureDecomposition}
        measurePoseRepresentation={measureTool.measurePoseRepresentation}
        setMeasurePoseRepresentation={measureTool.setMeasurePoseRepresentation}
        lang={lang}
        zIndex={measureToolLayer.zIndex}
        onActivate={measureToolLayer.onActivate}
      />

      <PaintPanel
        lang={lang}
        toolMode={paintTool.toolMode}
        paintColor={paintTool.paintColor}
        onPaintColorChange={paintTool.setPaintColor}
        paintSelectionScope={paintTool.paintSelectionScope}
        onPaintSelectionScopeChange={paintTool.setPaintSelectionScope}
        paintOperation={paintTool.paintOperation}
        onPaintOperationChange={paintTool.setPaintOperation}
        paintStatus={paintTool.paintStatus}
        supported={paintModeSupported}
        onClose={paintTool.handleClosePaintTool}
        paintPanelRef={layout.paintPanelRef}
        paintPanelPos={layout.paintPanelPos}
        onMouseDown={(event) => layout.handleMouseDown('paint', event)}
        zIndex={paintToolLayer.zIndex}
        onActivate={paintToolLayer.onActivate}
      />
    </>
  );
};
