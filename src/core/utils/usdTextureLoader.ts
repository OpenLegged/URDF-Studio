import * as THREE from 'three';
import type { UsdMaterialTextureInput, UsdMaterialTextureInputSlotPathField } from '@/types/usdMaterial';
import {
  USD_COLOR_TEXTURE_INPUT_SLOTS,
  cloneUsdSlotTexture,
  resolveUsdTextureColorSpace,
  usdTextureInputRequiresSlotState,
} from './usdTextureInput';
import { orientUsdTexture } from './usdMaterialAppearance';

/** Load one USD image once per decode color space, then apply its material-slot sampling state. */
export async function loadUsdTextureSlot(
  url: string,
  slot: UsdMaterialTextureInputSlotPathField,
  input: UsdMaterialTextureInput | null | undefined,
  { cache, loadTexture }: {
    cache: Map<string, Promise<THREE.Texture>>;
    loadTexture: (url: string) => Promise<THREE.Texture>;
  },
): Promise<THREE.Texture> {
  const isColor = USD_COLOR_TEXTURE_INPUT_SLOTS.has(slot);
  const cacheKey = `${isColor ? 'srgb' : 'linear'}:${url}`;
  let loading = cache.get(cacheKey);
  if (!loading) {
    loading = loadTexture(url).then((texture) => {
      orientUsdTexture(texture);
      const colorSpace = resolveUsdTextureColorSpace(slot, null);
      if (colorSpace) texture.colorSpace = colorSpace;
      return texture;
    });
    cache.set(cacheKey, loading);
  }
  const texture = await loading;
  return input && usdTextureInputRequiresSlotState(input)
    ? cloneUsdSlotTexture(texture, slot, input)
    : texture;
}
