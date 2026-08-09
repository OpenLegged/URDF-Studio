import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  ORIGIN_AXES_SIZE_FALLBACK_MAX,
  normalizeOriginAxesSize,
  resolveOriginAxesSizeMax,
} from '@/shared/components/3d/helpers/coordinateAxesSizing';
import { beginInitialGroundAlignment } from '@/shared/components/3d/robotPositioning';
import { alignObjectLowestPointToZ, computeVisibleMeshBounds } from '@/shared/utils';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

interface UseViewerGroundingControllerOptions {
  active: boolean;
  groundPlaneOffset: number;
  robot: RuntimeRobotObject | null;
  fallbackRobot: RuntimeRobotObject | null;
  requestSceneRefresh: () => void;
  setOriginSizePreference: Dispatch<SetStateAction<number>>;
}

/** Owns auto-ground scheduling and the model-derived origin-axis size limit. */
export function useViewerGroundingController({
  active,
  groundPlaneOffset,
  robot,
  fallbackRobot,
  requestSceneRefresh,
  setOriginSizePreference,
}: UseViewerGroundingControllerOptions) {
  const previousGroundPlaneOffsetRef = useRef(groundPlaneOffset);
  const runtimeAutoFitGroundHandlerRef = useRef<(() => void) | null>(null);
  const [originAxesSizeMax, setOriginAxesSizeMax] = useState(ORIGIN_AXES_SIZE_FALLBACK_MAX);

  const setOriginSize: Dispatch<SetStateAction<number>> = useCallback(
    (nextValue) => {
      setOriginSizePreference((currentValue) => {
        const resolvedValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue;
        return normalizeOriginAxesSize(resolvedValue, currentValue, originAxesSizeMax);
      });
    },
    [originAxesSizeMax, setOriginSizePreference],
  );

  const syncOriginAxesSizeLimit = useCallback(
    (loadedRobot: RuntimeRobotObject | null) => {
      const bounds = loadedRobot
        ? computeVisibleMeshBounds(loadedRobot, { includeInvisible: true })
        : null;
      const modelExtent = bounds
        ? Math.max(
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            bounds.max.z - bounds.min.z,
          )
        : null;
      const nextMax = resolveOriginAxesSizeMax(modelExtent);

      setOriginAxesSizeMax(nextMax);
      setOriginSizePreference((currentValue) =>
        normalizeOriginAxesSize(currentValue, currentValue, nextMax),
      );
    },
    [setOriginSizePreference],
  );

  const registerRuntimeAutoFitGroundHandler = useCallback((handler: (() => void) | null) => {
    runtimeAutoFitGroundHandlerRef.current = handler;
  }, []);

  const handleAutoFitGround = useCallback(() => {
    if (runtimeAutoFitGroundHandlerRef.current) {
      runtimeAutoFitGroundHandlerRef.current();
      return;
    }

    const currentRobot = robot ?? fallbackRobot;
    if (!currentRobot) {
      return;
    }

    const aligned = alignObjectLowestPointToZ(currentRobot, groundPlaneOffset, {
      includeInvisible: false,
      includeVisual: true,
      includeCollision: false,
    });
    if (aligned === null) {
      alignObjectLowestPointToZ(currentRobot, groundPlaneOffset, {
        includeInvisible: true,
        includeVisual: true,
        includeCollision: false,
      });
    }
    requestSceneRefresh();
  }, [fallbackRobot, groundPlaneOffset, requestSceneRefresh, robot]);

  useEffect(() => {
    if (!active || !robot || !beginInitialGroundAlignment(robot)) {
      return;
    }

    const timers = [0, 80, 220].map((delay) => window.setTimeout(handleAutoFitGround, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  useEffect(() => {
    const previousGroundPlaneOffset = previousGroundPlaneOffsetRef.current;
    previousGroundPlaneOffsetRef.current = groundPlaneOffset;

    if (
      active &&
      robot &&
      !Object.is(previousGroundPlaneOffset, groundPlaneOffset)
    ) {
      handleAutoFitGround();
    }
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  return {
    handleAutoFitGround,
    originAxesSizeMax,
    registerRuntimeAutoFitGroundHandler,
    setOriginSize,
    syncOriginAxesSizeLimit,
  };
}
