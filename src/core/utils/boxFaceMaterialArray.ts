import * as THREE from 'three';

import {
  applyMjcfTextureRepeat,
  createCanonicalMjcfBuiltinTexture,
} from '@/core/parsers/mjcf/mjcfBuiltinTextures';
import { createMatteMaterial } from './materialFactory';
import { colorRgbaTupleToOpacity } from './color.ts';
import type { UrdfVisualMaterial } from '@/types';

export interface BoxFaceMaterialDescriptor extends Pick<
  UrdfVisualMaterial,
  | 'color'
  | 'colorRgba'
  | 'name'
  | 'texture'
  | 'opacity'
  | 'roughness'
  | 'metalness'
  | 'emissive'
  | 'emissiveIntensity'
  | 'textureRepeat'
  | 'mjcfBuiltinTexture'
> {}

export interface CreateBoxFaceMaterialArrayOptions {
  fallbackColor?: string;
  opacity?: number;
  side?: THREE.Side;
  manager?: THREE.LoadingManager;
  label?: string;
}

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

export function createBoxFaceMaterialArray(
  descriptors: readonly BoxFaceMaterialDescriptor[],
  {
    fallbackColor = '#808080',
    opacity = 1,
    side = THREE.DoubleSide,
    manager,
    label = 'box-face-material',
  }: CreateBoxFaceMaterialArrayOptions = {},
): THREE.MeshStandardMaterial[] {
  const textureLoader = manager ? new THREE.TextureLoader(manager) : null;
  const textureRequests = new Map<
    string,
    {
      path: string;
      repeat?: [number, number];
      materials: THREE.MeshStandardMaterial[];
    }
  >();

  const materials = descriptors.map((descriptor, index) => {
    const texturePath = normalizeMaterialValue(descriptor.texture);
    const textureRepeat =
      descriptor.textureRepeat?.length === 2 &&
      descriptor.textureRepeat.every((entry) => Number.isFinite(entry))
        ? ([Number(descriptor.textureRepeat[0]), Number(descriptor.textureRepeat[1])] as [
            number,
            number,
          ])
        : undefined;
    const mjcfBuiltinTexture = !texturePath ? descriptor.mjcfBuiltinTexture : undefined;
    const authoredColor = normalizeMaterialValue(descriptor.color);
    const authoredOpacity =
      normalizeUnitIntervalValue(descriptor.opacity) ??
      colorRgbaTupleToOpacity(descriptor.colorRgba);
    const baseColor =
      authoredColor || (texturePath || mjcfBuiltinTexture ? '#ffffff' : fallbackColor);
    const effectiveOpacity = authoredOpacity ?? opacity;
    const material = createMatteMaterial({
      color: baseColor,
      opacity: effectiveOpacity,
      roughness: normalizeUnitIntervalValue(descriptor.roughness),
      metalness: normalizeUnitIntervalValue(descriptor.metalness),
      emissive: normalizeMaterialValue(descriptor.emissive),
      emissiveIntensity: normalizeNonNegativeValue(descriptor.emissiveIntensity),
      transparent: effectiveOpacity < 1,
      side,
      preserveExactColor: true,
      name: descriptor.name || `${label}_${index + 1}`,
    });

    if (texturePath) {
      const requestKey = `${texturePath}|repeat=${textureRepeat?.join(',') || '1,1'}`;
      const request = textureRequests.get(requestKey);
      if (request) {
        request.materials.push(material);
      } else {
        textureRequests.set(requestKey, {
          path: texturePath,
          repeat: textureRepeat,
          materials: [material],
        });
      }
    } else if (mjcfBuiltinTexture) {
      material.map = createCanonicalMjcfBuiltinTexture(mjcfBuiltinTexture, textureRepeat);
      material.userData.mjcfBuiltinTextureApplied = true;
      material.userData.mjcfBuiltinTexture = { ...mjcfBuiltinTexture };
      material.userData.mjcfTextureRepeat = textureRepeat ? [...textureRepeat] : [1, 1];
      material.needsUpdate = true;
    }

    return material;
  });

  if (!textureLoader || textureRequests.size === 0) {
    return materials;
  }

  textureRequests.forEach(({ path: texturePath, repeat, materials: materialUsers }) => {
    textureLoader.load(
      texturePath,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        applyMjcfTextureRepeat(texture, repeat);
        materialUsers.forEach((material) => {
          material.map = texture;
          material.needsUpdate = true;
        });
      },
      undefined,
      (error) => {
        console.error(`[${label}] Failed to load face texture "${texturePath}".`, error);
      },
    );
  });

  return materials;
}
