import { Suspense } from 'react';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { SourceCodeEditorErrorBoundary } from './SourceCodeEditorErrorBoundary';
import { BridgeCreateModal, CollisionOptimizationDialog } from '@/app/utils/overlayLoaders';
import { SourceCodeEditor } from '@/app/utils/sourceCodeEditorLoader';
import type { Language } from '@/shared/i18n';
import type { BridgeJoint, InteractionSelection, Theme, UrdfJoint } from '@/types';
import type { AssemblyState } from '@/types';
import type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '@/features/property-editor';
import type { SourceCodeEditorDocument } from '@/features/code-editor';

interface AppLayoutOverlaysProps {
  isCodeViewerOpen: boolean;
  sourceCodeDocuments: SourceCodeEditorDocument[];
  autoApplyEnabled?: boolean;
  loadingSourceCodeEditorLabel: string;
  onCloseCodeViewer: () => void;
  theme: Theme;
  lang: Language;
  isCollisionOptimizerOpen: boolean;
  loadingOptimizerLabel: string;
  collisionOptimizationSource: CollisionOptimizationSource;
  assets: Record<string, string>;
  sourceFilePath?: string;
  selection: InteractionSelection;
  onCloseCollisionOptimizer: () => void;
  onSelectCollisionTarget: (target: CollisionTargetRef) => void;
  onApplyCollisionOptimization: (
    operations: CollisionOptimizationOperation[],
  ) => void | Promise<void>;
  assemblyState: AssemblyState | null;
  shouldRenderBridgeModal: boolean;
  loadingBridgeDialogLabel: string;
  isBridgeModalOpen: boolean;
  onCloseBridgeModal: () => void;
  onPreviewBridgeChange: (bridge: BridgeJoint | null) => void;
  onCreateBridge: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: Partial<UrdfJoint>;
  }) => unknown;
}

export function AppLayoutOverlays({
  isCodeViewerOpen,
  sourceCodeDocuments,
  autoApplyEnabled = true,
  loadingSourceCodeEditorLabel,
  onCloseCodeViewer,
  theme,
  lang,
  isCollisionOptimizerOpen,
  loadingOptimizerLabel,
  collisionOptimizationSource,
  assets,
  sourceFilePath,
  selection,
  onCloseCollisionOptimizer,
  onSelectCollisionTarget,
  onApplyCollisionOptimization,
  assemblyState,
  shouldRenderBridgeModal,
  loadingBridgeDialogLabel,
  isBridgeModalOpen,
  onCloseBridgeModal,
  onPreviewBridgeChange,
  onCreateBridge,
}: AppLayoutOverlaysProps) {
  return (
    <>
      {isCodeViewerOpen && (
        <SourceCodeEditorErrorBoundary lang={lang} onClose={onCloseCodeViewer}>
          <Suspense fallback={<LazyOverlayFallback label={loadingSourceCodeEditorLabel} />}>
            <SourceCodeEditor
              documents={sourceCodeDocuments}
              onClose={onCloseCodeViewer}
              theme={theme}
              lang={lang}
              autoApplyEnabled={autoApplyEnabled}
            />
          </Suspense>
        </SourceCodeEditorErrorBoundary>
      )}

      {isCollisionOptimizerOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingOptimizerLabel} />}>
          <CollisionOptimizationDialog
            source={collisionOptimizationSource}
            lang={lang}
            assets={assets}
            sourceFilePath={sourceFilePath}
            selection={selection}
            onClose={onCloseCollisionOptimizer}
            onSelectTarget={onSelectCollisionTarget}
            onApply={onApplyCollisionOptimization}
          />
        </Suspense>
      )}

      {assemblyState && shouldRenderBridgeModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingBridgeDialogLabel} />}>
          <BridgeCreateModal
            isOpen={isBridgeModalOpen}
            onClose={onCloseBridgeModal}
            onPreviewChange={onPreviewBridgeChange}
            onCreate={onCreateBridge}
            lang={lang}
          />
        </Suspense>
      )}
    </>
  );
}
