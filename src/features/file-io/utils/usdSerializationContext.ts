import * as THREE from 'three';

import { buildTextureExportPathOverrides } from '@/core/parsers/meshPathUtils.ts';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';

import { type UsdMaterialMetadata } from './usdSceneNodeFactory.ts';
import { isUsdMeshObject } from './usdMaterialNormalization.ts';
import { normalizeUsdProgressLabel, yieldPeriodically } from './usdProgress.ts';
import { createUsdTextureRecord, type UsdTextureRecord } from './usdTextureRecord.ts';
import {
  clampUsdColorChannel,
  createThreeColorFromUsdAuthoredColor,
  normalizeUsdAuthoredColorTuple,
  toUsdAuthoredColor,
  toUsdAuthoredColorFromSrgbTuple,
} from './usdColorSpace.ts';

export type UsdRenderableAppearance = {
  color: THREE.Color;
  authoredColor: [number, number, number];
  opacity: number;
  texture: UsdTextureRecord | null;
};

export type UsdPreviewMaterialRecord = {
  name: string;
  path: string;
  appearance: UsdRenderableAppearance;
};

export type UsdMaterialSubsetRecord = {
  appearance: UsdRenderableAppearance;
  displayName?: string;
  faceIndices: number[];
  materialRecord: UsdPreviewMaterialRecord;
  name: string;
};

export type UsdNumericAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

export type UsdNumericAttributeSource = {
  array: ArrayLike<number>;
  stride: number;
  offset: number;
};

export type UsdMeshGeometryData = {
  triangleCount: number;
  faceVertexIndices: number[];
  positions: UsdNumericAttribute;
  normalAttribute: UsdNumericAttribute | null;
  normalInterpolation: 'vertex' | 'faceVarying' | null;
  uvAttribute: UsdNumericAttribute | null;
  signature: string;
};

export type UsdMeshGeometryRecord = {
  name: string;
  path: string;
  data: UsdMeshGeometryData;
};

export type UsdSerializationContext = {
  materialByObject: WeakMap<THREE.Object3D, UsdPreviewMaterialRecord>;
  materialSubsetsByObject: WeakMap<THREE.Object3D, UsdMaterialSubsetRecord[]>;
  materialRecords: UsdPreviewMaterialRecord[];
  geometryByObject: WeakMap<THREE.Object3D, UsdMeshGeometryRecord>;
  geometryRecords: UsdMeshGeometryRecord[];
  textureExportPathOverrides: ReadonlyMap<string, string>;
};

export type UsdSerializationContextProgress = {
  phase: 'geometry';
  completed: number;
  total: number;
  label?: string;
};

type CollectUsdSerializationContextOptions = {
  onProgress?: (progress: UsdSerializationContextProgress) => void;
  rootPrimName?: string;
  objectYieldInterval?: number;
  vertexYieldInterval?: number;
};

const DEFAULT_OBJECT_YIELD_INTERVAL = 32;
const DEFAULT_VERTEX_YIELD_INTERVAL = 32768;

const isDirectReadableUsdNumericArray = (
  value: ArrayLike<number>,
): value is Float32Array | Float64Array =>
  value instanceof Float32Array || value instanceof Float64Array;

export const getUsdNumericAttributeSource = (
  attribute: UsdNumericAttribute,
): UsdNumericAttributeSource | null => {
  if (
    attribute instanceof THREE.BufferAttribute &&
    !attribute.normalized &&
    isDirectReadableUsdNumericArray(attribute.array)
  ) {
    return {
      array: attribute.array,
      stride: attribute.itemSize,
      offset: 0,
    };
  }

  if (
    attribute instanceof THREE.InterleavedBufferAttribute &&
    !attribute.normalized &&
    isDirectReadableUsdNumericArray(attribute.data.array)
  ) {
    return {
      array: attribute.data.array,
      stride: attribute.data.stride,
      offset: attribute.offset,
    };
  }

  return null;
};

const hashGeometryNumber = (hash: number, value: number): number => {
  const normalized = Number.isFinite(value) ? Math.round(value * 1_000_000) : 0;
  hash ^= normalized >>> 0;
  return Math.imul(hash, 16777619) >>> 0;
};

