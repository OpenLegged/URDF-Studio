import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { useJointInteractionPreviewStore } from '@/store';
import { resolveClosedLoopDrivenJointMotion, resolveJointKey } from '@/core/robot';
import type { ViewerJointChangeContext, ViewerJointMotionStateValue } from '@/features/editor';
import type { JointQuaternion, RobotData } from '@/types';

const TREE_PANEL_JOINT_PREVIEW_SESSION_ID = 'tree-panel-joint-slider';
const TREE_PANEL_JOINT_COMMIT_EPSILON = 1e-6;
let nextTreePanelJointPreviewOwnerId = 0;

export interface TreePanelJointCommitSnapshot {
  jointAngles: Record<string, number>;
  jointQuaternions: Record<string, JointQuaternion>;
}

interface UseTreePanelJointPreviewParams {
  previewContextRobot: RobotData;
  jointAngleState: Record<string, number>;
  jointMotionState: Record<string, ViewerJointMotionStateValue>;
  pendingTreePanelJointCommitRef: MutableRefObject<TreePanelJointCommitSnapshot | null>;
  handleCommittedJointChange: (
    jointName: string,
    angle: number,
    context?: ViewerJointChangeContext,
  ) => void;
}

export function useTreePanelJointPreview({
  previewContextRobot,
  jointAngleState,
  jointMotionState,
  pendingTreePanelJointCommitRef,
  handleCommittedJointChange,
}: UseTreePanelJointPreviewParams) {
  const ownerIdRef = useRef<string | null>(null);
  if (ownerIdRef.current === null) {
    nextTreePanelJointPreviewOwnerId += 1;
    ownerIdRef.current = `tree-panel:${nextTreePanelJointPreviewOwnerId}`;
  }

  const isTreePanelJointCommitVisible = useCallback(
    (commit: TreePanelJointCommitSnapshot) =>
      Object.entries(commit.jointAngles).every(([jointId, committedAngle]) => {
        const jointName = previewContextRobot.joints[jointId]?.name;
        const motionAngle =
          jointMotionState[jointId]?.angle ??
          (jointName ? jointMotionState[jointName]?.angle : undefined);
        const snapshotAngle =
          jointAngleState[jointId] ?? (jointName ? jointAngleState[jointName] : undefined);
        const currentAngle =
          typeof motionAngle === 'number'
            ? motionAngle
            : typeof snapshotAngle === 'number'
              ? snapshotAngle
              : previewContextRobot.joints[jointId]?.angle;

        return (
          typeof currentAngle === 'number' &&
          Math.abs(currentAngle - committedAngle) <= TREE_PANEL_JOINT_COMMIT_EPSILON
        );
      }) &&
      Object.entries(commit.jointQuaternions).every(([jointId, committedQuaternion]) => {
        const jointName = previewContextRobot.joints[jointId]?.name;
        const currentQuaternion =
          jointMotionState[jointId]?.quaternion ??
          (jointName ? jointMotionState[jointName]?.quaternion : undefined) ??
          previewContextRobot.joints[jointId]?.quaternion;

        if (!currentQuaternion) {
          return false;
        }

        return (
          Math.abs(currentQuaternion.x - committedQuaternion.x) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.y - committedQuaternion.y) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.z - committedQuaternion.z) <=
            TREE_PANEL_JOINT_COMMIT_EPSILON &&
          Math.abs(currentQuaternion.w - committedQuaternion.w) <= TREE_PANEL_JOINT_COMMIT_EPSILON
        );
      }),
    [jointAngleState, jointMotionState, previewContextRobot.joints],
  );

  const clearTreePanelJointPreview = useCallback((deferToNextFrame = false) => {
    const clearPreview = () => {
      useJointInteractionPreviewStore.getState().clearPreview({
        ownerId: ownerIdRef.current,
        source: 'tree-panel',
        dragSessionId: TREE_PANEL_JOINT_PREVIEW_SESSION_ID,
      });
    };

    if (
      deferToNextFrame &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      window.requestAnimationFrame(clearPreview);
      return;
    }

    clearPreview();
  }, []);

  const publishTreePanelJointPreview = useCallback(
    (jointName: string, angle: number) => {
      const jointId = resolveJointKey(previewContextRobot.joints, jointName);
      if (!jointId) {
        return null;
      }

      const solution = resolveClosedLoopDrivenJointMotion(previewContextRobot, jointId, angle);
      const preview = {
        ownerId: ownerIdRef.current,
        source: 'tree-panel',
        dragSessionId: TREE_PANEL_JOINT_PREVIEW_SESSION_ID,
        activeJointId: jointId,
        jointAngles: solution.angles,
        jointQuaternions: solution.quaternions,
        jointOrigins: {},
      } as const;
      useJointInteractionPreviewStore.getState().publishPreview(preview);
      return preview;
    },
    [previewContextRobot],
  );

  const handleJointPreview = useCallback(
    (jointName: string, angle: number) => {
      publishTreePanelJointPreview(jointName, angle);
    },
    [publishTreePanelJointPreview],
  );

  const handleJointChange = useCallback(
    (jointName: string, angle: number, context?: ViewerJointChangeContext) => {
      const preview = publishTreePanelJointPreview(jointName, angle);
      if (preview) {
        pendingTreePanelJointCommitRef.current = {
          jointAngles: preview.jointAngles,
          jointQuaternions: preview.jointQuaternions,
        };
      }

      handleCommittedJointChange(jointName, angle, context);
      if (!preview) {
        clearTreePanelJointPreview(true);
        return;
      }

      const pendingCommit = pendingTreePanelJointCommitRef.current;
      if (pendingCommit && isTreePanelJointCommitVisible(pendingCommit)) {
        pendingTreePanelJointCommitRef.current = null;
        clearTreePanelJointPreview(true);
      }
    },
    [
      clearTreePanelJointPreview,
      handleCommittedJointChange,
      isTreePanelJointCommitVisible,
      pendingTreePanelJointCommitRef,
      publishTreePanelJointPreview,
    ],
  );

  useEffect(() => {
    const pendingCommit = pendingTreePanelJointCommitRef.current;
    if (!pendingCommit || !isTreePanelJointCommitVisible(pendingCommit)) {
      return;
    }

    pendingTreePanelJointCommitRef.current = null;
    clearTreePanelJointPreview(true);
  }, [
    clearTreePanelJointPreview,
    isTreePanelJointCommitVisible,
    jointAngleState,
    jointMotionState,
    pendingTreePanelJointCommitRef,
  ]);

  useEffect(
    () => () => {
      pendingTreePanelJointCommitRef.current = null;
      clearTreePanelJointPreview();
    },
    [clearTreePanelJointPreview, pendingTreePanelJointCommitRef],
  );

  return {
    handleJointPreview,
    handleJointChange,
  };
}
