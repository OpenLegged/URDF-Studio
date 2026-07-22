import { useEffect } from 'react';
import type * as THREE from 'three';

import type { AssemblyScenePlacement } from '@/core/robot';
import type { AssemblyState } from '@/types';

import { resolveAssemblyComponentAutoGrounding } from '../utils/assemblyComponentAutoGrounding';
import type { AssemblyComponentAutoGroundResolution } from '../types';

const AUTO_GROUND_RETRY_DELAYS_MS = [0, 80, 220, 500] as const;

interface UseAssemblyComponentAutoGroundingOptions {
  groundPlaneOffset: number;
  onResolved?: (resolution: AssemblyComponentAutoGroundResolution) => void;
  pendingComponentIds?: readonly string[];
  runtimeRobot: THREE.Object3D | null;
  requestSceneRefresh?: (options?: { force?: boolean }) => void;
  scenePlacement: AssemblyScenePlacement | null;
  workspace: AssemblyState | null;
}

/** Finalize newly appended component placement after its visual meshes are mounted. */
export function useAssemblyComponentAutoGrounding({
  groundPlaneOffset,
  onResolved,
  pendingComponentIds = [],
  requestSceneRefresh,
  runtimeRobot,
  scenePlacement,
  workspace,
}: UseAssemblyComponentAutoGroundingOptions): void {
  useEffect(() => {
    if (
      !runtimeRobot ||
      !scenePlacement ||
      !workspace ||
      !onResolved ||
      pendingComponentIds.length === 0
    ) {
      return;
    }

    let settled = false;
    const attemptGrounding = () => {
      if (settled) {
        return;
      }

      const resolution = resolveAssemblyComponentAutoGrounding({
        componentIds: pendingComponentIds,
        groundPlaneOffset,
        runtimeRobot,
        scenePlacement,
        workspace,
      });
      if (resolution.measuredComponentIds.length === 0) {
        return;
      }

      onResolved(resolution);
      const runtimeDelta = resolution.runtimeRobotLocalPositionDelta;
      if (runtimeDelta) {
        runtimeRobot.position.x += runtimeDelta.x;
        runtimeRobot.position.y += runtimeDelta.y;
        runtimeRobot.position.z += runtimeDelta.z;
        runtimeRobot.updateWorldMatrix(true, true);
      }
      settled = true;
      if (runtimeDelta) {
        requestSceneRefresh?.({ force: true });
      }
    };

    if (typeof window === 'undefined') {
      attemptGrounding();
      return;
    }

    const timers = AUTO_GROUND_RETRY_DELAYS_MS.map((delay) =>
      window.setTimeout(attemptGrounding, delay),
    );
    return () => {
      settled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    groundPlaneOffset,
    onResolved,
    pendingComponentIds,
    requestSceneRefresh,
    runtimeRobot,
    scenePlacement,
    workspace,
  ]);
}
