import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';

import {
  createLoadingManager,
  createMeshLoader,
  buildColladaRootNormalizationHints,
  findAssetByPath,
  isCoplanarOffsetMaterial,
  postProcessColladaScene,
} from '@/core/loaders';
import { collectExplicitlyScaledMeshPaths } from '@/core/loaders/meshScaleHints';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from '@/core/loaders/colladaWorkerSceneData';
import { normalizeMeshPathForExport } from '@/core/parsers/meshPathUtils';
import { getVisualGeometryEntries, hasGeometryMeshMaterialGroups } from '@/core/robot';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { GeometryType, type RobotState } from '@/types';
import { disposeObject3D } from '@/shared/utils/three/dispose';

export interface PrepareMjcfMeshExportAssetsOptions {
  robot: RobotState;
  assets: Record<string, string>;
  extraMeshFiles?: Map<string, Blob>;
  preferSharedMeshReuse?: boolean;
  meshFormat?: 'auto' | 'obj' | 'stl' | 'ply';
}

export interface PreparedMjcfMeshExportAssets {
  meshPathOverrides: Map<string, string>;
  archiveFiles: Map<string, Blob>;
  convertedSourceMeshPaths: Set<string>;
  visualMeshVariants: Map<string, MjcfVisualMeshVariant[]>;
}

function isMjcfNativeMeshPath(meshPath: string): boolean {
  return /\.(?:obj|stl|msh)$/i.test(meshPath);
}

function collectMeshPathAliases(meshPath: string): string[] {
  const aliases = [meshPath];
  const normalizedPath = normalizeMeshPathForExport(meshPath);
  if (normalizedPath && normalizedPath !== meshPath) {
    aliases.push(normalizedPath);
  }
  return aliases;
}

function buildConvertedMeshBasePath(normalizedPath: string): string {
  const pathMatch = normalizedPath.match(/^(.*\/)?([^/]+)$/);
  const directory = pathMatch?.[1] || '';
  const fileName = pathMatch?.[2] || normalizedPath;
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return `${directory}${withoutExtension.replace(/\./g, '_')}`;
}

function buildConvertedMeshExportPath(
  meshPath: string,
  usedPaths: Set<string>,
  extension: '.obj' | '.stl' | '.ply',
): string {
  const normalizedPath = normalizeMeshPathForExport(meshPath);
  if (!normalizedPath) {
    return '';
  }

  const basePath = buildConvertedMeshBasePath(normalizedPath);
  let candidate = `${basePath}${extension}`;
  let counter = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${basePath}_${counter}${extension}`;
    counter += 1;
  }

  usedPaths.add(candidate);
  return candidate;
}

export interface MjcfVisualMeshVariant {
  meshPath: string;
  color?: string;
  sourceMaterialName?: string;
}

interface ExtractedVisualMeshVariant extends MjcfVisualMeshVariant {
  blob: Blob;
}

interface PendingVisualMeshVariant {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  meshName: string;
}

const COPLANAR_ANCHOR_BAKE_OFFSET = 1e-4;
type GeometryGroup = THREE.BufferGeometry['groups'][number];
type GeometryAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function sanitizeVariantSegment(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildConvertedVisualVariantPath(
  meshPath: string,
  materialName: string | undefined,
  variantIndex: number,
  usedPaths: Set<string>,
  extension: '.obj' | '.stl' | '.ply',
): string {
  const normalizedPath = normalizeMeshPathForExport(meshPath);
  if (!normalizedPath) {
    return '';
  }

  const basePath = buildConvertedMeshBasePath(normalizedPath);
  const materialSuffix = sanitizeVariantSegment(materialName) || `part_${variantIndex + 1}`;

  let candidate = `${basePath}_${materialSuffix}${extension}`;
  let counter = 2;
  while (usedPaths.has(candidate)) {
    candidate = `${basePath}_${materialSuffix}_${counter}${extension}`;
    counter += 1;
  }

  usedPaths.add(candidate);
  return candidate;
}

function colorToHex(color: THREE.Color | undefined): string | undefined {
  if (!color) {
    return undefined;
  }

  const srgbColor = new THREE.Color(color.r, color.g, color.b).convertLinearToSRGB();
  const toChannel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');

  return `#${toChannel(srgbColor.r)}${toChannel(srgbColor.g)}${toChannel(srgbColor.b)}`;
}

function exportObjBlob(objExporter: OBJExporter, object: THREE.Object3D): Blob | null {
  const exportedObj = objExporter.parse(object);
  if (!exportedObj.trim()) {
    return null;
  }

  return new Blob([exportedObj], { type: 'text/plain' });
}

type MeshFormatKind = 'auto' | 'obj' | 'stl' | 'ply';
type MeshExtension = '.obj' | '.stl' | '.ply';

interface MeshExporters {
  obj: OBJExporter;
  stl: STLExporter;
  ply: PLYExporter;
}

function exportStlBlob(stlExporter: STLExporter, object: THREE.Object3D): Blob | null {
  const result = stlExporter.parse(object, { binary: true });
  if (!result || (result.byteLength ?? 0) === 0) {
    return null;
  }
  return new Blob([result as unknown as ArrayBuffer], { type: 'model/stl' });
}

function exportPlyBlob(plyExporter: PLYExporter, object: THREE.Object3D): Blob | null {
  const result = plyExporter.parse(object, () => {}, { binary: true });
  if (!result || (result.byteLength ?? 0) === 0) {
    return null;
  }
  return new Blob([result as unknown as ArrayBuffer], { type: 'model/ply' });
}

// Resolve effective mesh format: 'auto' picks STL (binary, smallest) for
// meshes without UVs, and OBJ (preserves UVs) for textured meshes.
function resolveMeshFormat(
  requested: MeshFormatKind,
  object: THREE.Object3D,
): MeshExtension {
  if (requested === 'stl') return '.stl';
  if (requested === 'ply') return '.ply';
  if (requested === 'obj') return '.obj';
  let hasUv = false;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute('uv')) {
      hasUv = true;
    }
  });
  return hasUv ? '.obj' : '.stl';
}

