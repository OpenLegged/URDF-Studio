import type { Texture } from 'three';

interface ColorChannels { r: number; g: number; b: number }
interface MaterialDiagnosticsInput {
  map?: Texture | null;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  metalnessMap?: Texture | null;
  aoMap?: Texture | null;
  normalScale?: { x: number; y: number };
  aoMapIntensity?: number;
  ior?: number;
  transmission?: number;
  thickness?: number;
  specularIntensity?: number;
  specularColor?: ColorChannels;
  attenuationColor?: ColorChannels;
  attenuationDistance?: number;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function colorChannels(value: ColorChannels | undefined): number[] | null {
  return value && [value.r, value.g, value.b].every(Number.isFinite)
    ? [value.r, value.g, value.b] : null;
}

/** Read the assigned texture itself, without copying a requested material path. */
export function summarizeRuntimeTexture(texture: Texture | null | undefined) {
  if (!texture) return null;
  const image: unknown = texture.image;
  const data = image && typeof image === 'object' ? image as Record<string, unknown> : {};
  const sourceUrl = typeof data.currentSrc === 'string' && data.currentSrc
    ? data.currentSrc : typeof data.src === 'string' && data.src ? data.src : null;
  return {
    name: texture.name || null,
    sourceUrl,
    width: finite(data.naturalWidth) ?? finite(data.width),
    height: finite(data.naturalHeight) ?? finite(data.height),
    repeat: texture.repeat.toArray(), offset: texture.offset.toArray(),
    center: texture.center.toArray(), rotation: texture.rotation,
    matrix: texture.matrix.toArray(), matrixAutoUpdate: texture.matrixAutoUpdate,
    flipY: texture.flipY, channel: texture.channel,
    wrapS: texture.wrapS, wrapT: texture.wrapT, colorSpace: texture.colorSpace,
  };
}

export function summarizeRuntimeMaterialDiagnostics(material: MaterialDiagnosticsInput) {
  return {
    baseColorTexture: summarizeRuntimeTexture(material.map),
    normalTexture: summarizeRuntimeTexture(material.normalMap),
    roughnessTexture: summarizeRuntimeTexture(material.roughnessMap),
    metalnessTexture: summarizeRuntimeTexture(material.metalnessMap),
    aoTexture: summarizeRuntimeTexture(material.aoMap),
    normalScale: material.normalScale
      && [material.normalScale.x, material.normalScale.y].every(Number.isFinite)
      ? [material.normalScale.x, material.normalScale.y] : null,
    aoMapIntensity: finite(material.aoMapIntensity), ior: finite(material.ior),
    transmission: finite(material.transmission), thickness: finite(material.thickness),
    specularIntensity: finite(material.specularIntensity),
    specularColorLinear: colorChannels(material.specularColor),
    attenuationColorLinear: colorChannels(material.attenuationColor),
    attenuationDistance: finite(material.attenuationDistance),
  };
}

export type RuntimeMaterialDiagnostics = ReturnType<typeof summarizeRuntimeMaterialDiagnostics>;
