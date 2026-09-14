export type UsdMaterialTextureInputSlotPathField =
  | 'mapPath'
  | 'emissiveMapPath'
  | 'roughnessMapPath'
  | 'metalnessMapPath'
  | 'normalMapPath'
  | 'aoMapPath'
  | 'alphaMapPath'
  | 'clearcoatMapPath'
  | 'clearcoatRoughnessMapPath'
  | 'clearcoatNormalMapPath'
  | 'specularColorMapPath'
  | 'specularIntensityMapPath'
  | 'transmissionMapPath'
  | 'thicknessMapPath'
  | 'sheenColorMapPath'
  | 'sheenRoughnessMapPath'
  | 'anisotropyMapPath'
  | 'iridescenceMapPath'
  | 'iridescenceThicknessMapPath';

/**
 * Runtime list of texture-input slot keys. Shared so the canonical validator
 * and the texture-input helper cannot drift apart — note `mapPath` does NOT
 * match a naive `endsWith('MapPath')` filter (lowercase m), which is exactly
 * the kind of drift this constant prevents.
 */
export const USD_MATERIAL_TEXTURE_INPUT_SLOTS: readonly UsdMaterialTextureInputSlotPathField[] = [
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
] as const;

/**
 * Per-slot metadata for a standard UsdPreviewSurface texture input. `uvTransform`
 * is a column-major 3x3 matrix implementing the USD UsdTransform2d composition
 * (result = in * scale * rotate * translation), directly loadable via
 * THREE.Matrix3.fromArray. `wrapS`/`wrapT` are raw USD tokens (e.g. "repeat",
 * "black"); `sourceColorSpace` is the authored UsdUVTexture token, absent when
 * the material relies on USD's automatic fallback.
 */
export interface UsdMaterialTextureInput {
  /** UsdUVTexture output selector and linear sample arithmetic, independent of UV transforms. */
  sourceOutput?: string | null;
  sampleScale?: ArrayLike<number> | null;
  sampleBias?: ArrayLike<number> | null;
  uvTransform?: ArrayLike<number> | null;
  uvPrimvar?: string | null;
  wrapS?: string | null;
  wrapT?: string | null;
  sourceColorSpace?: string | null;
  /**
   * Native resolution of sourceColorSpace=auto, recorded only when the image
   * header (gamma hint, channel count, bit depth) yields a definite
   * classification following Hio_StbImage::IsColorSpaceSRGB. Authored tokens
   * stay authoritative; unresolvable headers (ICC/EXIF/palette) record
   * nothing so the loader fallback applies.
   */
  resolvedColorSpace?: 'srgb' | 'raw' | null;
}

export type UsdMaterialTextureInputs = Partial<
  Record<UsdMaterialTextureInputSlotPathField, UsdMaterialTextureInput>
>;

/** Native MDL preset evidence only; these values are not a TS shader program. */
export type UsdMdlPresetInput = number | boolean | number[] | {
  assetPath: string;
  sourceColorSpace: 'sRGB' | 'raw' | 'auto';
};

export interface UsdMdlPreset {
  family: 'OmniPBR' | 'GlassWithVolume' | '';
  status: 'resolved' | 'partial' | 'unsupported';
  sourceAsset: string;
  subIdentifier: string;
  inputs: Record<string, UsdMdlPresetInput>;
  unsupportedInputs: string[];
}

export interface UsdSceneMaterialRecord {
  mdlPreset?: UsdMdlPreset | null;
  materialId?: string | null;
  stageSourcePath?: string | null;
  name?: string | null;
  shaderPath?: string | null;
  shaderName?: string | null;
  shaderInfoId?: string | null;
  isOmniPbr?: boolean | null;
  isOmniGlass?: boolean | null;
  opacityEnabled?: boolean | null;
  opacityTextureEnabled?: boolean | null;
  emissiveEnabled?: boolean | null;
  colorSpace?: string | null;
  colorSource?: string | null;
  authoredColorSpace?: string | null;
  emissiveColorSpace?: string | null;
  specularColorSpace?: string | null;
  attenuationColorSpace?: string | null;
  sheenColorSpace?: string | null;
  color?: ArrayLike<number> | null;
  authoredColor?: ArrayLike<number> | null;
  emissive?: ArrayLike<number> | null;
  specularColor?: ArrayLike<number> | null;
  attenuationColor?: ArrayLike<number> | null;
  sheenColor?: ArrayLike<number> | null;
  normalScale?: ArrayLike<number> | null;
  clearcoatNormalScale?: ArrayLike<number> | null;
  roughness?: number | null;
  metalness?: number | null;
  opacity?: number | null;
  alphaTest?: number | null;
  clearcoat?: number | null;
  clearcoatRoughness?: number | null;
  specularIntensity?: number | null;
  transmission?: number | null;
  thickness?: number | null;
  attenuationDistance?: number | null;
  aoMapIntensity?: number | null;
  sheen?: number | null;
  sheenRoughness?: number | null;
  iridescence?: number | null;
  iridescenceIOR?: number | null;
  anisotropy?: number | null;
  anisotropyRotation?: number | null;
  emissiveIntensity?: number | null;
  ior?: number | null;
  mapPath?: string | null;
  emissiveMapPath?: string | null;
  roughnessMapPath?: string | null;
  metalnessMapPath?: string | null;
  normalMapPath?: string | null;
  aoMapPath?: string | null;
  alphaMapPath?: string | null;
  clearcoatMapPath?: string | null;
  clearcoatRoughnessMapPath?: string | null;
  clearcoatNormalMapPath?: string | null;
  specularColorMapPath?: string | null;
  specularIntensityMapPath?: string | null;
  transmissionMapPath?: string | null;
  thicknessMapPath?: string | null;
  sheenColorMapPath?: string | null;
  sheenRoughnessMapPath?: string | null;
  anisotropyMapPath?: string | null;
  iridescenceMapPath?: string | null;
  iridescenceThicknessMapPath?: string | null;
  textureInputs?: UsdMaterialTextureInputs | null;
}