function exportMeshBlob(
  exporters: MeshExporters,
  extension: MeshExtension,
  object: THREE.Object3D,
): Blob | null {
  switch (extension) {
    case '.stl':
      return exportStlBlob(exporters.stl, object);
    case '.ply':
      return exportPlyBlob(exporters.ply, object);
    default:
      return exportObjBlob(exporters.obj, object);
  }
}

function isColorLike(color: unknown): color is THREE.Color {
  if (!color || typeof color !== 'object') {
    return false;
  }

  const candidate = color as Partial<THREE.Color> & { isColor?: boolean };
  return (
    (candidate.isColor === true || typeof candidate.getHexString === 'function') &&
    typeof candidate.r === 'number' &&
    typeof candidate.g === 'number' &&
    typeof candidate.b === 'number'
  );
}

function getMaterialColor(material: THREE.Material): THREE.Color | undefined {
  return 'color' in material && isColorLike(material.color) ? material.color : undefined;
}

function isBufferGeometryLike(geometry: unknown): geometry is THREE.BufferGeometry {
  if (!geometry || typeof geometry !== 'object') {
    return false;
  }

  const candidate = geometry as Partial<THREE.BufferGeometry> & { isBufferGeometry?: boolean };
  return (
    Boolean(candidate.isBufferGeometry) &&
    typeof candidate.clone === 'function' &&
    typeof candidate.getAttribute === 'function' &&
    typeof candidate.getIndex === 'function'
  );
}

function getAttributeArray(attribute: GeometryAttribute): ArrayLike<number> {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? attribute.data.array
    : attribute.array;
}

function cloneAttributeSubset(
  attribute: GeometryAttribute,
  vertexIndexes: readonly number[],
): THREE.BufferAttribute {
  const itemSize = attribute.itemSize;
  const sourceArray = getAttributeArray(attribute);
  const ArrayCtor = sourceArray.constructor as new (length: number) => ArrayLike<number>;
  const values = new ArrayCtor(vertexIndexes.length * itemSize) as THREE.TypedArray;

  vertexIndexes.forEach((vertexIndex, nextVertexIndex) => {
    const targetOffset = nextVertexIndex * itemSize;
    for (let componentIndex = 0; componentIndex < itemSize; componentIndex += 1) {
      if (attribute instanceof THREE.InterleavedBufferAttribute) {
        values[targetOffset + componentIndex] = attribute.getComponent(vertexIndex, componentIndex);
        continue;
      }

      const sourceOffset = vertexIndex * itemSize;
      values[targetOffset + componentIndex] = attribute.array[sourceOffset + componentIndex];
    }
  });

  const cloned = new THREE.BufferAttribute(values, itemSize, attribute.normalized);
  if (attribute.name) {
    cloned.name = attribute.name;
  }
  if (attribute instanceof THREE.BufferAttribute) {
    cloned.usage = attribute.usage;
    if (attribute.gpuType != null) {
      cloned.gpuType = attribute.gpuType;
    }
  }
  return cloned;
}

function getUsableGeometryIndex(geometry: THREE.BufferGeometry): GeometryAttribute | null {
  const index = geometry.getIndex();
  return index && index.count > 0 ? index : null;
}

function getTriangleVertexIndex(
  indexArray: ArrayLike<number> | null,
  start: number,
  offset: number,
): number {
  const pointer = start + offset;
  return indexArray ? Number(indexArray[pointer] ?? 0) : pointer;
}

function buildTriangleVertexKey(
  positionArray: ArrayLike<number>,
  vertexIndex: number,
  itemSize: number,
): string {
  const start = vertexIndex * itemSize;
  const x = Number(positionArray[start] ?? 0).toFixed(6);
  const y = Number(positionArray[start + 1] ?? 0).toFixed(6);
  const z = Number(positionArray[start + 2] ?? 0).toFixed(6);
  return `${x},${y},${z}`;
}

function buildTriangleKey(
  positionArray: ArrayLike<number>,
  itemSize: number,
  indexArray: ArrayLike<number> | null,
  start: number,
): string {
  const vertices = [
    buildTriangleVertexKey(positionArray, getTriangleVertexIndex(indexArray, start, 0), itemSize),
    buildTriangleVertexKey(positionArray, getTriangleVertexIndex(indexArray, start, 1), itemSize),
    buildTriangleVertexKey(positionArray, getTriangleVertexIndex(indexArray, start, 2), itemSize),
  ];
  vertices.sort();
  return vertices.join('|');
}

function pickPreferredTriangleOwner(
  materialIndexes: Iterable<number>,
  materials: readonly THREE.Material[],
): number | null {
  let preferredMaterialIndex: number | null = null;

  for (const materialIndex of materialIndexes) {
    if (preferredMaterialIndex == null) {
      preferredMaterialIndex = materialIndex;
      continue;
    }

    const preferredMaterial = materials[preferredMaterialIndex];
    const candidateMaterial = materials[materialIndex];
    const preferredIsOffset = isCoplanarOffsetMaterial(preferredMaterial);
    const candidateIsOffset = isCoplanarOffsetMaterial(candidateMaterial);

    if (preferredIsOffset !== candidateIsOffset) {
      if (!candidateIsOffset) {
        preferredMaterialIndex = materialIndex;
      }
      continue;
    }

    if (materialIndex < preferredMaterialIndex) {
      preferredMaterialIndex = materialIndex;
    }
  }

  return preferredMaterialIndex;
}