const parseDisplayColor = (
  value: string | null | undefined,
): { color: THREE.Color; authoredColor: [number, number, number]; opacity: number } | null => {
  const parsed = parseThreeColorWithOpacity(value);
  if (!parsed) {
    return null;
  }

  return {
    color: parsed.color,
    authoredColor: toUsdAuthoredColor(parsed.color),
    opacity: parsed.opacity ?? 1,
  };
};

const parseExplicitUsdAuthoredAppearance = (
  object: THREE.Object3D,
): { color: THREE.Color; authoredColor: [number, number, number]; opacity: number } | null => {
  const materialMetadata = object.userData?.usdMaterial as UsdMaterialMetadata | undefined;
  const authoredColor =
    Array.isArray(object.userData?.usdAuthoredColor) &&
    object.userData.usdAuthoredColor.length === 3 &&
    object.userData.usdAuthoredColor.every((value: unknown) => Number.isFinite(value))
      ? normalizeUsdAuthoredColorTuple([
          Number(object.userData.usdAuthoredColor[0]),
          Number(object.userData.usdAuthoredColor[1]),
          Number(object.userData.usdAuthoredColor[2]),
        ])
      : Array.isArray(materialMetadata?.colorRgba) &&
          materialMetadata.colorRgba.length === 4 &&
          materialMetadata.colorRgba.every((value) => Number.isFinite(value))
        ? toUsdAuthoredColorFromSrgbTuple([
            Number(materialMetadata.colorRgba[0]),
            Number(materialMetadata.colorRgba[1]),
            Number(materialMetadata.colorRgba[2]),
          ])
        : null;

  if (!authoredColor) {
    return null;
  }

  const explicitOpacity =
    Number.isFinite(object.userData?.usdOpacity) && object.userData.usdOpacity !== null
      ? clampUsdColorChannel(Number(object.userData.usdOpacity))
      : Number.isFinite(materialMetadata?.opacity)
        ? clampUsdColorChannel(Number(materialMetadata?.opacity))
        : Number.isFinite(materialMetadata?.colorRgba?.[3])
          ? clampUsdColorChannel(Number(materialMetadata?.colorRgba?.[3]))
          : 1;

  return {
    color: createThreeColorFromUsdAuthoredColor(authoredColor),
    authoredColor,
    opacity: explicitOpacity,
  };
};

type UsdPaletteEntry = {
  materialIndex: number;
  usdAuthoredColor?: [number, number, number];
  usdDisplayColor?: string | null;
  usdMaterial?: Record<string, unknown>;
  usdOpacity?: number;
  usdSourceMaterialName?: string;
};

const getUsdPaletteEntry = (
  object: THREE.Object3D,
  materialIndex: number,
): UsdPaletteEntry | null => {
  const palette = Array.isArray(object.userData?.usdMaterialPalette)
    ? (object.userData.usdMaterialPalette as UsdPaletteEntry[])
    : null;
  if (!palette) {
    return null;
  }

  return palette.find((entry) => entry?.materialIndex === materialIndex) || null;
};

const getExplicitUsdOpacity = (
  object: THREE.Object3D,
  materialIndex: number,
  fallbackOpacity: number,
): number => {
  const paletteOpacity = getUsdPaletteEntry(object, materialIndex)?.usdOpacity;
  if (Number.isFinite(paletteOpacity)) {
    return clampUsdColorChannel(Number(paletteOpacity));
  }

  if (materialIndex === 0 && Number.isFinite(object.userData?.usdOpacity)) {
    return clampUsdColorChannel(Number(object.userData.usdOpacity));
  }

  const materialMetadata = (materialIndex === 0 ? object.userData?.usdMaterial : null) as
    | UsdMaterialMetadata
    | undefined;
  if (Number.isFinite(materialMetadata?.opacity)) {
    return clampUsdColorChannel(Number(materialMetadata?.opacity));
  }

  return fallbackOpacity;
};

const parseExplicitUsdAuthoredAppearanceForMaterial = (
  object: THREE.Object3D,
  materialIndex = 0,
): { color: THREE.Color; authoredColor: [number, number, number]; opacity: number } | null => {
  const paletteEntry = getUsdPaletteEntry(object, materialIndex);
  if (paletteEntry?.usdAuthoredColor?.length === 3) {
    const authoredColor = normalizeUsdAuthoredColorTuple([
      Number(paletteEntry.usdAuthoredColor[0]),
      Number(paletteEntry.usdAuthoredColor[1]),
      Number(paletteEntry.usdAuthoredColor[2]),
    ]);
    return {
      color: createThreeColorFromUsdAuthoredColor(authoredColor),
      authoredColor,
      opacity:
        paletteEntry.usdOpacity !== undefined
          ? clampUsdColorChannel(Number(paletteEntry.usdOpacity))
          : 1,
    };
  }

  if (materialIndex === 0) {
    return parseExplicitUsdAuthoredAppearance(object);
  }

  return null;
};

