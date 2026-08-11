// Builtin texture generation extracted from mjcfHierarchyBuilder.ts
import * as THREE from 'three';
import { BOX_FACE_MATERIAL_ORDER } from '@/core/robot';
import type { MjcfBuiltinTexture } from '@/types';
import type { MJCFTexture } from './mjcfUtils';

export type MJCFTextureLoadCache = Map<string, Promise<THREE.Texture | null>>;

export function configureLoadedTexture(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

export function isMjcfCubeTexture(textureDef: MJCFTexture | null | undefined): boolean {
  return (
    String(textureDef?.type || '')
      .trim()
      .toLowerCase() === 'cube'
  );
}

export function clampBuiltinTextureChannel(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, value ?? fallback));
}

export function resolveBuiltinTextureColor(
  rgb: number[] | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  return [
    clampBuiltinTextureChannel(rgb?.[0], fallback[0]),
    clampBuiltinTextureChannel(rgb?.[1], fallback[1]),
    clampBuiltinTextureChannel(rgb?.[2], fallback[2]),
  ];
}

export function resolveBuiltinTextureDimension(
  value: number | undefined,
  fallback: number,
  maxDimension = 512,
): number {
  const resolved = Number.isFinite(value ?? Number.NaN) ? Math.round(value ?? fallback) : fallback;
  return Math.max(1, Math.min(maxDimension, resolved));
}