function buildDuplicateTriangleOwnerMap(
  sourceGeometry: THREE.BufferGeometry,
  materials: readonly THREE.Material[],
): Map<string, number> {
  const positionAttribute = sourceGeometry.getAttribute('position');
  if (!positionAttribute || positionAttribute.itemSize < 3 || sourceGeometry.groups.length < 2) {
    return new Map();
  }

  const triangleOwners = new Map<string, Set<number>>();
  const positionArray = positionAttribute.array;
  const indexArray = getUsableGeometryIndex(sourceGeometry)?.array ?? null;

  sourceGeometry.groups.forEach((group) => {
    const materialIndex = group.materialIndex ?? 0;
    const groupEnd = group.start + group.count;
    for (let triangleStart = group.start; triangleStart + 2 < groupEnd; triangleStart += 3) {
      const triangleKey = buildTriangleKey(
        positionArray,
        positionAttribute.itemSize,
        indexArray,
        triangleStart,
      );
      const owners = triangleOwners.get(triangleKey) ?? new Set<number>();
      owners.add(materialIndex);
      triangleOwners.set(triangleKey, owners);
    }
  });

  const preferredOwners = new Map<string, number>();
  triangleOwners.forEach((owners, triangleKey) => {
    if (owners.size < 2) {
      return;
    }

    const hasCoplanarAdjustedOwner = Array.from(owners).some((materialIndex) =>
      isCoplanarOffsetMaterial(materials[materialIndex]),
    );
    if (!hasCoplanarAdjustedOwner) {
      return;
    }

    const preferredOwner = pickPreferredTriangleOwner(owners, materials);
    if (preferredOwner != null) {
      preferredOwners.set(triangleKey, preferredOwner);
    }
  });

  return preferredOwners;
}

function buildIndexedGeometrySubset(
  sourceGeometry: THREE.BufferGeometry,
  relevantGroups: readonly GeometryGroup[],
  preferredTriangleOwners: ReadonlyMap<string, number>,
  targetMaterialIndex: number,
): THREE.BufferGeometry | null {
  const sourceIndex = getUsableGeometryIndex(sourceGeometry);
  if (!sourceIndex || relevantGroups.length === 0) {
    return null;
  }

  const positionAttribute = sourceGeometry.getAttribute('position');
  if (!positionAttribute) {
    return null;
  }

  const indexRemap = new Map<number, number>();
  const sourceVertexIndexes: number[] = [];
  const nextIndexes: number[] = [];
  const emittedTriangles = new Set<string>();
  const positionArray = positionAttribute.array;
  const indexArray = sourceIndex.array;

  relevantGroups.forEach((group) => {
    const groupEnd = group.start + group.count;
    for (let triangleStart = group.start; triangleStart + 2 < groupEnd; triangleStart += 3) {
      const triangleKey = buildTriangleKey(
        positionArray,
        positionAttribute.itemSize,
        indexArray,
        triangleStart,
      );
      const preferredOwner = preferredTriangleOwners.get(triangleKey);
      if (preferredOwner != null && preferredOwner !== targetMaterialIndex) {
        continue;
      }
      const shouldDeduplicateTriangle = preferredOwner != null;
      if (shouldDeduplicateTriangle && emittedTriangles.has(triangleKey)) {
        continue;
      }
      if (shouldDeduplicateTriangle) {
        emittedTriangles.add(triangleKey);
      }

      for (let offset = 0; offset < 3; offset += 1) {
        const sourceVertexIndex = sourceIndex.getX(triangleStart + offset);
        let nextVertexIndex = indexRemap.get(sourceVertexIndex);
        if (nextVertexIndex == null) {
          nextVertexIndex = sourceVertexIndexes.length;
          indexRemap.set(sourceVertexIndex, nextVertexIndex);
          sourceVertexIndexes.push(sourceVertexIndex);
        }
        nextIndexes.push(nextVertexIndex);
      }
    }
  });

  if (nextIndexes.length === 0 || sourceVertexIndexes.length === 0) {
    return null;
  }

  const subsetGeometry = new THREE.BufferGeometry();
  Object.entries(sourceGeometry.attributes).forEach(([attributeName, attribute]) => {
    subsetGeometry.setAttribute(
      attributeName,
      cloneAttributeSubset(attribute, sourceVertexIndexes),
    );
  });

  if (sourceGeometry.morphAttributes) {
    Object.entries(sourceGeometry.morphAttributes).forEach(([attributeName, morphAttributes]) => {
      if (attributeName === 'position' || attributeName === 'normal' || attributeName === 'color') {
        subsetGeometry.morphAttributes[attributeName] = morphAttributes.map((attribute) =>
          cloneAttributeSubset(attribute, sourceVertexIndexes),
        );
      }
    });
  }
  subsetGeometry.morphTargetsRelative = sourceGeometry.morphTargetsRelative;

  subsetGeometry.setIndex(nextIndexes);
  return subsetGeometry;
}

