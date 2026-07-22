export interface JointLimitOrderLike {
  lower?: number;
  upper?: number;
}

export interface OrderedJointLimitBounds {
  lower: number;
  upper: number;
}

export function hasFiniteJointLimitBounds<T extends JointLimitOrderLike>(
  limit: T | null | undefined,
): limit is T & Required<Pick<JointLimitOrderLike, 'lower' | 'upper'>> {
  return (
    typeof limit?.lower === 'number' &&
    Number.isFinite(limit.lower) &&
    typeof limit.upper === 'number' &&
    Number.isFinite(limit.upper)
  );
}

export function getOrderedJointLimitBounds(lower: number, upper: number): OrderedJointLimitBounds {
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower > upper) {
    return { lower: upper, upper: lower };
  }

  return { lower, upper };
}

export function normalizeJointLimitOrder<T extends JointLimitOrderLike>(limit: T): T {
  const lower = Number(limit.lower);
  const upper = Number(limit.upper);

  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= upper) {
    return limit;
  }

  return {
    ...limit,
    lower: upper,
    upper: lower,
  };
}