const getTextureSourceDataPath = (texture: THREE.Texture): string => {
  const sourceData: unknown = texture.source?.data;
  if (!sourceData || typeof sourceData !== 'object' || !('src' in sourceData)) {
    return '';
  }

  const sourcePath = (sourceData as { src?: unknown }).src;
  return typeof sourcePath === 'string' ? sourcePath.trim() : '';
};

const getRenderableTextureSourcePath = (object: THREE.Object3D, materialIndex = 0): string => {
  if (!isUsdMeshObject(object) || !object.geometry.getAttribute('uv')) {
    return '';
  }

  const paletteEntry = getUsdPaletteEntry(object, materialIndex);
  const materialMetadata =
    (paletteEntry?.usdMaterial as UsdMaterialMetadata | undefined) ||
    ((materialIndex === 0 ? object.userData?.usdMaterial : null) as
      | UsdMaterialMetadata
      | undefined);
  if (materialMetadata?.texture) {
    return String(materialMetadata.texture).trim();
  }

  const material = Array.isArray(object.material)
    ? object.material[materialIndex] || object.material[0]
    : object.material;
  if (!material || !('map' in material)) {
    return '';
  }

  const texture = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  if (!texture) {
    return '';
  }

  return String(
    texture.userData?.usdSourcePath || texture.name || getTextureSourceDataPath(texture),
  ).trim();
};

const getRenderableTextureRecord = (
  object: THREE.Object3D,
  materialIndex = 0,
  exportPathOverrides?: ReadonlyMap<string, string> | null,
): UsdTextureRecord | null => {
  return createUsdTextureRecord(
    getRenderableTextureSourcePath(object, materialIndex),
    exportPathOverrides,
  );
};

export const getUsdRenderableAppearance = (
  object: THREE.Object3D,
  materialIndex = 0,
  textureExportPathOverrides?: ReadonlyMap<string, string> | null,
): UsdRenderableAppearance | null => {
  const texture = getRenderableTextureRecord(object, materialIndex, textureExportPathOverrides);
  const explicitAuthoredAppearance = parseExplicitUsdAuthoredAppearanceForMaterial(
    object,
    materialIndex,
  );
  if (explicitAuthoredAppearance) {
    return {
      color: explicitAuthoredAppearance.color,
      authoredColor: explicitAuthoredAppearance.authoredColor,
      opacity: explicitAuthoredAppearance.opacity,
      texture,
    };
  }

  const paletteEntry = getUsdPaletteEntry(object, materialIndex);
  const explicitColor = parseDisplayColor(
    materialIndex === 0
      ? (paletteEntry?.usdDisplayColor ?? object.userData?.usdDisplayColor)
      : paletteEntry?.usdDisplayColor,
  );
  if (explicitColor) {
    return {
      color: explicitColor.color,
      authoredColor: explicitColor.authoredColor,
      opacity: getExplicitUsdOpacity(object, materialIndex, explicitColor.opacity),
      texture,
    };
  }

  if (!isUsdMeshObject(object)) {
    return null;
  }

  const material = Array.isArray(object.material)
    ? object.material[materialIndex] || object.material[0]
    : object.material;
  if (material && 'color' in material && material.color instanceof THREE.Color) {
    return {
      color: material.color,
      authoredColor: toUsdAuthoredColor(material.color),
      opacity: Number.isFinite(material.opacity) ? Math.max(0, Math.min(1, material.opacity)) : 1,
      texture,
    };
  }

  return null;
};

type UsdMeshSubsetAppearance = {
  appearance: UsdRenderableAppearance;
  displayName?: string;
  faceIndices: number[];
};

