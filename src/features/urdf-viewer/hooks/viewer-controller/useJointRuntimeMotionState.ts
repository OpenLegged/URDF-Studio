import { useCallback, useEffect, useMemo, useRef } from 'react';

import { getJointMotionAngleFromActualAngle, getJointReferencePosition } from '@/core/robot';
import { hasJointInteractionPreview, useJointInteractionPreviewStore } from '@/store';
import {
  normalizeViewerJointAngleState,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { JointQuaternion, RobotState } from '@/types';
import type { ViewerJointMotionStateValue } from '../../types';
import {
  hasRuntimeJointQuaternionSetter,
  type RuntimeViewerRobot,
} from '../../utils/runtimeRobotMotion';
import { resolveInitialJointControlState } from '../../utils/jointControlState';
import {
  getRuntimeJointCurrentMotionQuaternion,
  isSameJointAngle,
  isSameJointMotion,
  isSameJointQuaternion,
  mergeClosedLoopRobotStateWithRuntimeJointPose,
  resolveRuntimeReportedJointAngle,
  type RuntimePoseJointLike,
} from './closedLoopJointPreview';

type ClosedLoopRobotState = Pick<
  RobotState,
  'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
>;

interface JointPanelPort {
  activeJointRef: { current: string | null };
  jointAnglesRef: { current: Record<string, number> };
  patchJointPanelAngles: (nextJointAngles: Record<string, number>) => boolean;
  replaceJointPanelAngles: (nextJointAngles: Record<string, number>) => boolean;
  setPanelActiveJoint: (jointName: string | null) => boolean;
}

interface JointPreviewPort {
  clearJointInteractionPreview: () => void;
  publishJointInteractionPreview: (preview: {
    activeJointId: string | null;
    jointAngles?: Record<string, number>;
    jointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>;
  }) => void;
}

interface JointRuntimeStateInput {
  closedLoopRobotState: ClosedLoopRobotState | null;
  jointAngleState?: Record<string, number>;
  jointControlRobot: RuntimeViewerRobot | null;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  jointStateScopeKey: string | null;
}

interface UseJointRuntimeMotionStateOptions {
  panel: JointPanelPort;
  preview: JointPreviewPort;
  requestSceneRefresh: () => void;
  state: JointRuntimeStateInput;
}

interface ApplyRuntimeJointMotionPreviewOptions {
  syncJointPanel?: boolean;
  preserveActiveJointRuntime?: boolean;
  preserveActiveJointPanel?: boolean;
  publishInteractionPreview?: boolean;
}

export interface JointRuntimeMotionController {
  applyRuntimeJointMotionPreview: (
    nextJointAngles: Record<string, number>,
    nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    activeJointId?: string | null,
    options?: ApplyRuntimeJointMotionPreviewOptions,
  ) => void;
  commitIkJointKinematics: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  effectiveClosedLoopRobotState: ClosedLoopRobotState | null;
  getInitialJointAnglesForNextLoad: () => Record<string, number>;
  getJointAnglesSnapshot: () => Record<string, number>;
  initializeJointControlState: (loadedRobot: RuntimeViewerRobot) => void;
  previewIkJointKinematics: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  recordPendingLocalCommittedJointAngles: (nextJointAngles: Record<string, number>) => void;
  resolveJointRestActualAngle: (
    jointNameOrId: string,
    runtimeJoint?: RuntimePoseJointLike | null,
  ) => number;
  resolveRuntimeJointActualAngle: (jointName: string, runtimeMotionAngle: number) => number;
  resolveRuntimeMotionAngle: (
    jointNameOrId: string,
    actualAngle: number,
    runtimeJoint?: RuntimePoseJointLike | null,
  ) => number;
  restoreAppliedJointMotionState: () => void;
  setPreviewMotionState: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  storeAppliedJointMotionState: (
    nextJointAngles: Record<string, number>,
    nextJointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
}

/**
 * Owns the viewer's runtime joint pose, its last committed baseline, and the
 * pending-local shield used while workspace props catch up. Worker scheduling
 * and commit policy stay in `useJointInteractionController`; this hook only
 * mutates the runtime/panel projection and reconciles external motion props.
 */
export function useJointRuntimeMotionState({
  panel,
  preview,
  requestSceneRefresh,
  state,
}: UseJointRuntimeMotionStateOptions): JointRuntimeMotionController {
  const {
    activeJointRef,
    jointAnglesRef,
    patchJointPanelAngles,
    replaceJointPanelAngles,
    setPanelActiveJoint,
  } = panel;
  const { clearJointInteractionPreview, publishJointInteractionPreview } = preview;
  const {
    closedLoopRobotState,
    jointAngleState,
    jointControlRobot,
    jointMotionState,
    jointStateScopeKey,
  } = state;
  const jointControlJoints = jointControlRobot?.joints;
  const jointStateScopeRef = useRef<string | null>(null);
  const previousAppliedJointAngleStateRef = useRef<Record<string, number>>({});
  const previousAppliedJointMotionStateRef = useRef<Record<string, ViewerJointMotionStateValue>>(
    {},
  );
  const previewMotionAnglesRef = useRef<Record<string, number>>({});
  const previewMotionQuaternionsRef = useRef<
    Record<string, ViewerJointMotionStateValue['quaternion']>
  >({});
  const appliedTreePanelJointPreviewRef = useRef(false);
  const pendingLocalCommittedJointAnglesRef = useRef<Record<string, number>>({});

  const effectiveClosedLoopRobotState = useMemo(
    () =>
      mergeClosedLoopRobotStateWithRuntimeJointPose(
        closedLoopRobotState,
        jointControlRobot?.joints as Record<string, RuntimePoseJointLike> | undefined,
      ),
    [closedLoopRobotState, jointControlRobot],
  );

  /** Canonical state wins because only it reliably carries `referencePosition`. */
  const resolveMotionReferenceJoint = useCallback(
    (jointNameOrId: string, runtimeJoint?: RuntimePoseJointLike | null) => {
      const stateJointKey =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          runtimeJoint?.name || jointNameOrId,
        ) ??
        (jointNameOrId in (effectiveClosedLoopRobotState?.joints ?? {}) ? jointNameOrId : null);
      const stateJoint = stateJointKey
        ? effectiveClosedLoopRobotState?.joints?.[stateJointKey]
        : undefined;

      return stateJoint ?? runtimeJoint ?? null;
    },
    [effectiveClosedLoopRobotState?.joints],
  );

  const resolveRuntimeMotionAngle = useCallback(
    (jointNameOrId: string, actualAngle: number, runtimeJoint?: RuntimePoseJointLike | null) => {
      const referenceJoint = resolveMotionReferenceJoint(jointNameOrId, runtimeJoint);
      return referenceJoint
        ? getJointMotionAngleFromActualAngle(referenceJoint, actualAngle)
        : actualAngle;
    },
    [resolveMotionReferenceJoint],
  );

  const resolveJointRestActualAngle = useCallback(
    (jointNameOrId: string, runtimeJoint?: RuntimePoseJointLike | null) => {
      const referenceJoint = resolveMotionReferenceJoint(jointNameOrId, runtimeJoint);
      return referenceJoint ? getJointReferencePosition(referenceJoint) : 0;
    },
    [resolveMotionReferenceJoint],
  );

  const resolveRuntimeJointActualAngle = useCallback(
    (jointName: string, runtimeMotionAngle: number) => {
      const runtimeJointKey = resolveViewerJointKey(jointControlJoints, jointName);
      const runtimeJoint = runtimeJointKey ? jointControlRobot?.joints?.[runtimeJointKey] : null;
      const stateJointKey =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          runtimeJoint?.name || runtimeJointKey || jointName,
        ) ?? (jointName in (effectiveClosedLoopRobotState?.joints ?? {}) ? jointName : null);
      const stateJoint = stateJointKey
        ? effectiveClosedLoopRobotState?.joints?.[stateJointKey]
        : undefined;

      return resolveRuntimeReportedJointAngle(stateJoint, runtimeJoint, runtimeMotionAngle);
    },
    [effectiveClosedLoopRobotState?.joints, jointControlJoints, jointControlRobot],
  );

  const applyRuntimeJointMotionPreview = useCallback(
    (
      nextJointAngles: Record<string, number>,
      nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
      activeJointId: string | null = activeJointRef.current,
      options?: ApplyRuntimeJointMotionPreviewOptions,
    ) => {
      if (!jointControlRobot?.joints) {
        return;
      }

      let shouldRefresh = false;
      const preservedActiveJointKey =
        options?.preserveActiveJointRuntime && activeJointId
          ? (resolveViewerJointKey(jointControlJoints, activeJointId) ?? activeJointId)
          : null;
      let previewJointAngles = nextJointAngles;

      Object.entries(nextJointAngles).forEach(([jointNameOrId, angle]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        if (
          preservedActiveJointKey &&
          (jointKey === preservedActiveJointKey || jointNameOrId === activeJointId)
        ) {
          return;
        }

        const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
        if (!joint || !isSingleDofJoint(joint)) {
          return;
        }

        const runtimeMotionAngle = resolveRuntimeMotionAngle(jointNameOrId, angle, joint);
        const currentAngle = Number(joint.angle ?? joint.jointValue);
        if (!isSameJointAngle(currentAngle, runtimeMotionAngle)) {
          joint.setJointValue?.(runtimeMotionAngle);
          shouldRefresh = true;
        }
      });

      Object.entries(nextJointQuaternions).forEach(([jointNameOrId, quaternion]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        if (
          preservedActiveJointKey &&
          (jointKey === preservedActiveJointKey || jointNameOrId === activeJointId)
        ) {
          return;
        }

        const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
        if (
          !joint ||
          !quaternion ||
          !hasRuntimeJointQuaternionSetter(joint) ||
          isSameJointQuaternion(getRuntimeJointCurrentMotionQuaternion(joint), quaternion)
        ) {
          return;
        }

        joint.setJointQuaternion(quaternion);
        shouldRefresh = true;
      });

      if (preservedActiveJointKey && options?.preserveActiveJointPanel) {
        const preservedActiveJointAngle =
          jointAnglesRef.current[preservedActiveJointKey] ??
          (activeJointId ? jointAnglesRef.current[activeJointId] : undefined);

        if (typeof preservedActiveJointAngle === 'number') {
          const activeAngleKeys = [preservedActiveJointKey, activeJointId].filter(
            (key): key is string => Boolean(key),
          );
          const shouldPatchPreviewActiveAngle = activeAngleKeys.some((key) =>
            Object.hasOwn(nextJointAngles, key),
          );

          if (shouldPatchPreviewActiveAngle) {
            previewJointAngles = { ...nextJointAngles };
            activeAngleKeys.forEach((key) => {
              if (Object.hasOwn(previewJointAngles, key)) {
                previewJointAngles[key] = preservedActiveJointAngle;
              }
            });
          }
        }
      }

      if ((options?.syncJointPanel ?? true) && Object.keys(previewJointAngles).length > 0) {
        patchJointPanelAngles(previewJointAngles);
      }

      previewMotionAnglesRef.current = previewJointAngles;
      previewMotionQuaternionsRef.current = nextJointQuaternions;
      if (options?.publishInteractionPreview !== false) {
        publishJointInteractionPreview({
          activeJointId,
          jointAngles: previewJointAngles,
          jointQuaternions: nextJointQuaternions,
        });
      }

      if (shouldRefresh) {
        requestSceneRefresh();
      }
    },
    [
      activeJointRef,
      jointAnglesRef,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      requestSceneRefresh,
      resolveRuntimeMotionAngle,
    ],
  );

  const setPreviewMotionState = useCallback(
    (
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      previewMotionAnglesRef.current = jointAngles;
      previewMotionQuaternionsRef.current = jointQuaternions;
    },
    [],
  );

  const getJointAnglesSnapshot = useCallback(
    () => ({ ...jointAnglesRef.current }),
    [jointAnglesRef],
  );

  const getInitialJointAnglesForNextLoad = useCallback(() => {
    if (!jointStateScopeKey || jointStateScopeRef.current !== jointStateScopeKey) {
      return {};
    }
    return { ...jointAnglesRef.current };
  }, [jointAnglesRef, jointStateScopeKey]);

  const previewIkJointKinematics = useCallback(
    (
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      applyRuntimeJointMotionPreview(jointAngles, jointQuaternions, activeJointRef.current, {
        syncJointPanel: false,
      });
    },
    [activeJointRef, applyRuntimeJointMotionPreview],
  );

  const storeAppliedJointMotionState = useCallback(
    (
      nextJointAngles: Record<string, number>,
      nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']> = {},
    ) => {
      previousAppliedJointAngleStateRef.current = {
        ...previousAppliedJointAngleStateRef.current,
        ...nextJointAngles,
      };

      const nextMotionState = { ...previousAppliedJointMotionStateRef.current };
      Object.keys(nextJointAngles).forEach((jointNameOrId) => {
        if (!nextJointQuaternions[jointNameOrId]) {
          delete nextMotionState[jointNameOrId];
        }
      });
      Object.entries(nextJointQuaternions).forEach(([jointNameOrId, quaternion]) => {
        if (!quaternion) {
          delete nextMotionState[jointNameOrId];
          return;
        }
        const nextMotion: ViewerJointMotionStateValue = { quaternion };
        const angle = nextJointAngles[jointNameOrId];
        if (typeof angle === 'number') {
          nextMotion.angle = angle;
        }
        nextMotionState[jointNameOrId] = nextMotion;
      });
      previousAppliedJointMotionStateRef.current = nextMotionState;
    },
    [],
  );

  const recordPendingLocalCommittedJointAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const normalizedAngles = normalizeViewerJointAngleState(jointControlJoints, nextJointAngles);
      if (Object.keys(normalizedAngles).length === 0) {
        return;
      }
      pendingLocalCommittedJointAnglesRef.current = {
        ...pendingLocalCommittedJointAnglesRef.current,
        ...normalizedAngles,
      };
    },
    [jointControlJoints],
  );

  const commitIkJointKinematics = useCallback(
    (
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      storeAppliedJointMotionState(jointAngles, jointQuaternions);
      recordPendingLocalCommittedJointAngles(jointAngles);
      if (Object.keys(jointAngles).length > 0) {
        patchJointPanelAngles(jointAngles);
      }
      previewMotionAnglesRef.current = { ...previousAppliedJointAngleStateRef.current };
      previewMotionQuaternionsRef.current = Object.fromEntries(
        Object.entries(previousAppliedJointMotionStateRef.current)
          .filter(([, motion]) => Boolean(motion?.quaternion))
          .map(([name, motion]) => [name, motion?.quaternion]),
      );
    },
    [patchJointPanelAngles, recordPendingLocalCommittedJointAngles, storeAppliedJointMotionState],
  );

  const restoreAppliedJointMotionState = useCallback(() => {
    clearJointInteractionPreview();
    previewMotionAnglesRef.current = { ...previousAppliedJointAngleStateRef.current };
    previewMotionQuaternionsRef.current = Object.fromEntries(
      Object.entries(previousAppliedJointMotionStateRef.current)
        .filter(([, motion]) => Boolean(motion?.quaternion))
        .map(([name, motion]) => [name, motion?.quaternion]),
    );

    if (!jointControlRobot?.joints) {
      return;
    }

    let shouldRefresh = false;
    Object.entries(previousAppliedJointAngleStateRef.current).forEach(([jointNameOrId, angle]) => {
      const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
      const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
      if (!joint || !isSingleDofJoint(joint)) {
        return;
      }

      const runtimeMotionAngle = resolveRuntimeMotionAngle(jointNameOrId, angle, joint);
      const currentAngle = Number(joint.angle ?? joint.jointValue);
      if (!isSameJointAngle(currentAngle, runtimeMotionAngle)) {
        joint.setJointValue?.(runtimeMotionAngle);
        shouldRefresh = true;
      }
    });

    Object.entries(previousAppliedJointMotionStateRef.current).forEach(
      ([jointNameOrId, motion]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
        if (
          !joint ||
          !motion?.quaternion ||
          !hasRuntimeJointQuaternionSetter(joint) ||
          isSameJointQuaternion(getRuntimeJointCurrentMotionQuaternion(joint), motion.quaternion)
        ) {
          return;
        }
        joint.setJointQuaternion(motion.quaternion);
        shouldRefresh = true;
      },
    );

    if (Object.keys(previousAppliedJointAngleStateRef.current).length > 0) {
      replaceJointPanelAngles(previousAppliedJointAngleStateRef.current);
    }
    if (shouldRefresh) {
      requestSceneRefresh();
    }
  }, [
    clearJointInteractionPreview,
    jointControlJoints,
    jointControlRobot,
    replaceJointPanelAngles,
    requestSceneRefresh,
    resolveRuntimeMotionAngle,
  ]);

  useEffect(() => {
    const applyTreePanelJointPreview = (
      treePreview = useJointInteractionPreviewStore.getState().preview,
    ) => {
      const hasTreePanelPreview =
        treePreview.source === 'tree-panel' &&
        (Object.keys(treePreview.jointAngles).length > 0 ||
          Object.keys(treePreview.jointQuaternions).length > 0 ||
          Object.keys(treePreview.jointOrigins).length > 0);

      if (!hasTreePanelPreview) {
        appliedTreePanelJointPreviewRef.current = false;
        return;
      }

      appliedTreePanelJointPreviewRef.current = true;
      applyRuntimeJointMotionPreview(
        treePreview.jointAngles,
        treePreview.jointQuaternions,
        treePreview.activeJointId,
        { syncJointPanel: false, publishInteractionPreview: false },
      );
    };

    applyTreePanelJointPreview();
    return useJointInteractionPreviewStore.subscribe((nextState, previousState) => {
      const currentIsTreePanelPreview = nextState.preview.source === 'tree-panel';
      const previousWasTreePanelPreview = previousState.preview.source === 'tree-panel';
      if (
        !currentIsTreePanelPreview &&
        !previousWasTreePanelPreview &&
        !appliedTreePanelJointPreviewRef.current
      ) {
        return;
      }
      applyTreePanelJointPreview(nextState.preview);
    });
  }, [applyRuntimeJointMotionPreview]);

  const initializeJointControlState = useCallback(
    (loadedRobot: RuntimeViewerRobot) => {
      const loadedJoints = loadedRobot.joints;
      const preservePreviousAngles =
        jointStateScopeRef.current !== null && jointStateScopeRef.current === jointStateScopeKey;
      const { currentAngles } = resolveInitialJointControlState({
        joints: loadedJoints,
        previousAngles: jointAnglesRef.current,
        preservePreviousAngles,
        isControllableJoint: isSingleDofJoint,
      });

      replaceJointPanelAngles(currentAngles);
      storeAppliedJointMotionState(currentAngles);
      setPanelActiveJoint(null);
      jointStateScopeRef.current = jointStateScopeKey;
    },
    [
      jointAnglesRef,
      jointStateScopeKey,
      replaceJointPanelAngles,
      setPanelActiveJoint,
      storeAppliedJointMotionState,
    ],
  );

  const resetTrackedMotionState = useCallback(() => {
    previousAppliedJointAngleStateRef.current = jointControlRobot?.joints
      ? { ...jointAnglesRef.current }
      : {};
    previousAppliedJointMotionStateRef.current = {};
    previewMotionAnglesRef.current = {};
    previewMotionQuaternionsRef.current = {};
  }, [jointAnglesRef, jointControlRobot]);

  useEffect(() => {
    resetTrackedMotionState();
  }, [
    effectiveClosedLoopRobotState,
    jointControlRobot,
    jointStateScopeKey,
    resetTrackedMotionState,
  ]);

  useEffect(() => {
    pendingLocalCommittedJointAnglesRef.current = {};
  }, [jointStateScopeKey]);

  useEffect(() => {
    if (!jointControlRobot || (!jointAngleState && !jointMotionState)) {
      return;
    }

    const nextAngleState = jointMotionState
      ? Object.fromEntries(
          Object.entries(jointMotionState)
            .filter(([, motion]) => typeof motion?.angle === 'number')
            .map(([name, motion]) => [name, motion.angle as number]),
        )
      : (jointAngleState ?? {});
    let normalizedAngleState = normalizeViewerJointAngleState(jointControlJoints, nextAngleState);
    let effectiveJointMotionState = jointMotionState ?? {};
    const pendingLocalCommittedJointAngles = pendingLocalCommittedJointAnglesRef.current;
    if (Object.keys(pendingLocalCommittedJointAngles).length > 0) {
      const remainingPendingAngles = Object.fromEntries(
        Object.entries(pendingLocalCommittedJointAngles).filter(
          ([jointKey, committedAngle]) =>
            !isSameJointAngle(normalizedAngleState[jointKey], committedAngle),
        ),
      );
      pendingLocalCommittedJointAnglesRef.current = remainingPendingAngles;

      if (Object.keys(remainingPendingAngles).length > 0) {
        normalizedAngleState = { ...normalizedAngleState, ...remainingPendingAngles };
        if (jointMotionState) {
          effectiveJointMotionState = { ...jointMotionState };
          Object.entries(remainingPendingAngles).forEach(([jointKey, angle]) => {
            effectiveJointMotionState[jointKey] = {
              ...(effectiveJointMotionState[jointKey] ?? {}),
              angle,
            };
          });
        }
      }
    }

    const treePanelPreview = useJointInteractionPreviewStore.getState().preview;
    if (treePanelPreview.source === 'tree-panel' && hasJointInteractionPreview(treePanelPreview)) {
      const previewAngles = normalizeViewerJointAngleState(
        jointControlJoints,
        treePanelPreview.jointAngles,
      );
      const previewQuaternionEntries = Object.entries(treePanelPreview.jointQuaternions)
        .map(([jointNameOrId, quaternion]) => {
          const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
          return jointKey && quaternion ? ([jointKey, quaternion] as const) : null;
        })
        .filter((entry): entry is readonly [string, JointQuaternion] => entry !== null);

      if (Object.keys(previewAngles).length > 0) {
        normalizedAngleState = { ...normalizedAngleState, ...previewAngles };
      }
      if (
        jointMotionState &&
        (Object.keys(previewAngles).length > 0 || previewQuaternionEntries.length > 0)
      ) {
        effectiveJointMotionState = { ...effectiveJointMotionState };
        Object.entries(previewAngles).forEach(([jointKey, angle]) => {
          effectiveJointMotionState[jointKey] = {
            ...(effectiveJointMotionState[jointKey] ?? {}),
            angle,
          };
        });
        previewQuaternionEntries.forEach(([jointKey, quaternion]) => {
          effectiveJointMotionState[jointKey] = {
            ...(effectiveJointMotionState[jointKey] ?? {}),
            quaternion,
          };
        });
      }
    }

    const meaningfulJointMotionEntries = Object.entries(effectiveJointMotionState).filter(
      ([, motion]) =>
        Boolean(motion) && (typeof motion?.angle === 'number' || Boolean(motion?.quaternion)),
    );
    if (
      Object.keys(normalizedAngleState).length === 0 &&
      meaningfulJointMotionEntries.length === 0
    ) {
      return;
    }

    const changedPanelAngles = Object.fromEntries(
      Object.entries(normalizedAngleState).filter(
        ([name, angle]) =>
          !isSameJointAngle(previousAppliedJointAngleStateRef.current[name], angle),
      ),
    );
    let shouldRefresh = false;
    if (Object.keys(changedPanelAngles).length > 0) {
      patchJointPanelAngles(changedPanelAngles);
    }

    meaningfulJointMotionEntries.forEach(([name, motion]) => {
      if (!motion || isSameJointMotion(previousAppliedJointMotionStateRef.current[name], motion)) {
        return;
      }
      const jointKey = resolveViewerJointKey(jointControlJoints, name);
      const joint = jointKey ? jointControlRobot.joints?.[jointKey] : undefined;
      if (!joint) {
        return;
      }

      if (typeof motion.angle === 'number' && isSingleDofJoint(joint)) {
        const runtimeMotionAngle = resolveRuntimeMotionAngle(name, motion.angle, joint);
        const currentAngle = Number(joint.angle ?? joint.jointValue);
        if (!isSameJointAngle(currentAngle, runtimeMotionAngle)) {
          joint.setJointValue?.(runtimeMotionAngle);
          shouldRefresh = true;
        }
      }
      if (
        motion.quaternion &&
        hasRuntimeJointQuaternionSetter(joint) &&
        !isSameJointQuaternion(getRuntimeJointCurrentMotionQuaternion(joint), motion.quaternion)
      ) {
        joint.setJointQuaternion(motion.quaternion);
        shouldRefresh = true;
      }
    });

    if (!jointMotionState) {
      Object.entries(changedPanelAngles).forEach(([name, angle]) => {
        const jointKey = resolveViewerJointKey(jointControlJoints, name) ?? name;
        const joint = jointControlRobot.joints?.[jointKey];
        if (!joint || !isSingleDofJoint(joint)) {
          return;
        }
        const runtimeMotionAngle = resolveRuntimeMotionAngle(name, angle, joint);
        const currentAngle = Number(joint.angle ?? joint.jointValue);
        if (!isSameJointAngle(currentAngle, runtimeMotionAngle)) {
          joint.setJointValue?.(runtimeMotionAngle);
          shouldRefresh = true;
        }
      });
    }

    previousAppliedJointAngleStateRef.current = normalizedAngleState;
    previousAppliedJointMotionStateRef.current = jointMotionState
      ? Object.fromEntries(meaningfulJointMotionEntries)
      : {};
    previewMotionAnglesRef.current = normalizedAngleState;
    previewMotionQuaternionsRef.current = Object.fromEntries(
      meaningfulJointMotionEntries
        .filter(([, motion]) => Boolean(motion?.quaternion))
        .map(([name, motion]) => [name, motion?.quaternion]),
    );

    if (shouldRefresh) {
      requestSceneRefresh();
    }
  }, [
    jointAngleState,
    jointControlJoints,
    jointControlRobot,
    jointMotionState,
    patchJointPanelAngles,
    requestSceneRefresh,
    resolveRuntimeMotionAngle,
  ]);

  return {
    applyRuntimeJointMotionPreview,
    commitIkJointKinematics,
    effectiveClosedLoopRobotState,
    getInitialJointAnglesForNextLoad,
    getJointAnglesSnapshot,
    initializeJointControlState,
    previewIkJointKinematics,
    recordPendingLocalCommittedJointAngles,
    resolveJointRestActualAngle,
    resolveRuntimeJointActualAngle,
    resolveRuntimeMotionAngle,
    restoreAppliedJointMotionState,
    setPreviewMotionState,
    storeAppliedJointMotionState,
  };
}
