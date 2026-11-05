import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { RootState } from '@react-three/fiber';
import type { SnapshotCaptureAction } from '@/shared/components/3d/scene/snapshotConfig';
import type { RobotData, RobotFile, UrdfVisual } from '@/types';
import type { SnapshotPreviewSession } from '../components/snapshot-preview/types';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

export function resolveSnapshotPreviewShowVisual() {
  return true;
}

function resolveSnapshotPreviewVisual(visual: UrdfVisual): UrdfVisual {
  return {
    ...visual,
    visible: true,
  };
}

export function resolveSnapshotPreviewRobot(robot: RobotData): RobotData {
  return {
    ...robot,
    links: Object.fromEntries(
      Object.entries(robot.links).map(([linkId, link]) => [
        linkId,
        {
          ...link,
          visible: true,
          visual: resolveSnapshotPreviewVisual(link.visual),
          visualBodies: link.visualBodies?.map(resolveSnapshotPreviewVisual),
        },
      ]),
    ),
  };
}

const SNAPSHOT_PREVIEW_SOURCE_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'mjcf',
  'sdf',
  'xacro',
  'usd',
]);

export function resolveSnapshotPreviewSourceFile({
  viewerSourceFile,
  viewerSourceFilePath,
  viewerSourceFormat,
  availableFiles,
  urdfContentForViewer,
  robotName,
}: {
  viewerSourceFile: RobotFile | null;
  viewerSourceFilePath?: string;
  viewerSourceFormat?: SnapshotPreviewSession['viewerSourceFormat'];
  availableFiles: RobotFile[];
  urdfContentForViewer: string;
  robotName: string;
}): RobotFile | null {
  const inlineContent = urdfContentForViewer.trim();
  if (viewerSourceFile) {
    return {
      ...viewerSourceFile,
      name: viewerSourceFilePath ?? viewerSourceFile.name,
      content: inlineContent || viewerSourceFile.content,
    };
  }

  if (inlineContent) {
    const inlineFormat =
      viewerSourceFormat === 'mjcf' ||
      viewerSourceFormat === 'sdf' ||
      viewerSourceFormat === 'xacro'
        ? viewerSourceFormat
        : 'urdf';
    const inlineExtension = inlineFormat === 'mjcf' ? 'xml' : inlineFormat;
    return {
      name: `${robotName || 'robot'}-snapshot-preview.${inlineExtension}`,
      content: inlineContent,
      format: inlineFormat,
    };
  }

  return (
    availableFiles.find(
      (file) => SNAPSHOT_PREVIEW_SOURCE_FORMATS.has(file.format) && file.content.trim(),
    ) ?? null
  );
}

interface UseSnapshotDialogControllerParams {
  availableFiles: RobotFile[];
  groundPlaneOffset: number;
  jointAngleState?: SnapshotPreviewSession['jointAngleState'];
  jointMotionState?: SnapshotPreviewSession['jointMotionState'];
  selectedFileFormat: RobotFile['format'] | null;
  theme: SnapshotPreviewSession['theme'];
  urdfContentForViewer: string;
  viewerAssets: Record<string, string>;
  viewerCanvasStateRef: MutableRefObject<RootState | null>;
  viewerDocumentReady: boolean;
  viewerReloadKey: number;
  viewerScenePlacement: SnapshotPreviewSession['scenePlacement'];
  viewerShowVisual: boolean;
  viewerSourceFile: RobotFile | null;
  viewerSourceFilePath?: string;
  viewerSourceFormat?: SnapshotPreviewSession['viewerSourceFormat'];
  snapshotPreviewCaptureActionRef: MutableRefObject<SnapshotCaptureAction | null>;
  setIsSnapshotDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSnapshotPreviewSession: Dispatch<SetStateAction<SnapshotPreviewSession | null>>;
}