const getUsdMeshSubsetAppearances = (
  object: THREE.Object3D,
  textureExportPathOverrides?: ReadonlyMap<string, string> | null,
): UsdMeshSubsetAppearance[] => {
  if (!isUsdMeshObject(object) || !Array.isArray(object.material) || object.material.length <= 1) {
    return [];
  }

  const geometry = object.geometry;
  if (!(geometry instanceof THREE.BufferGeometry) || geometry.groups.length === 0) {
    return [];
  }

  const faceIndicesByMaterial = new Map<number, number[]>();
  geometry.groups.forEach((group) => {
    const materialIndex = Number(group.materialIndex ?? 0);
    if (!Number.isInteger(materialIndex) || materialIndex < 0) {
      return;
    }

    const faceStart = Math.max(0, Math.floor(group.start / 3));
    const faceCount = Math.max(0, Math.floor(group.count / 3));
    if (faceCount <= 0) {
      return;
    }

    const faceIndices = faceIndicesByMaterial.get(materialIndex) || [];
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      faceIndices.push(faceStart + faceIndex);
    }
    faceIndicesByMaterial.set(materialIndex, faceIndices);
  });

  return Array.from(faceIndicesByMaterial.entries())
    .map(([materialIndex, faceIndices]) => {
      const appearance = getUsdRenderableAppearance(
        object,
        materialIndex,
        textureExportPathOverrides,
      );
      if (!appearance || faceIndices.length === 0) {
        return null;
      }

      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const material = objectMaterials[materialIndex] || objectMaterials[0];
      const displayName =
        getUsdPaletteEntry(object, materialIndex)?.usdSourceMaterialName ||
        material?.name ||
        undefined;

      return {
        appearance,
        faceIndices,
        ...(displayName ? { displayName } : {}),
      } satisfies UsdMeshSubsetAppearance;
    })
    .filter((entry): entry is UsdMeshSubsetAppearance => Boolean(entry));
};

export const getUsdDisplayColor = (object: THREE.Object3D): [number, number, number] | null => {
  if (getUsdMeshSubsetAppearances(object).length > 0) {
    return null;
  }

  return getUsdRenderableAppearance(object)?.authoredColor || null;
};

const collectUsdFaceVertexIndices = (
  mesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
  positionCount: number,
): number[] => {
  const shouldRespectGroups = Boolean(mesh.userData?.usdSerializeFilteredGroups);
  const filteredGroups = shouldRespectGroups
    ? geometry.groups.filter(
        (group) => Number.isFinite(group.start) && Number.isFinite(group.count) && group.count > 0,
      )
    : [];

  if (geometry.index) {
    const indexValues = Array.from(geometry.index.array, (value) => Number(value));
    if (filteredGroups.length === 0) {
      return indexValues;
    }

    const groupedIndices: number[] = [];
    filteredGroups.forEach((group) => {
      const start = Math.max(0, Math.floor(group.start));
      const end = Math.min(indexValues.length, start + Math.max(0, Math.floor(group.count)));
      for (let index = start; index < end; index += 1) {
        groupedIndices.push(indexValues[index]);
      }
    });
    return groupedIndices;
  }

  if (filteredGroups.length === 0) {
    return Array.from({ length: positionCount }, (_, value) => value);
  }

  const groupedIndices: number[] = [];
  filteredGroups.forEach((group) => {
    const start = Math.max(0, Math.floor(group.start));
    const end = Math.min(positionCount, start + Math.max(0, Math.floor(group.count)));
    for (let index = start; index < end; index += 1) {
      groupedIndices.push(index);
    }
  });
  return groupedIndices;
};

