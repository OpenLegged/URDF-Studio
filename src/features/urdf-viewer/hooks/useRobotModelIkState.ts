import { useCallback, useMemo } from 'react';
import { Box3, Matrix4, Vector3, type Object3D } from 'three';
import {
  resolveDirectManipulableLinkIkDescriptor,
  resolveDirectManipulableLinkIkJointIds,
  resolveLinkIkHandleDescriptor,
  resolveLinkKey,
} from '@/core/robot';
import {
  resolveViewerJointAngleValue,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { InteractionSelection, JointQuaternion, RobotData, UrdfJoint, UrdfLink } from '@/types';
import type { RobotModelProps } from '../types';
import { resolveSelectedIkDragLinkId } from '../utils/selectedIkDragLink';

const RUNTIME_IK_ANCHOR_EPSILON_SQ = 1e-12;

interface ViewerRuntimeJoint extends Object3D {
  angle?: number;
  jointValue?: number;
  jointType?: string;
}

interface LinkIkKinematicOverrides {
  angles: Record<string, number>;
  quaternions: Record<string, JointQuaternion>;
}

interface UseRobotModelIkStateOptions {
  robot: Object3D | null;
  robotVersion: number;
  selection: InteractionSelection | undefined;
  ikDragActive: boolean;
  robotLinks: Record<string, UrdfLink> | undefined;
  robotJoints: Record<string, UrdfJoint> | undefined;
  rootLinkId: string | null;
  providedIkRobotState: RobotModelProps['ikRobotState'];
  backendRobotData: RobotData | null;
  onIkCommitKinematicOverrides: RobotModelProps['onIkCommitKinematicOverrides'];
  onJointMotionCommit: RobotModelProps['onJointMotionCommit'];
}

function resolveRuntimeLinkBoundsAnchorLocal(
  linkObject: Object3D | null,
): { x: number; y: number; z: number } | null {
  if (!linkObject) {
    return null;
  }

  linkObject.updateMatrixWorld(true);
  const inverseLinkMatrix = new Matrix4().copy(linkObject.matrixWorld).invert();
  const localBounds = new Box3();
  const meshBounds = new Box3();
  let hasBounds = false;

  linkObject.traverse((object) => {
    const mesh = object as Object3D & {
      isMesh?: boolean;
      geometry?: {
        boundingBox?: Box3 | null;
        computeBoundingBox?: () => void;
      };
    };
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox?.();
    }
    if (!mesh.geometry.boundingBox) {
      return;
    }

    object.updateMatrixWorld(true);
    meshBounds
      .copy(mesh.geometry.boundingBox)
      .applyMatrix4(object.matrixWorld)
      .applyMatrix4(inverseLinkMatrix);

    if (meshBounds.isEmpty()) {
      return;
    }

    if (!hasBounds) {
      localBounds.copy(meshBounds);
      hasBounds = true;
      return;
    }

    localBounds.union(meshBounds);
  });

  if (!hasBounds || localBounds.isEmpty()) {
    return null;
  }

  const center = localBounds.getCenter(new Vector3());
  if (center.lengthSq() > RUNTIME_IK_ANCHOR_EPSILON_SQ) {
    return { x: center.x, y: center.y, z: center.z };
  }

  const farthestCorner = new Vector3();
  for (const x of [localBounds.min.x, localBounds.max.x]) {
    for (const y of [localBounds.min.y, localBounds.max.y]) {
      for (const z of [localBounds.min.z, localBounds.max.z]) {
        const candidate = new Vector3(x, y, z);
        if (candidate.lengthSq() > farthestCorner.lengthSq()) {
          farthestCorner.copy(candidate);
        }
      }
    }
  }

  return { x: farthestCorner.x, y: farthestCorner.y, z: farthestCorner.z };
}

