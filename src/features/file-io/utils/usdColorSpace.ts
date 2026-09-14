import * as THREE from 'three';

export const clampUsdColorChannel = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
};

export const normalizeUsdAuthoredColorTuple = (
  color: readonly [number, number, number],
): [number, number, number] => {
  return [
    clampUsdColorChannel(color[0]),
    clampUsdColorChannel(color[1]),
    clampUsdColorChannel(color[2]),
  ];

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
