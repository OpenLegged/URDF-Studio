export const MAX_GEOMETRY_DIMENSION_DECIMALS = 6;
export const GEOMETRY_DIMENSION_STEP = 0.01;
export const MAX_TRANSFORM_DECIMALS = 6;
export const TRANSFORM_STEP = 0.000001;
export const MAX_PROPERTY_DECIMALS = 7;

/** Serialize source-owned numbers without rounding away editable precision. */
export function formatNumberPreservingPrecision(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

export const roundToMaxDecimals = (
  value: number,
  maxDecimals: number = MAX_PROPERTY_DECIMALS,
): number => {
  if (!Number.isFinite(value)) {
    return value;
  }

  const rounded = Number(value.toFixed(maxDecimals));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const formatNumberWithMaxDecimals = (
  value: number,
  maxDecimals: number = MAX_PROPERTY_DECIMALS,
): string => {
  if (!Number.isFinite(value)) {
    return '';
  }

  const rounded = roundToMaxDecimals(value, maxDecimals);
  // Integer and exponent zeros are significant; trim only a fixed fractional part.
  return rounded.toFixed(maxDecimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
};