function buildNonIndexedGeometrySubset(
  sourceGeometry: THREE.BufferGeometry,
  relevantGroups: readonly GeometryGroup[],
  preferredTriangleOwners: ReadonlyMap<string, number>,
  targetMaterialIndex: number,
): THREE.BufferGeometry | null {
  const positionAttribute = sourceGeometry.getAttribute('position');
  if (!positionAttribute || relevantGroups.length === 0) {
    return null;
  }

  const vertexIndexes: number[] = [];
  const emittedTriangles = new Set<string>();
  const positionArray = positionAttribute.array;
  relevantGroups.forEach((group) => {
    const groupEnd = group.start + group.count;
    for (let triangleStart = group.start; triangleStart + 2 < groupEnd; triangleStart += 3) {
      const triangleKey = buildTriangleKey(
        positionArray,
        positionAttribute.itemSize,
        null,
        triangleStart,
      );
      const preferredOwner = preferredTriangleOwners.get(triangleKey);
      if (preferredOwner != null && preferredOwner !== targetMaterialIndex) {
        continue;
      }
      const shouldDeduplicateTriangle = preferredOwner != null;
      if (shouldDeduplicateTriangle && emittedTriangles.has(triangleKey)) {
        continue;
      }
      if (shouldDeduplicateTriangle) {
        emittedTriangles.add(triangleKey);
      }

      vertexIndexes.push(triangleStart, triangleStart + 1, triangleStart + 2);
    }
  });

  if (vertexIndexes.length === 0) {
    return null;
  }

  const subsetGeometry = new THREE.BufferGeometry();
  Object.entries(sourceGeometry.attributes).forEach(([attributeName, attribute]) => {
    subsetGeometry.setAttribute(attributeName, cloneAttributeSubset(attribute, vertexIndexes));
  });

  if (sourceGeometry.morphAttributes) {
    Object.entries(sourceGeometry.morphAttributes).forEach(([attributeName, morphAttributes]) => {
      if (attributeName === 'position' || attributeName === 'normal' || attributeName === 'color') {
        subsetGeometry.morphAttributes[attributeName] = morphAttributes.map((attribute) =>
          cloneAttributeSubset(attribute, vertexIndexes),
        );
      }
    });
  }
  subsetGeometry.morphTargetsRelative = sourceGeometry.morphTargetsRelative;

  return subsetGeometry;
}

function extractGeometryForMaterial(
  sourceGeometry: THREE.BufferGeometry,
  materials: readonly THREE.Material[],
  materialIndex: number,
): THREE.BufferGeometry | null {
  const relevantGroups = sourceGeometry.groups.filter(
    (group) => (group.materialIndex ?? 0) === materialIndex,
  );
  if (relevantGroups.length === 0) {
    return null;
  }

  const preferredTriangleOwners = buildDuplicateTriangleOwnerMap(sourceGeometry, materials);

  if (getUsableGeometryIndex(sourceGeometry)) {
    return buildIndexedGeometrySubset(
      sourceGeometry,
      relevantGroups,
      preferredTriangleOwners,
      materialIndex,
    );
  }

  return buildNonIndexedGeometrySubset(
    sourceGeometry,
    relevantGroups,
    preferredTriangleOwners,
    materialIndex,
  );
}

function buildSceneVariantTriangleOwnerMap(
  variants: readonly PendingVisualMeshVariant[],
): Map<string, number> {
  const triangleOwners = new Map<string, Set<number>>();

  variants.forEach((variant, variantIndex) => {
    const positionAttribute = variant.geometry.getAttribute('position');
    if (!positionAttribute) {
      return;
    }

    const indexArray = getUsableGeometryIndex(variant.geometry)?.array ?? null;
    const positionArray = positionAttribute.array;
    const triangleCount = indexArray
      ? Math.floor(indexArray.length / 3)
      : Math.floor(positionAttribute.count / 3);

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const triangleKey = buildTriangleKey(
        positionArray,
        positionAttribute.itemSize,
        indexArray,
        triangleIndex * 3,
      );
      const owners = triangleOwners.get(triangleKey) ?? new Set<number>();
      owners.add(variantIndex);
      triangleOwners.set(triangleKey, owners);
    }
  });

  const preferredOwners = new Map<string, number>();
  triangleOwners.forEach((owners, triangleKey) => {
    if (owners.size < 2) {
      return;
    }

    const hasCoplanarAdjustedOwner = Array.from(owners).some((variantIndex) =>
      isCoplanarOffsetMaterial(variants[variantIndex]?.material),
    );
    if (!hasCoplanarAdjustedOwner) {
      return;
    }

    const preferredOwner = pickPreferredTriangleOwner(
      Array.from(owners),
      variants.map((variant) => variant.material),
    );
    if (preferredOwner != null) {
      preferredOwners.set(triangleKey, preferredOwner);
    }
  });

  return preferredOwners;
}

function buildSceneVariantGeometrySubset(
  sourceGeometry: THREE.BufferGeometry,
  preferredTriangleOwners: ReadonlyMap<string, number>,
  targetVariantIndex: number,
): THREE.BufferGeometry | null {
  const positionAttribute = sourceGeometry.getAttribute('position');
  if (!positionAttribute) {
    return null;
  }

  const indexAttribute = getUsableGeometryIndex(sourceGeometry);
  const indexArray = indexAttribute?.array ?? null;
  const positionArray = positionAttribute.array;
  const triangleCount = indexArray
    ? Math.floor(indexArray.length / 3)
    : Math.floor(positionAttribute.count / 3);
  if (triangleCount <= 0) {
    return null;
  }

  const emittedTriangles = new Set<string>();

  if (indexArray) {
    const indexRemap = new Map<number, number>();
    const sourceVertexIndexes: number[] = [];
    const nextIndexes: number[] = [];

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const triangleStart = triangleIndex * 3;
      const triangleKey = buildTriangleKey(
        positionArray,
        positionAttribute.itemSize,
        indexArray,
        triangleStart,
      );
      const preferredOwner = preferredTriangleOwners.get(triangleKey);
      if (preferredOwner != null && preferredOwner !== targetVariantIndex) {
        continue;
      }
      const shouldDeduplicateTriangle = preferredOwner != null;
      if (shouldDeduplicateTriangle && emittedTriangles.has(triangleKey)) {
        continue;
      }
      if (shouldDeduplicateTriangle) {
        emittedTriangles.add(triangleKey);
      }

      for (let offset = 0; offset < 3; offset += 1) {
        const sourceVertexIndex = Number(indexArray[triangleStart + offset] ?? 0);
        let nextVertexIndex = indexRemap.get(sourceVertexIndex);
        if (nextVertexIndex == null) {
          nextVertexIndex = sourceVertexIndexes.length;
          indexRemap.set(sourceVertexIndex, nextVertexIndex);
          sourceVertexIndexes.push(sourceVertexIndex);
        }
        nextIndexes.push(nextVertexIndex);
      }
    }

    if (nextIndexes.length === 0 || sourceVertexIndexes.length === 0) {
      return null;
    }

    const subsetGeometry = new THREE.BufferGeometry();
    Object.entries(sourceGeometry.attributes).forEach(([attributeName, attribute]) => {
      subsetGeometry.setAttribute(
        attributeName,
        cloneAttributeSubset(attribute, sourceVertexIndexes),
      );
    });
    subsetGeometry.setIndex(nextIndexes);
    subsetGeometry.computeBoundingBox();
    subsetGeometry.computeBoundingSphere();
    return subsetGeometry;
  }

  const vertexIndexes: number[] = [];
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const triangleStart = triangleIndex * 3;
    const triangleKey = buildTriangleKey(
      positionArray,
      positionAttribute.itemSize,
      null,
      triangleStart,
    );
    const preferredOwner = preferredTriangleOwners.get(triangleKey);
    if (preferredOwner != null && preferredOwner !== targetVariantIndex) {
      continue;
    }
    const shouldDeduplicateTriangle = preferredOwner != null;
    if (shouldDeduplicateTriangle && emittedTriangles.has(triangleKey)) {
      continue;
    }
    if (shouldDeduplicateTriangle) {
      emittedTriangles.add(triangleKey);
    }

    vertexIndexes.push(triangleStart, triangleStart + 1, triangleStart + 2);
  }

  if (vertexIndexes.length === 0) {
    return null;
  }

  const subsetGeometry = new THREE.BufferGeometry();
  Object.entries(sourceGeometry.attributes).forEach(([attributeName, attribute]) => {
    subsetGeometry.setAttribute(attributeName, cloneAttributeSubset(attribute, vertexIndexes));
  });
  subsetGeometry.computeBoundingBox();
  subsetGeometry.computeBoundingSphere();
  return subsetGeometry;
}