export const extractUsdMeshGeometryData = async (
  mesh: THREE.Mesh,
  vertexYieldInterval = DEFAULT_VERTEX_YIELD_INTERVAL,
): Promise<UsdMeshGeometryData | null> => {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position || position.count === 0) {
    return null;
  }

  let signatureHash = 2166136261;
  const positionSource = getUsdNumericAttributeSource(position);
  if (positionSource && position.itemSize >= 3) {
    const { array, stride, offset } = positionSource;
    for (let index = 0; index < position.count; index += 1) {
      const base = index * stride + offset;
      signatureHash = hashGeometryNumber(signatureHash, Number(array[base] ?? 0));
      signatureHash = hashGeometryNumber(signatureHash, Number(array[base + 1] ?? 0));
      signatureHash = hashGeometryNumber(signatureHash, Number(array[base + 2] ?? 0));
      await yieldPeriodically(index + 1, vertexYieldInterval);
    }
  } else {
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      signatureHash = hashGeometryNumber(signatureHash, x);
      signatureHash = hashGeometryNumber(signatureHash, y);
      signatureHash = hashGeometryNumber(signatureHash, z);
      await yieldPeriodically(index + 1, vertexYieldInterval);
    }
  }

  const indexValues = collectUsdFaceVertexIndices(mesh, geometry, position.count);
  const faceVertexIndices: number[] = [];
  for (let index = 0; index < indexValues.length; index += 3) {
    if (index + 2 >= indexValues.length) break;
    faceVertexIndices.push(indexValues[index], indexValues[index + 1], indexValues[index + 2]);
    signatureHash = hashGeometryNumber(signatureHash, 3);
    signatureHash = hashGeometryNumber(signatureHash, indexValues[index]);
    signatureHash = hashGeometryNumber(signatureHash, indexValues[index + 1]);
    signatureHash = hashGeometryNumber(signatureHash, indexValues[index + 2]);
  }
  const triangleCount = faceVertexIndices.length / 3;

  const normal = geometry.getAttribute('normal');
  let normalAttribute: UsdNumericAttribute | null = null;
  let normalInterpolation: 'vertex' | 'faceVarying' | null = null;
  if (normal && normal.count > 0 && normal.itemSize >= 3) {
    const nextNormalInterpolation =
      normal.count === position.count
        ? 'vertex'
        : normal.count === faceVertexIndices.length
          ? 'faceVarying'
          : null;

    if (nextNormalInterpolation) {
      let normalSignatureHash = signatureHash;
      normalSignatureHash = hashGeometryNumber(
        normalSignatureHash,
        nextNormalInterpolation === 'vertex' ? 1 : 2,
      );
      normalSignatureHash = hashGeometryNumber(normalSignatureHash, normal.count);

      const normalSource = getUsdNumericAttributeSource(normal);
      if (normalSource) {
        const { array, stride, offset } = normalSource;
        for (let index = 0; index < normal.count; index += 1) {
          const base = index * stride + offset;
          normalSignatureHash = hashGeometryNumber(normalSignatureHash, Number(array[base] ?? 0));
          normalSignatureHash = hashGeometryNumber(
            normalSignatureHash,
            Number(array[base + 1] ?? 0),
          );
          normalSignatureHash = hashGeometryNumber(
            normalSignatureHash,
            Number(array[base + 2] ?? 0),
          );
          await yieldPeriodically(index + 1, vertexYieldInterval);
        }
      } else {
        for (let index = 0; index < normal.count; index += 1) {
          normalSignatureHash = hashGeometryNumber(normalSignatureHash, normal.getX(index));
          normalSignatureHash = hashGeometryNumber(normalSignatureHash, normal.getY(index));
          normalSignatureHash = hashGeometryNumber(normalSignatureHash, normal.getZ(index));
          await yieldPeriodically(index + 1, vertexYieldInterval);
        }
      }

      normalAttribute = normal;
      normalInterpolation = nextNormalInterpolation;
      signatureHash = normalSignatureHash;
    }
  }

  const uv = geometry.getAttribute('uv');
  let uvAttribute: UsdNumericAttribute | null = null;
  if (uv && uv.count > 0 && faceVertexIndices.length > 0) {
    let uvSignatureHash = signatureHash;
    let hasCompleteUvCoverage = true;
    const uvSource = getUsdNumericAttributeSource(uv);
    if (uvSource && uv.itemSize >= 2) {
      const { array, stride, offset } = uvSource;
      for (let index = 0; index < faceVertexIndices.length; index += 1) {
        const faceVertexIndex = faceVertexIndices[index];
        if (faceVertexIndex < 0 || faceVertexIndex >= uv.count) {
          hasCompleteUvCoverage = false;
          break;
        }

        const base = faceVertexIndex * stride + offset;
        uvSignatureHash = hashGeometryNumber(uvSignatureHash, Number(array[base] ?? 0));
        uvSignatureHash = hashGeometryNumber(uvSignatureHash, Number(array[base + 1] ?? 0));
        await yieldPeriodically(index + 1, vertexYieldInterval);
      }
    } else {
      for (let index = 0; index < faceVertexIndices.length; index += 1) {
        const faceVertexIndex = faceVertexIndices[index];
        if (faceVertexIndex < 0 || faceVertexIndex >= uv.count) {
          hasCompleteUvCoverage = false;
          break;
        }

        uvSignatureHash = hashGeometryNumber(uvSignatureHash, uv.getX(faceVertexIndex));
        uvSignatureHash = hashGeometryNumber(uvSignatureHash, uv.getY(faceVertexIndex));
        await yieldPeriodically(index + 1, vertexYieldInterval);
      }
    }

    if (hasCompleteUvCoverage) {
      uvAttribute = uv;
      signatureHash = uvSignatureHash;
    }
  }

  return {
    triangleCount,
    faceVertexIndices,
    positions: position,
    normalAttribute,
    normalInterpolation,
    uvAttribute,
    signature: (signatureHash >>> 0).toString(16).padStart(8, '0'),
  };
};

