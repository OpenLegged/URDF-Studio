/// <reference lib="webworker" />

import { resolveClosedLoopDrivenJointMotion } from '@/core/robot';
import { buildClosedLoopMotionPreviewRobot } from '@/shared/utils/robot/closedLoopMotionPreview';
import type {
  ClosedLoopMotionPreviewRobot,
  ClosedLoopMotionPreviewWorkerRequest,
  ClosedLoopMotionPreviewWorkerResponse,
} from '@/shared/utils/robot/closedLoopMotionPreviewContract';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
let baseRobot: ClosedLoopMotionPreviewRobot | null = null;

workerScope.addEventListener(
  'message',
  (event: MessageEvent<ClosedLoopMotionPreviewWorkerRequest>) => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'set-base-robot') {
      baseRobot = message.robot;
      return;
    }

    if (message.type !== 'resolve-motion-preview') {
      return;
    }

    try {
      const sourceRobot = message.robot ?? baseRobot;
      if (!sourceRobot) {
        throw new Error('Closed-loop motion preview worker has no base robot.');
      }

      const solveRobot = message.previewState
        ? buildClosedLoopMotionPreviewRobot(sourceRobot, message.previewState)
        : sourceRobot;
      const solution = resolveClosedLoopDrivenJointMotion(
        solveRobot,
        message.jointId,
        message.angle,
        message.options ?? {},
      );

      const response: ClosedLoopMotionPreviewWorkerResponse = {
        type: 'resolve-motion-preview-result',
        requestId: message.requestId,
        solution,
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: ClosedLoopMotionPreviewWorkerResponse = {
        type: 'resolve-motion-preview-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'Closed-loop motion preview worker failed',
      };
      workerScope.postMessage(response);
    }
  },
);

export {};