function shouldBakeCoplanarAnchorOffset(
  materials: readonly THREE.Material[],
  materialIndex: number | undefined,
): boolean {
  if (materialIndex == null) {
    return false;
  }

  const targetMaterial = materials[materialIndex];
  if (!targetMaterial) {
    return false;
  }

  return (
    materials.some((candidateMaterial) => isCoplanarOffsetMaterial(candidateMaterial)) &&
    !isCoplanarOffsetMaterial(targetMaterial)
  );
}

function applyGeometryNormalOffset(geometry: THREE.BufferGeometry, distance: number): void {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) {
    return;
  }

  let normalAttribute = geometry.getAttribute('normal');
  if (!normalAttribute) {
    geometry.computeVertexNormals();
    normalAttribute = geometry.getAttribute('normal');
  }

  const positionAttribute = geometry.getAttribute('position');
  if (!positionAttribute || !normalAttribute) {
    return;
  }

  for (let vertexIndex = 0; vertexIndex < positionAttribute.count; vertexIndex += 1) {
    positionAttribute.setXYZ(
      vertexIndex,
      positionAttribute.getX(vertexIndex) + normalAttribute.getX(vertexIndex) * distance,
      positionAttribute.getY(vertexIndex) + normalAttribute.getY(vertexIndex) * distance,
      positionAttribute.getZ(vertexIndex) + normalAttribute.getZ(vertexIndex) * distance,
    );
  }

  positionAttribute.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function createBakedVariantMesh(
  mesh: THREE.Mesh,
  material: THREE.Material,
  materialIndex?: number,
): THREE.Mesh | null {
  if (!isBufferGeometryLike(mesh.geometry)) {
    return null;
  }

  const geometry = mesh.geometry.clone();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materialIndex != null && geometry.groups.length > 0) {
    const subsetGeometry = extractGeometryForMaterial(mesh.geometry, materials, materialIndex);
    geometry.dispose();
    if (!subsetGeometry) {
      return null;
    }
    subsetGeometry.clearGroups();
    subsetGeometry.applyMatrix4(mesh.matrixWorld);
    if (shouldBakeCoplanarAnchorOffset(materials, materialIndex)) {
      applyGeometryNormalOffset(subsetGeometry, COPLANAR_ANCHOR_BAKE_OFFSET);
    }
    subsetGeometry.computeBoundingBox();
    subsetGeometry.computeBoundingSphere();
    const bakedMaterial = material.clone();
    bakedMaterial.name = material.name;
    const bakedMesh = new THREE.Mesh(subsetGeometry, bakedMaterial);
    bakedMesh.name = mesh.name || material.name || 'mesh_variant';
    bakedMesh.updateMatrixWorld(true);
    return bakedMesh;
  }

  if (geometry.groups.length > 0) {
    geometry.clearGroups();
  }

  geometry.applyMatrix4(mesh.matrixWorld);

  const bakedMaterial = material.clone();
  bakedMaterial.name = material.name;

  const bakedMesh = new THREE.Mesh(geometry, bakedMaterial);
  bakedMesh.name = mesh.name || material.name || 'mesh_variant';
  bakedMesh.updateMatrixWorld(true);
  return bakedMesh;
}