const createUsdMaterialSignature = (appearance: UsdRenderableAppearance): string => {
  return [
    appearance.authoredColor[0].toFixed(6),
    appearance.authoredColor[1].toFixed(6),
    appearance.authoredColor[2].toFixed(6),
    appearance.opacity.toFixed(6),
    appearance.texture?.exportPath || '',
  ].join(':');
};

const createUsdGeometrySignature = (data: UsdMeshGeometryData): string => {
  return data.signature;
};

const collectUsdTextureSourcePaths = (sceneRoot: THREE.Object3D): Set<string> => {
  const textureSourcePaths = new Set<string>();
  const addTextureSourcePath = (value: unknown) => {
    const sourcePath = typeof value === 'string' ? value.trim() : '';
    if (sourcePath) {
      textureSourcePaths.add(sourcePath);
    }
  };

  sceneRoot.traverse((object) => {
    const materialMetadata = object.userData?.usdMaterial as UsdMaterialMetadata | undefined;
    addTextureSourcePath(materialMetadata?.texture);

    const palette = Array.isArray(object.userData?.usdMaterialPalette)
      ? (object.userData.usdMaterialPalette as UsdPaletteEntry[])
      : [];
    palette.forEach((entry) => {
      const paletteMaterial = entry?.usdMaterial as UsdMaterialMetadata | undefined;
      addTextureSourcePath(paletteMaterial?.texture);
    });

    if (!isUsdMeshObject(object)) {
      return;
    }

    const materialCount = Array.isArray(object.material) ? object.material.length : 1;
    for (let materialIndex = 0; materialIndex < materialCount; materialIndex += 1) {
      addTextureSourcePath(getRenderableTextureSourcePath(object, materialIndex));
    }
  });

  return textureSourcePaths;
};

