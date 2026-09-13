import * as THREE from 'three';
import type { UsdMaterialTextureInputs, UsdMaterialTextureInputSlotPathField } from '@/types/usdMaterial';
import { normalizeUsdTextureInputs, USD_TEXTURE_INPUT_SLOTS } from './usdTextureInput';

export const USD_TEXTURE_ARITHMETIC_VERSION = 'usd-map-rgb-arithmetic-v1';
const MULTIPLY = 'diffuseColor *= sampledDiffuseColor;';
const ARITHMETIC = 'sampledDiffuseColor.rgb = sampledDiffuseColor.rgb * usdMapSampleScale.rgb + usdMapSampleBias.rgb;';

type ArithmeticSlotStatus = 'configured' | 'map-not-assigned' | 'unsupported-slot' | 'unsupported-output';
interface ArithmeticSlotSummary {
  slot: UsdMaterialTextureInputSlotPathField;
  sourceOutput: string | null;
  sampleScale: number[];
  sampleBias: number[];
  status: ArithmeticSlotStatus;
}
export interface UsdTextureArithmeticSummary {
  version: string;
  compiled: boolean;
  shaderStatus: 'not-compiled' | 'patched' | 'map-fragment-missing';
  slots: ArithmeticSlotSummary[];
  sampleScale: number[];
  sampleBias: number[];
}
interface ArithmeticState {
  inputs: UsdMaterialTextureInputs;
  slots: ArithmeticSlotSummary[];
  scale: { value: THREE.Vector4 };
  bias: { value: THREE.Vector4 };
  shaderStatus: UsdTextureArithmeticSummary['shaderStatus'];
  originalHook: THREE.Material['onBeforeCompile'];
  originalKey: THREE.Material['customProgramCacheKey'];
  originalClone: THREE.Material['clone'];
  hook?: THREE.Material['onBeforeCompile'];
  key?: THREE.Material['customProgramCacheKey'];
  clone?: THREE.Material['clone'];
}
const states = new WeakMap<THREE.Material, ArithmeticState>();

function describeSlots(material: THREE.Material, inputs: UsdMaterialTextureInputs): ArithmeticSlotSummary[] {
  return USD_TEXTURE_INPUT_SLOTS.flatMap((slot) => {
    const input = inputs[slot];
    if (!input) return [];
    const sampleScale = Array.from(input.sampleScale ?? [1, 1, 1, 1]);
    const sampleBias = Array.from(input.sampleBias ?? [0, 0, 0, 0]);
    if (sampleScale.every((value) => value === 1) && sampleBias.every((value) => value === 0)) return [];
    const status = slot !== 'mapPath' ? 'unsupported-slot'
      : input.sourceOutput !== 'rgb' ? 'unsupported-output'
        : !(material as THREE.MeshStandardMaterial).map ? 'map-not-assigned' : 'configured';
    return [{ slot, sourceOutput: input.sourceOutput ?? null, sampleScale, sampleBias, status }];
  });
}

function restoreHooks(material: THREE.Material, state: ArithmeticState): void {
  if (material.onBeforeCompile === state.hook) material.onBeforeCompile = state.originalHook;
  if (material.customProgramCacheKey === state.key) material.customProgramCacheKey = state.originalKey;
  if (material.clone === state.clone) material.clone = state.originalClone;
  state.hook = undefined;
  state.key = undefined;
  state.clone = undefined;
  state.shaderStatus = 'not-compiled';
  material.needsUpdate = true;
}

function installHooks(material: THREE.Material, state: ArithmeticState): void {
  state.hook = function(shader, renderer) {
    state.originalHook.call(this, shader, renderer);
    const fragment = shader.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment);
    if (!fragment.includes(MULTIPLY)) {
      state.shaderStatus = 'map-fragment-missing';
      return;
    }
    shader.uniforms.usdMapSampleScale = state.scale;
    shader.uniforms.usdMapSampleBias = state.bias;
    shader.fragmentShader = `uniform vec4 usdMapSampleScale;\nuniform vec4 usdMapSampleBias;\n${fragment.replace(MULTIPLY, `${ARITHMETIC}\n${MULTIPLY}`)}`;
    state.shaderStatus = 'patched';
  };
  state.key = function() {
    // Three's default key reads this.onBeforeCompile; calling it after wrapping
    // would erase the original hook's identity and allow incorrect reuse.
    const originalKey = state.originalKey === THREE.Material.prototype.customProgramCacheKey
      ? state.originalHook.toString() : state.originalKey.call(this);
    return `${originalKey}|${state.originalHook.toString()}|${USD_TEXTURE_ARITHMETIC_VERSION}`;
  };
  state.clone = function() {
    const cloned = state.originalClone.call(this);
    // Material.copy intentionally omits callbacks. Reinstall with independent
    // uniform objects and the original hooks, never with source state closures.
    cloned.onBeforeCompile = state.originalHook;
    cloned.customProgramCacheKey = state.originalKey;
    applyUsdTextureArithmetic(cloned, state.inputs);
    return cloned;
  };
  material.onBeforeCompile = state.hook;
  material.customProgramCacheKey = state.key;
  material.clone = state.clone;
  material.needsUpdate = true;
}

/** Apply decoded map RGB arithmetic; alpha and other texture slots are untouched. */
export function applyUsdTextureArithmetic(material: THREE.Material, inputs: UsdMaterialTextureInputs | null | undefined): void {
  const normalized = normalizeUsdTextureInputs(inputs);
  const slots = describeSlots(material, normalized ?? {});
  let state = states.get(material);
  if (!slots.length) {
    if (state) restoreHooks(material, state);
    states.delete(material);
    return;
  }
  if (!state) {
    state = {
      inputs: normalized!, slots,
      scale: { value: new THREE.Vector4(1, 1, 1, 1) }, bias: { value: new THREE.Vector4(0, 0, 0, 0) },
      shaderStatus: 'not-compiled', originalHook: material.onBeforeCompile,
      originalKey: material.customProgramCacheKey, originalClone: material.clone,
    };
    states.set(material, state);
  }
  state.inputs = normalized!;
  state.slots = slots;
  const configured = slots.find((entry) => entry.status === 'configured');
  if (!configured) {
    if (state.hook) restoreHooks(material, state);
    return;
  }
  state.scale.value.fromArray(configured.sampleScale);
  state.bias.value.fromArray(configured.sampleBias);
  if (!state.hook) installHooks(material, state);
}

/** Reads actual installed uniforms/compile state, not authored metadata alone. */
export function getUsdTextureArithmeticSummary(material: object): UsdTextureArithmeticSummary | null {
  const state = states.get(material as THREE.Material);
  if (!state) return null;
  return {
    version: USD_TEXTURE_ARITHMETIC_VERSION,
    compiled: state.shaderStatus === 'patched' && (material as THREE.Material).onBeforeCompile === state.hook,
    shaderStatus: state.shaderStatus,
    slots: state.slots.map((slot) => ({ ...slot, sampleScale: [...slot.sampleScale], sampleBias: [...slot.sampleBias] })),
    sampleScale: state.scale.value.toArray(), sampleBias: state.bias.value.toArray(),
  };
}
