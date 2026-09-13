import type { UsdMdlPreset, UsdMdlPresetInput } from '@/types/usdMaterial';

const PRESET_KEYS = new Set([
  'family', 'status', 'sourceAsset', 'subIdentifier', 'inputs', 'unsupportedInputs',
]);
const ASSET_KEYS = new Set(['assetPath', 'sourceColorSpace']);
const COLOR_SPACES = new Set(['sRGB', 'raw', 'auto']);
const MAX_INPUTS = 128;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
const MAX_VECTOR_LENGTH = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit;
}

function inputName(value: unknown): value is string {
  return boundedString(value, MAX_IDENTIFIER_LENGTH) && value.trim().length > 0
    && !['__proto__', 'prototype', 'constructor'].includes(value);
}

function normalizeInput(value: unknown): UsdMdlPresetInput | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.length <= MAX_VECTOR_LENGTH
      && Array.from(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ? value.slice() : null;
  }
  if (!isRecord(value) || Object.keys(value).some((key) => !ASSET_KEYS.has(key))) return null;
  if (!boundedString(value.assetPath, MAX_PATH_LENGTH)
    || typeof value.sourceColorSpace !== 'string' || !COLOR_SPACES.has(value.sourceColorSpace)) return null;
  return { assetPath: value.assetPath, sourceColorSpace: value.sourceColorSpace as 'sRGB' | 'raw' | 'auto' };
}

function normalizeUnsupportedInputs(value: unknown, status: UsdMdlPreset['status']): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_INPUTS) return null;
  const entries: unknown[] = Array.from(value);
  if (!entries.every(inputName) || (status === 'resolved' && entries.length > 0)) return null;
  return entries;
}

/**
 * Keep only a complete, bounded diagnostic contract. Invalid payloads are
 * rejected as a whole: dropping unsupported fields while retaining "resolved"
 * would turn incomplete evidence into an apparent success. This does not
 * evaluate MDL or choose render parameters; native standard fields do that.
 */
export function normalizeUsdMdlPreset(value: unknown): UsdMdlPreset | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !PRESET_KEYS.has(key))) return null;
  const { family, status, sourceAsset, subIdentifier, inputs, unsupportedInputs } = value;
  if (family !== 'OmniPBR' && family !== 'GlassWithVolume' && family !== '') return null;
  if (status !== 'resolved' && status !== 'partial' && status !== 'unsupported') return null;
  if (family === '' && status !== 'unsupported') return null;
  if (!boundedString(sourceAsset, MAX_PATH_LENGTH) || !boundedString(subIdentifier, MAX_PATH_LENGTH)) return null;
  if (!isRecord(inputs) || Object.keys(inputs).length > MAX_INPUTS) return null;
  const normalizedUnsupportedInputs = normalizeUnsupportedInputs(unsupportedInputs, status);
  if (normalizedUnsupportedInputs === null) return null;

  const normalizedInputs: Record<string, UsdMdlPresetInput> = {};
  for (const [name, input] of Object.entries(inputs)) {
    if (!inputName(name)) return null;
    const normalized = normalizeInput(input);
    if (normalized === null) return null;
    normalizedInputs[name] = normalized;
  }
  return { family, status, sourceAsset, subIdentifier, inputs: normalizedInputs, unsupportedInputs: normalizedUnsupportedInputs };
}
