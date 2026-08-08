import { useCallback, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { SHARED_MATERIALS } from '@/shared/components/3d/sharedMaterials';
import { disposeObject3D } from '../utils/dispose';

/** Keeps the previous scene alive for two frames so robot swaps do not flash blank. */
export function useDeferredRobotDisposal(robotRef: RefObject<THREE.Object3D | null>) {
  const pendingDisposeRobotRef = useRef<THREE.Object3D | null>(null);
  const pendingDisposeFrameRef = useRef<number | null>(null);

  const disposeRobotObject = useCallback((robotObject: THREE.Object3D | null) => {
    if (!robotObject) {
      return;
    }
    if (robotObject.parent) {
      robotObject.parent.remove(robotObject);
    }
    disposeObject3D(robotObject, true, SHARED_MATERIALS);
  }, []);

  const flushPendingRobotDispose = useCallback(() => {
    if (pendingDisposeFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(pendingDisposeFrameRef.current);
      pendingDisposeFrameRef.current = null;
    }

    if (pendingDisposeRobotRef.current) {
      const robotToDispose = pendingDisposeRobotRef.current;
      pendingDisposeRobotRef.current = null;
      disposeRobotObject(robotToDispose);
    }
  }, [disposeRobotObject]);

  const schedulePreviousRobotDispose = useCallback(
    (previousRobot: THREE.Object3D | null) => {
      if (!previousRobot) {
        return;
      }

      flushPendingRobotDispose();
      pendingDisposeRobotRef.current = previousRobot;

      const disposePreviousRobot = () => {
        pendingDisposeFrameRef.current = null;
        const robotToDispose = pendingDisposeRobotRef.current;
        pendingDisposeRobotRef.current = null;

        if (!robotToDispose || robotToDispose === robotRef.current) {
          return;
        }

        disposeRobotObject(robotToDispose);
      };

      if (typeof window !== 'undefined') {
        pendingDisposeFrameRef.current = window.requestAnimationFrame(() => {
          pendingDisposeFrameRef.current = window.requestAnimationFrame(disposePreviousRobot);
        });
        return;
      }

      queueMicrotask(disposePreviousRobot);
    },
    [disposeRobotObject, flushPendingRobotDispose, robotRef],
  );

  return {
    disposeRobotObject,
    flushPendingRobotDispose,
    schedulePreviousRobotDispose,
  };
}
