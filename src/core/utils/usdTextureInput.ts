import * as THREE from 'three';
import type {
  UsdMaterialTextureInput,
  UsdMaterialTextureInputSlotPathField,
  UsdMaterialTextureInputs,
} from '@/types/usdMaterial';

export const USD_TEXTURE_INPUT_SLOTS: readonly UsdMaterialTextureInputSlotPathField[] = [
  'mapPath',
  'emissiveMapPath',
  'roughnessMapPath',
  'metalnessMapPath',
  'normalMapPath',
  'aoMapPath',
  'alphaMapPath',
  'clearcoatMapPath',
  'clearcoatRoughnessMapPath',
  'clearcoatNormalMapPath',
  'specularColorMapPath',
  'specularIntensityMapPath',
  'transmissionMapPath',
  'thicknessMapPath',
  'sheenColorMapPath',
  'sheenRoughnessMapPath',
  'anisotropyMapPath',
  'iridescenceMapPath',
  'iridescenceThicknessMapPath',
];

/**
 * Slots that sample color. USD's sourceColorSpace=auto reads 8-bit 3/4-channel
 * images as sRGB, so their Three counterpart uses THREE.SRGBColorSpace. All
 * other slots (roughness/metalness/normal/occlusion/alpha and physical masks)
 * stay linear.
 */
export const USD_COLOR_TEXTURE_INPUT_SLOTS: ReadonlySet<UsdMaterialTextureInputSlotPathField> =
  new Set<UsdMaterialTextureInputSlotPathField>([
    'mapPath',
    'emissiveMapPath',
    'specularColorMapPath',
    'sheenColorMapPath',
  ]);

const USD_WRAP_MODE_TO_THREE: Record<string, THREE.Wrapping> = {
  repeat: THREE.RepeatWrapping,
  mirroredRepeat: THREE.MirroredRepeatWrapping,
  mirror: THREE.MirroredRepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  clampToEdge: THREE.ClampToEdgeWrapping,
  black: THREE.ClampToEdgeWrapping,
  // `black`/`clamp` differ only in how the border is sampled; Three has no
  // border-color extension wired through the standard material texture path,
  // so both clamp. This is a documented approximation, not a silent drop.
};

const RESOLVED_COLOR_SPACES = new Set(['srgb', 'raw']);

function normalizeResolvedColorSpace(
  value: unknown,
): 'srgb' | 'raw' | null {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return RESOLVED_COLOR_SPACES.has(token) ? (token as 'srgb' | 'raw') : null;
}

