import React from 'react';

import type { Language } from '@/shared/i18n';
import type {
  ViewerControllerJointsPanelSurface,
  ViewerControllerLayoutSurface,
  ViewerControllerMeasureToolSurface,
  ViewerControllerOptionsPanelSurface,
  ViewerControllerPaintToolSurface,
  ViewerControllerToolbarSurface,
} from '@/features/editor';

import { FilePreviewBanner, FilePreviewError } from './FilePreviewOverlay';
import { LazyViewerJointsPanel, LazyViewerPanels } from './modeModuleLoaders';
import type { FilePreviewState } from './types';

interface UnifiedViewerPanelSurfaces {
  toolbar: ViewerControllerToolbarSurface;
  layout: ViewerControllerLayoutSurface;
  optionsPanel: ViewerControllerOptionsPanelSurface;
  jointsPanel: ViewerControllerJointsPanelSurface;
  measureTool: ViewerControllerMeasureToolSurface;
  paintTool: ViewerControllerPaintToolSurface;
}

interface UnifiedViewerOverlaysProps {
  activePreview?: FilePreviewState;
  lang: Language;
  onClosePreview?: () => void;
  viewerPanels: UnifiedViewerPanelSurfaces;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  showToolbar?: boolean;
}

export function UnifiedViewerOverlays({
  activePreview,
  lang,
  onClosePreview,
  viewerPanels,
  onUpdate,
  showOptionsPanel,
  setShowOptionsPanel,
  showJointPanel,
  setShowJointPanel,
  showToolbar,
}: UnifiedViewerOverlaysProps) {
  if (activePreview) {
    return (
      <>
        <FilePreviewBanner
          fileName={activePreview.fileName}
          onClose={() => onClosePreview?.()}
          lang={lang}
        />
        {!activePreview.urdfContent && <FilePreviewError lang={lang} />}
      </>
    );
  }

  return (
    <>
      <React.Suspense fallback={null}>
        <LazyViewerPanels
          lang={lang}
          toolbar={viewerPanels.toolbar}
          layout={viewerPanels.layout}
          optionsPanel={viewerPanels.optionsPanel}
          jointsPanel={viewerPanels.jointsPanel}
          measureTool={viewerPanels.measureTool}
          paintTool={viewerPanels.paintTool}
          onUpdate={onUpdate}
          showOptionsPanel={showOptionsPanel}
          setShowOptionsPanel={setShowOptionsPanel}
          showJointPanel={false}
          showToolbar={showToolbar}
          preferEdgeDockedOptionsPanel={true}
        />
      </React.Suspense>
      {showJointPanel && (
        <React.Suspense fallback={null}>
          <LazyViewerJointsPanel
            layout={viewerPanels.layout}
            jointsPanel={viewerPanels.jointsPanel}
            showJointPanel={true}
            setShowJointPanel={setShowJointPanel}
            lang={lang}
            onUpdate={onUpdate}
          />
        </React.Suspense>
      )}
    </>
  );
}
