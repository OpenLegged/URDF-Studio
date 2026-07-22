import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createClosedLoopMotionPreviewWorkerSession,
  type AsyncClosedLoopMotionPreviewSession,
  type ClosedLoopMotionPreviewResult,
} from '@/shared/utils/robot/closedLoopMotionPreview';
import type { RobotState } from '@/types';
import { CLOSED_LOOP_PREVIEW_MAX_IN_FLIGHT } from './closedLoopJointPreview';

type ClosedLoopRobot = Pick<
  RobotState,
  'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
>;

export interface ClosedLoopPreviewScheduleRequest {
  selectedJointId: string;
  resolvedAngle: number;
  diagnosticLabel: string;
  preserveActiveJointRuntime: boolean;
}

export interface ClosedLoopPreviewResolution {
  request: ClosedLoopPreviewScheduleRequest;
  compensation: ClosedLoopMotionPreviewResult;
  hasNewerPendingPreview: boolean;
}

interface UseClosedLoopPreviewSchedulerOptions {
  baseRobot: ClosedLoopRobot | null;
  onResolved: (resolution: ClosedLoopPreviewResolution) => void;
  onRejected: (request: ClosedLoopPreviewScheduleRequest, error: unknown) => void;
}

type SessionFactory = () => AsyncClosedLoopMotionPreviewSession;

/**
 * Owns the closed-loop preview worker session and every transient request handle.
 * `reset` invalidates queued and in-flight results; unmount also resets the session
 * and cancels the owned animation frame.
 */
export function useClosedLoopPreviewScheduler(
  { baseRobot, onResolved, onRejected }: UseClosedLoopPreviewSchedulerOptions,
  createSession: SessionFactory = createClosedLoopMotionPreviewWorkerSession,
) {
  const [session] = useState(createSession);
  const baseRobotRef = useRef(baseRobot);
  const onResolvedRef = useRef(onResolved);
  const onRejectedRef = useRef(onRejected);
  const mountedRef = useRef(false);
  const pendingRequestRef = useRef<ClosedLoopPreviewScheduleRequest | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const inFlightCountRef = useRef(0);
  const workerRequestSerialRef = useRef(0);
  const lastAppliedWorkerSerialRef = useRef(0);

  baseRobotRef.current = baseRobot;
  onResolvedRef.current = onResolved;
  onRejectedRef.current = onRejected;

  const cancel = useCallback(() => {
    generationRef.current += 1;
    pendingRequestRef.current = null;
    if (pendingFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    session.setBaseRobot(baseRobotRef.current);
    session.reset();
  }, [cancel, session]);

  const solve = useCallback(
    async (selectedJointId: string, resolvedAngle: number) => {
      const requestGeneration = generationRef.current;
      const workerRequestSerial = ++workerRequestSerialRef.current;
      session.setBaseRobot(baseRobotRef.current);
      let compensation: ClosedLoopMotionPreviewResult;
      try {
        compensation = await session.solve(selectedJointId, resolvedAngle);
      } catch (error) {
        if (
          !mountedRef.current ||
          requestGeneration !== generationRef.current ||
          workerRequestSerial <= lastAppliedWorkerSerialRef.current
        ) {
          return null;
        }
        throw error;
      }

      if (
        !mountedRef.current ||
        requestGeneration !== generationRef.current ||
        workerRequestSerial <= lastAppliedWorkerSerialRef.current
      ) {
        return null;
      }

      lastAppliedWorkerSerialRef.current = workerRequestSerial;
      return compensation;
    },
    [session],
  );

  const schedule = useCallback(
    (request: ClosedLoopPreviewScheduleRequest) => {
      session.setBaseRobot(baseRobotRef.current);
      pendingRequestRef.current = request;

      if (
        pendingFrameRef.current !== null ||
        inFlightCountRef.current >= CLOSED_LOOP_PREVIEW_MAX_IN_FLIGHT
      ) {
        return;
      }

      const scheduleRun = (run: () => void) => {
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          run();
          return;
        }
        pendingFrameRef.current = window.requestAnimationFrame(run);
      };

      const run = () => {
        pendingFrameRef.current = null;
        const pendingRequest = pendingRequestRef.current;
        pendingRequestRef.current = null;
        if (!pendingRequest) {
          return;
        }

        const requestGeneration = generationRef.current;
        const workerRequestSerial = ++workerRequestSerialRef.current;
        inFlightCountRef.current += 1;
        void session
          .solve(pendingRequest.selectedJointId, pendingRequest.resolvedAngle)
          .then((compensation) => {
            if (
              !mountedRef.current ||
              requestGeneration !== generationRef.current ||
              workerRequestSerial <= lastAppliedWorkerSerialRef.current
            ) {
              return;
            }
            lastAppliedWorkerSerialRef.current = workerRequestSerial;
            onResolvedRef.current({
              request: pendingRequest,
              compensation,
              hasNewerPendingPreview: pendingRequestRef.current !== null,
            });
          })
          .catch((error: unknown) => {
            if (
              !mountedRef.current ||
              requestGeneration !== generationRef.current ||
              workerRequestSerial <= lastAppliedWorkerSerialRef.current
            ) {
              return;
            }
            if (!pendingRequest.preserveActiveJointRuntime) {
              reset();
            }
            onRejectedRef.current(pendingRequest, error);
          })
          .finally(() => {
            inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
            if (
              mountedRef.current &&
              pendingRequestRef.current &&
              inFlightCountRef.current < CLOSED_LOOP_PREVIEW_MAX_IN_FLIGHT
            ) {
              scheduleRun(run);
            }
          });
      };

      scheduleRun(run);
    },
    [reset, session],
  );

  useEffect(() => {
    session.setBaseRobot(baseRobot);
    reset();
  }, [baseRobot, reset, session]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reset();
    };
  }, [reset]);

  return { schedule, solve, cancel, reset };
}