export function useSnapshotDialogController({
  availableFiles,
  groundPlaneOffset,
  jointAngleState,
  jointMotionState,
  selectedFileFormat,
  theme,
  urdfContentForViewer,
  viewerAssets,
  viewerCanvasStateRef,
  viewerDocumentReady,
  viewerReloadKey,
  viewerScenePlacement,
  viewerShowVisual,
  viewerSourceFile,
  viewerSourceFilePath,
  viewerSourceFormat,
  snapshotPreviewCaptureActionRef,
  setIsSnapshotDialogOpen,
  setSnapshotPreviewSession,
}: UseSnapshotDialogControllerParams) {
  const handleCloseSnapshotDialog = useCallback(() => {
    setIsSnapshotDialogOpen(false);
    setSnapshotPreviewSession(null);
    snapshotPreviewCaptureActionRef.current = null;
  }, [setIsSnapshotDialogOpen, setSnapshotPreviewSession, snapshotPreviewCaptureActionRef]);

  const handleSnapshotPreviewCaptureActionChange = useCallback(
    (action: SnapshotCaptureAction | null) => {
      snapshotPreviewCaptureActionRef.current = action;
    },
    [snapshotPreviewCaptureActionRef],
  );

  const handleSnapshot = useCallback(async () => {
    const viewerCanvasState = viewerCanvasStateRef.current;
    let cameraSnapshot: SnapshotPreviewSession['cameraSnapshot'] = null;
    if (viewerCanvasState) {
      try {
        const { captureWorkspaceCameraSnapshot } =
          await import('@/shared/components/3d/workspace/workspaceCameraSnapshot');
        const viewportElement =
          viewerCanvasState.gl.domElement.parentElement ?? viewerCanvasState.gl.domElement;
        cameraSnapshot = captureWorkspaceCameraSnapshot(viewerCanvasState, viewportElement);
      } catch (error) {
        logRegressionError('[AppLayout] Failed to capture workspace camera snapshot:', error);
      }
    }
    const viewportAspectRatio =
      cameraSnapshot?.visibleViewport?.aspectRatio ??
      cameraSnapshot?.aspectRatio ??
      (viewerCanvasState?.size.width && viewerCanvasState.size.height
        ? viewerCanvasState.size.width / viewerCanvasState.size.height
        : 16 / 9);
    const previewSourceFile = resolveSnapshotPreviewSourceFile({
      viewerSourceFile,
      viewerSourceFilePath,
      viewerSourceFormat,
      availableFiles,
      urdfContentForViewer,
      robotName: viewerScenePlacement.robotData.name,
    });
    const previewUrdfContent =
      urdfContentForViewer.trim() || previewSourceFile?.content.trim() || '';
    const previewRobot = resolveSnapshotPreviewRobot(viewerScenePlacement.robotData);
    const previewCameraSnapshot = viewerShowVisual && viewerDocumentReady ? cameraSnapshot : null;

    snapshotPreviewCaptureActionRef.current = null;
    setSnapshotPreviewSession({
      theme,
      cameraSnapshot: previewCameraSnapshot,
      viewportAspectRatio,
      robotName: previewRobot.name || 'robot',
      robot: previewRobot,
      scenePlacement: {
        ...viewerScenePlacement,
        robotData: previewRobot,
      },
      assets: viewerAssets,
      availableFiles,
      urdfContent: previewUrdfContent,
      viewerSourceFormat,
      sourceFilePath: previewSourceFile?.name ?? viewerSourceFilePath,
      sourceFile: previewSourceFile,
      jointAngleState,
      jointMotionState,
      showVisual: resolveSnapshotPreviewShowVisual(),
      isMeshPreview: selectedFileFormat === 'mesh',
      viewerReloadKey,
      groundPlaneOffset,
    });
    setIsSnapshotDialogOpen(true);
  }, [
    availableFiles,
    groundPlaneOffset,
    jointAngleState,
    jointMotionState,
    selectedFileFormat,
    setIsSnapshotDialogOpen,
    setSnapshotPreviewSession,
    snapshotPreviewCaptureActionRef,
    theme,
    urdfContentForViewer,
    viewerAssets,
    viewerCanvasStateRef,
    viewerDocumentReady,
    viewerReloadKey,
    viewerScenePlacement,
    viewerShowVisual,
    viewerSourceFile,
    viewerSourceFilePath,
    viewerSourceFormat,
  ]);

  return {
    handleCloseSnapshotDialog,
    handleSnapshotPreviewCaptureActionChange,
    handleSnapshot,
  };
}
