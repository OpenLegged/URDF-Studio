import { useCallback, useEffect, useRef } from 'react';

import { resolveMimicJointAngleTargets } from '@/core/robot';
import { logRuntimeFailure, scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import {
  normalizeViewerJointAngleState,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { JointQuaternion } from '@/types';
import type { ViewerJointChangeContext, ViewerJointMotionStateValue } from '../../types';
import type { RuntimeViewerRobot } from '../../utils/runtimeRobotMotion';
import {
  compactJointQuaternions,
  type ClosedLoopPreviewCommitState,
  isSameJointAngle,
  resolveClosedLoopPreviewAngles,
  type ViewerJointInteractionEvent,
} from './closedLoopJointPreview';
import {
  type ClosedLoopPreviewResolution,
  useClosedLoopPreviewScheduler,
} from './useClosedLoopPreviewScheduler';
import type { JointRuntimeMotionController } from './useJointRuntimeMotionState';

interface JointPanelPort {
  activeJointRef: { current: string | null };
  jointAnglesRef: { current: Record<string, number> };
  patchJointPanelAngles: (nextJointAngles: Record<string, number>) => boolean;
  setPanelActiveJoint: (jointName: string | null) => boolean;
}

interface JointInteractionPreviewPort {
  clearJointInteractionPreview: () => void;
  publishJointInteractionPreview: (preview: {
    activeJointId: string | null;
    jointAngles?: Record<string, number>;
    jointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>;
  }) => void;
}

interface JointInteractionEventPort {
  emitJointChangeToApp: (
    jointName: string,
    angle: number,
    context?: ViewerJointChangeContext,
  ) => void;
  requestSceneRefresh: () => void;
}

interface JointInteractionState {
  isDraggingRef: { current: boolean };
  jointControlRobot: RuntimeViewerRobot | null;
  jointStateScopeKey: string | null;
}

interface UseJointInteractionControllerOptions {
  events: JointInteractionEventPort;
  motion: JointRuntimeMotionController;
  panel: JointPanelPort;
  preview: JointInteractionPreviewPort;
  state: JointInteractionState;
}

/**
 * Owns joint interaction policy: mimic expansion, closed-loop worker scheduling,
 * drag previews, commit fallback, and reset. Runtime pose refs remain owned by
 * `useJointRuntimeMotionState`; the worker/RAF lifecycle remains owned by the
 * nested `useClosedLoopPreviewScheduler`.
 */
export function useJointInteractionController({
  events,
  motion,
  panel,
  preview,
  state,
}: UseJointInteractionControllerOptions) {
  const { emitJointChangeToApp, requestSceneRefresh } = events;
  const {
    applyRuntimeJointMotionPreview,
    commitIkJointKinematics,
    effectiveClosedLoopRobotState,
    recordPendingLocalCommittedJointAngles,
    resolveJointRestActualAngle,
    resolveRuntimeJointActualAngle,
    resolveRuntimeMotionAngle,
    restoreAppliedJointMotionState,
    setPreviewMotionState,
    storeAppliedJointMotionState,
  } = motion;
  const { activeJointRef, jointAnglesRef, patchJointPanelAngles, setPanelActiveJoint } = panel;
  const { clearJointInteractionPreview, publishJointInteractionPreview } = preview;
  const { isDraggingRef, jointControlRobot, jointStateScopeKey } = state;
  const jointControlJoints = jointControlRobot?.joints;
  const lastClosedLoopPreviewCommitRef = useRef<ClosedLoopPreviewCommitState | null>(null);

  const resolveDrivenMotion = useCallback(
    (jointId: string, angle: number) => {
      if (!effectiveClosedLoopRobotState?.joints?.[jointId]) {
        return {
          angles: { [jointId]: angle },
          lockedJointIds: [jointId],
        };
      }
      return resolveMimicJointAngleTargets(effectiveClosedLoopRobotState, jointId, angle);
    },
    [effectiveClosedLoopRobotState],
  );

  const rememberClosedLoopPreviewCommit = useCallback(
    (
      selectedJointId: string,
      resolvedAngle: number,
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      lastClosedLoopPreviewCommitRef.current = {
        baseRobot: effectiveClosedLoopRobotState,
        selectedJointId,
        resolvedAngle,
        jointAngles: { ...jointAngles },
        jointQuaternions: compactJointQuaternions(jointQuaternions),
      };
    },
    [effectiveClosedLoopRobotState],
  );

  const handleClosedLoopPreviewResolved = useCallback(
    ({
      request: pendingPreview,
      compensation,
      hasNewerPendingPreview,
    }: ClosedLoopPreviewResolution) => {
      const resolvedPreview = resolveClosedLoopPreviewAngles(
        pendingPreview.selectedJointId,
        pendingPreview.resolvedAngle,
        compensation,
      );
      const activePanelAngle = jointAnglesRef.current[pendingPreview.selectedJointId];
      const activePanelMovedPastRequest =
        pendingPreview.preserveActiveJointRuntime &&
        isDraggingRef.current &&
        typeof activePanelAngle === 'number' &&
        !isSameJointAngle(activePanelAngle, pendingPreview.resolvedAngle);
      const shouldPreserveActiveJointPreview =
        pendingPreview.preserveActiveJointRuntime &&
        isDraggingRef.current &&
        (hasNewerPendingPreview || activePanelMovedPastRequest);

      rememberClosedLoopPreviewCommit(
        pendingPreview.selectedJointId,
        pendingPreview.resolvedAngle,
        resolvedPreview.angles,
        compensation.quaternions,
      );
      applyRuntimeJointMotionPreview(
        resolvedPreview.angles,
        compensation.quaternions,
        pendingPreview.selectedJointId,
        {
          preserveActiveJointRuntime:
            pendingPreview.preserveActiveJointRuntime &&
            (resolvedPreview.preserveActiveJointRuntime || shouldPreserveActiveJointPreview),
          preserveActiveJointPanel: shouldPreserveActiveJointPreview,
        },
      );
    },
    [
      applyRuntimeJointMotionPreview,
      isDraggingRef,
      jointAnglesRef,
      rememberClosedLoopPreviewCommit,
    ],
  );

  const handleClosedLoopPreviewRejected = useCallback(
    (pendingPreview: ClosedLoopPreviewResolution['request'], error: unknown) => {
      logRuntimeFailure(
        'useViewerController:scheduleClosedLoopPreviewWorkerSolve',
        new Error(`${pendingPreview.diagnosticLabel} worker solve failed.`, { cause: error }),
        'warn',
      );
      if (!pendingPreview.preserveActiveJointRuntime) {
        lastClosedLoopPreviewCommitRef.current = null;
        restoreAppliedJointMotionState();
      }
    },
    [restoreAppliedJointMotionState],
  );

  const {
    schedule: scheduleClosedLoopPreview,
    solve: solveClosedLoopPreview,
    solveImmediately: solveClosedLoopPreviewImmediately,
    cancel: cancelClosedLoopPreviewScheduler,
    reset: resetClosedLoopPreviewScheduler,
  } = useClosedLoopPreviewScheduler({
    baseRobot: effectiveClosedLoopRobotState,
    onResolved: handleClosedLoopPreviewResolved,
    onRejected: handleClosedLoopPreviewRejected,
  });

  const scheduleClosedLoopPreviewWorkerSolve = useCallback(
    (
      selectedJointId: string,
      resolvedAngle: number,
      diagnosticLabel: string,
      options?: { preserveActiveJointRuntime?: boolean },
    ) => {
      scheduleClosedLoopPreview({
        selectedJointId,
        resolvedAngle,
        diagnosticLabel,
        preserveActiveJointRuntime: options?.preserveActiveJointRuntime ?? false,
      });
    },
    [scheduleClosedLoopPreview],
  );

  const resetClosedLoopPreviewState = useCallback(() => {
    resetClosedLoopPreviewScheduler();
    lastClosedLoopPreviewCommitRef.current = null;
    setPreviewMotionState({}, {});
  }, [resetClosedLoopPreviewScheduler, setPreviewMotionState]);

  const clearIkJointKinematicsPreview = useCallback(() => {
    resetClosedLoopPreviewScheduler();
    lastClosedLoopPreviewCommitRef.current = null;
    restoreAppliedJointMotionState();
  }, [resetClosedLoopPreviewScheduler, restoreAppliedJointMotionState]);

  const scheduleClosedLoopDragPreview = useCallback(
    (selectedJointId: string, resolvedAngle: number) => {
      // A worker result from a previous non-drag preview must not overtake the
      // synchronous drag projection and put the follower back on an old pose.
      cancelClosedLoopPreviewScheduler();

      try {
        const compensation = solveClosedLoopPreviewImmediately(selectedJointId, resolvedAngle);
        const resolvedPreview = resolveClosedLoopPreviewAngles(
          selectedJointId,
          resolvedAngle,
          compensation,
        );
        rememberClosedLoopPreviewCommit(
          selectedJointId,
          resolvedAngle,
          resolvedPreview.angles,
          compensation.quaternions,
        );
        applyRuntimeJointMotionPreview(
          resolvedPreview.angles,
          compensation.quaternions,
          selectedJointId,
        );
      } catch (error) {
        logRuntimeFailure(
          'useViewerController:scheduleClosedLoopDragPreview',
          new Error('Synchronous closed-loop drag solve failed; falling back to worker.', {
            cause: error,
          }),
          'warn',
        );
        scheduleClosedLoopPreviewWorkerSolve(
          selectedJointId,
          resolvedAngle,
          'Closed-loop drag preview fallback',
          { preserveActiveJointRuntime: true },
        );
      }
    },
    [
      applyRuntimeJointMotionPreview,
      cancelClosedLoopPreviewScheduler,
      rememberClosedLoopPreviewCommit,
      scheduleClosedLoopPreviewWorkerSolve,
      solveClosedLoopPreviewImmediately,
    ],
  );

  useEffect(() => {
    // Runtime projection changes invalidate solved compensation and any viewer
    // preview session. The runtime-state owner separately re-seeds its baseline
    // without clearing locally committed angles awaiting workspace propagation.
    lastClosedLoopPreviewCommitRef.current = null;
    resetClosedLoopPreviewScheduler();
    clearJointInteractionPreview();
  }, [
    clearJointInteractionPreview,
    effectiveClosedLoopRobotState,
    jointControlRobot,
    jointStateScopeKey,
    resetClosedLoopPreviewScheduler,
  ]);

  const handleRuntimeJointAnglesSnapshotChange = useCallback(
    (nextAngles: Record<string, number>) => {
      if (!nextAngles || typeof nextAngles !== 'object') {
        return;
      }
      const shouldCommitToApp = !isDraggingRef.current;
      const normalizedAngles = normalizeViewerJointAngleState(jointControlJoints, nextAngles);
      const resolvedAngles = { ...normalizedAngles };

      if (jointControlRobot?.joints) {
        Object.entries(normalizedAngles).forEach(([jointKey, angle]) => {
          const joint = jointControlRobot.joints?.[jointKey];
          if (joint && isSingleDofJoint(joint)) {
            const resolvedAngle = resolveRuntimeJointActualAngle(joint.name || jointKey, angle);
            resolvedAngles[jointKey] = resolvedAngle;
            joint.angle = resolvedAngle;
          }
        });
      }

      const activeRuntimeJointKey = resolveViewerJointKey(
        effectiveClosedLoopRobotState?.joints,
        activeJointRef.current ?? Object.keys(resolvedAngles)[0] ?? null,
      );
      const activeRuntimeAngle =
        activeRuntimeJointKey && Object.hasOwn(resolvedAngles, activeRuntimeJointKey)
          ? resolvedAngles[activeRuntimeJointKey]
          : undefined;
      const drivenMotion =
        activeRuntimeJointKey && typeof activeRuntimeAngle === 'number'
          ? resolveDrivenMotion(activeRuntimeJointKey, activeRuntimeAngle)
          : null;
      const hasClosedLoopConstraints = Boolean(
        effectiveClosedLoopRobotState?.closedLoopConstraints?.length,
      );

      if (
        activeRuntimeJointKey &&
        typeof activeRuntimeAngle === 'number' &&
        hasClosedLoopConstraints
      ) {
        if (!shouldCommitToApp) {
          scheduleClosedLoopDragPreview(activeRuntimeJointKey, activeRuntimeAngle);
          return;
        }

        void solveClosedLoopPreview(activeRuntimeJointKey, activeRuntimeAngle)
          .then((compensation) => {
            if (!compensation) {
              return;
            }
            const resolvedPreview = resolveClosedLoopPreviewAngles(
              activeRuntimeJointKey,
              activeRuntimeAngle,
              compensation,
            );
            const committedAngles = resolvedPreview.angles;
            storeAppliedJointMotionState(committedAngles, compensation.quaternions);
            recordPendingLocalCommittedJointAngles(committedAngles);
            const activeJoint = jointControlRobot?.joints?.[activeRuntimeJointKey];
            emitJointChangeToApp(
              activeJoint?.name || activeRuntimeJointKey,
              resolvedPreview.activeAngle,
              {
                jointAngles: committedAngles,
                jointQuaternions: compensation.quaternions,
              },
            );
            applyRuntimeJointMotionPreview(
              committedAngles,
              compensation.quaternions,
              activeRuntimeJointKey,
            );
          })
          .catch((error) => {
            logRuntimeFailure(
              'useViewerController:handleRuntimeJointAnglesChange',
              new Error('Closed-loop runtime worker solve failed; keeping local joint state.', {
                cause: error,
              }),
              'warn',
            );
            const committedAngles = { ...resolvedAngles };
            if (!Object.hasOwn(committedAngles, activeRuntimeJointKey)) {
              committedAngles[activeRuntimeJointKey] = activeRuntimeAngle;
            }
            const committedQuaternions: Record<string, JointQuaternion> = {};
            storeAppliedJointMotionState(committedAngles, committedQuaternions);
            recordPendingLocalCommittedJointAngles(committedAngles);
            const activeJoint = jointControlRobot?.joints?.[activeRuntimeJointKey];
            emitJointChangeToApp(activeJoint?.name || activeRuntimeJointKey, activeRuntimeAngle, {
              jointAngles: committedAngles,
              jointQuaternions: committedQuaternions,
            });
            applyRuntimeJointMotionPreview(
              committedAngles,
              committedQuaternions,
              activeRuntimeJointKey,
            );
          });
        return;
      }

      const nextPreviewAngles = drivenMotion
        ? { ...resolvedAngles, ...drivenMotion.angles }
        : resolvedAngles;
      if (shouldCommitToApp) {
        const [activeEntry] = Object.entries(resolvedAngles);
        if (activeEntry) {
          const [jointKey, resolvedAngle] = activeEntry;
          const joint = jointControlRobot?.joints?.[jointKey];
          emitJointChangeToApp(joint?.name || jointKey, resolvedAngle, {
            jointAngles: nextPreviewAngles,
          });
        }
        storeAppliedJointMotionState(nextPreviewAngles);
        recordPendingLocalCommittedJointAngles(nextPreviewAngles);
      }
      patchJointPanelAngles(nextPreviewAngles);
      setPreviewMotionState(nextPreviewAngles, {});
      publishJointInteractionPreview({
        activeJointId: activeRuntimeJointKey,
        jointAngles: nextPreviewAngles,
      });
    },
    [
      activeJointRef,
      applyRuntimeJointMotionPreview,
      effectiveClosedLoopRobotState,
      emitJointChangeToApp,
      isDraggingRef,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      recordPendingLocalCommittedJointAngles,
      resolveDrivenMotion,
      resolveRuntimeJointActualAngle,
      scheduleClosedLoopDragPreview,
      setPreviewMotionState,
      solveClosedLoopPreview,
      storeAppliedJointMotionState,
    ],
  );

  const resolveJointInteractionActualAngle = useCallback(
    ({ jointName, angle, angleSpace }: ViewerJointInteractionEvent) =>
      angleSpace === 'runtime' ? resolveRuntimeJointActualAngle(jointName, angle) : angle,
    [resolveRuntimeJointActualAngle],
  );

  const previewJointInteraction = useCallback(
    (interaction: ViewerJointInteractionEvent) => {
      const jointName = interaction.jointName;
      const angle = resolveJointInteractionActualAngle(interaction);
      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      if (!jointKey || !jointControlRobot?.joints?.[jointKey]) {
        return;
      }

      const joint = jointControlRobot.joints[jointKey];
      if (!isSingleDofJoint(joint)) {
        return;
      }
      const selectedClosedLoopJointId =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          joint.name || jointKey || jointName,
        ) ?? jointKey;
      const hasClosedLoopConstraints = Boolean(
        effectiveClosedLoopRobotState?.closedLoopConstraints?.length,
      );

      let shouldRefresh = false;
      const runtimeMotionAngle = resolveRuntimeMotionAngle(jointName, angle, joint);
      if (!isSameJointAngle(Number(joint.angle ?? joint.jointValue), runtimeMotionAngle)) {
        joint.setJointValue?.(runtimeMotionAngle);
        shouldRefresh = true;
      }

      if (selectedClosedLoopJointId && hasClosedLoopConstraints) {
        if (shouldRefresh) {
          requestSceneRefresh();
        }
        if (isDraggingRef.current) {
          scheduleClosedLoopDragPreview(selectedClosedLoopJointId, angle);
          return;
        }
        scheduleClosedLoopPreviewWorkerSolve(
          selectedClosedLoopJointId,
          angle,
          'Closed-loop joint interaction preview',
          { preserveActiveJointRuntime: true },
        );
        return;
      }

      const resolvedAngle = Number.isFinite(Number(angle)) ? Number(angle) : angle;
      const drivenMotion = resolveDrivenMotion(selectedClosedLoopJointId, resolvedAngle);
      applyRuntimeJointMotionPreview(drivenMotion.angles, {}, jointKey);
      if (shouldRefresh) {
        requestSceneRefresh();
      }
    },
    [
      applyRuntimeJointMotionPreview,
      effectiveClosedLoopRobotState,
      isDraggingRef,
      jointControlJoints,
      jointControlRobot,
      requestSceneRefresh,
      resolveDrivenMotion,
      resolveJointInteractionActualAngle,
      resolveRuntimeMotionAngle,
      scheduleClosedLoopDragPreview,
      scheduleClosedLoopPreviewWorkerSolve,
    ],
  );

  const handleJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      previewJointInteraction({ source: 'r3f', jointName, angle, angleSpace: 'actual' });
    },
    [previewJointInteraction],
  );

  const handleRuntimeJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      previewJointInteraction({ source: 'runtime', jointName, angle, angleSpace: 'runtime' });
    },
    [previewJointInteraction],
  );

  const handleActiveJointChange = useCallback(
    (jointName: string | null) => {
      if (!jointName) {
        setPanelActiveJoint(null);
        return;
      }
      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      const joint = jointKey ? jointControlRobot?.joints?.[jointKey] : undefined;
      setPanelActiveJoint(isSingleDofJoint(joint) ? jointKey : null);
    },
    [jointControlJoints, jointControlRobot, setPanelActiveJoint],
  );

  const commitJointInteraction = useCallback(
    async (interaction: ViewerJointInteractionEvent) => {
      const jointName = interaction.jointName;
      const angle = resolveJointInteractionActualAngle(interaction);
      clearJointInteractionPreview();
      cancelClosedLoopPreviewScheduler();
      const jointKey = resolveViewerJointKey(jointControlJoints, jointName);
      const joint = jointKey ? jointControlRobot?.joints?.[jointKey] : undefined;
      let shouldRefresh = false;
      if (joint && isSingleDofJoint(joint)) {
        const runtimeMotionAngle = resolveRuntimeMotionAngle(jointName, angle, joint);
        if (!isSameJointAngle(Number(joint.angle ?? joint.jointValue), runtimeMotionAngle)) {
          joint.setJointValue?.(runtimeMotionAngle);
          shouldRefresh = true;
        }
      }

      const resolvedAngle = Number.isFinite(Number(angle))
        ? Number(angle)
        : Number.isFinite(Number(joint?.angle ?? joint?.jointValue))
          ? Number(joint?.angle ?? joint?.jointValue)
          : angle;
      const selectedClosedLoopJointId =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          joint?.name || jointKey || jointName,
        ) ?? jointKey;
      const hasClosedLoopConstraints = Boolean(
        effectiveClosedLoopRobotState?.closedLoopConstraints?.length,
      );
      const resolvedJointName = joint?.name || jointKey || jointName;

      if (selectedClosedLoopJointId && hasClosedLoopConstraints) {
        try {
          const previewCommit = lastClosedLoopPreviewCommitRef.current;
          const canReusePreviewCommit =
            previewCommit?.baseRobot === effectiveClosedLoopRobotState &&
            previewCommit.selectedJointId === selectedClosedLoopJointId &&
            isSameJointAngle(previewCommit.resolvedAngle, resolvedAngle);
          let committedAngles: Record<string, number>;
          let committedQuaternions: Record<string, JointQuaternion>;

          if (canReusePreviewCommit) {
            committedAngles = { ...previewCommit.jointAngles };
            if (!Object.hasOwn(committedAngles, selectedClosedLoopJointId)) {
              committedAngles[selectedClosedLoopJointId] = resolvedAngle;
            }
            committedQuaternions = { ...previewCommit.jointQuaternions };
          } else {
            try {
              const compensation = await solveClosedLoopPreview(
                selectedClosedLoopJointId,
                resolvedAngle,
              );
              if (!compensation) {
                return;
              }
              const resolvedPreview = resolveClosedLoopPreviewAngles(
                selectedClosedLoopJointId,
                resolvedAngle,
                compensation,
              );
              committedAngles = resolvedPreview.angles;
              committedQuaternions = compensation.quaternions;
            } catch (workerError) {
              logRuntimeFailure(
                'useViewerController:handleJointChangeCommit',
                new Error(
                  'Closed-loop joint commit worker solve failed; keeping local joint state.',
                  { cause: workerError },
                ),
                'warn',
              );
              committedAngles = { [selectedClosedLoopJointId]: resolvedAngle };
              committedQuaternions = {};
            }
          }
          const committedActiveAngle =
            typeof committedAngles[selectedClosedLoopJointId] === 'number'
              ? committedAngles[selectedClosedLoopJointId]
              : resolvedAngle;

          applyRuntimeJointMotionPreview(
            committedAngles,
            committedQuaternions,
            selectedClosedLoopJointId,
          );
          storeAppliedJointMotionState(committedAngles, committedQuaternions);
          recordPendingLocalCommittedJointAngles(committedAngles);
          (joint as { finalizeJointValue?: () => void } | undefined)?.finalizeJointValue?.();
          resetClosedLoopPreviewState();
          emitJointChangeToApp(resolvedJointName, committedActiveAngle, {
            jointAngles: committedAngles,
            jointQuaternions: committedQuaternions,
          });
          clearJointInteractionPreview();
          return;
        } catch (error) {
          scheduleFailFastInDev(
            'useViewerController:handleJointChangeCommit',
            new Error('Closed-loop joint commit solve failed.', { cause: error }),
            'warn',
          );
        }
      }

      resetClosedLoopPreviewState();
      const drivenMotion = selectedClosedLoopJointId
        ? resolveDrivenMotion(selectedClosedLoopJointId, resolvedAngle)
        : { angles: {}, lockedJointIds: [] };
      Object.entries(drivenMotion.angles).forEach(([jointNameOrId, drivenAngle]) => {
        const drivenJointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId);
        const drivenJoint = drivenJointKey
          ? jointControlRobot?.joints?.[drivenJointKey]
          : undefined;
        if (!drivenJoint || !isSingleDofJoint(drivenJoint)) {
          return;
        }
        const runtimeMotionAngle = resolveRuntimeMotionAngle(
          jointNameOrId,
          drivenAngle,
          drivenJoint,
        );
        if (
          !isSameJointAngle(Number(drivenJoint.angle ?? drivenJoint.jointValue), runtimeMotionAngle)
        ) {
          drivenJoint.setJointValue?.(runtimeMotionAngle);
          shouldRefresh = true;
        }
      });

      if (Object.keys(drivenMotion.angles).length > 0) {
        patchJointPanelAngles(drivenMotion.angles);
      } else if (jointKey) {
        patchJointPanelAngles({ [jointKey]: resolvedAngle });
      }
      const committedAngles =
        Object.keys(drivenMotion.angles).length > 0
          ? drivenMotion.angles
          : jointKey
            ? { [jointKey]: resolvedAngle }
            : {};
      storeAppliedJointMotionState(committedAngles);
      recordPendingLocalCommittedJointAngles(committedAngles);
      (joint as { finalizeJointValue?: () => void } | undefined)?.finalizeJointValue?.();
      if (shouldRefresh) {
        requestSceneRefresh();
      }
      emitJointChangeToApp(resolvedJointName, resolvedAngle, { jointAngles: committedAngles });
    },
    [
      applyRuntimeJointMotionPreview,
      cancelClosedLoopPreviewScheduler,
      clearJointInteractionPreview,
      effectiveClosedLoopRobotState,
      emitJointChangeToApp,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      recordPendingLocalCommittedJointAngles,
      requestSceneRefresh,
      resetClosedLoopPreviewState,
      resolveDrivenMotion,
      resolveJointInteractionActualAngle,
      resolveRuntimeMotionAngle,
      solveClosedLoopPreview,
      storeAppliedJointMotionState,
    ],
  );

  const handleJointChangeCommit = useCallback(
    async (jointName: string, angle: number) => {
      await commitJointInteraction({ source: 'r3f', jointName, angle, angleSpace: 'actual' });
    },
    [commitJointInteraction],
  );

  const handleRuntimeJointChangeCommit = useCallback(
    async (jointName: string, angle: number) => {
      await commitJointInteraction({ source: 'runtime', jointName, angle, angleSpace: 'runtime' });
    },
    [commitJointInteraction],
  );

  const handleRuntimeJointAnglesChange = useCallback(
    (nextAngles: Record<string, number>) => {
      if (!nextAngles || typeof nextAngles !== 'object') {
        return;
      }
      const normalizedAngles = normalizeViewerJointAngleState(jointControlJoints, nextAngles);
      const angleEntries = Object.entries(normalizedAngles);
      if (angleEntries.length === 1) {
        const [jointName, angle] = angleEntries[0]!;
        if (isDraggingRef.current) {
          handleRuntimeJointAngleChange(jointName, angle);
          return;
        }
        void handleRuntimeJointChangeCommit(jointName, angle);
        return;
      }
      handleRuntimeJointAnglesSnapshotChange(nextAngles);
    },
    [
      handleRuntimeJointAngleChange,
      handleRuntimeJointAnglesSnapshotChange,
      handleRuntimeJointChangeCommit,
      isDraggingRef,
      jointControlJoints,
    ],
  );

  const handleResetJoints = useCallback(() => {
    if (!jointControlRobot?.joints) {
      return;
    }
    const runtimeJoints = jointControlRobot.joints;
    const resetAngles: Record<string, number> = {};
    Object.keys(jointAnglesRef.current).forEach((jointNameOrId) => {
      const jointKey = resolveViewerJointKey(jointControlJoints, jointNameOrId) ?? jointNameOrId;
      resetAngles[jointNameOrId] = resolveJointRestActualAngle(
        jointNameOrId,
        runtimeJoints[jointKey],
      );
    });

    const normalizedResetAngles = normalizeViewerJointAngleState(jointControlJoints, resetAngles);
    if (Object.keys(normalizedResetAngles).length === 0) {
      return;
    }
    clearJointInteractionPreview();
    cancelClosedLoopPreviewScheduler();
    resetClosedLoopPreviewState();

    let shouldRefresh = false;
    Object.entries(normalizedResetAngles).forEach(([jointKey, angle]) => {
      const joint = runtimeJoints[jointKey];
      if (!joint || !isSingleDofJoint(joint)) {
        return;
      }
      const runtimeMotionAngle = resolveRuntimeMotionAngle(jointKey, angle, joint);
      if (isSameJointAngle(Number(joint.angle ?? joint.jointValue), runtimeMotionAngle)) {
        return;
      }

      const originalIgnoreLimits = joint.ignoreLimits;
      joint.ignoreLimits = true;
      joint.setJointValue?.(runtimeMotionAngle);
      joint.ignoreLimits = originalIgnoreLimits;
      (joint as { finalizeJointValue?: () => void }).finalizeJointValue?.();
      shouldRefresh = true;
    });

    commitIkJointKinematics(normalizedResetAngles, {});
    const [firstResetEntry] = Object.entries(normalizedResetAngles);
    if (firstResetEntry) {
      const [jointKey, angle] = firstResetEntry;
      emitJointChangeToApp(runtimeJoints[jointKey]?.name || jointKey, angle, {
        jointAngles: normalizedResetAngles,
      });
    }
    if (shouldRefresh) {
      requestSceneRefresh();
    }
  }, [
    cancelClosedLoopPreviewScheduler,
    clearJointInteractionPreview,
    commitIkJointKinematics,
    emitJointChangeToApp,
    jointAnglesRef,
    jointControlJoints,
    jointControlRobot,
    requestSceneRefresh,
    resetClosedLoopPreviewState,
    resolveJointRestActualAngle,
    resolveRuntimeMotionAngle,
  ]);

  return {
    clearIkJointKinematicsPreview,
    handleActiveJointChange,
    handleJointAngleChange,
    handleJointChangeCommit,
    handleResetJoints,
    handleRuntimeJointAngleChange,
    handleRuntimeJointAnglesChange,
    handleRuntimeJointChangeCommit,
  };
}