export function createBuiltinDataTexture(
  width: number,
  height: number,
  resolveColor: (x: number, y: number) => [number, number, number],
  options: { nearest?: boolean } = {},
): THREE.Texture {
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = resolveColor(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(r * 255);
      data[offset + 1] = Math.round(g * 255);
      data[offset + 2] = Math.round(b * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = configureLoadedTexture(new THREE.DataTexture(data, width, height));
  texture.generateMipmaps = false;
  texture.minFilter = options.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.magFilter = options.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  return texture;
}

export function createBuiltinCheckerTexture(textureDef: MJCFTexture): THREE.Texture {
  const width = resolveBuiltinTextureDimension(textureDef.width, 128);
  const height = resolveBuiltinTextureDimension(textureDef.height, 128);
  const primaryColor = resolveBuiltinTextureColor(textureDef.rgb1, [0.2, 0.3, 0.4]);
  const secondaryColor = resolveBuiltinTextureColor(textureDef.rgb2, [0.1, 0.2, 0.3]);
  const edgeColor = resolveBuiltinTextureColor(textureDef.markrgb, primaryColor);
  // MuJoCo uses 2x2 cells per texture tile (not 10x10). Combined with
  // texrepeat (e.g. 5x5) this produces a clear, readable checker grid.
  const cellsX = 2;
  const cellsY = 2;
  const cellWidth = width / cellsX;
  const cellHeight = height / cellsY;
  const hasEdgeMark =
    String(textureDef.mark || '')
      .trim()
      .toLowerCase() === 'edge';

  const texture = createBuiltinDataTexture(width, height, (x, y) => {
    const cellX = Math.floor(x / cellWidth);
    const cellY = Math.floor(y / cellHeight);

    if (hasEdgeMark) {
      const localX = x - cellX * cellWidth;
      const localY = y - cellY * cellHeight;
      if (localX < 1 || localY < 1) {
        return edgeColor;
      }
    }

    return (cellX + cellY) % 2 === 0 ? primaryColor : secondaryColor;
  });

  // Enable mipmaps so the checker looks smooth on the angled ground plane
  // instead of flickering / moiré from NearestFilter.
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createBuiltinFlatTexture(textureDef: MJCFTexture): THREE.Texture {
  const width = resolveBuiltinTextureDimension(textureDef.width, 16);
  const height = resolveBuiltinTextureDimension(textureDef.height, 16);
  const color = resolveBuiltinTextureColor(textureDef.rgb1, [1, 1, 1]);

  return createBuiltinDataTexture(width, height, () => color);
}

export function createBuiltinGradientTexture(textureDef: MJCFTexture): THREE.Texture {
  const width = resolveBuiltinTextureDimension(textureDef.width, 64);
  const height = resolveBuiltinTextureDimension(textureDef.height, 256);
  const topColor = resolveBuiltinTextureColor(textureDef.rgb1, [0.3, 0.5, 0.7]);
  const bottomColor = resolveBuiltinTextureColor(textureDef.rgb2, [0, 0, 0]);

  return createBuiltinDataTexture(width, height, (_x, y) => {
    const ratio = height <= 1 ? 0 : y / (height - 1);
    return [
      topColor[0] * (1 - ratio) + bottomColor[0] * ratio,
      topColor[1] * (1 - ratio) + bottomColor[1] * ratio,
      topColor[2] * (1 - ratio) + bottomColor[2] * ratio,
    ];
  });
}

export function createBuiltinTexture(textureDef: MJCFTexture): THREE.Texture | null {
  const builtin = String(textureDef.builtin || '')
    .trim()
    .toLowerCase();

  switch (builtin) {
    case 'checker':
      return createBuiltinCheckerTexture(textureDef);
    case 'flat':
      return createBuiltinFlatTexture(textureDef);
    case 'gradient':
      return createBuiltinGradientTexture(textureDef);
    default:
      console.warn(
        `[MJCFLoader] Unsupported builtin texture "${textureDef.builtin}" on texture "${textureDef.name}".`,
      );
      return null;
  }
}

function toRuntimeTextureDefinition(texture: MjcfBuiltinTexture): MJCFTexture {
  return {
    name: '__canonical_mjcf_builtin_texture__',
    builtin: texture.builtin,
    type: texture.type,
    rgb1: texture.rgb1 ? [...texture.rgb1] : undefined,
    rgb2: texture.rgb2 ? [...texture.rgb2] : undefined,
    mark: texture.mark,
    markrgb: texture.markrgb ? [...texture.markrgb] : undefined,
    width: texture.width,
    height: texture.height,
  };
}

export function applyMjcfTextureRepeat(
  texture: THREE.Texture,
  repeat: [number, number] | undefined,
): THREE.Texture {
  const repeatX = Number.isFinite(repeat?.[0]) ? Number(repeat?.[0]) : 1;
  const repeatY = Number.isFinite(repeat?.[1]) ? Number(repeat?.[1]) : 1;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

/** Regenerates a serializable canonical MJCF builtin descriptor for Three.js runtime use. */
export function createCanonicalMjcfBuiltinTexture(
  descriptor: MjcfBuiltinTexture,
  repeat?: [number, number],
): THREE.Texture {
  const textureDef = toRuntimeTextureDefinition(descriptor);
  let texture: THREE.Texture;

  if (descriptor.cubeFace && descriptor.builtin === 'flat') {
    texture = createBuiltinFlatTexture(
      descriptor.cubeFace === 'down' && descriptor.rgb2
        ? { ...textureDef, rgb1: [...descriptor.rgb2] }
        : textureDef,
    );
  } else if (descriptor.cubeFace && descriptor.builtin === 'gradient') {
    const topColor = resolveBuiltinTextureColor(textureDef.rgb1, [0.3, 0.5, 0.7]);
    const bottomColor = resolveBuiltinTextureColor(textureDef.rgb2, [0, 0, 0]);
    if (descriptor.cubeFace === 'up') {
      texture = createBuiltinFlatTexture({ ...textureDef, rgb1: topColor });
    } else if (descriptor.cubeFace === 'down') {
      texture = createBuiltinFlatTexture({ ...textureDef, rgb1: bottomColor });
    } else {
      texture = createBuiltinGradientTexture(textureDef);
    }
  } else {
    texture =
      descriptor.builtin === 'checker'
        ? createBuiltinCheckerTexture(textureDef)
        : descriptor.builtin === 'flat'
          ? createBuiltinFlatTexture(textureDef)
          : createBuiltinGradientTexture(textureDef);
  }

  return applyMjcfTextureRepeat(texture, repeat);
}

export function createBuiltinCubeFaceTextures(textureDef: MJCFTexture): THREE.Texture[] | null {
  const builtin = String(textureDef.builtin || '')
    .trim()
    .toLowerCase();

  switch (builtin) {
    case 'checker':
      return BOX_FACE_MATERIAL_ORDER.map(() => createBuiltinCheckerTexture(textureDef));
    case 'flat':
      return BOX_FACE_MATERIAL_ORDER.map((face) =>
        createBuiltinFlatTexture(
          face === 'down' && Array.isArray(textureDef.rgb2) && textureDef.rgb2.length >= 3
            ? { ...textureDef, rgb1: textureDef.rgb2 }
            : textureDef,
        ),
      );
    case 'gradient': {
      const topColor = resolveBuiltinTextureColor(textureDef.rgb1, [0.3, 0.5, 0.7]);
      const bottomColor = resolveBuiltinTextureColor(textureDef.rgb2, [0, 0, 0]);
      return BOX_FACE_MATERIAL_ORDER.map((face) => {
        if (face === 'up') {
          return createBuiltinFlatTexture({ ...textureDef, rgb1: topColor });
        }
        if (face === 'down') {
          return createBuiltinFlatTexture({ ...textureDef, rgb1: bottomColor });
        }
        return createBuiltinGradientTexture(textureDef);
      });
    }
    default:
      console.warn(
        `[MJCFLoader] Unsupported builtin texture "${textureDef.builtin}" on texture "${textureDef.name}".`,
      );
      return null;
  }
}

export function getBuiltinTextureCacheKey(textureDef: MJCFTexture): string {
  return [
    '__mjcf_builtin__',
    textureDef.name,
    textureDef.builtin || '',
    textureDef.type || '',
    `${textureDef.width || ''}x${textureDef.height || ''}`,
  ].join(':');
}

export function getBuiltinTexturePromise(
  textureDef: MJCFTexture,
  textureLoadCache: MJCFTextureLoadCache,
): Promise<THREE.Texture | null> {
  const cacheKey = getBuiltinTextureCacheKey(textureDef);
  const cached = textureLoadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const promise = Promise.resolve()
    .then(() => createBuiltinTexture(textureDef))
    .catch((error) => {
      console.error(`[MJCFLoader] Failed to generate builtin texture "${textureDef.name}".`, error);
      return null;
    });

  textureLoadCache.set(cacheKey, promise);
  return promise;
}
