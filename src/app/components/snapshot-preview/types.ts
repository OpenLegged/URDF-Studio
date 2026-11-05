import type {
  ViewerJointMotionStateValue,
  ViewerRobotSourceFormat,
} from '@/features/editor';
import type { WorkspaceCameraSnapshot } from '@/shared/components/3d';
import type { AssemblyScenePlacement } from '@/core/robot';
import type { RobotData, RobotFile } from '@/types';
import type { Theme } from '@/types';

export type SnapshotDialogPreviewStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export interface SnapshotDialogPreviewState {
  status: SnapshotDialogPreviewStatus;
  imageUrl: string | null;
  aspectRatio: number;
}

export interface SnapshotPreviewSession {
  theme: Theme;
  cameraSnapshot: WorkspaceCameraSnapshot | null;
  viewportAspectRatio: number;
  robotName: string;
  robot: RobotData;
  scenePlacement: AssemblyScenePlacement;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  urdfContent: string;
  viewerSourceFormat?: ViewerRobotSourceFormat;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  jointAngleState?: Record<string, number>;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  showVisual: boolean;
  isMeshPreview: boolean;
  viewerReloadKey: number;
  groundPlaneOffset: number;
}