const IDENTITY_UV_TRANSFORM: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function normalizeUsdTextureInputSlot(
  value: unknown,
): UsdMaterialTextureInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Partial<Record<keyof UsdMaterialTextureInput, unknown>>;
  const uvTransform = Array.isArray(raw.uvTransform)
    ? raw.uvTransform
    : (raw.uvTransform as ArrayLike<number> | null | undefined) &&
        typeof (raw.uvTransform as ArrayLike<number>).length === 'number'
      ? Array.from(raw.uvTransform as ArrayLike<number>)
      : null;
  const normalized: UsdMaterialTextureInput = {};
  if (uvTransform && uvTransform.length === 9 && uvTransform.every((entry) => Number.isFinite(Number(entry)))) {
    normalized.uvTransform = uvTransform.map((entry) => Number(entry));
  }
  for (const field of ['uvPrimvar', 'wrapS', 'wrapT', 'sourceColorSpace', 'sourceOutput'] as const) {
    const text = raw[field];
    if (typeof text === 'string' && text.trim()) {
      normalized[field] = text.trim();
    }
  }
  const resolvedColorSpace = normalizeResolvedColorSpace(raw.resolvedColorSpace);
  if (resolvedColorSpace) {
    normalized.resolvedColorSpace = resolvedColorSpace;
  }
  for (const field of ['sampleScale', 'sampleBias'] as const) {
    const value = raw[field] as ArrayLike<unknown> | null | undefined;
    if (value?.length === 4) {
      const tuple = Array.from(value);
      if (tuple.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        normalized[field] = tuple as number[];
      }
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeUsdTextureInputs(
  value: unknown,
): UsdMaterialTextureInputs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const normalized: UsdMaterialTextureInputs = {};
  let hasAnySlot = false;
  for (const slot of USD_TEXTURE_INPUT_SLOTS) {
    const slotInput = normalizeUsdTextureInputSlot((value as Record<string, unknown>)[slot]);
    if (slotInput) {
      normalized[slot] = slotInput;
      hasAnySlot = true;
    }
  }
  return hasAnySlot ? normalized : null;
}

export function getUsdTextureInputSlot(
  textureInputs: UsdMaterialTextureInputs | null | undefined,
  slot: UsdMaterialTextureInputSlotPathField,
): UsdMaterialTextureInput | null {
  const input = textureInputs?.[slot];
  return input ? input : null;
}

/** Retain authored sampling data, including inputs whose textures are still loading. */
export function rememberUsdMaterialTextureInputs(
  material: THREE.Material,
  inputs: UsdMaterialTextureInputs | null | undefined,
): void {
  const normalized = normalizeUsdTextureInputs(inputs);
  if (normalized) {
    material.userData.usdTextureInputs = normalized;
  } else {
    delete material.userData.usdTextureInputs;
  }
}

/**
 * Capture live texture state in the same schema used by native USD snapshots.
 * Keep shader-only metadata (primvar, sample arithmetic, color-space hints) and
 * USD wrap tokens such as `black` when their Three approximation is unchanged.
 * Reading must not update a shared texture's matrix or alias authored arrays.
 */
export function captureUsdMaterialTextureInputs(material: unknown): UsdMaterialTextureInputs | null {
  if (!material || typeof material !== 'object') return null;
  const candidate = material as THREE.Material & Record<string, unknown>;
  const inputs = normalizeUsdTextureInputs(candidate.userData?.usdTextureInputs) || {};
  for (const slot of USD_TEXTURE_INPUT_SLOTS) {
    const texture = candidate[slot.slice(0, -4)] as THREE.Texture | null | undefined;
    if (!texture?.isTexture) continue;
    const input: UsdMaterialTextureInput = {
      ...normalizeUsdTextureInputSlot(texture.userData.usdTextureInput),
      ...inputs[slot],
    };
    const matrix = texture.matrixAutoUpdate
      ? new THREE.Matrix3().setUvTransform(
        texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y,
        texture.rotation, texture.center.x, texture.center.y,
      )
      : texture.matrix;
    input.uvTransform = matrix.toArray();
    for (const axis of ['wrapS', 'wrapT'] as const) {
      if (resolveWrapMode(input[axis]) === texture[axis]) continue;
      input[axis] = texture[axis] === THREE.RepeatWrapping
        ? 'repeat'
        : texture[axis] === THREE.MirroredRepeatWrapping ? 'mirror' : 'clamp';
    }
    inputs[slot] = input;
  }
  return normalizeUsdTextureInputs(inputs);
}

export function usdTextureInputHasUvTransform(
  input: UsdMaterialTextureInput | null | undefined,
): boolean {
  // A recorded matrix counts even when it is the identity: applying it must
  // reset any state a shared cache texture already carries (repeat/offset or a
  // previous material's matrix), so identity is an authored value here, not
  // "nothing to do".
  const uvTransform = input?.uvTransform;
  return Boolean(
    uvTransform
      && uvTransform.length === 9
      && Array.from(uvTransform).every((value) => Number.isFinite(Number(value))),
  );
}

export function usdTextureInputHasTransform(
  input: UsdMaterialTextureInput | null | undefined,
): boolean {
  const uvTransform = input?.uvTransform;
  if (!usdTextureInputHasUvTransform(input)) {
    return false;
  }
  return Array.from(uvTransform!).some(
    (value, index) => Math.abs(Number(value) - IDENTITY_UV_TRANSFORM[index]) > 1e-9,
  );
}

/**
 * Resolve the Three color space for a slot record.
 *
 * Explicit tokens are authoritative (`raw` -> linear, `sRGB` -> sRGB). For the
 * auto/absent case the native snapshot may carry `resolvedColorSpace` — the
 * driver's image-header classification of sourceColorSpace=auto following
 * Hio_StbImage::IsColorSpaceSRGB (gamma hint first, then the 8-bit 3/4-channel
 * guess), which turns single-channel grayscale base-color maps linear. Without
 * a resolved hint the f47 corpus truth (225/225 8-bit RGB/RGBA files, no color
 * metadata) keeps color slots on the sRGB fallback; headers the native side
 * cannot classify (ICC/EXIF/palette) intentionally record nothing. Data slots
 * (roughness/normal/occlusion/alpha and physical masks) return null so the
 * caller keeps its existing decode state — the slot's sampling semantics, not
 * a USD rule, decide there, and forcing linear would overwrite established
 * behavior for no evidence.
 */
export function resolveUsdTextureColorSpace(
  slot: UsdMaterialTextureInputSlotPathField,
  input: UsdMaterialTextureInput | null | undefined,
): THREE.ColorSpace | null {
  const authored = input?.sourceColorSpace?.trim().toLowerCase();
  if (authored === 'srgb') {
    return THREE.SRGBColorSpace;
  }
  if (authored === 'raw') {
    return THREE.LinearSRGBColorSpace;
  }
  if (!USD_COLOR_TEXTURE_INPUT_SLOTS.has(slot)) {
    return null;
  }
  const resolved = normalizeResolvedColorSpace(input?.resolvedColorSpace);
  if (resolved === 'raw') {
    return THREE.LinearSRGBColorSpace;
  }
  if (resolved === 'srgb') {
    return THREE.SRGBColorSpace;
  }
  return THREE.SRGBColorSpace;
}

/**
 * Whether a slot record carries state that must isolate the material's texture
 * instance from the shared cache: any authored matrix (identity included —
 * see `usdTextureInputHasUvTransform`), wrap mode, or explicit color space.
 * `resolvedColorSpace: 'raw'` also counts: it classifies an auto
 * (unauthored) base-color image as linear data, which deviates from the
 * loader's SRGB cache default, so the slot must clone before the linear
 * decode lands on the texture — returning the shared instance would keep the
 * color-space fix from ever reaching `material.map`. A resolved `srgb`
 * deliberately does not count: it mirrors the loader default for the dominant
 * 8-bit RGB/RGBA corpus, so cloning on it would clone every shared texture
 * for no behavioral difference.
 */
export function usdTextureInputRequiresSlotState(
  input: UsdMaterialTextureInput | null | undefined,
): boolean {
  return Boolean(
    input
      && (usdTextureInputHasUvTransform(input)
        || input.wrapS
        || input.wrapT
        || input.sourceColorSpace
        || normalizeResolvedColorSpace(input.resolvedColorSpace) === 'raw'),
  );
}

function resolveWrapMode(value: string | null | undefined): THREE.Wrapping | null {
  const token = value?.trim();
  if (!token) {
    return null;
  }
  return USD_WRAP_MODE_TO_THREE[token] ?? null;
}

/**
 * Apply per-slot USD texture metadata to one concrete Three texture.
 *
 * The texture is expected to be a per-material clone (never the shared cached
 * instance), so mutation is safe. The explicit `matrix` follows the USD
 * UsdTransform2d composition exactly (in * scale * rotate * translation, column
 * major) — `THREE.Texture.setUvTransform` composes scale/rotation/translation
 * in a different order and disagrees with USD for nonuniform scale plus
 * rotation, so it is deliberately not used. Wrap modes and the color space are
 * resolved from the slot record, falling back to the caller's defaults when the
 * material did not author them.
 */
export function applyUsdTextureInputToTexture(
  texture: THREE.Texture,
  slot: UsdMaterialTextureInputSlotPathField,
  input: UsdMaterialTextureInput | null | undefined,
): boolean {
  if (!texture || !input) {
    return false;
  }
  texture.userData.usdTextureInput = normalizeUsdTextureInputSlot(input);
  let applied = false;
  if (usdTextureInputHasUvTransform(input)) {
    // An explicit matrix always wins, including the identity: the clone may
    // carry non-identity repeat/offset state inherited from the shared cache
    // texture, and an identity record must reset it.
    texture.matrixAutoUpdate = false;
    texture.matrix.fromArray(input.uvTransform as ArrayLike<number>);
    applied = true;
  }
  const wrapS = resolveWrapMode(input.wrapS);
  if (wrapS !== null) {
    texture.wrapS = wrapS;
    applied = true;
  }
  const wrapT = resolveWrapMode(input.wrapT);
  if (wrapT !== null) {
    texture.wrapT = wrapT;
    applied = true;
  }
  const colorSpace = resolveUsdTextureColorSpace(slot, input);
  if (colorSpace && texture.colorSpace !== colorSpace) {
    texture.colorSpace = colorSpace;
    applied = true;
  }
  if (applied) {
    texture.needsUpdate = true;
  }
  return applied;
}

/**
 * Clone a shared cached texture for one material slot when per-slot state is
 * required. Cloning is mandatory when a transform exists: two materials sharing
 * one image with different UsdTransform2d values would otherwise contaminate
 * each other through the shared `matrix`. `source` is re-linked explicitly
 * because a fresh clone without source data would re-issue the image load.
 */
export function cloneUsdSlotTexture(
  cachedTexture: THREE.Texture,
  slot: UsdMaterialTextureInputSlotPathField,
  input: UsdMaterialTextureInput | null | undefined,
): THREE.Texture {
  const clone = cachedTexture.clone();
  clone.source = cachedTexture.source;
  applyUsdTextureInputToTexture(clone, slot, input);
  return clone;
}
