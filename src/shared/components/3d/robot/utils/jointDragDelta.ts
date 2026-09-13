interface ResolveRevoluteDragDeltaOptions {
  worldDelta: number;
  tangentDelta: number;
  planeFacingRatio: number;
  epsilon?: number;
  maxDelta?: number;
  planeFacingThreshold?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface ResolveRevoluteTangentAngleDeltaOptions {
  tangentDistance: number;
  startRadius: number;
  endRadius: number;
  epsilon?: number;
}

interface ResolveRevoluteDragStepOptions {
  pendingDelta: number;
  nextDelta?: number;
  maxStep: number;
  epsilon?: number;
}

export interface RevoluteDragStep {
  appliedDelta: number;
  pendingDelta: number;
}

export function resolveRevoluteTangentAngleDelta({
  tangentDistance,
  startRadius,
  endRadius,
  epsilon = 1e-5,
}: ResolveRevoluteTangentAngleDeltaOptions): number {
  if (!Number.isFinite(tangentDistance)) {
    return 0;
  }

  const finiteRadii = [startRadius, endRadius].filter(
    (radius) => Number.isFinite(radius) && radius > epsilon,
  );
  if (finiteRadii.length === 0) {
    return 0;
  }

  const effectiveRadius =
    finiteRadii.reduce((total, radius) => total + radius, 0) / finiteRadii.length;
  return tangentDistance / effectiveRadius;
}

export function resolveRevoluteDragStep({
  pendingDelta,
  nextDelta = 0,
  maxStep,
  epsilon = 1e-5,
}: ResolveRevoluteDragStepOptions): RevoluteDragStep {
  const safePendingDelta = Number.isFinite(pendingDelta) ? pendingDelta : 0;
  const safeNextDelta = Number.isFinite(nextDelta) ? nextDelta : 0;
  const accumulatedDelta = safePendingDelta + safeNextDelta;
  const safeMaxStep = Number.isFinite(maxStep) && maxStep > epsilon ? maxStep : Infinity;
  const appliedDelta = clamp(accumulatedDelta, -safeMaxStep, safeMaxStep);
  const remainder = accumulatedDelta - appliedDelta;

  return {
    appliedDelta: Math.abs(appliedDelta) > epsilon ? appliedDelta : 0,
    pendingDelta: Math.abs(remainder) > epsilon ? remainder : 0,
  };
}

export function resolveRevoluteDragDelta({
  worldDelta,
  tangentDelta,
  planeFacingRatio,
  epsilon = 1e-5,
  maxDelta = Math.PI / 8,
  planeFacingThreshold = 0.2,
}: ResolveRevoluteDragDeltaOptions): number {
  const hasWorldDelta = Number.isFinite(worldDelta) && Math.abs(worldDelta) > epsilon;
  const hasTangentDelta = Number.isFinite(tangentDelta) && Math.abs(tangentDelta) > epsilon;

  if (
    hasTangentDelta &&
    Number.isFinite(planeFacingRatio) &&
    planeFacingRatio < planeFacingThreshold
  ) {
    return clamp(tangentDelta, -maxDelta, maxDelta);
  }

  if (hasWorldDelta) {
    return clamp(worldDelta, -maxDelta, maxDelta);
  }

  if (hasTangentDelta) {
    return clamp(tangentDelta, -maxDelta, maxDelta);
  }

  return clamp(hasWorldDelta ? worldDelta : 0, -maxDelta, maxDelta);
}
