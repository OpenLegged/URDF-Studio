import { useRef, useState, type MutableRefObject } from 'react';
import type { RootState } from '@react-three/fiber';

import type { SnapshotPreviewSession } from '../components/snapshot-preview/types';
import { useBatchThumbnailDebugApi } from './useBatchThumbnailDebugApi';
import { useSnapshotDialogController } from './useSnapshotDialogController';
import { useSnapshotCaptureRequest } from './use_snapshot_capture_request';
import type {
  SnapshotCaptureAction,
  SnapshotCaptureProgress,
  SnapshotPreviewAction,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { RobotFile } from '@/types';

interface UseAppLayoutSnapshotWorkflowParams {
  availableFiles: RobotFile[];
  groundPlaneOffset: number;
  jointAngleState?: SnapshotPreviewSession['jointAngleState'];
  jointMotionState?: SnapshotPreviewSession['jointMotionState'];
  selectedFileFormat: RobotFile['format'] | null;
  theme: SnapshotPreviewSession['theme'];
  urdfContentForViewer: string;
  viewerAssets: Record<string, string>;
  viewerDocumentReady: boolean;
  viewerReloadKey: number;
  viewerRobot: SnapshotPreviewSession['robot'];
  viewerShowVisual: boolean;
  viewerSourceFile: RobotFile | null;
  viewerSourceFilePath?: string;
  viewerSourceFormat?: SnapshotPreviewSession['viewerSourceFormat'];
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  snapshotFailedMessage: string;
}

export interface AppLayoutSnapshotWorkflow {
  snapshotActionRef: MutableRefObject<SnapshotCaptureAction | null>;
  previewActionRef: MutableRefObject<SnapshotPreviewAction | null>;
  viewerCanvasStateRef: MutableRefObject<RootState | null>;
  isDialogOpen: boolean;
  isCapturing: boolean;
  captureProgress: SnapshotCaptureProgress | null;
  previewSession: SnapshotPreviewSession | null;
  handleSnapshotPreviewCaptureActionChange: (action: SnapshotCaptureAction | null) => void;
  handleCloseSnapshotDialog: () => void;
  handleSnapshot: () => Promise<void>;
  handleCaptureSnapshot: ReturnType<typeof useSnapshotCaptureRequest>['handleCaptureSnapshot'];
  handleCancelSnapshotCapture: ReturnType<
    typeof useSnapshotCaptureRequest
  >['handleCancelSnapshotCapture'];
}

/** Owns snapshot refs, preview-session state, capture cancellation and debug registration. */
export function useAppLayoutSnapshotWorkflow({
  availableFiles,
  groundPlaneOffset,
  jointAngleState,
  jointMotionState,
  selectedFileFormat,
  theme,
  urdfContentForViewer,
  viewerAssets,
  viewerDocumentReady,
  viewerReloadKey,
  viewerRobot,
  viewerShowVisual,
  viewerSourceFile,
  viewerSourceFilePath,
  viewerSourceFormat,
  showToast,
  snapshotFailedMessage,
}: UseAppLayoutSnapshotWorkflowParams): AppLayoutSnapshotWorkflow {
  const snapshotActionRef = useRef<SnapshotCaptureAction | null>(null);
  const previewActionRef = useRef<SnapshotPreviewAction | null>(null);
  const viewerCanvasStateRef = useRef<RootState | null>(null);
  const snapshotPreviewCaptureActionRef = useRef<SnapshotCaptureAction | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<SnapshotCaptureProgress | null>(null);
  const [previewSession, setPreviewSession] = useState<SnapshotPreviewSession | null>(null);

  useBatchThumbnailDebugApi({ previewActionRef, viewerCanvasStateRef });

  const { handleCloseSnapshotDialog, handleSnapshotPreviewCaptureActionChange, handleSnapshot } =
    useSnapshotDialogController({
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
      viewerRobot,
      viewerShowVisual,
      viewerSourceFile,
      viewerSourceFilePath,
      viewerSourceFormat,
      snapshotPreviewCaptureActionRef,
      setIsSnapshotDialogOpen: setIsDialogOpen,
      setSnapshotPreviewSession: setPreviewSession,
    });
  const { handleCaptureSnapshot, handleCancelSnapshotCapture } = useSnapshotCaptureRequest({
    liveCaptureActionRef: snapshotActionRef,
    frozenPreviewCaptureActionRef: snapshotPreviewCaptureActionRef,
    snapshotPreviewSession: previewSession,
    setIsSnapshotCapturing: setIsCapturing,
    setSnapshotCaptureProgress: setCaptureProgress,
    showToast,
    snapshotFailedMessage,
  });

  return {
    snapshotActionRef,
    previewActionRef,
    viewerCanvasStateRef,
    isDialogOpen,
    isCapturing,
    captureProgress,
    previewSession,
    handleSnapshotPreviewCaptureActionChange,
    handleCloseSnapshotDialog,
    handleSnapshot,
    handleCaptureSnapshot,
    handleCancelSnapshotCapture,
  };
}
