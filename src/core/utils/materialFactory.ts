import * as THREE from 'three';
import { parseThreeColorWithOpacity } from './color.ts';

const RUBBER_MATERIAL_PATTERN =
  /\b(rubber|tire|tyre|grip|gasket|seal|boot|bushing|silicone|footpad|foot_pad)\b/i;
const METAL_MATERIAL_PATTERN =
  /\b(metal|steel|stainless|chrome|alum(?:inum|inium)?|iron|alloy|bolt|screw|shaft|bearing|hinge|bracket)\b/i;
const COATED_SHELL_MATERIAL_PATTERN =
  /\b(shell|body|cover|panel|fairing|housing|case|coat|paint)\b/i;

export const MATERIAL_CONFIG = {
  roughness: 0.56,
  metalness: 0.035,
  envMapIntensity: 0.56,
  whiteColorMultiplier: 0.93,
  whiteEnvMapIntensityMultiplier: 0.82,
  nearWhiteThreshold: 0.88,
} as const;

const MATERIAL_PRESET_CONFIG = {
  default: {
    roughness: MATERIAL_CONFIG.roughness,
    metalness: MATERIAL_CONFIG.metalness,
    envMapIntensity: MATERIAL_CONFIG.envMapIntensity,
  },
  coated: {
    roughness: 0.64,
    metalness: 0.05,
    envMapIntensity: 0.46,
  },
  rubber: {
    roughness: 0.82,
    metalness: 0.01,
    envMapIntensity: 0.16,
  },
  metal: {
    roughness: 0.38,
    metalness: 0.48,
    envMapIntensity: 0.64,
  },
} as const;

type MaterialPresetName = keyof typeof MATERIAL_PRESET_CONFIG;

function inferMaterialPresetNameFromName(name?: string): MaterialPresetName | null {
  const normalizedName = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[._\-]+/g, ' ');
  if (!normalizedName) {
    return null;
  }

  if (RUBBER_MATERIAL_PATTERN.test(normalizedName)) {
    return 'rubber';
  }

  if (METAL_MATERIAL_PATTERN.test(normalizedName)) {
    return 'metal';
  }

  if (COATED_SHELL_MATERIAL_PATTERN.test(normalizedName)) {
    return 'coated';
  }

  return null;
}

function inferMaterialPresetNameFromColor(color: THREE.Color): MaterialPresetName {
  const perceptualColor = color.clone().convertLinearToSRGB();
  const hsl = { h: 0, s: 0, l: 0 };
  perceptualColor.getHSL(hsl);

  if (hsl.s <= 0.22 && hsl.l <= 0.22) {
    return 'rubber';
  }

  if (hsl.s <= 0.26 && hsl.l >= 0.76) {
    return 'coated';
  }

  return 'default';
}

function inferMaterialPresetName(name: string | undefined, color: THREE.Color): MaterialPresetName {
  return inferMaterialPresetNameFromName(name) ?? inferMaterialPresetNameFromColor(color);
}

export interface CreateMaterialOptions {
  color: THREE.ColorRepresentation;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  name?: string;
  preserveExactColor?: boolean;
  alphaTest?: number;
}

function resolveUnitIntervalValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function resolveNonNegativeValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

export function createMatteMaterial(options: CreateMaterialOptions): THREE.MeshStandardMaterial {
  const {
    color,
    side = THREE.DoubleSide,
    map = null,
    name = '',
    preserveExactColor = false,
  } = options;
  const parsedColor = parseThreeColorWithOpacity(color);
  const finalColor = parsedColor?.color ?? new THREE.Color('#ffffff');
  const effectiveOpacity = Number.isFinite(options.opacity)
    ? Number(options.opacity)
    : (parsedColor?.opacity ?? 1.0);
  const effectiveTransparent = Boolean(options.transparent) || effectiveOpacity < 1.0;
  const presetName = inferMaterialPresetName(name, finalColor);
  const preset = MATERIAL_PRESET_CONFIG[presetName];
  const effectiveRoughness = resolveUnitIntervalValue(options.roughness) ?? preset.roughness;
  const effectiveMetalness = resolveUnitIntervalValue(options.metalness) ?? preset.metalness;
  const parsedEmissive = parseThreeColorWithOpacity(options.emissive);
  const effectiveEmissive = parsedEmissive?.color;
  const effectiveAlphaTest = resolveUnitIntervalValue(options.alphaTest);
  const effectiveEmissiveIntensity = resolveNonNegativeValue(options.emissiveIntensity);
  const isNearWhite =
    finalColor.r >= MATERIAL_CONFIG.nearWhiteThreshold &&
    finalColor.g >= MATERIAL_CONFIG.nearWhiteThreshold &&
    finalColor.b >= MATERIAL_CONFIG.nearWhiteThreshold;
  const shouldPreserveExactColorAppearance = preserveExactColor;
  const envMapIntensity = isNearWhite && !shouldPreserveExactColorAppearance
    ? preset.envMapIntensity * MATERIAL_CONFIG.whiteEnvMapIntensityMultiplier
    : preset.envMapIntensity;

  if (
    !shouldPreserveExactColorAppearance &&
    !map &&
    finalColor.r > 0.95 &&
    finalColor.g > 0.95 &&
    finalColor.b > 0.95
  ) {
    finalColor.multiplyScalar(MATERIAL_CONFIG.whiteColorMultiplier);
  }

  const material = new THREE.MeshStandardMaterial({
    color: finalColor,
    roughness: effectiveRoughness,
    metalness: effectiveMetalness,
    envMapIntensity,
    ...(effectiveEmissive ? { emissive: effectiveEmissive } : {}),
    ...(effectiveEmissiveIntensity !== undefined
      ? { emissiveIntensity: effectiveEmissiveIntensity }
      : {}),
    side,
    transparent: effectiveTransparent,
    opacity: effectiveOpacity,
    depthWrite: effectiveOpacity >= 1.0,
    map,
  });

  // Preserve authored URDF/USD palette values without ACES shifting saturated
  // robot colors (for example Unitree's orange) toward yellow in the viewer.
  if (shouldPreserveExactColorAppearance) {
    material.toneMapped = false;
  }

  if (name) material.name = name;

  if (effectiveAlphaTest !== undefined) {
    material.alphaTest = effectiveAlphaTest;
  }

  material.userData.originalColor = finalColor.clone();
  material.userData.materialPreset = presetName;
  material.userData.originalRoughness = effectiveRoughness;
  material.userData.originalMetalness = effectiveMetalness;
  material.userData.originalEnvMapIntensity = envMapIntensity;
  if (effectiveEmissive) {
    material.userData.originalEmissive = effectiveEmissive.clone();
  }
  if (effectiveEmissiveIntensity !== undefined) {
    material.userData.originalEmissiveIntensity = effectiveEmissiveIntensity;
  }

  return material;
}
