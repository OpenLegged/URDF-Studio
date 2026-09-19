import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  getJointReferencePosition,
  isEntityEditorLocked,
  resolveClosedLoopDrivenJointMotion,
  type AssemblySceneProjection,
} from '@/core/robot';
import {
  projectJointPreviewToWorkspaceTargets,
  type ViewerJointMotionStateValue,
} from '@/features/editor';
import {
  useJointInteractionPreviewStore,
  type JointInteractionPreviewSnapshot,
} from '@/store/jointInteractionPreviewStore';
import { useUIStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  entityRefKey,
  type BridgeEntityRef,
  type JointEntityRef,
  type JointQuaternion,
} from '@/types';

type JointRef = JointEntityRef | BridgeEntityRef;
let nextTreePanelJointPreviewOwnerId = 0;

interface UseTreePanelJointPreviewParams {
  sceneProjection: AssemblySceneProjection;
  jointAngleState: Record<string, number>;
  jointMotionState: Record<string, ViewerJointMotionStateValue>;
  handleCommittedJointChange: (ref: JointRef, angle: number) => void;
  flushJointMotion: () => void;
}

function readWorkspaceJoint(ref: JointRef) {
  const workspace = useWorkspaceStore.getState().workspace;
  return ref.type === 'joint'
    ? workspace.components[ref.componentId]?.robot.joints[ref.entityId]
    : workspace.bridges[ref.bridgeId]?.joint;
}

function quaternionsMatch(current: JointQuaternion | undefined, expected: JointQuaternion) {
  return Boolean(
    current &&
    (['x', 'y', 'z', 'w'] as const).every(
      (axis) => Math.abs(current[axis] - expected[axis]) <= 1e-6,
    ),
  );
}

function isWorkspacePreviewCommitted(preview: JointInteractionPreviewSnapshot) {
  return preview.workspaceTargets?.every(({ ref, angle, quaternion }) => {
    const joint = readWorkspaceJoint(ref);
    return (
      joint &&
      (angle === undefined || Math.abs((joint.angle ?? Number.NaN) - angle) <= 1e-6) &&
      (!quaternion || quaternionsMatch(joint.quaternion, quaternion))
    );
  });
}

