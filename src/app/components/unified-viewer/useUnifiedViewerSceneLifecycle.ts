import React from 'react';
import type { Object3D as ThreeObject3D } from 'three';

import type { RobotFile } from '@/types';
import type { ViewerRobotSourceFormat } from '@/features/editor';
import {
  buildUnifiedViewerRetainedRobotScopeKey,
  shouldReuseUnifiedViewerRetainedRobot,
} from '@/app/utils/unifiedViewerRetainedRobot';

const INACTIVE_SCENE_UNMOUNT_DELAY_MS = 15_000;

interface UseUnifiedViewerSceneLifecycleParams {
  viewerVisible: boolean;
  viewerMounted: boolean;
  sourceFile?: RobotFile | null;
  sourceFilePath?: string;
  sourceFormat?: ViewerRobotSourceFormat;
  onInactiveViewerTimeout: () => void;
}

/** Owns the retained Three.js graph and every timer tied to its scene lifetime. */
export function useUnifiedViewerSceneLifecycle({
  viewerVisible,
  viewerMounted,
  sourceFile,
  sourceFilePath,
  sourceFormat,
  onInactiveViewerTimeout,
}: UseUnifiedViewerSceneLifecycleParams) {
  const retainedRobotRef = React.useRef<ThreeObject3D | null>(null);
  const retainedRobotScopeRef = React.useRef<string | null>(null);
  const retainedRobotReleaseTimerRef = React.useRef<number | null>(null);
  const inactiveSceneUnmountTimerRef = React.useRef<number | null>(null);
  const retainedRobotScopeKey = React.useMemo(
    () =>
      buildUnifiedViewerRetainedRobotScopeKey({
        sourceFile,
        sourceFilePath,
        sourceFormat,
      }),
    [sourceFile, sourceFilePath, sourceFormat],
  );

  const clearRetainedRobot = React.useCallback(() => {
    if (retainedRobotReleaseTimerRef.current !== null) {
      window.clearTimeout(retainedRobotReleaseTimerRef.current);
      retainedRobotReleaseTimerRef.current = null;
    }
    retainedRobotRef.current = null;
    retainedRobotScopeRef.current = null;
  }, []);

  React.useEffect(() => {
    if (viewerVisible) {
      if (inactiveSceneUnmountTimerRef.current !== null) {
        window.clearTimeout(inactiveSceneUnmountTimerRef.current);
        inactiveSceneUnmountTimerRef.current = null;
      }
      return undefined;
    }
    if (!viewerMounted) {
      return undefined;
    }

    inactiveSceneUnmountTimerRef.current = window.setTimeout(() => {
      inactiveSceneUnmountTimerRef.current = null;
      onInactiveViewerTimeout();
    }, INACTIVE_SCENE_UNMOUNT_DELAY_MS);

    return () => {
      if (inactiveSceneUnmountTimerRef.current !== null) {
        window.clearTimeout(inactiveSceneUnmountTimerRef.current);
        inactiveSceneUnmountTimerRef.current = null;
      }
    };
  }, [onInactiveViewerTimeout, viewerMounted, viewerVisible]);

  React.useEffect(() => {
    if (viewerVisible || viewerMounted || !retainedRobotRef.current) {
      if (retainedRobotReleaseTimerRef.current !== null) {
        window.clearTimeout(retainedRobotReleaseTimerRef.current);
        retainedRobotReleaseTimerRef.current = null;
      }
      return undefined;
    }

    retainedRobotReleaseTimerRef.current = window.setTimeout(() => {
      retainedRobotReleaseTimerRef.current = null;
      retainedRobotRef.current = null;
      retainedRobotScopeRef.current = null;
    }, 0);

    return () => {
      if (retainedRobotReleaseTimerRef.current !== null) {
        window.clearTimeout(retainedRobotReleaseTimerRef.current);
        retainedRobotReleaseTimerRef.current = null;
      }
    };
  }, [viewerMounted, viewerVisible]);

  React.useEffect(() => {
    if (
      retainedRobotScopeRef.current !== null &&
      !shouldReuseUnifiedViewerRetainedRobot(retainedRobotScopeRef.current, retainedRobotScopeKey)
    ) {
      clearRetainedRobot();
    }
  }, [clearRetainedRobot, retainedRobotScopeKey]);

  React.useEffect(
    () => () => {
      if (inactiveSceneUnmountTimerRef.current !== null) {
        window.clearTimeout(inactiveSceneUnmountTimerRef.current);
        inactiveSceneUnmountTimerRef.current = null;
      }
      clearRetainedRobot();
    },
    [clearRetainedRobot],
  );

  const onRuntimeRobotLoaded = React.useCallback(
    (robot: ThreeObject3D) => {
      retainedRobotRef.current = robot;
      retainedRobotScopeRef.current = retainedRobotScopeKey;
    },
    [retainedRobotScopeKey],
  );
  const retainedRobot = shouldReuseUnifiedViewerRetainedRobot(
    retainedRobotScopeRef.current,
    retainedRobotScopeKey,
  )
    ? retainedRobotRef.current
    : null;

  return { retainedRobot, onRuntimeRobotLoaded };
}
