import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionSolveOptions,
} from '@/core/robot/closedLoops';
import type { JointQuaternion, RobotState } from '@/types';

export type ClosedLoopMotionPreviewRobot = Pick<
  RobotState,
  'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
>;

export type ClosedLoopMotionPreviewWorkerSolveOptions = Omit<
  ClosedLoopMotionSolveOptions,
  'angles' | 'quaternions' | 'lockedJointIds'
>;

export interface ClosedLoopMotionPreviewState {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

export interface ClosedLoopMotionPreviewWorkerSolveRequest {
  type: 'resolve-motion-preview';
  requestId: number;
  robot?: ClosedLoopMotionPreviewRobot;
  jointId: string;
  angle: number;
  options?: ClosedLoopMotionPreviewWorkerSolveOptions;
  previewState?: ClosedLoopMotionPreviewState;
}

export interface ClosedLoopMotionPreviewWorkerSetBaseRobotRequest {
  type: 'set-base-robot';
  robot: ClosedLoopMotionPreviewRobot | null;
}

export type ClosedLoopMotionPreviewWorkerRequest =
  | ClosedLoopMotionPreviewWorkerSolveRequest
  | ClosedLoopMotionPreviewWorkerSetBaseRobotRequest;

export interface ClosedLoopMotionPreviewWorkerSuccessResponse {
  type: 'resolve-motion-preview-result';
  requestId: number;
  solution: ClosedLoopDrivenJointMotionResult;
}

export interface ClosedLoopMotionPreviewWorkerErrorResponse {
  type: 'resolve-motion-preview-error';
  requestId: number;
  error: string;
}

export type ClosedLoopMotionPreviewWorkerResponse =
  | ClosedLoopMotionPreviewWorkerSuccessResponse
  | ClosedLoopMotionPreviewWorkerErrorResponse;

export type ClosedLoopMotionPreviewWorkerSolve = (
  robot: ClosedLoopMotionPreviewRobot,
  jointId: string,
  angle: number,
  options?: ClosedLoopMotionPreviewWorkerSolveOptions,
  previewState?: ClosedLoopMotionPreviewState,
) => Promise<ClosedLoopDrivenJointMotionResult>;
