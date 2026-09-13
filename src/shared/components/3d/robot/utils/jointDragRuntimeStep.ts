import { hasEffectivelyFiniteJointLimits } from '@/shared/utils/jointUnits';
import { clampJointInteractionValue } from '@/core/robot/index';

interface JointDragRuntimeStepOptions {
  currentRuntimeValue?: number | null;
  fallbackRuntimeValue?: number | null;
  delta: number;
  jointType: string;
  limit?: { lower?: number; upper?: number } | null;
  deferRuntimeUpdate?: boolean;
  epsilon?: number;
}

export interface JointDragRuntimeStep {
  changed: boolean;
  nextRuntimeValue: number;
  shouldApplyRuntimeUpdate: boolean;
}

export function resolveJointDragRuntimeStep({
  currentRuntimeValue,
  fallbackRuntimeValue,
  delta,
  jointType,
  limit,
  deferRuntimeUpdate = false,
  epsilon = 1e-5,
}: JointDragRuntimeStepOptions): JointDragRuntimeStep {
  const current =
    typeof currentRuntimeValue === 'number' && Number.isFinite(currentRuntimeValue)
      ? currentRuntimeValue
      : typeof fallbackRuntimeValue === 'number' && Number.isFinite(fallbackRuntimeValue)
        ? fallbackRuntimeValue
        : 0;
  let nextRuntimeValue = current + delta;

  if (
    (jointType === 'revolute' || jointType === 'prismatic') &&
    hasEffectivelyFiniteJointLimits(limit)
  ) {
    nextRuntimeValue = clampJointInteractionValue(nextRuntimeValue, limit!.lower!, limit!.upper!);
  }

  const changed = Math.abs(nextRuntimeValue - current) > epsilon;
  const shouldApplyRuntimeUpdate = changed;
  if (deferRuntimeUpdate) {
    // Closed-loop compensation can lag behind in the worker, but the directly
    // dragged joint still needs an immediate local runtime update to stay under
    // the pointer.
    return {
      changed,
      nextRuntimeValue,
      shouldApplyRuntimeUpdate,
    };
  }

  return {
    changed,
    nextRuntimeValue,
    shouldApplyRuntimeUpdate,
  };
}
