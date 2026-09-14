import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import {
  setRegressionViewerHandlers,
  type RegressionViewerFlags,
} from '@/shared/debug/regressionState';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import { resolveViewerJointKey } from '@/shared/utils/jointPanelState';
import type { RuntimeViewerJoint } from '../../utils/runtimeRobotMotion';
import type { ToolMode } from '../../types';

type HighlightMode = 'link' | 'collision';
type BooleanSetter = Dispatch<SetStateAction<boolean>>;
type NumberSetter = Dispatch<SetStateAction<number>>;

type RuntimeJointLike = RuntimeViewerJoint;

interface UseRegressionBridgeParams {
  active: boolean;
  centerOfMassSize: number;
  enabled?: boolean;
  highlightMode: HighlightMode;
  jointAxisSize: number;
  modelOpacity: number;
  originSize: number;
  requestSceneRefresh: (options?: { force?: boolean }) => void;
  robot: RuntimeRobotObject | null;
  toolMode: ToolMode;
  jointAnglesRef: MutableRefObject<Record<string, number>>;
  activeJointRef: MutableRefObject<string | null>;
  patchJointPanelAngles: (nextJointAngles: Record<string, number>) => boolean;
  resolveRuntimeMotionAngle: (
    jointNameOrId: string,
    actualAngle: number,
    runtimeJoint?: RuntimeJointLike | null,
  ) => number;
  setCenterOfMassSize: NumberSetter;
  setHighlightMode: Dispatch<SetStateAction<HighlightMode>>;
  setJointAxisSize: NumberSetter;
  setModelOpacity: NumberSetter;
  setOriginSize: NumberSetter;
  setShowCenterOfMass: BooleanSetter;
  setShowCoMOverlay: BooleanSetter;
  setShowCollision: BooleanSetter;
  setShowCollisionAlwaysOnTop: BooleanSetter;
  setShowInertia: BooleanSetter;
  setShowInertiaOverlay: BooleanSetter;
  setShowJointAxes: BooleanSetter;
  setShowJointAxesOverlay: BooleanSetter;
  setShowOrigins: BooleanSetter;
  setShowOriginsOverlay: BooleanSetter;
  setShowVisual: Dispatch<SetStateAction<boolean>>;
  changeToolMode: (mode: ToolMode) => void;
  showCenterOfMass: boolean;
  showCoMOverlay: boolean;
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
  showInertia: boolean;
  showInertiaOverlay: boolean;
  showJointAxes: boolean;
  showJointAxesOverlay: boolean;
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  showVisual: boolean;
}

export function useRegressionBridge({
  active,
  centerOfMassSize,
  enabled = true,
  highlightMode,
  jointAxisSize,
  modelOpacity,
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
  setModelOpacity,
  setOriginSize,
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
  changeToolMode,
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
}: UseRegressionBridgeParams) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const regressionDebugEnabled = isRegressionDebugEnabled();
    if (!regressionDebugEnabled) {
      return;
    }

    if (!active) {
      setRegressionViewerHandlers(null);
      return () => {
        setRegressionViewerHandlers(null);
      };
    }

    const applyFlags = (flags: RegressionViewerFlags) => {
      if (flags.showCollision !== undefined) setShowCollision(flags.showCollision);
      if (flags.showCollisionAlwaysOnTop !== undefined)
        setShowCollisionAlwaysOnTop(flags.showCollisionAlwaysOnTop);
      if (flags.showVisual !== undefined) setShowVisual(flags.showVisual);
      if (flags.showCenterOfMass !== undefined) setShowCenterOfMass(flags.showCenterOfMass);
      if (flags.showCoMOverlay !== undefined) setShowCoMOverlay(flags.showCoMOverlay);
      if (flags.centerOfMassSize !== undefined) setCenterOfMassSize(flags.centerOfMassSize);
      if (flags.showInertia !== undefined) setShowInertia(flags.showInertia);
      if (flags.showInertiaOverlay !== undefined) setShowInertiaOverlay(flags.showInertiaOverlay);
      if (flags.showOrigins !== undefined) setShowOrigins(flags.showOrigins);
      if (flags.showOriginsOverlay !== undefined) setShowOriginsOverlay(flags.showOriginsOverlay);
      if (flags.originSize !== undefined) setOriginSize(flags.originSize);
      if (flags.showJointAxes !== undefined) setShowJointAxes(flags.showJointAxes);
      if (flags.showJointAxesOverlay !== undefined)
        setShowJointAxesOverlay(flags.showJointAxesOverlay);
      if (flags.jointAxisSize !== undefined) setJointAxisSize(flags.jointAxisSize);
      if (flags.highlightMode !== undefined) setHighlightMode(flags.highlightMode);
      if (flags.modelOpacity !== undefined) setModelOpacity(flags.modelOpacity);
    };

    setRegressionViewerHandlers({
      getSnapshot: () => ({
        jointAngles: { ...jointAnglesRef.current },
        activeJoint: activeJointRef.current,
        toolMode,
        highlightMode,
        flags: {
          showCollision,
          showCollisionAlwaysOnTop,
          showVisual,
          showCenterOfMass,
          showCoMOverlay,
          centerOfMassSize,
          showInertia,
          showInertiaOverlay,
          showOrigins,
          showOriginsOverlay,
          originSize,
          showJointAxes,
          showJointAxesOverlay,
          jointAxisSize,
          highlightMode,
          modelOpacity,
        },
      }),
      setFlags: applyFlags,
      setToolMode: (nextMode) => {
        const normalizedMode = String(nextMode || '').trim();
        const allowedModes: ToolMode[] = [
          'select',
          'translate',
          'rotate',
          'universal',
          'view',
          'face',
          'measure',
          'paint',
        ];
        const resolvedMode = allowedModes.includes(normalizedMode as ToolMode)
          ? (normalizedMode as ToolMode)
          : toolMode;
        const changed = resolvedMode !== toolMode;

        if (changed) {
          changeToolMode(resolvedMode);
        }

        return {
          changed,
          activeMode: resolvedMode,
        };
      },
      setJointAngles: (nextJointAngles) => {
        if (!nextJointAngles || typeof nextJointAngles !== 'object') {
          return { changed: false };
        }

        let changed = false;

        Object.entries(nextJointAngles).forEach(([jointName, angle]) => {
          if (!Number.isFinite(Number(angle))) {
            return;
          }

          const numericAngle = Number(angle);
          const runtimeJoints = robot?.joints as Record<string, RuntimeJointLike> | undefined;
          const jointKey = resolveViewerJointKey(runtimeJoints, jointName) ?? jointName;
          const joint = runtimeJoints?.[jointKey];
          if (joint && isSingleDofJoint(joint)) {
            joint.setJointValue?.(resolveRuntimeMotionAngle(jointName, numericAngle, joint));
          }

          if (jointAnglesRef.current[jointName] !== numericAngle) {
            changed = true;
          }
        });

        if (changed) {
          patchJointPanelAngles(nextJointAngles);
        }

        robot?.updateMatrixWorld?.(true);
        requestSceneRefresh();
        return { changed };
      },
    });

    return () => {
      setRegressionViewerHandlers(null);
    };
  }, [
    active,
    activeJointRef,
    centerOfMassSize,
    enabled,
    highlightMode,
    jointAnglesRef,
    jointAxisSize,
    modelOpacity,
    originSize,
    patchJointPanelAngles,
    requestSceneRefresh,
    resolveRuntimeMotionAngle,
    robot,
    setCenterOfMassSize,
    setHighlightMode,
    setJointAxisSize,
    setModelOpacity,
    setOriginSize,
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
    changeToolMode,
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
    toolMode,
  ]);
}
