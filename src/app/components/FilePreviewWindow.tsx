import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AlertCircle, FileCode, LoaderCircle, Plus } from 'lucide-react';

import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { translations } from '@/shared/i18n';
import {
  classifyLibraryFileKind,
  isLibraryComponentAddableFile,
} from '@/shared/utils/robotFileSupport';
import {
  readStoredWorkspaceViewerShowVisualPreference,
  resolveWorkspaceViewerShowVisual,
  subscribeToShowVisualPreference,
} from '@/app/hooks/workspaceViewerDetailPreferences';
import {
  resolveStandaloneViewerSourceFormat,
  USD_ROBOT_STATE_VIEWER_PLACEHOLDER_URDF,
} from '@/app/hooks/workspace-source-sync/mjcfViewerRuntimePolicy';
import {
  createAssemblyScenePlacement,
  createAssemblySceneProjection,
  createSingleComponentWorkspace,
} from '@/core/robot';
import type { ViewerJointMotionStateValue } from '@/features/editor';
import { useManagedWindowLayer, type Language } from '@/store';
import type { DocumentLoadLifecycleState, DocumentLoadState } from '@/store/assetsStore';
import type { RobotData, RobotFile, RobotState, Theme } from '@/types';

const LazyUnifiedViewer = React.lazy(async () => ({
  default: (await import('./UnifiedViewer')).UnifiedViewer,
}));

interface FilePreviewWindowProps {
  file: RobotFile | null;
  previewRobot: RobotState | null;
  previewState?: { urdfContent: string; fileName: string };
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
  documentLoadState: DocumentLoadState;
  lang: Language;
  theme: Theme;
  showVisual: boolean;
  onClose: () => void;
  onAddComponent?: (file: RobotFile) => void;
}

function normalizeAssetPath(path: string): string {
  return path.replace(/^\/+/, '');
}

function resolveAssetUrl(path: string, assets: Record<string, string>): string | null {
  const normalizedPath = normalizeAssetPath(path);
  return assets[path] ?? assets[normalizedPath] ?? assets[`/${normalizedPath}`] ?? null;
}

function resolvePreviewDocumentLoadLifecycleState(file: RobotFile): DocumentLoadLifecycleState {
  return {
    status: 'ready',
    fileName: file.name,
    format: file.format,
  };
}

export function resolveFilePreviewViewerSourceFile(file: RobotFile): RobotFile {
  return file.format === 'usd'
    ? {
        ...file,
        content: USD_ROBOT_STATE_VIEWER_PLACEHOLDER_URDF,
        format: 'urdf',
      }
    : file;
}

export function createFilePreviewRobotData(previewRobot: RobotState): RobotData {
  const { selection: _selection, ...robotData } = previewRobot;
  return robotData;
}

export function resolveFilePreviewViewerConfig(
  file: RobotFile,
  options: {
    showVisual: boolean;
  },
): {
  showVisual: boolean;
  sourceFile: RobotFile;
  sourceFilePath: string;
  viewerSourceFormat: ReturnType<typeof resolveStandaloneViewerSourceFormat>;
} {
  const sourceFile = resolveFilePreviewViewerSourceFile(file);

  return {
    showVisual: options.showVisual,
    sourceFile,
    sourceFilePath: sourceFile.name,
    viewerSourceFormat: resolveStandaloneViewerSourceFormat(file.format, {
      renderSelectedUsdFromRobotState: file.format === 'usd',
    }),
  };
}

export function resolveFilePreviewShowVisual({
  previewRobot,
  fallbackShowVisual,
  storedPreference,
}: {
  previewRobot: RobotState | null;
  fallbackShowVisual: boolean;
  storedPreference: boolean | null;
}): boolean {
  if (!previewRobot) {
    return fallbackShowVisual;
  }

  return resolveWorkspaceViewerShowVisual({
    robotLinks: previewRobot.links,
    storedPreference,
  });
}

export function buildFilePreviewJointMotionState(
  previewRobot: RobotState | null,
): Record<string, ViewerJointMotionStateValue> | undefined {
  if (!previewRobot) {
    return undefined;
  }

  const motions: Record<string, ViewerJointMotionStateValue> = {};
  Object.entries(previewRobot.joints).forEach(([jointId, joint]) => {
    const nextState: ViewerJointMotionStateValue = {};
    if (joint.angle !== undefined) {
      nextState.angle = joint.angle;
    }
    if (joint.quaternion) {
      nextState.quaternion = { ...joint.quaternion };
    }
    if (nextState.angle !== undefined || nextState.quaternion) {
      motions[jointId] = nextState;
    }
  });

  return Object.keys(motions).length > 0 ? motions : undefined;
}

