import * as THREE from 'three';

const USD_BRIGHT_NEUTRAL_SNAP_MIN = 0.8;
const USD_BRIGHT_NEUTRAL_SNAP_DELTA = 0.01;

export const clampUsdColorChannel = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (Math.abs(value) <= 1e-6) {
    return 0;
  }

  if (Math.abs(value - 1) <= 1e-6) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
};

export const normalizeUsdAuthoredColorTuple = (
  color: readonly [number, number, number],
): [number, number, number] => {
  const normalizedColor: [number, number, number] = [
    clampUsdColorChannel(color[0]),
    clampUsdColorChannel(color[1]),
    clampUsdColorChannel(color[2]),
  ];

  const minChannel = Math.min(...normalizedColor);
  const maxChannel = Math.max(...normalizedColor);
  if (
    minChannel >= USD_BRIGHT_NEUTRAL_SNAP_MIN &&
    maxChannel - minChannel <= USD_BRIGHT_NEUTRAL_SNAP_DELTA
  ) {
    const snappedChannel = clampUsdColorChannel(
      Number(((normalizedColor[0] + normalizedColor[1] + normalizedColor[2]) / 3).toFixed(2)),
    );
    return [snappedChannel, snappedChannel, snappedChannel];
  }

  return normalizedColor;
};

/**
 * USD scalar color attributes are authored in scene-linear space unless an
 * attribute explicitly declares another color space. Three.js Color channels
 * are already stored in its linear working color space.
 */
export const toUsdAuthoredColor = (color: THREE.Color): [number, number, number] => {
  return normalizeUsdAuthoredColorTuple([color.r, color.g, color.b]);
};

/**
 * URDF, MJCF, and SDF color tuples are interpreted as display/sRGB values by
 * the editor. Convert their exact source tuples before storing usdAuthoredColor.
 */
export const toUsdAuthoredColorFromSrgbTuple = (
  color: readonly [number, number, number],
): [number, number, number] => {
  const linearColor = new THREE.Color().setRGB(
    clampUsdColorChannel(color[0]),
    clampUsdColorChannel(color[1]),
    clampUsdColorChannel(color[2]),
    THREE.SRGBColorSpace,
  );
  return toUsdAuthoredColor(linearColor);
};

export const createThreeColorFromUsdAuthoredColor = (
  color: readonly [number, number, number],
): THREE.Color => {
  const normalizedColor = normalizeUsdAuthoredColorTuple(color);
  return new THREE.Color().setRGB(
    normalizedColor[0],
    normalizedColor[1],
    normalizedColor[2],
    THREE.LinearSRGBColorSpace,
  );
};