function extractVisualMeshVariants(
  meshObject: THREE.Object3D,
  sourceMeshPath: string,
  usedArchivePaths: Set<string>,
  objExporter: OBJExporter,
  exporters: MeshExporters,
  meshFormat: MeshFormatKind,
): ExtractedVisualMeshVariant[] {
  const variantFiles: ExtractedVisualMeshVariant[] = [];
  const pendingVariants: PendingVisualMeshVariant[] = [];
  meshObject.updateMatrixWorld(true);

  meshObject.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materialIndexes =
      Array.isArray(mesh.material) && mesh.geometry?.groups?.length
        ? Array.from(new Set(mesh.geometry.groups.map((group) => group.materialIndex ?? 0)))
        : [undefined];

    materialIndexes.forEach((materialIndex) => {
      const material = materialIndex == null ? materials[0] : materials[materialIndex];
      if (!material) {
        return;
      }

      const bakedMesh = createBakedVariantMesh(mesh, material, materialIndex);
      if (!bakedMesh) {
        return;
      }

      try {
        pendingVariants.push({
          geometry: bakedMesh.geometry.clone(),
          material: (bakedMesh.material as THREE.Material).clone(),
          meshName: bakedMesh.name || material.name || 'mesh_variant',
        });
      } finally {
        disposeObject3D(bakedMesh, true);
      }
    });
  });

  const preferredTriangleOwners = buildSceneVariantTriangleOwnerMap(pendingVariants);

  pendingVariants.forEach((variant, variantIndex) => {
    const filteredGeometry = buildSceneVariantGeometrySubset(
      variant.geometry,
      preferredTriangleOwners,
      variantIndex,
    );

    try {
      if (!filteredGeometry) {
        return;
      }

      const exportMesh = new THREE.Mesh(filteredGeometry, variant.material);
      exportMesh.name = variant.meshName;
      exportMesh.updateMatrixWorld(true);
      const extension = resolveMeshFormat(meshFormat, exportMesh);
      const exportPath = buildConvertedVisualVariantPath(
        sourceMeshPath,
        variant.material.name,
        variantIndex,
        usedArchivePaths,
        extension,
      );
      if (!exportPath) {
        disposeObject3D(exportMesh, true);
        return;
      }

      const blob = exportMeshBlob(exporters, extension, exportMesh);
      disposeObject3D(exportMesh, true);
      if (!blob) {
        return;
      }

      variantFiles.push({
        meshPath: exportPath,
        color: colorToHex(getMaterialColor(variant.material)),
        sourceMaterialName: variant.material.name || undefined,
        blob,
      });
    } finally {
      variant.geometry.dispose();
      variant.material.dispose();
    }
  });

  return variantFiles;
}

function registerInlineMeshBlobUrls(
  sourceAssets: Record<string, string>,
  extraMeshFiles?: Map<string, Blob>,
): { resolvedAssets: Record<string, string>; tempObjectUrls: string[] } {
  const resolvedAssets = { ...sourceAssets };
  const tempObjectUrls: string[] = [];

  extraMeshFiles?.forEach((blob, sourcePath) => {
    const objectUrl = URL.createObjectURL(blob);
    tempObjectUrls.push(objectUrl);

    resolvedAssets[sourcePath] = objectUrl;

    const normalizedSourcePath = normalizeMeshPathForExport(sourcePath);
    if (normalizedSourcePath) {
      resolvedAssets[normalizedSourcePath] = objectUrl;

      const fileName = normalizedSourcePath.split('/').pop();
      if (fileName) {
        resolvedAssets[fileName] = objectUrl;
      }
    }
  });

  return { resolvedAssets, tempObjectUrls };
}

function collectReferencedMeshPaths(robot: RobotState): Set<string> {
  const meshPaths = new Set<string>();

  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        meshPaths.add(entry.geometry.meshPath);
      }
    });

    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      meshPaths.add(link.collision.meshPath);
    }

    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        meshPaths.add(body.meshPath);
      }
    });
  });

  return meshPaths;
}

interface ReferencedMeshUsage {
  hasVisualUsage: boolean;
  hasVisualMultiMaterialUsage: boolean;
  hasNonVisualUsage: boolean;
}

function hasCustomMeshMaterialUsage(
  geometry: Pick<RobotState['links'][string]['visual'], 'meshMaterialGroups'>,
): boolean {
  return geometry.meshMaterialGroups?.some((group) => Number(group.materialIndex) > 0) ?? false;
}

function collectReferencedMeshUsage(robot: RobotState): Map<string, ReferencedMeshUsage> {
  const usageByPath = new Map<string, ReferencedMeshUsage>();

  const markUsage = (meshPath: string | undefined, usageType: 'visual' | 'non-visual') => {
    if (!meshPath) {
      return;
    }

    const candidatePaths = new Set<string>([meshPath]);
    const normalizedPath = normalizeMeshPathForExport(meshPath);
    if (normalizedPath) {
      candidatePaths.add(normalizedPath);
    }

    candidatePaths.forEach((candidatePath) => {
      const usage = usageByPath.get(candidatePath) ?? {
        hasVisualUsage: false,
        hasVisualMultiMaterialUsage: false,
        hasNonVisualUsage: false,
      };

      if (usageType === 'visual') {
        usage.hasVisualUsage = true;
      } else {
        usage.hasNonVisualUsage = true;
      }

      usageByPath.set(candidatePath, usage);
    });
  };

  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type !== GeometryType.MESH) {
        return;
      }

      markUsage(entry.geometry.meshPath, 'visual');
      const normalizedPath = entry.geometry.meshPath
        ? normalizeMeshPathForExport(entry.geometry.meshPath)
        : '';
      if (
        (entry.geometry.authoredMaterials?.length || 0) > 1 ||
        hasCustomMeshMaterialUsage(entry.geometry)
      ) {
        const candidatePaths = new Set<string>([entry.geometry.meshPath || '']);
        if (normalizedPath) {
          candidatePaths.add(normalizedPath);
        }

        candidatePaths.forEach((candidatePath) => {
          if (!candidatePath) {
            return;
          }
          const usage = usageByPath.get(candidatePath) ?? {
            hasVisualUsage: false,
            hasVisualMultiMaterialUsage: false,
            hasNonVisualUsage: false,
          };
          usage.hasVisualUsage = true;
          usage.hasVisualMultiMaterialUsage = true;
          usageByPath.set(candidatePath, usage);
        });
      }
    });

    if (link.collision.type === GeometryType.MESH) {
      markUsage(link.collision.meshPath, 'non-visual');
    }

    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH) {
        markUsage(body.meshPath, 'non-visual');
      }
    });
  });

  return usageByPath;
}