export const collectUsdSerializationContext = async (
  sceneRoot: THREE.Object3D,
  {
    onProgress,
    rootPrimName,
    objectYieldInterval = DEFAULT_OBJECT_YIELD_INTERVAL,
    vertexYieldInterval = DEFAULT_VERTEX_YIELD_INTERVAL,
  }: CollectUsdSerializationContextOptions = {},
): Promise<UsdSerializationContext> => {
  const effectiveRootPrimName = String(rootPrimName || sceneRoot.name || 'Robot').trim() || 'Robot';
  const materialByObject = new WeakMap<THREE.Object3D, UsdPreviewMaterialRecord>();
  const materialSubsetsByObject = new WeakMap<THREE.Object3D, UsdMaterialSubsetRecord[]>();
  const materialBySignature = new Map<string, UsdPreviewMaterialRecord>();
  const materialRecords: UsdPreviewMaterialRecord[] = [];
  const geometryByObject = new WeakMap<THREE.Object3D, UsdMeshGeometryRecord>();
  const geometryBySignature = new Map<string, UsdMeshGeometryRecord>();
  const geometryByBuffer = new WeakMap<THREE.BufferGeometry, UsdMeshGeometryRecord>();
  const geometryRecords: UsdMeshGeometryRecord[] = [];
  const objects: THREE.Object3D[] = [];
  const textureExportPathOverrides = buildTextureExportPathOverrides(
    collectUsdTextureSourcePaths(sceneRoot),
  );

  sceneRoot.traverse((object) => {
    if (object.userData.usdGeomType || isUsdMeshObject(object)) {
      objects.push(object);
    }
  });

  if (onProgress && objects.length > 0) {
    onProgress({
      phase: 'geometry',
      completed: 0,
      total: objects.length,
    });
  }

  let completed = 0;
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
    const object = objects[objectIndex];
    const label = normalizeUsdProgressLabel(object.name || object.userData.usdGeomType, 'object');

    const materialSubsets =
      object.userData?.usdPurpose === 'guide'
        ? []
        : getUsdMeshSubsetAppearances(object, textureExportPathOverrides);
    if (materialSubsets.length > 0) {
      const subsetRecords: UsdMaterialSubsetRecord[] = [];
      materialSubsets.forEach((subset, subsetIndex) => {
        const signature = createUsdMaterialSignature(subset.appearance);
        let materialRecord = materialBySignature.get(signature);
        if (!materialRecord) {
          const name = `Material_${materialRecords.length}`;
          materialRecord = {
            name,
            path: `/${effectiveRootPrimName}/Looks/${name}`,
            appearance: {
              color: subset.appearance.color.clone(),
              authoredColor: [...subset.appearance.authoredColor] as [number, number, number],
              opacity: subset.appearance.opacity,
              texture: subset.appearance.texture
                ? {
                    sourcePath: subset.appearance.texture.sourcePath,
                    exportPath: subset.appearance.texture.exportPath,
                  }
                : null,
            },
          };
          materialBySignature.set(signature, materialRecord);
          materialRecords.push(materialRecord);
        }

        subsetRecords.push({
          appearance: {
            color: subset.appearance.color.clone(),
            authoredColor: [...subset.appearance.authoredColor] as [number, number, number],
            opacity: subset.appearance.opacity,
            texture: subset.appearance.texture
              ? {
                  sourcePath: subset.appearance.texture.sourcePath,
                  exportPath: subset.appearance.texture.exportPath,
                }
              : null,
          },
          faceIndices: subset.faceIndices.slice(),
          materialRecord,
          name: `subset_${subsetIndex}`,
          ...(subset.displayName ? { displayName: subset.displayName } : {}),
        });
      });
      materialSubsetsByObject.set(object, subsetRecords);
    } else {
      const appearance =
        object.userData?.usdPurpose === 'guide'
          ? null
          : getUsdRenderableAppearance(object, 0, textureExportPathOverrides);
      if (appearance) {
        const signature = createUsdMaterialSignature(appearance);
        let record = materialBySignature.get(signature);
        if (!record) {
          const name = `Material_${materialRecords.length}`;
          record = {
            name,
            path: `/${effectiveRootPrimName}/Looks/${name}`,
            appearance: {
              color: appearance.color.clone(),
              authoredColor: [...appearance.authoredColor] as [number, number, number],
              opacity: appearance.opacity,
              texture: appearance.texture
                ? {
                    sourcePath: appearance.texture.sourcePath,
                    exportPath: appearance.texture.exportPath,
                  }
                : null,
            },
          };
          materialBySignature.set(signature, record);
          materialRecords.push(record);
        }

        materialByObject.set(object, record);
      }
    }

    if (isUsdMeshObject(object)) {
      const cachedGeometryRecord = geometryByBuffer.get(object.geometry);
      if (cachedGeometryRecord) {
        geometryByObject.set(object, cachedGeometryRecord);
      } else {
        const geometryData = await extractUsdMeshGeometryData(object, vertexYieldInterval);
        if (geometryData) {
          const geometrySignature = createUsdGeometrySignature(geometryData);
          let geometryRecord = geometryBySignature.get(geometrySignature);
          if (!geometryRecord) {
            const name = `Geometry_${geometryRecords.length}`;
            geometryRecord = {
              name,
              path: `/${effectiveRootPrimName}/__MeshLibrary/${name}`,
              data: geometryData,
            };
            geometryBySignature.set(geometrySignature, geometryRecord);
            geometryRecords.push(geometryRecord);
          }

          geometryByBuffer.set(object.geometry, geometryRecord);
          geometryByObject.set(object, geometryRecord);
        }
      }
    }

    completed = Math.min(objects.length, completed + 1);
    onProgress?.({
      phase: 'geometry',
      completed,
      total: objects.length,
      label,
    });
    await yieldPeriodically(objectIndex + 1, objectYieldInterval);
  }

  return {
    materialByObject,
    materialSubsetsByObject,
    materialRecords,
    geometryByObject,
    geometryRecords,
    textureExportPathOverrides,
  };
};