/** Keep slider frames in the runtime preview channel; commit the workspace on release. */
export function useTreePanelJointPreview({
  sceneProjection,
  jointAngleState,
  jointMotionState,
  handleCommittedJointChange,
  flushJointMotion,
}: UseTreePanelJointPreviewParams) {
  const ownerIdRef = useRef<string | null>(null);
  const sessionCounterRef = useRef(0);
  const activeSessionRef = useRef<string | null>(null);
  const pendingCommitRef = useRef<JointInteractionPreviewSnapshot | null>(null);
  if (ownerIdRef.current === null) {
    nextTreePanelJointPreviewOwnerId += 1;
    ownerIdRef.current = `tree-panel:${nextTreePanelJointPreviewOwnerId}`;
  }

  // The semantic projection deliberately retains its identity across pose commits.
  // Refresh only its small joint map, without re-projecting geometry and resources.
  const previewRobot = useMemo(() => {
    const robot = sceneProjection.robotData;
    const joints = Object.fromEntries(
      Object.entries(robot.joints).map(([id, joint]) => {
        const motion = jointMotionState[id];
        return [
          id,
          {
            ...joint,
            angle: motion?.angle ?? jointAngleState[id] ?? joint.angle,
            quaternion: motion?.quaternion ?? joint.quaternion,
          },
        ];
      }),
    );
    return { ...robot, joints };
  }, [jointAngleState, jointMotionState, sceneProjection]);

  const clearPreview = useCallback((preview: JointInteractionPreviewSnapshot) => {
    useJointInteractionPreviewStore.getState().clearPreview({
      ownerId: ownerIdRef.current,
      source: 'tree-panel',
      dragSessionId: preview.dragSessionId,
    });
    if (activeSessionRef.current === preview.dragSessionId) {
      activeSessionRef.current = null;
    }
    if (pendingCommitRef.current === preview) {
      pendingCommitRef.current = null;
    }
  }, []);

  const cancelJointPreview = useCallback(() => {
    const store = useJointInteractionPreviewStore.getState();
    const preview = store.preview;
    pendingCommitRef.current = null;
    activeSessionRef.current = null;
    if (preview.ownerId !== ownerIdRef.current || preview.source !== 'tree-panel') {
      return;
    }

    // Preview consumers apply poses imperatively. Restore the canonical pose before
    // removing a cancelled preview, without taking over another viewer's session.
    const jointAngles: JointInteractionPreviewSnapshot['jointAngles'] = {};
    const jointQuaternions: JointInteractionPreviewSnapshot['jointQuaternions'] = {};
    for (const target of preview.workspaceTargets ?? []) {
      const joint = readWorkspaceJoint(target.ref);
      const id = sceneProjection.entityRefKeyToGlobal.get(entityRefKey(target.ref));
      if (!joint || !id) continue;
      if (target.angle !== undefined) {
        jointAngles[id] = joint.angle ?? getJointReferencePosition(joint);
      }
      if (target.quaternion) {
        jointQuaternions[id] = joint.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
      }
    }
    const restoredPreview = { ...preview, jointAngles, jointQuaternions };
    store.publishPreview({
      ...restoredPreview,
      workspaceTargets: projectJointPreviewToWorkspaceTargets(sceneProjection, restoredPreview),
    });
    clearPreview(preview);
  }, [clearPreview, sceneProjection]);

  const publishJointPreview = useCallback(
    (ref: JointRef, angle: number) => {
      const jointId = sceneProjection.entityRefKeyToGlobal.get(entityRefKey(ref));
      const store = useWorkspaceStore.getState();
      if (
        !jointId ||
        !readWorkspaceJoint(ref) ||
        !Number.isFinite(angle) ||
        store.transaction ||
        isEntityEditorLocked(store.workspace, ref)
      ) {
        return null;
      }
      const solution = resolveClosedLoopDrivenJointMotion(previewRobot, jointId, angle, {
        ignoreLimits: useUIStore.getState().ignoreJointLimits,
      });
      if (activeSessionRef.current === null || pendingCommitRef.current) {
        sessionCounterRef.current += 1;
        activeSessionRef.current = String(sessionCounterRef.current);
        pendingCommitRef.current = null;
      }
      const rendererPreview = {
        activeJointId: jointId,
        jointAngles: solution.angles,
        jointQuaternions: solution.quaternions,
        jointOrigins: {},
      };
      const preview: JointInteractionPreviewSnapshot = {
        ownerId: ownerIdRef.current,
        source: 'tree-panel',
        dragSessionId: activeSessionRef.current,
        ...rendererPreview,
        workspaceTargets: projectJointPreviewToWorkspaceTargets(sceneProjection, rendererPreview),
      };
      useJointInteractionPreviewStore.getState().publishPreview(preview);
      return preview;
    },
    [previewRobot, sceneProjection],
  );

  const isCommitVisible = useCallback(
    (preview: JointInteractionPreviewSnapshot) =>
      Object.entries(preview.jointAngles).every(
        ([id, angle]) =>
          Math.abs(
            (jointMotionState[id]?.angle ??
              jointAngleState[id] ??
              previewRobot.joints[id]?.angle ??
              Number.NaN) - angle,
          ) <= 1e-6,
      ) &&
      Object.entries(preview.jointQuaternions).every(([id, quaternion]) => {
        const current = jointMotionState[id]?.quaternion ?? previewRobot.joints[id]?.quaternion;
        return quaternionsMatch(current, quaternion);
      }),
    [jointAngleState, jointMotionState, previewRobot],
  );

  const handleJointPreview = useCallback(
    (ref: JointRef, angle: number) => {
      publishJointPreview(ref, angle);
    },
    [publishJointPreview],
  );

  const handleJointChange = useCallback(
    (ref: JointRef, angle: number) => {
      const preview = publishJointPreview(ref, angle);
      if (!preview) {
        cancelJointPreview();
        return;
      }
      pendingCommitRef.current = preview;
      try {
        handleCommittedJointChange(ref, angle);
        flushJointMotion();
      } catch (error) {
        cancelJointPreview();
        throw error;
      }
      if (!isWorkspacePreviewCommitted(preview)) {
        cancelJointPreview();
        return;
      }
      if (isCommitVisible(preview)) clearPreview(preview);
    },
    [
      cancelJointPreview,
      clearPreview,
      flushJointMotion,
      handleCommittedJointChange,
      isCommitVisible,
      publishJointPreview,
    ],
  );

  useEffect(() => {
    const pending = pendingCommitRef.current;
    if (pending && isCommitVisible(pending)) clearPreview(pending);
  }, [clearPreview, isCommitVisible]);

  useEffect(() => cancelJointPreview, [cancelJointPreview]);

  return { handleJointPreview, handleJointChange, cancelJointPreview };
}
