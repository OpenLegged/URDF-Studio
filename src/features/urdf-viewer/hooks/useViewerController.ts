import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useSelectionStore, type HoverFreezeOwner } from '@/store/selectionStore';
import { hasJointInteractionPreview, useJointInteractionPreviewStore } from '@/store';
import type {
  JointInteractionPreviewSnapshot,
  WorkspaceJointInteractionPreview,
} from '@/store/jointInteractionPreviewStore';
import { alignObjectLowestPointToZ, computeVisibleMeshBounds } from '@/shared/utils';
import {
  ORIGIN_AXES_SIZE_FALLBACK_MAX,
  normalizeOriginAxesSize,
  resolveOriginAxesSizeMax,
} from '@/shared/components/3d/helpers/coordinateAxesSizing';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import {
  normalizeViewerJointAngleState,
  resolveViewerJointKey,
} from '@/shared/utils/jointPanelState';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import type {
  ToolMode,
  ViewerProps,
  ViewerJointChangeContext,
  ViewerHelperKind,
  ViewerJointMotionStateValue,
} from '../types';
import { resolveInitialJointControlState } from '../utils/jointControlState';
import { createEmptyMeasureState } from '../utils/measurements';
import {
  hasRuntimeJointQuaternionSetter,
  type RuntimeViewerRobot,
} from '../utils/runtimeRobotMotion';
import { beginInitialGroundAlignment } from '@/shared/components/3d/robotPositioning';
import { useViewerSettings } from './useViewerSettings';
import { usePanelLayoutController } from './viewer-controller/usePanelLayoutController';
import { useRegressionBridge } from './viewer-controller/useRegressionBridge';
import { useSceneRefreshScheduler } from './viewer-controller/useSceneRefreshScheduler';
import {
  type ClosedLoopPreviewResolution,
  useClosedLoopPreviewScheduler,
} from './viewer-controller/useClosedLoopPreviewScheduler';
import { useToolModeController } from './viewer-controller/useToolModeController';
import {
  compactJointQuaternions,
  type ClosedLoopPreviewCommitState,
  getRuntimeJointCurrentMotionQuaternion,
  isSameJointAngle,
  isSameJointMotion,
  isSameJointQuaternion,
  mergeClosedLoopRobotStateWithRuntimeJointPose,
  resolveClosedLoopPreviewAngles,
  resolveRuntimeReportedJointAngle,
  type RuntimePoseJointLike,
  type ViewerJointInteractionEvent,
} from './viewer-controller/closedLoopJointPreview';
import { type InteractionSelection, type JointQuaternion, type RobotState } from '@/types';
import { getJointMotionAngleFromActualAngle, resolveMimicJointAngleTargets } from '@/core/robot';
import { logRuntimeFailure, scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

type Selection = ViewerProps['selection'];
// Publish viewer previews through a small external store so local consumers like
// the tree joint panel can follow drag state without rerendering the app shell.
const APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED = true;

interface UseViewerControllerProps {
  onJointChange?: ViewerProps['onJointChange'];
  syncJointChangesToApp?: boolean;
  showJointPanel?: boolean;
  jointAngleState?: ViewerProps['jointAngleState'];
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  onSelect?: ViewerProps['onSelect'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onHover?: ViewerProps['onHover'];
  selection?: Selection;
  showVisual?: ViewerProps['showVisual'];
  setShowVisual?: ViewerProps['setShowVisual'];
  onTransformPendingChange?: ViewerProps['onTransformPendingChange'];
  groundPlaneOffset?: number;
  setGroundPlaneOffset?: (offset: number) => void;
  groundPlaneOffsetReadOnly?: boolean;
  active?: boolean;
  enableRegressionBridge?: boolean;
  jointStateScopeKey?: string | null;
  defaultToolMode?: ToolMode;
  toolModeScopeKey?: string | null;
  closedLoopRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  projectJointInteractionPreview?: (
    preview: Pick<
      JointInteractionPreviewSnapshot,
      'activeJointId' | 'jointAngles' | 'jointQuaternions' | 'jointOrigins'
    >,
  ) => Record<string, WorkspaceJointInteractionPreview>;
}

export const useViewerController = ({
  onJointChange,
  syncJointChangesToApp = false,
  showJointPanel = true,
  jointAngleState,
  jointMotionState,
  onSelect,
  onHover,
  selection,
  showVisual: propShowVisual,
  setShowVisual: propSetShowVisual,
  onTransformPendingChange,
  groundPlaneOffset = 0,
  setGroundPlaneOffset,
  groundPlaneOffsetReadOnly = false,
  active = true,
  enableRegressionBridge = true,
  jointStateScopeKey = null,
  defaultToolMode = 'select',
  toolModeScopeKey = null,
  closedLoopRobotState = null,
  projectJointInteractionPreview,
}: UseViewerControllerProps) => {
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const hoverFreezeOwner = useRef<HoverFreezeOwner>(Symbol('viewer-controller')).current;
  const setOwnedHoverFrozen = useCallback(
    (frozen: boolean) => setHoverFrozen(hoverFreezeOwner, frozen),
    [hoverFreezeOwner, setHoverFrozen],
  );
  const isOrbitDragging = useRef(false);
  const [robot, setRobot] = useState<RuntimeRobotObject | null>(null);
  const [jointPanelRobot, setJointPanelRobot] = useState<RuntimeRobotObject | null>(null);
  const {
    showCollision,
    setShowCollision,
    showCollisionAlwaysOnTop,
    setShowCollisionAlwaysOnTop,
    localShowVisual,
    setLocalShowVisual,
    showIkHandles,
    setShowIkHandles,
    showIkHandlesAlwaysOnTop,
    setShowIkHandlesAlwaysOnTop,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    setOriginSize: setOriginSizePreference,
    showMjcfSites,
    setShowMjcfSites,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    interactionLayerPriority,
    recordInteractionLayerActivation,
    modelOpacity,
    setModelOpacity,
    highlightMode,
    setHighlightMode,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    isJointsCollapsed,
    toggleJointsCollapsed,
  } = useViewerSettings();

  const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
  const setShowVisual = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (nextValue) => {
      const resolvedValue = typeof nextValue === 'function' ? nextValue(showVisual) : nextValue;
      (propSetShowVisual || setLocalShowVisual)(resolvedValue);
      if (resolvedValue) {
        recordInteractionLayerActivation('visual');
      }
    },
    [propSetShowVisual, recordInteractionLayerActivation, setLocalShowVisual, showVisual],
  );

  const {
    normalizedToolModeScopeKey,
    toolModeState,
    setToolModeState,
    resolvedToolModeState,
    toolMode,
    transformMode,
    measureState,
    setMeasureState,
    setMeasureMode,
    measureAnchorMode,
    setMeasureAnchorMode,
    showMeasureDecomposition,
    setShowMeasureDecomposition,
    measurePoseRepresentation,
    setMeasurePoseRepresentation,
    paintColor,
    setPaintColor,
    paintSelectionScope,
    setPaintSelectionScope,
    paintOperation,
    setPaintOperation,
    paintInteractionRef,
    paintStatus,
    setPaintStatus,
  } = useToolModeController({ defaultToolMode, toolModeScopeKey });
  const {
    containerRef,
    optionsPanelRef,
    jointPanelRef,
    measurePanelRef,
    paintPanelRef,
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    paintPanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = usePanelLayoutController();
  const updateGroundPlaneOffset = useCallback(
    (nextOffset: number) => {
      setGroundPlaneOffset?.(nextOffset);
    },
    [setGroundPlaneOffset],
  );

  useEffect(() => {
    if (resolvedToolModeState === toolModeState) {
      return;
    }

    setToolModeState(resolvedToolModeState);
  }, [resolvedToolModeState, setToolModeState, toolModeState]);

  useEffect(() => {
    if (selection?.subType === 'collision') {
      setHighlightMode('collision');
    } else if (selection?.subType === 'visual') {
      setHighlightMode('link');
    }
  }, [selection?.subType, setHighlightMode]);

  const jointPanelStoreRef = useRef(createJointPanelStore());
  const jointAnglesRef = useRef<Record<string, number>>(
    jointPanelStoreRef.current.getSnapshot().jointAngles,
  );
  const initialJointAnglesRef = useRef<Record<string, number>>({});
  const jointStateScopeRef = useRef<string | null>(null);
  const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
  const activeJointRef = useRef<string | null>(
    jointPanelStoreRef.current.getSnapshot().activeJoint,
  );
  const suppressNextPanelAutoScrollRef = useRef(false);
  const [isDragging, setIsDraggingState] = useState(false);
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
  const isDraggingRef = useRef(false);
  const setIsDragging = useCallback(
    (nextDragging: boolean | ((previousDragging: boolean) => boolean)) => {
      const resolvedDragging =
        typeof nextDragging === 'function' ? nextDragging(isDraggingRef.current) : nextDragging;
      isDraggingRef.current = resolvedDragging;
      if (active) {
        setOwnedHoverFrozen(resolvedDragging || transformPendingRef.current);
      }
      setIsDraggingState(resolvedDragging);
    },
    [active, setOwnedHoverFrozen],
  );
  const previousGroundPlaneOffsetRef = useRef(groundPlaneOffset);
  const previousAppliedJointAngleStateRef = useRef<Record<string, number>>({});
  const runtimeAutoFitGroundHandlerRef = useRef<(() => void) | null>(null);
  const previousAppliedJointMotionStateRef = useRef<Record<string, ViewerJointMotionStateValue>>(
    {},
  );
  const previewMotionAnglesRef = useRef<Record<string, number>>({});
  const previewMotionQuaternionsRef = useRef<
    Record<string, ViewerJointMotionStateValue['quaternion']>
  >({});
  const lastClosedLoopPreviewCommitRef = useRef<ClosedLoopPreviewCommitState | null>(null);
  const jointInteractionPreviewSessionCounterRef = useRef(0);
  const activeJointInteractionPreviewSessionRef = useRef<string | null>(null);
  const appliedTreePanelJointPreviewRef = useRef(false);
  const pendingLocalCommittedJointAnglesRef = useRef<Record<string, number>>({});

  const justSelectedRef = useRef(false);
  const transformPendingRef = useRef(false);
  const jointControlRobot = (jointPanelRobot || robot) as RuntimeViewerRobot | null;
  const jointControlJoints = jointControlRobot?.joints;
  const effectiveClosedLoopRobotState = useMemo(
    () =>
      mergeClosedLoopRobotStateWithRuntimeJointPose(
        closedLoopRobotState,
        jointControlRobot?.joints as Record<string, RuntimePoseJointLike> | undefined,
      ),
    [closedLoopRobotState, jointControlRobot],
  );
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
  const resolveRuntimeMotionAngle = useCallback(
    (jointNameOrId: string, actualAngle: number, runtimeJoint?: RuntimePoseJointLike | null) => {
      const stateJointKey =
        resolveViewerJointKey(
          effectiveClosedLoopRobotState?.joints,
          runtimeJoint?.name || jointNameOrId,
        ) ??
        (jointNameOrId in (effectiveClosedLoopRobotState?.joints ?? {}) ? jointNameOrId : null);
      const stateJoint = stateJointKey
        ? effectiveClosedLoopRobotState?.joints?.[stateJointKey]
        : undefined;
      const referenceJoint = stateJoint ?? runtimeJoint;

      return referenceJoint
        ? getJointMotionAngleFromActualAngle(referenceJoint, actualAngle)
        : actualAngle;
    },
    [effectiveClosedLoopRobotState?.joints],
  );

  const ensureJointInteractionPreviewSessionId = useCallback(() => {
    if (activeJointInteractionPreviewSessionRef.current !== null) {
      return activeJointInteractionPreviewSessionRef.current;
    }

    jointInteractionPreviewSessionCounterRef.current += 1;
    activeJointInteractionPreviewSessionRef.current = String(
      jointInteractionPreviewSessionCounterRef.current,
    );
    return activeJointInteractionPreviewSessionRef.current;
  }, [setIsDragging]);

  const publishJointInteractionPreview = useCallback(
    (preview: {
      activeJointId: string | null;
      jointAngles?: Record<string, number>;
      jointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>;
    }) => {
      if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
        return;
      }

      const jointQuaternions = Object.fromEntries(
        Object.entries(preview.jointQuaternions ?? {}).filter(([, quaternion]) =>
          Boolean(quaternion),
        ),
      ) as Record<string, NonNullable<ViewerJointMotionStateValue['quaternion']>>;
      const rendererPreview = {
        activeJointId: preview.activeJointId,
        jointAngles: { ...(preview.jointAngles ?? {}) },
        jointQuaternions,
        jointOrigins: {},
      };
      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'viewer',
        dragSessionId: ensureJointInteractionPreviewSessionId(),
        ...rendererPreview,
        workspaceByComponent: projectJointInteractionPreview?.(rendererPreview) ?? {},
      });
    },
    [ensureJointInteractionPreviewSessionId, projectJointInteractionPreview],
  );

  const clearJointInteractionPreview = useCallback(() => {
    if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
      activeJointInteractionPreviewSessionRef.current = null;
      return;
    }

    const activeSessionId = activeJointInteractionPreviewSessionRef.current;
    activeJointInteractionPreviewSessionRef.current = null;

    if (activeSessionId === null) {
      return;
    }

    useJointInteractionPreviewStore.getState().clearPreview({
      source: 'viewer',
      dragSessionId: activeSessionId,
    });
  }, []);

  const emitJointChangeToApp = useCallback(
    (jointName: string, angle: number, context?: ViewerJointChangeContext) => {
      if (!syncJointChangesToApp) {
        return;
      }

      onJointChange?.(jointName, angle, context);
    },
    [onJointChange, syncJointChangesToApp],
  );

  const syncJointAngleSnapshot = useCallback(() => {
    jointAnglesRef.current = jointPanelStoreRef.current.getSnapshot().jointAngles;
  }, []);

  const syncActiveJointSnapshot = useCallback(() => {
    activeJointRef.current = jointPanelStoreRef.current.getSnapshot().activeJoint;
  }, []);

  const patchJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.patchJointAngles(nextJointAngles);
      if (changed) {
        syncJointAngleSnapshot();
      }
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const replaceJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.replaceJointAngles(nextJointAngles);
      syncJointAngleSnapshot();
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const setPanelActiveJoint = useCallback(
    (jointName: string | null, options?: JointPanelActiveJointOptions) => {
      if (options?.suppressNextAutoScroll) {
        suppressNextPanelAutoScrollRef.current = true;
      }

      const shouldSuppressAutoScroll =
        jointName !== null &&
        options?.autoScroll === undefined &&
        suppressNextPanelAutoScrollRef.current;
      const changed = jointPanelStoreRef.current.setActiveJoint(
        jointName,
        shouldSuppressAutoScroll ? { ...options, autoScroll: false } : options,
      );

      if (shouldSuppressAutoScroll) {
        suppressNextPanelAutoScrollRef.current = false;
      }

      syncActiveJointSnapshot();
      return changed;
    },
    [syncActiveJointSnapshot],
  );

  const { requestSceneRefresh, registerSceneRefresh, cancelSceneRefresh } =
    useSceneRefreshScheduler();

  useEffect(() => {
    if (!active) {
      return;
    }

    // Keep collision/visual visibility toggles responsive even when a loader
    // branch did not mutate scene graph state in the same commit.
    requestSceneRefresh();
  }, [active, requestSceneRefresh, showCollision, showCollisionAlwaysOnTop, showVisual]);

  const applyRuntimeJointMotionPreview = useCallback(
    (
      nextJointAngles: Record<string, number>,
      nextJointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
      activeJointId: string | null = activeJointRef.current,
      options?: {
        syncJointPanel?: boolean;
        preserveActiveJointRuntime?: boolean;
        preserveActiveJointPanel?: boolean;
        publishInteractionPreview?: boolean;
      },
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
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      requestSceneRefresh,
      resolveRuntimeMotionAngle,
    ],
  );

  const applyImmediateClosedLoopActiveJointPreview = useCallback(
    (activeJointId: string, activeAngle: number) => {
      const nextActiveAngle = { [activeJointId]: activeAngle };
      patchJointPanelAngles(nextActiveAngle);
      previewMotionAnglesRef.current = {
        ...previewMotionAnglesRef.current,
        ...nextActiveAngle,
      };
      publishJointInteractionPreview({
        activeJointId,
        jointAngles: previewMotionAnglesRef.current,
        jointQuaternions: previewMotionQuaternionsRef.current,
      });
      requestSceneRefresh();
    },
    [patchJointPanelAngles, publishJointInteractionPreview, requestSceneRefresh],
  );

  const getJointAnglesSnapshot = useCallback(() => ({ ...jointAnglesRef.current }), []);

  const getInitialJointAnglesForNextLoad = useCallback(() => {
    if (!jointStateScopeKey) {
      return {};
    }

    if (jointStateScopeRef.current !== jointStateScopeKey) {
      return {};
    }

    return { ...jointAnglesRef.current };
  }, [jointStateScopeKey]);

  const previewIkJointKinematics = useCallback(
    (
      jointAngles: Record<string, number>,
      jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
    ) => {
      applyRuntimeJointMotionPreview(jointAngles, jointQuaternions, activeJointRef.current, {
        syncJointPanel: false,
      });
    },
    [applyRuntimeJointMotionPreview],
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
    lastClosedLoopPreviewCommitRef.current = null;
    previewMotionAnglesRef.current = { ...previousAppliedJointAngleStateRef.current };
    previewMotionQuaternionsRef.current = Object.fromEntries(
      Object.entries(previousAppliedJointMotionStateRef.current)
        .filter(([, motion]) => Boolean(motion?.quaternion))
        .map(([name, motion]) => [name, motion?.quaternion]),
    );

    if (jointControlRobot?.joints) {
      let shouldRefresh = false;

      Object.entries(previousAppliedJointAngleStateRef.current).forEach(
        ([jointNameOrId, angle]) => {
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
        },
      );

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
      preview = useJointInteractionPreviewStore.getState().preview,
    ) => {
      const hasTreePanelPreview =
        preview.source === 'tree-panel' &&
        (Object.keys(preview.jointAngles).length > 0 ||
          Object.keys(preview.jointQuaternions).length > 0 ||
          Object.keys(preview.jointOrigins).length > 0);

      if (!hasTreePanelPreview) {
        if (appliedTreePanelJointPreviewRef.current) {
          appliedTreePanelJointPreviewRef.current = false;
        }
        return;
      }

      appliedTreePanelJointPreviewRef.current = true;
      applyRuntimeJointMotionPreview(
        preview.jointAngles,
        preview.jointQuaternions,
        preview.activeJointId,
        { syncJointPanel: false, publishInteractionPreview: false },
      );
    };

    applyTreePanelJointPreview();

    return useJointInteractionPreviewStore.subscribe((state, previousState) => {
      const currentIsTreePanelPreview = state.preview.source === 'tree-panel';
      const previousWasTreePanelPreview = previousState.preview.source === 'tree-panel';
      if (
        !currentIsTreePanelPreview &&
        !previousWasTreePanelPreview &&
        !appliedTreePanelJointPreviewRef.current
      ) {
        return;
      }

      applyTreePanelJointPreview(state.preview);
    });
  }, [applyRuntimeJointMotionPreview]);

  const handleClosedLoopPreviewResolved = useCallback(
    ({
      request: pendingPreview,
      compensation,
      hasNewerPendingPreview,
    }: ClosedLoopPreviewResolution) => {
      const preview = resolveClosedLoopPreviewAngles(
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
        preview.angles,
        compensation.quaternions,
      );
      applyRuntimeJointMotionPreview(
        preview.angles,
        compensation.quaternions,
        pendingPreview.selectedJointId,
        {
          preserveActiveJointRuntime:
            pendingPreview.preserveActiveJointRuntime &&
            (preview.preserveActiveJointRuntime || shouldPreserveActiveJointPreview),
          preserveActiveJointPanel: shouldPreserveActiveJointPreview,
        },
      );
    },
    [applyRuntimeJointMotionPreview, rememberClosedLoopPreviewCommit],
  );

  const handleClosedLoopPreviewRejected = useCallback(
    (pendingPreview: ClosedLoopPreviewResolution['request'], error: unknown) => {
      logRuntimeFailure(
        'useViewerController:scheduleClosedLoopPreviewWorkerSolve',
        new Error(`${pendingPreview.diagnosticLabel} worker solve failed.`, {
          cause: error,
        }),
        'warn',
      );
      if (!pendingPreview.preserveActiveJointRuntime) {
        restoreAppliedJointMotionState();
      }
    },
    [restoreAppliedJointMotionState],
  );

  const {
    schedule: scheduleClosedLoopPreview,
    solve: solveClosedLoopPreview,
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
    previewMotionAnglesRef.current = {};
    previewMotionQuaternionsRef.current = {};
  }, [resetClosedLoopPreviewScheduler]);

  const clearIkJointKinematicsPreview = useCallback(() => {
    resetClosedLoopPreviewScheduler();
    restoreAppliedJointMotionState();
  }, [resetClosedLoopPreviewScheduler, restoreAppliedJointMotionState]);

  const scheduleClosedLoopDragPreview = useCallback(
    (selectedJointId: string, resolvedAngle: number) => {
      applyImmediateClosedLoopActiveJointPreview(selectedJointId, resolvedAngle);
      scheduleClosedLoopPreviewWorkerSolve(
        selectedJointId,
        resolvedAngle,
        'Closed-loop drag preview',
        {
          preserveActiveJointRuntime: true,
        },
      );
    },
    [applyImmediateClosedLoopActiveJointPreview, scheduleClosedLoopPreviewWorkerSolve],
  );

  useEffect(() => {
    if (!active) return;
    setOwnedHoverFrozen(isDragging || transformPendingRef.current);
  }, [active, isDragging, setOwnedHoverFrozen]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    if (!active) {
      setOwnedHoverFrozen(false);
    }
  }, [active, setOwnedHoverFrozen]);

  useEffect(() => {
    const releaseDragLock = () => setIsDragging(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsDragging(false);
      }
    };

    window.addEventListener('mouseup', releaseDragLock);
    window.addEventListener('pointerup', releaseDragLock);
    window.addEventListener('blur', releaseDragLock);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('mouseup', releaseDragLock);
      window.removeEventListener('pointerup', releaseDragLock);
      window.removeEventListener('blur', releaseDragLock);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearJointInteractionPreview();
      cancelSceneRefresh();
    };
  }, [cancelSceneRefresh, clearJointInteractionPreview]);

  useRegressionBridge({
    active,
    centerOfMassSize,
    enabled: enableRegressionBridge,
    highlightMode,
    jointAxisSize,
    modelOpacity,
    normalizedToolModeScopeKey,
    originSize,
    requestSceneRefresh,
    robot,
    toolMode,
    jointAnglesRef,
    activeJointRef,
    patchJointPanelAngles,
    resolveRuntimeMotionAngle,
    setCenterOfMassSize,
    setHighlightMode,
    setJointAxisSize,
    setMeasureState,
    setModelOpacity,
    setOriginSize,
    setPaintStatus,
    setShowCenterOfMass,
    setShowCoMOverlay,
    setShowCollision,
    setShowCollisionAlwaysOnTop,
    setShowInertia,
    setShowInertiaOverlay,
    setShowJointAxes,
    setShowJointAxesOverlay,
    setShowOrigins,
    setShowOriginsOverlay,
    setShowVisual,
    setToolModeState,
    showCenterOfMass,
    showCoMOverlay,
    showCollision,
    showCollisionAlwaysOnTop,
    showInertia,
    showInertiaOverlay,
    showJointAxes,
    showJointAxesOverlay,
    showOrigins,
    showOriginsOverlay,
    showVisual,
  });

  const initializeJointControlState = useCallback(
    (loadedRobot: RuntimeRobotObject) => {
      const loadedJoints = (loadedRobot as RuntimeViewerRobot | null)?.joints;
      const preservePreviousAngles =
        jointStateScopeRef.current !== null && jointStateScopeRef.current === jointStateScopeKey;
      const { currentAngles, defaultAngles } = resolveInitialJointControlState({
        joints: loadedJoints,
        previousAngles: jointAnglesRef.current,
        preservePreviousAngles,
        isControllableJoint: isSingleDofJoint,
      });

      replaceJointPanelAngles(currentAngles);
      storeAppliedJointMotionState(currentAngles);
      initialJointAnglesRef.current = defaultAngles;
      setPanelActiveJoint(null);
      jointStateScopeRef.current = jointStateScopeKey;
    },
    [
      jointStateScopeKey,
      replaceJointPanelAngles,
      setPanelActiveJoint,
      storeAppliedJointMotionState,
    ],
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

  const handleRobotLoaded = useCallback(
    (loadedRobot: RuntimeRobotObject) => {
      clearJointInteractionPreview();
      setJointPanelRobot(null);
      setRobot(loadedRobot);
      initializeJointControlState(loadedRobot);
      syncOriginAxesSizeLimit(loadedRobot);
    },
    [clearJointInteractionPreview, initializeJointControlState, syncOriginAxesSizeLimit],
  );

  const handleJointPanelRobotLoaded = useCallback(
    (loadedRobot: RuntimeRobotObject | null) => {
      clearJointInteractionPreview();
      setJointPanelRobot(loadedRobot);
      syncOriginAxesSizeLimit(loadedRobot);
      if (!loadedRobot) {
        return;
      }
      initializeJointControlState(loadedRobot);
    },
    [clearJointInteractionPreview, initializeJointControlState, syncOriginAxesSizeLimit],
  );

  const handleRuntimeJointAnglesSnapshotChange = useCallback(
    (nextAngles: Record<string, number>) => {
      if (!nextAngles || typeof nextAngles !== 'object') return;
      const shouldCommitToApp = !isDraggingRef.current;
      const normalizedAngles = normalizeViewerJointAngleState(jointControlJoints, nextAngles);
      const resolvedAngles = { ...normalizedAngles };

      if (jointControlRobot?.joints) {
        Object.entries(normalizedAngles).forEach(([jointKey, angle]) => {
          const joint = jointControlRobot.joints?.[jointKey];
          if (joint && isSingleDofJoint(joint)) {
            const stateJointKey =
              resolveViewerJointKey(
                effectiveClosedLoopRobotState?.joints,
                joint.name || jointKey,
              ) ?? (jointKey in (effectiveClosedLoopRobotState?.joints ?? {}) ? jointKey : null);
            const stateJoint = stateJointKey
              ? effectiveClosedLoopRobotState?.joints?.[stateJointKey]
              : undefined;
            const resolvedAngle = resolveRuntimeReportedJointAngle(stateJoint, joint, angle);
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

            const preview = resolveClosedLoopPreviewAngles(
              activeRuntimeJointKey,
              activeRuntimeAngle,
              compensation,
            );
            const committedAngles = preview.angles;
            storeAppliedJointMotionState(committedAngles, compensation.quaternions);
            recordPendingLocalCommittedJointAngles(committedAngles);
            const activeJoint =
              activeRuntimeJointKey && jointControlRobot?.joints
                ? jointControlRobot.joints[activeRuntimeJointKey]
                : undefined;
            emitJointChangeToApp(activeJoint?.name || activeRuntimeJointKey, preview.activeAngle, {
              jointAngles: committedAngles,
              jointQuaternions: compensation.quaternions,
            });

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
            const activeJoint =
              activeRuntimeJointKey && jointControlRobot?.joints
                ? jointControlRobot.joints[activeRuntimeJointKey]
                : undefined;
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
      previewMotionAnglesRef.current = nextPreviewAngles;
      previewMotionQuaternionsRef.current = {};
      publishJointInteractionPreview({
        activeJointId: activeRuntimeJointKey,
        jointAngles: nextPreviewAngles,
      });
    },
    [
      applyRuntimeJointMotionPreview,
      effectiveClosedLoopRobotState,
      emitJointChangeToApp,
      jointControlJoints,
      jointControlRobot,
      patchJointPanelAngles,
      publishJointInteractionPreview,
      recordPendingLocalCommittedJointAngles,
      resolveDrivenMotion,
      scheduleClosedLoopDragPreview,
      solveClosedLoopPreview,
      storeAppliedJointMotionState,
    ],
  );

  const handleTransformPending = useCallback(
    (pending: boolean) => {
      transformPendingRef.current = pending;
      if (active) {
        setOwnedHoverFrozen(pending || isDraggingRef.current);
      }
      onTransformPendingChange?.(pending);
    },
    [active, onTransformPendingChange, setOwnedHoverFrozen],
  );

  useEffect(() => {
    return () => {
      transformPendingRef.current = false;
      setOwnedHoverFrozen(false);
      onTransformPendingChange?.(false);
    };
  }, [onTransformPendingChange, setOwnedHoverFrozen]);

  useEffect(() => {
    previousAppliedJointAngleStateRef.current = jointControlRobot?.joints
      ? { ...jointAnglesRef.current }
      : {};
    previousAppliedJointMotionStateRef.current = {};
    previewMotionAnglesRef.current = {};
    previewMotionQuaternionsRef.current = {};
    // NOTE: do NOT clear pendingLocalCommittedJointAnglesRef here. This effect
    // also re-runs when jointControlRobot / effectiveClosedLoopRobotState change
    // identity, which in multi-model/assembly mode happens on every joint-angle
    // commit (the merged robot is recomputed). Wiping the just-recorded
    // committed angle here is exactly what made a directly-dragged link's joint
    // snap back to its pre-drag value for ~0.5s before jumping forward. The
    // pending map self-clears in the re-sync effect once the store-derived
    // state catches up; a genuine model/scope switch is handled below.
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

  // Drop any locally-committed-but-not-yet-propagated joint angles ONLY when the
  // joint-state scope genuinely changes (a different model/scope is loaded), not
  // when the merged robot object identity churns from this scope's own commits.
  useEffect(() => {
    pendingLocalCommittedJointAnglesRef.current = {};
  }, [jointStateScopeKey]);

  useEffect(() => {
    if (!jointControlRobot || (!jointAngleState && !jointMotionState)) return;

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
        normalizedAngleState = {
          ...normalizedAngleState,
          ...remainingPendingAngles,
        };

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
        normalizedAngleState = {
          ...normalizedAngleState,
          ...previewAngles,
        };
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
      if (!joint || !motion) {
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
        if (joint && isSingleDofJoint(joint)) {
          const runtimeMotionAngle = resolveRuntimeMotionAngle(name, angle, joint);
          const currentAngle = Number(joint.angle ?? joint.jointValue);
          if (!isSameJointAngle(currentAngle, runtimeMotionAngle)) {
            joint.setJointValue?.(runtimeMotionAngle);
            shouldRefresh = true;
          }
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
      if (!jointKey || !jointControlRobot?.joints?.[jointKey]) return;

      const joint = jointControlRobot.joints[jointKey];
      if (!isSingleDofJoint(joint)) return;

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
          {
            preserveActiveJointRuntime: true,
          },
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
      jointControlJoints,
      jointControlRobot,
      requestSceneRefresh,
      resolveDrivenMotion,
      resolveJointInteractionActualAngle,
      resolveRuntimeMotionAngle,
      scheduleClosedLoopPreviewWorkerSolve,
      scheduleClosedLoopDragPreview,
    ],
  );

  const handleJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      previewJointInteraction({
        source: 'r3f',
        jointName,
        angle,
        angleSpace: 'actual',
      });
    },
    [previewJointInteraction],
  );

  const handleRuntimeJointAngleChange = useCallback(
    (jointName: string, angle: number) => {
      previewJointInteraction({
        source: 'runtime',
        jointName,
        angle,
        angleSpace: 'runtime',
      });
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
              const preview = resolveClosedLoopPreviewAngles(
                selectedClosedLoopJointId,
                resolvedAngle,
                compensation,
              );
              committedAngles = preview.angles;
              committedQuaternions = compensation.quaternions;
            } catch (workerError) {
              logRuntimeFailure(
                'useViewerController:handleJointChangeCommit',
                new Error(
                  'Closed-loop joint commit worker solve failed; keeping local joint state.',
                  {
                    cause: workerError,
                  },
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

      emitJointChangeToApp(resolvedJointName, resolvedAngle, {
        jointAngles: committedAngles,
      });
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
      requestSceneRefresh,
      recordPendingLocalCommittedJointAngles,
      resolveJointInteractionActualAngle,
      resetClosedLoopPreviewState,
      resolveDrivenMotion,
      resolveRuntimeMotionAngle,
      solveClosedLoopPreview,
      storeAppliedJointMotionState,
    ],
  );

  const handleJointChangeCommit = useCallback(
    async (jointName: string, angle: number) => {
      await commitJointInteraction({
        source: 'r3f',
        jointName,
        angle,
        angleSpace: 'actual',
      });
    },
    [commitJointInteraction],
  );

  const handleRuntimeJointChangeCommit = useCallback(
    async (jointName: string, angle: number) => {
      await commitJointInteraction({
        source: 'runtime',
        jointName,
        angle,
        angleSpace: 'runtime',
      });
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
      jointControlJoints,
    ],
  );

  const handleResetJoints = useCallback(() => {
    if (!jointControlRobot?.joints) return;
    const runtimeJoints = jointControlRobot.joints;
    Object.keys(jointAnglesRef.current).forEach((name) => {
      const initialAngle = initialJointAnglesRef.current[name] || 0;
      const joint = runtimeJoints[name];
      if (joint) {
        const originalIgnoreLimits = joint.ignoreLimits;
        joint.ignoreLimits = true;
        handleJointAngleChange(name, initialAngle);
        joint.ignoreLimits = originalIgnoreLimits;
      } else {
        handleJointAngleChange(name, initialAngle);
      }

      handleJointChangeCommit(name, initialAngle);
    });
  }, [handleJointAngleChange, handleJointChangeCommit, jointControlRobot]);

  const handleSelectWrapper = useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
      helperKind?: ViewerHelperKind,
    ) => {
      if (transformPendingRef.current) return;

      onSelect?.(type, id, subType, helperKind);
      const activeJointKey = resolveActiveViewerJointKeyFromSelection(
        jointControlJoints,
        type && id ? { type, id } : null,
      );
      setPanelActiveJoint(activeJointKey);
    },
    [jointControlJoints, onSelect, setPanelActiveJoint],
  );

  const handleHoverWrapper = useCallback(
    (
      type: InteractionSelection['type'],
      id: string | null,
      subType?: 'visual' | 'collision',
      objectIndex?: number,
      helperKind?: ViewerHelperKind,
      highlightObjectId?: number,
    ) => {
      onHover?.(type, id, subType, objectIndex, helperKind, highlightObjectId);
    },
    [onHover],
  );

  const registerRuntimeAutoFitGroundHandler = useCallback((handler: (() => void) | null) => {
    runtimeAutoFitGroundHandlerRef.current = handler;
  }, []);

  const handleAutoFitGround = useCallback(() => {
    if (runtimeAutoFitGroundHandlerRef.current) {
      runtimeAutoFitGroundHandlerRef.current();
      return;
    }

    const currentRobot = robot ?? jointPanelRobot;
    if (!currentRobot) return;

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
  }, [groundPlaneOffset, jointPanelRobot, requestSceneRefresh, robot]);

  const handleToolModeChange = useCallback(
    (nextMode: ToolMode) => {
      setToolModeState({
        scopeKey: normalizedToolModeScopeKey,
        explicit: true,
        mode: nextMode,
      });

      if (nextMode !== 'measure') {
        setMeasureState((prev) => (!prev.hoverTarget ? prev : { ...prev, hoverTarget: null }));
      }
      if (nextMode !== 'paint') {
        setPaintStatus(null);
      }
    },
    [normalizedToolModeScopeKey, setMeasureState, setPaintStatus, setToolModeState],
  );

  const handleCloseMeasureTool = useCallback(() => {
    setMeasureState(createEmptyMeasureState());
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
    onHover?.(null, null);
  }, [normalizedToolModeScopeKey, onHover, setMeasureState, setToolModeState]);

  const handleClosePaintTool = useCallback(() => {
    setPaintStatus(null);
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
  }, [normalizedToolModeScopeKey, setPaintStatus, setToolModeState]);

  const handlePointerMissed = useCallback(() => {
    if (justSelectedRef.current) return;
    if (transformPendingRef.current) return;
    onSelect?.('link', '');
    setPanelActiveJoint(null);
  }, [onSelect, setPanelActiveJoint]);

  useEffect(() => {
    if (!active || !robot) return;
    if (!beginInitialGroundAlignment(robot)) return;

    const timers = [0, 80, 220].map((delay) => window.setTimeout(handleAutoFitGround, delay));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  useEffect(() => {
    const previousGroundPlaneOffset = previousGroundPlaneOffsetRef.current;
    previousGroundPlaneOffsetRef.current = groundPlaneOffset;

    if (!active || !robot) {
      return;
    }

    if (Object.is(previousGroundPlaneOffset, groundPlaneOffset)) {
      return;
    }

    handleAutoFitGround();
  }, [active, groundPlaneOffset, handleAutoFitGround, robot]);

  useEffect(() => {
    if (!jointControlRobot) return;
    const activeJointKey = resolveActiveViewerJointKeyFromSelection(jointControlJoints, selection);
    setPanelActiveJoint(activeJointKey);
  }, [jointControlJoints, jointControlRobot, selection, setPanelActiveJoint]);

  return {
    robot,
    setRobot,
    jointPanelRobot,
    setJointPanelRobot,
    showCollision,
    showCollisionAlwaysOnTop,
    setShowCollisionAlwaysOnTop,
    setShowCollision,
    showVisual,
    setShowVisual,
    showIkHandles,
    setShowIkHandles,
    showIkHandlesAlwaysOnTop,
    setShowIkHandlesAlwaysOnTop,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    originAxesSizeMax,
    setOriginSize,
    showMjcfSites,
    setShowMjcfSites,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    interactionLayerPriority,
    modelOpacity,
    setModelOpacity,
    highlightMode,
    setHighlightMode,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    isJointsCollapsed,
    toggleJointsCollapsed,
    closedLoopRobotState: effectiveClosedLoopRobotState,
    toolMode,
    measureState,
    setMeasureState,
    setMeasureMode,
    measureAnchorMode,
    setMeasureAnchorMode,
    showMeasureDecomposition,
    setShowMeasureDecomposition,
    measurePoseRepresentation,
    setMeasurePoseRepresentation,
    paintColor,
    setPaintColor,
    paintSelectionScope,
    setPaintSelectionScope,
    paintOperation,
    setPaintOperation,
    paintInteractionRef,
    paintStatus,
    setPaintStatus,
    containerRef,
    optionsPanelRef,
    jointPanelRef,
    measurePanelRef,
    paintPanelRef,
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    paintPanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    transformMode,
    jointPanelStore: jointPanelStoreRef.current,
    getJointAnglesSnapshot,
    getInitialJointAnglesForNextLoad,
    registerSceneRefresh,
    previewIkJointKinematics,
    commitIkJointKinematics,
    clearIkJointKinematicsPreview,
    angleUnit,
    setAngleUnit,
    registerRuntimeAutoFitGroundHandler,
    setActiveJoint: setPanelActiveJoint,
    handleActiveJointChange,
    isDragging,
    setIsDragging,
    isOrbitDragging,
    justSelectedRef,
    transformPendingRef,
    handleRobotLoaded,
    handleJointPanelRobotLoaded,
    handleRuntimeJointAnglesChange,
    handleRuntimeJointAngleChange,
    handleRuntimeJointChangeCommit,
    handleTransformPending,
    handleJointAngleChange,
    handleJointChangeCommit,
    handleResetJoints,
    handleSelectWrapper,
    handleHoverWrapper,
    handleAutoFitGround,
    groundPlaneOffset,
    setGroundPlaneOffset: updateGroundPlaneOffset,
    groundPlaneOffsetReadOnly,
    handleToolModeChange,
    handleCloseMeasureTool,
    handleClosePaintTool,
    handlePointerMissed,
  };
};

export type ViewerController = ReturnType<typeof useViewerController>;