/** Derives the currently selected IK target and single-joint transform state. */
export function useRobotModelIkState({
  robot,
  robotVersion,
  selection,
  ikDragActive,
  robotLinks,
  robotJoints,
  rootLinkId,
  providedIkRobotState,
  backendRobotData,
  onIkCommitKinematicOverrides,
  onJointMotionCommit,
}: UseRobotModelIkStateOptions) {
  const selectedIkHandleLinkId = useMemo(
    () =>
      resolveSelectedIkDragLinkId({
        selection,
        ikDragActive,
        robotLinks,
        robotJoints,
        rootLinkId,
      }),
    [ikDragActive, robotJoints, robotLinks, rootLinkId, selection],
  );
  const selectedIkRuntimeLink = useMemo(() => {
    if (!robot || !selectedIkHandleLinkId) {
      return null;
    }

    const runtimeLinkMap = (
      robot as Object3D & {
        links?: Record<string, Object3D>;
      }
    ).links;
    const resolvedLinkId = resolveLinkKey(robotLinks ?? {}, selectedIkHandleLinkId) ?? selectedIkHandleLinkId;

    return runtimeLinkMap?.[resolvedLinkId] ?? runtimeLinkMap?.[selectedIkHandleLinkId] ?? null;
  }, [robot, robotLinks, selectedIkHandleLinkId]);
  const selectedIkHandle = useMemo(
    () =>
      (
        selectedIkRuntimeLink as
          | (Object3D & {
              userData?: { __ikHandle?: Object3D };
            })
          | null
      )?.userData?.__ikHandle ?? null,
    [selectedIkRuntimeLink],
  );
  const selectedPassiveIkHandleDescriptor = useMemo(() => {
    if (!selectedIkHandleLinkId || !rootLinkId || !robotLinks || !robotJoints) {
      return null;
    }

    return resolveLinkIkHandleDescriptor(
      { links: robotLinks, joints: robotJoints, rootLinkId },
      selectedIkHandleLinkId,
    );
  }, [robotJoints, robotLinks, rootLinkId, selectedIkHandleLinkId]);
  const selectedDirectIkJointIds = useMemo(() => {
    if (!selectedIkHandleLinkId || !rootLinkId || !robotLinks || !robotJoints) {
      return null;
    }

    return resolveDirectManipulableLinkIkJointIds(
      { links: robotLinks, joints: robotJoints, rootLinkId },
      selectedIkHandleLinkId,
    );
  }, [robotJoints, robotLinks, rootLinkId, selectedIkHandleLinkId]);
  const selectedDirectIkHandleDescriptor = useMemo(() => {
    if (!selectedIkHandleLinkId || !rootLinkId || !robotLinks || !robotJoints) {
      return null;
    }

    return resolveDirectManipulableLinkIkDescriptor(
      { links: robotLinks, joints: robotJoints, rootLinkId },
      selectedIkHandleLinkId,
    );
  }, [robotJoints, robotLinks, rootLinkId, selectedIkHandleLinkId]);
  const selectedIkHandleDescriptor =
    selectedDirectIkHandleDescriptor ?? selectedPassiveIkHandleDescriptor;
  const selectedRuntimeIkAnchorLocal = useMemo(() => {
    // The runtime graph mutates in place, so its object identity alone cannot
    // invalidate the measured fallback anchor after a backend patch.
    void robotVersion;
    void selectedIkHandleLinkId;
    return resolveRuntimeLinkBoundsAnchorLocal(selectedIkRuntimeLink);
  }, [robotVersion, selectedIkHandleLinkId, selectedIkRuntimeLink]);
  const selectedIkAnchorLocal =
    selectedIkHandleDescriptor?.anchorLocal ?? selectedRuntimeIkAnchorLocal;
  const selectedIkJointIds = selectedIkHandleDescriptor?.jointIds ?? selectedDirectIkJointIds;

  const selectedJointEntry = useMemo(() => {
    if (!robot || selection?.type !== 'joint' || !selection.id) {
      return null;
    }

    const runtimeJoints = (robot as Object3D & { joints?: Record<string, ViewerRuntimeJoint> })
      .joints;
    const jointKey = resolveViewerJointKey(runtimeJoints, selection.id);
    if (!jointKey) {
      return null;
    }

    const joint = runtimeJoints?.[jointKey] ?? null;
    if (!joint || !isSingleDofJoint(joint)) {
      return null;
    }

    return {
      jointKey,
      joint,
      jointName: joint.name || jointKey,
    };
  }, [robot, selection?.id, selection?.type]);
  const selectedJointValue = useMemo(() => {
    if (!selectedJointEntry) {
      return 0;
    }

    return resolveViewerJointAngleValue(
      undefined,
      selectedJointEntry.jointKey,
      selectedJointEntry.joint,
      0,
    );
  }, [selectedJointEntry]);
  const fallbackIkRobotState = useMemo(
    () =>
      rootLinkId && robotLinks && robotJoints
        ? {
            links: robotLinks,
            joints: robotJoints,
            rootLinkId,
            closedLoopConstraints: [],
          }
        : null,
    [robotJoints, robotLinks, rootLinkId],
  );
  const ikRobotState = providedIkRobotState ?? fallbackIkRobotState;
  const createIkHistorySnapshot = useCallback(
    (): RobotData | null => (backendRobotData ? structuredClone(backendRobotData) : null),
    [backendRobotData],
  );
  const commitIkKinematicOverrides = useCallback(
    (overrides: LinkIkKinematicOverrides) => {
      onIkCommitKinematicOverrides?.(overrides.angles, overrides.quaternions);
      onJointMotionCommit?.({
        jointAngles: overrides.angles,
        jointQuaternions: overrides.quaternions,
      });
    },
    [onIkCommitKinematicOverrides, onJointMotionCommit],
  );

  return {
    commitIkKinematicOverrides,
    createIkHistorySnapshot,
    ikRobotState,
    selectedIkAnchorLocal,
    selectedIkHandle,
    selectedIkHandleLinkId,
    selectedIkJointIds,
    selectedIkRuntimeLink,
    selectedJointEntry,
    selectedJointValue,
  };
}