function findVisualGeometryByMeshPath(
  robot: RobotState,
  meshPath: string,
): RobotState['links'][string]['visual'] | null {
  const normalizedMeshPath = normalizeMeshPathForExport(meshPath);

  for (const link of Object.values(robot.links)) {
    const visualEntry = getVisualGeometryEntries(link).find((entry) => {
      if (entry.geometry.type !== GeometryType.MESH || !entry.geometry.meshPath) {
        return false;
      }

      if (entry.geometry.meshPath === meshPath) {
        return true;
      }

      const normalizedEntryPath = normalizeMeshPathForExport(entry.geometry.meshPath);
      return Boolean(
        normalizedMeshPath && normalizedEntryPath && normalizedEntryPath === normalizedMeshPath,
      );
    });

    if (visualEntry) {
      return visualEntry.geometry;
    }
  }

  return null;
}

function containsPlaceholderMesh(object: any): boolean {
  let hasPlaceholder = Boolean(object?.userData?.isPlaceholder);

  object?.traverse?.((child: any) => {
    if (child?.userData?.isPlaceholder) {
      hasPlaceholder = true;
    }
  });

  return hasPlaceholder;
}

function getInlineMeshBlob(
  extraMeshFiles: Map<string, Blob> | undefined,
  meshPath: string,
): Blob | null {
  if (!extraMeshFiles?.size) {
    return null;
  }

  for (const candidatePath of collectMeshPathAliases(meshPath)) {
    const blob = extraMeshFiles.get(candidatePath);
    if (blob) {
      return blob;
    }
  }

  return null;
}

function shouldParseColladaInProcessForMjcfExport(meshPath: string): boolean {
  return /\.dae$/i.test(meshPath) && typeof Worker === 'undefined' && typeof window === 'undefined';
}

