import * as THREE from 'three';

import type { AssemblyScenePlacement } from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransformUtils';
import { getLowestMeshZ } from '@/shared/utils';
import type { AssemblyState } from '@/types';

import type {
  AssemblyComponentAutoGroundResolution,
  AssemblyComponentGroundAdjustment,
} from '../types';

const DEFAULT_GROUND_TOLERANCE = 1e-4;

type RuntimeRobotWithJoints = THREE.Object3D & {
  joints?: Record<string, THREE.Object3D | undefined>;
};

interface ResolveAssemblyComponentAutoGroundingOptions {
  componentIds: Iterable<string>;
  groundPlaneOffset: number;
  runtimeRobot: THREE.Object3D;
  scenePlacement: AssemblyScenePlacement;
  tolerance?: number;
  workspace: AssemblyState;
}

function resolveRuntimeComponentTarget(
  runtimeRobot: THREE.Object3D,
  scenePlacement: AssemblyScenePlacement,
  componentId: string,
): THREE.Object3D | null {
  if (
    scenePlacement.renderStrategy === 'direct-component' &&
    scenePlacement.directComponentId === componentId
  ) {
    // The direct component transform belongs to the R3F wrapper immediately
    // above the runtime robot. Measuring and resolving the delta on that wrapper
    // keeps the correction in the same coordinate space as component.transform.
    return runtimeRobot.parent;
  }

  const target = scenePlacement.componentTransformTargets.get(componentId);
  if (!target || target.kind !== 'component-root') {
    return null;
  }

  return (runtimeRobot as RuntimeRobotWithJoints).joints?.[target.runtimeJointId] ?? null;
}

function measureComponentLowestPoint(target: THREE.Object3D): number | null {
  return (
    getLowestMeshZ(target, {
      includeInvisible: false,
      includeVisual: true,
      includeCollision: false,
    }) ??
    getLowestMeshZ(target, {
      includeInvisible: true,
      includeVisual: true,
      includeCollision: false,
    })
  );
}

function resolveParentLocalWorldZDelta(target: THREE.Object3D, deltaWorldZ: number): THREE.Vector3 {
  if (!target.parent) {
    return new THREE.Vector3(0, 0, deltaWorldZ);
  }

  target.parent.updateWorldMatrix(true, false);
  const localOrigin = target.parent.worldToLocal(new THREE.Vector3(0, 0, 0));
  const localTarget = target.parent.worldToLocal(new THREE.Vector3(0, 0, deltaWorldZ));
  return localTarget.sub(localOrigin);
}

/**
 * Resolve one-shot canonical transform corrections from fully loaded runtime meshes.
 *
 * Default placement can only estimate mesh bounds. This final pass measures each
 * newly appended, independently transformable component in world space so formats
 * with different authored origins all settle on the same viewer ground plane.
 */
export function resolveAssemblyComponentAutoGrounding({
  componentIds,
  groundPlaneOffset,
  runtimeRobot,
  scenePlacement,
  tolerance = DEFAULT_GROUND_TOLERANCE,
  workspace,
}: ResolveAssemblyComponentAutoGroundingOptions): AssemblyComponentAutoGroundResolution {
  const requestedComponentIds = new Set(componentIds);
  const adjustments: AssemblyComponentGroundAdjustment[] = [];
  const measuredComponentIds: string[] = [];
  const fallbackGroundZ = Number.isFinite(groundPlaneOffset) ? groundPlaneOffset : 0;
  const measurements = new Map<string, { lowestPoint: number; target: THREE.Object3D }>();

  runtimeRobot.updateWorldMatrix(true, true);

  Object.values(workspace.components).forEach((component) => {
    if (!component || component.visible === false) {
      return;
    }

    const target = resolveRuntimeComponentTarget(runtimeRobot, scenePlacement, component.id);
    if (!target) {
      return;
    }

    const lowestPoint = measureComponentLowestPoint(target);
    if (!Number.isFinite(lowestPoint)) {
      return;
    }

    measurements.set(component.id, {
      lowestPoint: Number(lowestPoint),
      target,
    });
  });

  const existingGroundReferenceZ = Math.min(
    ...Array.from(measurements.entries())
      .filter(([componentId]) => !requestedComponentIds.has(componentId))
      .map(([, measurement]) => measurement.lowestPoint),
  );
  const targetGroundZ = Number.isFinite(existingGroundReferenceZ)
    ? existingGroundReferenceZ
    : fallbackGroundZ;
  const runtimeRobotLocalDelta = resolveParentLocalWorldZDelta(
    runtimeRobot,
    fallbackGroundZ - targetGroundZ,
  );
  const runtimeRobotLocalPositionDelta =
    runtimeRobotLocalDelta.lengthSq() > tolerance * tolerance
      ? {
          x: runtimeRobotLocalDelta.x,
          y: runtimeRobotLocalDelta.y,
          z: runtimeRobotLocalDelta.z,
        }
      : null;

  requestedComponentIds.forEach((componentId) => {
    const component = workspace.components[componentId];
    const measurement = measurements.get(componentId);
    if (!component || !measurement) {
      return;
    }

    measuredComponentIds.push(componentId);
    const deltaWorldZ = targetGroundZ - measurement.lowestPoint;
    if (Math.abs(deltaWorldZ) <= tolerance) {
      return;
    }

    const localDelta = resolveParentLocalWorldZDelta(measurement.target, deltaWorldZ);
    const nextTransform = cloneAssemblyTransform(component.transform);
    nextTransform.position.x += localDelta.x;
    nextTransform.position.y += localDelta.y;
    nextTransform.position.z += localDelta.z;
    adjustments.push({ componentId, transform: nextTransform });
  });

  return {
    adjustments,
    measuredComponentIds,
    runtimeRobotLocalPositionDelta,
  };
}
