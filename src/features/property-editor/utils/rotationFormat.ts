import * as THREE from 'three';
import { degToRad, radToDeg } from '@/core/robot/transforms';
import { formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';

export interface EulerRadiansValue {
  r: number;
  p: number;
  y: number;
}

export interface QuaternionValue {
  x: number;
  y: number;
  z: number;
  w: number;
}

const URDF_EULER_ORDER: THREE.EulerOrder = 'ZYX';
const PI_DISPLAY_MAX_DENOMINATOR = 12;
const PI_DISPLAY_TOLERANCE = 1e-6;
const RADIAN_FALLBACK_DECIMALS = 4;

export const DEFAULT_EULER_RADIANS: EulerRadiansValue = {
  r: 0,
  p: 0,
  y: 0,
};

export const DEFAULT_QUATERNION: QuaternionValue = {
  x: 0,
  y: 0,
  z: 0,
  w: 1,
};

const normalizeSignedZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

const normalizeDisplayZero = (value: number): number => (
  Object.is(value, -0) || Math.abs(value) < Number.EPSILON ? 0 : value
);

const formatPiFraction = (numerator: number, denominator: number): string => {
  const sign = numerator < 0 ? '-' : '';
  const absoluteNumerator = Math.abs(numerator);

  if (denominator === 1) {
    return absoluteNumerator === 1
      ? `${sign}π`
      : `${sign}${absoluteNumerator}π`;
  }

  return absoluteNumerator === 1
    ? `${sign}π/${denominator}`
    : `${sign}${absoluteNumerator}π/${denominator}`;
};

const findApproximatePiFraction = (
  ratio: number,
): { numerator: number; denominator: number } | null => {
  let bestMatch: { numerator: number; denominator: number; error: number } | null = null;

  for (let denominator = 1; denominator <= PI_DISPLAY_MAX_DENOMINATOR; denominator += 1) {
    const numerator = Math.round(ratio * denominator);
    if (numerator === 0 && ratio !== 0) {
      continue;
    }

    const approximation = numerator / denominator;
    const error = Math.abs(ratio - approximation);

    if (error > PI_DISPLAY_TOLERANCE) {
      continue;
    }

    if (
      bestMatch === null
      || error < bestMatch.error
      || (Math.abs(error - bestMatch.error) < Number.EPSILON && denominator < bestMatch.denominator)
    ) {
      bestMatch = { numerator, denominator, error };
    }
  }

  return bestMatch
    ? { numerator: bestMatch.numerator, denominator: bestMatch.denominator }
    : null;
};

const normalizePiDraft = (value: string): string => (
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/π/g, 'pi')
    .replace(/pai/g, 'pi')
    .replace(/[−–—]/g, '-')
);

export const formatRadiansForDisplay = (
  value: number,
  options?: { activeFocus?: boolean },
): string => {
  if (!Number.isFinite(value)) {
    return '';
  }

  const normalizedValue = options?.activeFocus
    ? normalizeSignedZero(value)
    : normalizeDisplayZero(value);
  if (normalizedValue === 0) {
    return '0';
  }

  const piRatio = normalizedValue / Math.PI;
  const symbolicFraction = findApproximatePiFraction(piRatio);
  if (symbolicFraction !== null) {
    return formatPiFraction(symbolicFraction.numerator, symbolicFraction.denominator);
  }

  if (options?.activeFocus) {
    return String(normalizedValue);
  }

  return formatNumberWithMaxDecimals(normalizedValue, RADIAN_FALLBACK_DECIMALS) || '0';
};

export const parseRadiansDisplayValue = (value: string): number | null => {
  const normalizedDraft = normalizePiDraft(value);
  if (normalizedDraft.length === 0) {
    return null;
  }

  const numericValue = Number(normalizedDraft);
  if (Number.isFinite(numericValue)) {
    return normalizeSignedZero(numericValue);
  }

  const symbolicMatch = normalizedDraft.match(
    /^([+-])?(?:(\d*\.?\d+)?(?:\*)?)?pi(?:\/(\d*\.?\d+))?$/,
  );

  if (!symbolicMatch) {
    return null;
  }

  const sign = symbolicMatch[1] === '-' ? -1 : 1;
  const coefficient = symbolicMatch[2] ? Number(symbolicMatch[2]) : 1;
  const denominator = symbolicMatch[3] ? Number(symbolicMatch[3]) : 1;

  if (!Number.isFinite(coefficient) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return normalizeSignedZero(sign * coefficient * Math.PI / denominator);
};

export const eulerRadiansToDegrees = (
  value: EulerRadiansValue,
): EulerRadiansValue => ({
  r: radToDeg(value.r),
  p: radToDeg(value.p),
  y: radToDeg(value.y),
});

export const eulerDegreesToRadians = (
  value: EulerRadiansValue,
): EulerRadiansValue => ({
  r: degToRad(value.r),
  p: degToRad(value.p),
  y: degToRad(value.y),
});

export const normalizeQuaternionValue = (
  value: QuaternionValue,
): QuaternionValue => {
  const quaternion = new THREE.Quaternion(value.x, value.y, value.z, value.w);
  if (quaternion.lengthSq() === 0) {
    return DEFAULT_QUATERNION;
  }

  quaternion.normalize();
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
};

export const eulerRadiansToQuaternion = (
  value: EulerRadiansValue,
): QuaternionValue => {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(value.r, value.p, value.y, URDF_EULER_ORDER),
  );

  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
};

export const quaternionToEulerRadians = (
  value: QuaternionValue,
): EulerRadiansValue => {
  const normalized = normalizeQuaternionValue(value);
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(normalized.x, normalized.y, normalized.z, normalized.w),
    URDF_EULER_ORDER,
  );

  return {
    r: euler.x,
    p: euler.y,
    y: euler.z,
  };
};