export function FilePreviewWindow({
  file,
  previewRobot,
  previewState,
  assets,
  allFileContents,
  availableFiles,
  documentLoadState,
  lang,
  theme,
  showVisual,
  onClose,
  onAddComponent,
}: FilePreviewWindowProps) {
  const t = translations[lang];
  const filePreviewWindowLayer = useManagedWindowLayer('filePreview');
  const isOpen = Boolean(file);
  const windowState = useDraggableWindow({
    isOpen,
    defaultPosition: { x: 180, y: 120 },
    defaultSize: { width: 700, height: 500 },
    minSize: { width: 420, height: 320 },
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: true,
    clampResizeToViewport: false,
    dragBounds: {
      allowNegativeX: true,
      minVisibleWidth: 120,
      bottomMargin: 50,
    },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const fileKind = file ? classifyLibraryFileKind(file) : null;
  const imageUrl = useMemo(() => {
    if (!file || fileKind !== 'image') {
      return null;
    }

    return resolveAssetUrl(file.name, assets);
  }, [assets, file, fileKind]);

  const previewLoadState = useMemo(() => {
    if (!file || documentLoadState.fileName !== file.name) {
      return 'idle' as const;
    }

    if (documentLoadState.status === 'loading' || documentLoadState.status === 'hydrating') {
      return 'loading' as const;
    }

    if (documentLoadState.status === 'error') {
      return 'error' as const;
    }

    return 'ready' as const;
  }, [documentLoadState.fileName, documentLoadState.status, file]);

  const previewLifecycleState = useMemo(
    () => (file ? resolvePreviewDocumentLoadLifecycleState(file) : null),
    [file],
  );
  const storedShowVisualPreference = useSyncExternalStore(
    subscribeToShowVisualPreference,
    readStoredWorkspaceViewerShowVisualPreference,
    () => null,
  );
  const previewShowVisual = useMemo(
    () =>
      resolveFilePreviewShowVisual({
        previewRobot,
        fallbackShowVisual: showVisual,
        storedPreference: storedShowVisualPreference,
      }),
    [previewRobot, showVisual, storedShowVisualPreference],
  );
  const previewViewerConfig = useMemo(
    () => (file ? resolveFilePreviewViewerConfig(file, { showVisual: previewShowVisual }) : null),
    [file, previewShowVisual],
  );
  const previewJointMotionState = useMemo(
    () => buildFilePreviewJointMotionState(previewRobot),
    [previewRobot],
  );
  const previewWorkspace = useMemo(
    () => previewRobot
      ? createSingleComponentWorkspace(createFilePreviewRobotData(previewRobot), {
          componentId: 'preview_component',
          sourceFile: file?.name ?? null,
        })
      : null,
    [file?.name, previewRobot],
  );
  const previewSceneProjection = useMemo(
    () => previewWorkspace ? createAssemblySceneProjection(previewWorkspace) : null,
    [previewWorkspace],
  );
  const previewScenePlacement = useMemo(
    () => previewWorkspace && previewSceneProjection
      ? createAssemblyScenePlacement(previewWorkspace, previewSceneProjection)
      : null,
    [previewSceneProjection, previewWorkspace],
  );

  if (!file) {
    return null;
  }

  const displayName = file.name.split('/').pop() ?? file.name;
  const hasMatching3dPreview = Boolean(
    previewState?.fileName === file.name && previewState.urdfContent && previewRobot,
  );
  const canRender3dPreview = Boolean(
    hasMatching3dPreview && fileKind !== 'image',
  );
  const canAddComponent = Boolean(onAddComponent && isLibraryComponentAddableFile(file));
  const showLoadingState = previewLoadState === 'loading' && !canRender3dPreview && !imageUrl;
  const errorMessage =
    previewLoadState === 'error' ? (documentLoadState.error ?? t.noPreviewImage) : t.noPreviewImage;

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <div className={`flex items-center gap-2 ${FLOATING_WINDOW_TITLE_CLASS}`}>
          <FileCode className="h-4 w-4 text-system-blue" />
          <span className="max-w-[320px] truncate" title={file.name}>
            {t.filePreview}: {displayName}
          </span>
        </div>
      }
      headerActions={
        canAddComponent ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-semibold text-green-700 transition-colors hover:bg-green-100 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40"
            onClick={() => onAddComponent?.(file)}
            title={t.addComponent}
            aria-label={t.addComponent}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>{t.add}</span>
          </button>
        ) : null
      }
      className={`flex flex-col overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg shadow-2xl`}
      zIndex={filePreviewWindowLayer.zIndex}
      onActivate={filePreviewWindowLayer.onActivate}
      headerClassName={`flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between border-b border-border-black bg-element-bg px-3`}
      showResizeHandles
      showMinimizeButton={false}
      closeTitle={t.closePreview}
      maximizeTitle={t.expand}
      restoreTitle={t.collapse}
    >
      <div className="relative flex-1 min-h-0 bg-google-light-bg dark:bg-black">
        {canRender3dPreview &&
        previewState &&
        previewRobot &&
        previewLifecycleState &&
        previewWorkspace &&
        previewSceneProjection &&
        previewScenePlacement ? (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
                <LoaderCircle className="h-6 w-6 animate-spin" />
                <span className="text-sm">{t.loadingRobot}</span>
              </div>
            }
          >
            <LazyUnifiedViewer
              key={previewState.fileName}
              workspace={previewWorkspace}
              sceneProjection={previewSceneProjection}
              scenePlacement={previewScenePlacement}
              mode="editor"
              onSelect={() => {}}
              onUpdate={() => {}}
              assets={assets}
              allFileContents={allFileContents}
              lang={lang}
              theme={theme}
              showVisual={previewViewerConfig?.showVisual ?? showVisual}
              jointMotionState={previewJointMotionState}
              showOptionsPanel={false}
              showJointPanel={false}
              showToolbar={false}
              availableFiles={availableFiles}
              urdfContent={previewState.urdfContent}
              viewerSourceFormat={previewViewerConfig?.viewerSourceFormat}
              sourceFilePath={previewViewerConfig?.sourceFilePath ?? file.name}
              sourceFile={previewViewerConfig?.sourceFile ?? file}
              selection={null}
              modelInteractionEnabled={false}
              isMeshPreview={file.format === 'mesh'}
              documentLoadState={previewLifecycleState}
              showUsageGuide={false}
            />
          </React.Suspense>
        ) : imageUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={imageUrl}
              alt={displayName}
              className="max-h-full max-w-full rounded-md object-contain"
            />
          </div>
        ) : showLoadingState ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <LoaderCircle className="h-6 w-6 animate-spin" />
            <span className="text-sm">{t.loadingRobot}</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-text-tertiary">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">{errorMessage}</span>
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