async function loadColladaMeshInProcessForMjcfExport(
  meshPath: string,
  assets: Record<string, string>,
  manager: THREE.LoadingManager,
  explicitScaleMeshPaths: ReadonlySet<string>,
): Promise<THREE.Object3D> {
  const assetUrl = findAssetByPath(meshPath, assets, '');
  if (!assetUrl) {
    throw new Error(`Mesh asset could not be resolved for ${meshPath}`);
  }

  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Collada asset: ${response.status} ${response.statusText}`);
  }

  const colladaText = await response.text();
  const serializedScene = parseColladaSceneData(colladaText, assetUrl);
  const scene = createSceneFromSerializedColladaData(serializedScene, { manager });
  const maxDimension = postProcessColladaScene(scene);
  const normalizedMeshPath = normalizeMeshPathForExport(meshPath);
  const hasExplicitScale =
    explicitScaleMeshPaths.has(meshPath) ||
    Boolean(normalizedMeshPath && explicitScaleMeshPaths.has(normalizedMeshPath));

  if (!hasExplicitScale && maxDimension > 10) {
    scene.scale.setScalar(0.001);
  }

  return scene;
}

async function hashMeshBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function buildNativeMeshFingerprint(meshPath: string, meshBlob: Blob): Promise<string> {
  const normalizedPath = normalizeMeshPathForExport(meshPath) || meshPath;
  const extensionMatch = normalizedPath.match(/\.([^.]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || '';
  const bytes = new Uint8Array(await meshBlob.arrayBuffer());
  const hash = await hashMeshBytes(bytes);
  return `${extension}:${bytes.byteLength}:${hash}`;
}

function markSharedMeshReuse(
  sourceMeshPath: string,
  canonicalMeshPath: string,
  meshPathOverrides: Map<string, string>,
  convertedSourceMeshPaths: Set<string>,
): void {
  collectMeshPathAliases(sourceMeshPath).forEach((candidatePath) => {
    meshPathOverrides.set(candidatePath, canonicalMeshPath);
    convertedSourceMeshPaths.add(candidatePath);
  });
}

function registerNativeMeshPassThroughOverride(
  sourceMeshPath: string,
  normalizedMeshPath: string,
  meshPathOverrides: Map<string, string>,
): void {
  collectMeshPathAliases(sourceMeshPath).forEach((candidatePath) => {
    meshPathOverrides.set(candidatePath, normalizedMeshPath);
  });
}

function createMjcfMeshExportError(meshPath: string, cause: unknown): Error {
  const normalizedCause =
    cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : String(cause));
  return new Error(`[MJCF export] Failed to convert mesh "${meshPath}" to OBJ.`, {
    cause: normalizedCause,
  });
}

async function prepareSharedNativeMeshReuse(
  referencedMeshPaths: Set<string>,
  extraMeshFiles: Map<string, Blob> | undefined,
  meshPathOverrides: Map<string, string>,
  convertedSourceMeshPaths: Set<string>,
): Promise<void> {
  if (!extraMeshFiles?.size) {
    return;
  }

  const canonicalPathByFingerprint = new Map<string, string>();

  for (const meshPath of referencedMeshPaths) {
    if (!isMjcfNativeMeshPath(meshPath)) {
      continue;
    }

    const meshBlob = getInlineMeshBlob(extraMeshFiles, meshPath);
    if (!meshBlob) {
      continue;
    }

    const fingerprint = await buildNativeMeshFingerprint(meshPath, meshBlob);
    const canonicalMeshPath = canonicalPathByFingerprint.get(fingerprint);
    if (!canonicalMeshPath) {
      canonicalPathByFingerprint.set(fingerprint, meshPath);
      continue;
    }

    if (canonicalMeshPath === meshPath) {
      continue;
    }

    markSharedMeshReuse(meshPath, canonicalMeshPath, meshPathOverrides, convertedSourceMeshPaths);
  }
}

export async function prepareMjcfMeshExportAssets(
  options: PrepareMjcfMeshExportAssetsOptions,
): Promise<PreparedMjcfMeshExportAssets> {
  const { robot, assets, extraMeshFiles, preferSharedMeshReuse = true } = options;
  const meshPathOverrides = new Map<string, string>();
  const archiveFiles = new Map<string, Blob>();
  const convertedSourceMeshPaths = new Set<string>();
  const visualMeshVariants = new Map<string, MjcfVisualMeshVariant[]>();
  const usedArchivePaths = new Set<string>();
  const referencedMeshPaths = collectReferencedMeshPaths(robot);
  const referencedMeshUsage = collectReferencedMeshUsage(robot);
  const { resolvedAssets, tempObjectUrls } = registerInlineMeshBlobUrls(assets, extraMeshFiles);
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(robot.links);
  const explicitScaleMeshPaths = collectExplicitlyScaledMeshPaths(robot);
  const loadingManager = createLoadingManager(resolvedAssets);
  const loadMesh = createMeshLoader(resolvedAssets, loadingManager, '', {
    colladaRootNormalizationHints,
    explicitScaleMeshPaths,
  });
  const objExporter = new OBJExporter();
  const exporters: MeshExporters = {
    obj: objExporter,
    stl: new STLExporter(),
    ply: new PLYExporter(),
  };
  const meshFormat: MeshFormatKind = options.meshFormat ?? 'auto';

  try {
    if (preferSharedMeshReuse) {
      await prepareSharedNativeMeshReuse(
        referencedMeshPaths,
        extraMeshFiles,
        meshPathOverrides,
        convertedSourceMeshPaths,
      );
    }

    for (const meshPath of referencedMeshPaths) {
      const normalizedSourcePath = normalizeMeshPathForExport(meshPath);
      const sourceUsage =
        referencedMeshUsage.get(meshPath) ||
        (normalizedSourcePath ? referencedMeshUsage.get(normalizedSourcePath) : undefined);

      if (isMjcfNativeMeshPath(meshPath) && !sourceUsage?.hasVisualMultiMaterialUsage) {
        if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
          registerNativeMeshPassThroughOverride(meshPath, normalizedSourcePath, meshPathOverrides);
        }
        continue;
      }

      try {
        const meshObject = shouldParseColladaInProcessForMjcfExport(meshPath)
          ? await loadColladaMeshInProcessForMjcfExport(
              meshPath,
              resolvedAssets,
              loadingManager,
              explicitScaleMeshPaths,
            )
          : await new Promise<any>((resolve, reject) => {
              loadMesh(meshPath, loadingManager, (result, err) => {
                if (err) {
                  reject(err);
                  return;
                }

                resolve(result);
              });
            });

        if (containsPlaceholderMesh(meshObject)) {
          disposeObject3D(meshObject, true);
          throw new Error(
            `[MJCF export] Required mesh "${meshPath}" resolved to a placeholder asset.`,
          );
        }

        const meshGroupGeometry = findVisualGeometryByMeshPath(robot, meshPath);
        if (meshGroupGeometry && hasGeometryMeshMaterialGroups(meshGroupGeometry)) {
          applyVisualMeshMaterialGroupsToObject(meshObject, meshGroupGeometry, {
            manager: loadingManager,
          });
        }

        const extractedVariantFiles = extractVisualMeshVariants(
          meshObject,
          meshPath,
          usedArchivePaths,
          objExporter,
          exporters,
          meshFormat,
        );
        const hasSplitVisualVariants = extractedVariantFiles.length > 1;
        const shouldPreferVisualVariants =
          hasSplitVisualVariants &&
          Boolean(sourceUsage?.hasVisualMultiMaterialUsage) &&
          !sourceUsage?.hasNonVisualUsage;
        const needsFullMeshExport = !shouldPreferVisualVariants;

        if (needsFullMeshExport) {
          const fullExtension = resolveMeshFormat(meshFormat, meshObject);
          const exportPath = buildConvertedMeshExportPath(meshPath, usedArchivePaths, fullExtension);
          if (!exportPath) {
            disposeObject3D(meshObject, true);
            throw new Error(`[MJCF export] Could not derive a mesh export path for "${meshPath}".`);
          }

          const meshBlob = exportMeshBlob(exporters, fullExtension, meshObject);
          if (!meshBlob) {
            disposeObject3D(meshObject, true);
            throw new Error(`[MJCF export] Mesh export for "${meshPath}" produced no mesh data.`);
          }
          archiveFiles.set(exportPath, meshBlob);
          meshPathOverrides.set(meshPath, exportPath);
          convertedSourceMeshPaths.add(meshPath);

          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            meshPathOverrides.set(normalizedSourcePath, exportPath);
            convertedSourceMeshPaths.add(normalizedSourcePath);
          }
        } else {
          convertedSourceMeshPaths.add(meshPath);
          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            convertedSourceMeshPaths.add(normalizedSourcePath);
          }
        }

        if (extractedVariantFiles.length > 1) {
          const variants = extractedVariantFiles.map(({ blob, ...variant }) => {
            archiveFiles.set(variant.meshPath, blob);
            return variant;
          });

          visualMeshVariants.set(meshPath, variants);
          if (normalizedSourcePath && normalizedSourcePath !== meshPath) {
            visualMeshVariants.set(normalizedSourcePath, variants);
          }
        }

        disposeObject3D(meshObject, true);
      } catch (error) {
        throw createMjcfMeshExportError(meshPath, error);
      }
    }
  } finally {
    tempObjectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
  }

  return {
    meshPathOverrides,
    archiveFiles,
    convertedSourceMeshPaths,
    visualMeshVariants,
  };
}

export const __mjcfMeshExportInternals = {
  isBufferGeometryLike,
  isColorLike,
  getMaterialColor,
  colorToHex,
  createBakedVariantMesh,
};
