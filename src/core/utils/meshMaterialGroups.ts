import * as THREE from 'three';

import type { UrdfVisual, UrdfVisualMaterial, UrdfVisualMeshMaterialGroup } from '@/types';
import { getGeometryMeshMaterialGroupsForMesh } from '@/core/robot/visualMeshMaterialGroups';
import {
  getGeometryAuthoredMaterials,
  normalizeAuthoredMaterialEntry,
} from '@/core/robot/visualMaterials';
import { createMatteMaterial } from './materialFactory';
import { isProtectedMaterial } from './three/materialProtection';
import { colorRgbaTupleToOpacity, parseThreeColorWithOpacity } from './color.ts';

export type MeshFaceSelectionScope = 'face' | 'island';

const FACE_ISLAND_NORMAL_DOT_THRESHOLD = Math.cos((18 * Math.PI) / 180);

type RuntimeVisualObject = THREE.Object3D & { isURDFVisual?: boolean };

interface FaceIslandTopology {
  normals: THREE.Vector3[];
  adjacency: number[][];
}

const faceIslandTopologyCache = new WeakMap<THREE.BufferGeometry, FaceIslandTopology>();

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

function getMaterialColorHex(material: THREE.Material | null | undefined): string | undefined {
  if (!material) {
    return undefined;
  }

  const runtimeMaterial = material as THREE.Material & {
    color?: THREE.Color;
    userData: THREE.Material['userData'] & { originalColor?: THREE.Color };
  };
  const color = runtimeMaterial.userData?.originalColor?.isColor
    ? runtimeMaterial.userData.originalColor
    : runtimeMaterial.color;
  return color?.isColor ? `#${color.getHexString()}` : undefined;
}

function getMaterialColorValue(
  material: THREE.Material | null | undefined,
  key: 'emissive',
): string | undefined {
  if (!material) {
    return undefined;
  }

  const runtimeMaterial = material as THREE.Material & {
    emissive?: THREE.Color;
    userData: THREE.Material['userData'] & { originalEmissive?: THREE.Color };
  };
  const color = runtimeMaterial.userData?.originalEmissive?.isColor
    ? runtimeMaterial.userData.originalEmissive
    : runtimeMaterial[key];
  return color?.isColor ? `#${color.getHexString()}` : undefined;
}

function resolveRuntimeMaterialScalar(
  material: THREE.Material | null | undefined,
  property: 'roughness' | 'metalness' | 'emissiveIntensity',
  originalProperty: 'originalRoughness' | 'originalMetalness' | 'originalEmissiveIntensity',
  normalizer: (value: number | undefined) => number | undefined,
): number | undefined {
  if (!material) {
    return undefined;
  }

  const originalValue = normalizer(material.userData?.[originalProperty]);
  if (originalValue !== undefined) {
    return originalValue;
  }

  return normalizer((material as THREE.Material & Record<typeof property, number>)[property]);
}

export function resolveRuntimePaintBaseMaterial(mesh: THREE.Mesh): THREE.Material | null {
  const highlightSnapshot = mesh.userData?.__urdfHighlightSnapshot as
    | { material?: THREE.Material | THREE.Material[] }
    | undefined;
  const sourceMaterial = highlightSnapshot?.material ?? mesh.material;
  return (Array.isArray(sourceMaterial) ? sourceMaterial[0] : sourceMaterial) ?? null;
}

function cloneVisualMaterialDescriptor(
  material: UrdfVisualMaterial | null | undefined,
): UrdfVisualMaterial {
  if (!material) {
    return {};
  }

  return {
    ...material,
    ...(material.passes
      ? { passes: material.passes.map((pass) => ({ ...pass })) }
      : {}),
  };
}

function resolveDescriptorOpacity(
  authoredMaterial: UrdfVisualMaterial | null | undefined,
  fallbackMaterial: UrdfVisualMaterial | null | undefined,
  runtimeMaterial: THREE.Material | null,
): number | undefined {
  return (
    normalizeUnitIntervalValue(authoredMaterial?.opacity) ??
    colorRgbaTupleToOpacity(authoredMaterial?.colorRgba) ??
    normalizeUnitIntervalValue(fallbackMaterial?.opacity) ??
    colorRgbaTupleToOpacity(fallbackMaterial?.colorRgba) ??
    normalizeUnitIntervalValue(runtimeMaterial?.opacity)
  );
}

function resolveRuntimeMaterialName(
  runtimeMaterial: THREE.Material | null,
  authoredMaterial: UrdfVisualMaterial | null | undefined,
): string | undefined {
  if (authoredMaterial?.name) {
    return undefined;
  }

  return normalizeMaterialValue(runtimeMaterial?.name);
}

function resolveRuntimeTexturePath(
  runtimeMaterial: THREE.Material | null,
  authoredMaterial: UrdfVisualMaterial | null | undefined,
  fallbackMaterial: UrdfVisualMaterial | null | undefined,
): string | undefined {
  if (authoredMaterial?.texture || fallbackMaterial?.texture) {
    return undefined;
  }

  return normalizeMaterialValue(runtimeMaterial?.userData?.urdfTexturePath);
}

function resolveRuntimeTextureRotation(
  runtimeMaterial: THREE.Material | null,
): number | undefined {
  const materialWithMap = runtimeMaterial as
    | (THREE.Material & { map?: THREE.Texture | null })
    | null;
  const rotation = materialWithMap?.map?.rotation;
  return Number.isFinite(rotation) ? Number(rotation) : undefined;
}

export function captureRuntimeVisualMaterialDescriptor(
  mesh: THREE.Mesh,
  authoredMaterial?: UrdfVisualMaterial | null,
  fallbackMaterial?: UrdfVisualMaterial | null,
): UrdfVisualMaterial {
  const runtimeMaterial = resolveRuntimePaintBaseMaterial(mesh);
  // The visualization opacity slider mutates runtime material.opacity. Prefer
  // an authored/base descriptor when available, and only fall back to the
  // runtime value for loader-owned materials that have no canonical opacity.
  const runtimeDescriptor = normalizeAuthoredMaterialEntry({
    name: resolveRuntimeMaterialName(runtimeMaterial, authoredMaterial),
    color: getMaterialColorHex(runtimeMaterial),
    texture: resolveRuntimeTexturePath(runtimeMaterial, authoredMaterial, fallbackMaterial),
    opacity: resolveDescriptorOpacity(authoredMaterial, fallbackMaterial, runtimeMaterial),
    roughness: resolveRuntimeMaterialScalar(
      runtimeMaterial,
      'roughness',
      'originalRoughness',
      normalizeUnitIntervalValue,
    ),
    metalness: resolveRuntimeMaterialScalar(
      runtimeMaterial,
      'metalness',
      'originalMetalness',
      normalizeUnitIntervalValue,
    ),
    emissive: getMaterialColorValue(runtimeMaterial, 'emissive'),
    emissiveIntensity: resolveRuntimeMaterialScalar(
      runtimeMaterial,
      'emissiveIntensity',
      'originalEmissiveIntensity',
      normalizeNonNegativeValue,
    ),
    alphaTest: normalizeUnitIntervalValue(runtimeMaterial?.alphaTest),
    textureRotation: resolveRuntimeTextureRotation(runtimeMaterial),
  });

  return {
    ...cloneVisualMaterialDescriptor(fallbackMaterial),
    ...cloneVisualMaterialDescriptor(authoredMaterial),
    ...(runtimeDescriptor ?? {}),
  };
}

export function hasDistinctRuntimeBaseMaterialsWithinVisual(mesh: THREE.Mesh): boolean {
  let visualRoot: THREE.Object3D = mesh;
  while (visualRoot.parent && !(visualRoot as RuntimeVisualObject).isURDFVisual) {
    visualRoot = visualRoot.parent;
  }

  if (!(visualRoot as RuntimeVisualObject).isURDFVisual) {
    return false;
  }

  const signatures = new Set<string>();
  visualRoot.traverse((child) => {
    const childMesh = child as THREE.Mesh;
    if (!childMesh.isMesh || !childMesh.material) {
      return;
    }

    const material = resolveRuntimePaintBaseMaterial(childMesh);
    if (!material) {
      return;
    }

    const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
    const mapSource = map?.source?.data as
      | { currentSrc?: string; src?: string }
      | string
      | undefined;
    const mapKey =
      typeof mapSource === 'string'
        ? mapSource
        : (mapSource?.currentSrc ?? mapSource?.src ?? map?.name ?? (map ? map.uuid : ''));
    signatures.add(
      JSON.stringify({
        name: material.name || '',
        color: getMaterialColorHex(material) ?? '',
        opacity: normalizeUnitIntervalValue(material.opacity) ?? null,
        roughness: resolveRuntimeMaterialScalar(
          material,
          'roughness',
          'originalRoughness',
          normalizeUnitIntervalValue,
        ),
        metalness: resolveRuntimeMaterialScalar(
          material,
          'metalness',
          'originalMetalness',
          normalizeUnitIntervalValue,
        ),
        emissive: getMaterialColorValue(material, 'emissive') ?? '',
        emissiveIntensity: resolveRuntimeMaterialScalar(
          material,
          'emissiveIntensity',
          'originalEmissiveIntensity',
          normalizeNonNegativeValue,
        ),
        alphaTest: normalizeUnitIntervalValue(material.alphaTest) ?? null,
        map: mapKey,
        textureRotation: map && Number.isFinite(map.rotation) ? Number(map.rotation) : null,
      }),
    );
  });

  return signatures.size > 1;
}

function getGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }

  const positionAttribute = geometry.getAttribute('position');
  return positionAttribute ? Math.floor(positionAttribute.count / 3) : 0;
}

function getTriangleVertexKey(
  geometry: THREE.BufferGeometry,
  vertexIndex: number,
  position: THREE.Vector3,
): string {
  if (geometry.index) {
    return `i:${vertexIndex}`;
  }

  return `p:${position.x.toFixed(6)},${position.y.toFixed(6)},${position.z.toFixed(6)}`;
}

function buildFaceIslandTopology(geometry: THREE.BufferGeometry): FaceIslandTopology {
  const cached = faceIslandTopologyCache.get(geometry);
  if (cached) {
    return cached;
  }

  const triangleCount = getGeometryTriangleCount(geometry);
  const positionAttribute = geometry.getAttribute('position');
  const indexAttribute = geometry.index;
  const normals = Array.from({ length: triangleCount }, () => new THREE.Vector3(0, 0, 1));
  const adjacency = Array.from({ length: triangleCount }, () => [] as number[]);

  if (!positionAttribute || triangleCount === 0) {
    const emptyTopology = { normals, adjacency };
    faceIslandTopologyCache.set(geometry, emptyTopology);
    return emptyTopology;
  }

  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const edgeToFaces = new Map<string, number[]>();

  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    const baseIndex = faceIndex * 3;
    const vertexIndexes = [
      indexAttribute ? indexAttribute.getX(baseIndex) : baseIndex,
      indexAttribute ? indexAttribute.getX(baseIndex + 1) : baseIndex + 1,
      indexAttribute ? indexAttribute.getX(baseIndex + 2) : baseIndex + 2,
    ];

    vertexA.fromBufferAttribute(positionAttribute, vertexIndexes[0]!);
    vertexB.fromBufferAttribute(positionAttribute, vertexIndexes[1]!);
    vertexC.fromBufferAttribute(positionAttribute, vertexIndexes[2]!);

    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    normals[faceIndex].crossVectors(edgeAB, edgeAC).normalize();

    const vertexKeys = [
      getTriangleVertexKey(geometry, vertexIndexes[0]!, vertexA),
      getTriangleVertexKey(geometry, vertexIndexes[1]!, vertexB),
      getTriangleVertexKey(geometry, vertexIndexes[2]!, vertexC),
    ];

    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const leftKey = vertexKeys[edgeIndex]!;
      const rightKey = vertexKeys[(edgeIndex + 1) % 3]!;
      const edgeKey = leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`;
      const faces = edgeToFaces.get(edgeKey) ?? [];
      faces.push(faceIndex);
      edgeToFaces.set(edgeKey, faces);
    }
  }

  edgeToFaces.forEach((faces) => {
    if (faces.length < 2) {
      return;
    }

    for (let index = 0; index < faces.length; index += 1) {
      const faceIndex = faces[index]!;
      const neighbors = adjacency[faceIndex]!;
      for (let neighborIndex = 0; neighborIndex < faces.length; neighborIndex += 1) {
        if (neighborIndex === index) {
          continue;
        }

        const neighborFace = faces[neighborIndex]!;
        if (!neighbors.includes(neighborFace)) {
          neighbors.push(neighborFace);
        }
      }
    }
  });

  const topology = { normals, adjacency };
  faceIslandTopologyCache.set(geometry, topology);
  return topology;
}

export function resolveMeshFaceSelection(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  scope: MeshFaceSelectionScope,
): number[] {
  const triangleCount = getGeometryTriangleCount(geometry);
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangleCount) {
    return [];
  }

  if (scope === 'face') {
    return [faceIndex];
  }

  const topology = buildFaceIslandTopology(geometry);
  const visited = new Set<number>([faceIndex]);
  const queue = [faceIndex];

  while (queue.length > 0) {
    const currentFace = queue.shift()!;
    const currentNormal = topology.normals[currentFace]!;

    topology.adjacency[currentFace]?.forEach((neighborFace) => {
      if (visited.has(neighborFace)) {
        return;
      }

      const neighborNormal = topology.normals[neighborFace]!;
      if (currentNormal.dot(neighborNormal) < FACE_ISLAND_NORMAL_DOT_THRESHOLD) {
        return;
      }

      visited.add(neighborFace);
      queue.push(neighborFace);
    });
  }

  return Array.from(visited).sort((left, right) => left - right);
}

function resolveTextureLoader(manager?: THREE.LoadingManager): THREE.TextureLoader | null {
  return manager ? new THREE.TextureLoader(manager) : new THREE.TextureLoader();
}

interface CreatePaletteMaterialOptions {
  descriptor: UrdfVisualMaterial | undefined;
  slotIndex: number;
  template: THREE.Material;
  textureCache: Map<string, THREE.Texture>;
  textureLoader: THREE.TextureLoader | null;
}

function createPaletteMaterial({
  descriptor,
  slotIndex,
  template,
  textureCache,
  textureLoader,
}: CreatePaletteMaterialOptions): THREE.Material {
  const nextMaterial =
    typeof template.clone === 'function'
      ? template.clone()
      : createMatteMaterial({
          color: '#ffffff',
          preserveExactColor: true,
          name: `paint_slot_${slotIndex}`,
        });
  const parsedColor = parseThreeColorWithOpacity(descriptor?.color);
  const parsedEmissive = parseThreeColorWithOpacity(descriptor?.emissive);
  const texturePath = normalizeMaterialValue(descriptor?.texture);
  const opacityOverride =
    normalizeUnitIntervalValue(descriptor?.opacity) ??
    colorRgbaTupleToOpacity(descriptor?.colorRgba);
  const roughnessOverride = normalizeUnitIntervalValue(descriptor?.roughness);
  const metalnessOverride = normalizeUnitIntervalValue(descriptor?.metalness);
  const emissiveIntensityOverride = normalizeNonNegativeValue(descriptor?.emissiveIntensity);
  const alphaTestOverride = normalizeUnitIntervalValue(descriptor?.alphaTest);
  const textureRotation = Number.isFinite(descriptor?.textureRotation)
    ? Number(descriptor?.textureRotation)
    : 0;
  const effectiveOpacity = opacityOverride ?? parsedColor?.opacity;

  if (descriptor?.name?.trim()) {
    nextMaterial.name = descriptor.name.trim();
  } else if (!nextMaterial.name) {
    nextMaterial.name = `paint_slot_${slotIndex}`;
  }

  if (parsedColor && (nextMaterial as THREE.MeshStandardMaterial).color?.isColor) {
    const colorMaterial = nextMaterial as THREE.MeshStandardMaterial;
    colorMaterial.color.copy(parsedColor.color);
    colorMaterial.toneMapped = false;
    colorMaterial.userData.originalColor = parsedColor.color.clone();
    if (slotIndex > 0) {
      colorMaterial.map = null;
    }
  }

  if (effectiveOpacity != null) {
    nextMaterial.opacity = effectiveOpacity;
    nextMaterial.transparent = nextMaterial.transparent || effectiveOpacity < 1;
  }

  if (roughnessOverride !== undefined && 'roughness' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).roughness = roughnessOverride;
  }

  if (metalnessOverride !== undefined && 'metalness' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).metalness = metalnessOverride;
  }

  if (parsedEmissive && 'emissive' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).emissive.copy(parsedEmissive.color);
  }

  if (emissiveIntensityOverride !== undefined && 'emissiveIntensity' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).emissiveIntensity = emissiveIntensityOverride;
  }

  if (alphaTestOverride !== undefined) {
    nextMaterial.alphaTest = alphaTestOverride;
  }

  if (texturePath && 'map' in nextMaterial && textureLoader) {
    const textureCacheKey = `${texturePath}|rotation=${textureRotation}`;
    const cachedTexture = textureCache.get(textureCacheKey);
    if (cachedTexture) {
      (nextMaterial as THREE.MeshStandardMaterial).map = cachedTexture;
      if (!parsedColor && (nextMaterial as THREE.MeshStandardMaterial).color?.isColor) {
        (nextMaterial as THREE.MeshStandardMaterial).color.set('#ffffff');
      }
    } else {
      const assignmentToken = {};
      nextMaterial.userData.__meshMaterialPaletteTextureAssignment = assignmentToken;
      nextMaterial.addEventListener('dispose', () => {
        if (nextMaterial.userData.__meshMaterialPaletteTextureAssignment === assignmentToken) {
          delete nextMaterial.userData.__meshMaterialPaletteTextureAssignment;
        }
      });
      textureLoader.load(
        texturePath,
        (texture) => {
          if (nextMaterial.userData.__meshMaterialPaletteTextureAssignment !== assignmentToken) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          if (textureRotation !== 0) {
            texture.rotation = textureRotation;
            texture.center.set(0.5, 0.5);
          }
          textureCache.set(textureCacheKey, texture);
          (nextMaterial as THREE.MeshStandardMaterial).map = texture;
          if (!parsedColor && (nextMaterial as THREE.MeshStandardMaterial).color?.isColor) {
            (nextMaterial as THREE.MeshStandardMaterial).color.set('#ffffff');
          }
          delete nextMaterial.userData.__meshMaterialPaletteTextureAssignment;
          nextMaterial.needsUpdate = true;
        },
        undefined,
        (error) => {
          if (nextMaterial.userData.__meshMaterialPaletteTextureAssignment === assignmentToken) {
            delete nextMaterial.userData.__meshMaterialPaletteTextureAssignment;
          }
          console.error('[MeshMaterialGroups] Failed to load palette texture.', {
            texturePath,
            error,
          });
        },
      );
    }
  } else if (slotIndex > 0 && parsedColor && 'map' in nextMaterial) {
    (nextMaterial as THREE.MeshStandardMaterial).map = null;
  }

  // Mesh palette edits are authoritative for this slot material.
  nextMaterial.needsUpdate = true;
  return nextMaterial;
}

export function resolveRuntimeMeshRootWithinVisual(mesh: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D = mesh;

  while (current.parent && !(current.parent as RuntimeVisualObject).isURDFVisual) {
    current = current.parent;
  }

  return current;
}

export function resolveRuntimeMeshMaterialGroupKey(
  mesh: THREE.Object3D,
  root: THREE.Object3D = resolveRuntimeMeshRootWithinVisual(mesh),
): string {
  const tokens: string[] = [];
  let current: THREE.Object3D | null = mesh;

  while (current && current !== root) {
    const parent: THREE.Object3D | null = current.parent;
    if (!parent) {
      break;
    }

    const childIndex = parent.children.indexOf(current);
    const name = current.name?.trim();
    tokens.push(name ? `${childIndex}:${name}` : String(childIndex));
    current = parent;
  }

  return tokens.reverse().join('/') || '0';
}

export function applyVisualMeshMaterialGroupsToObject(
  object: THREE.Object3D,
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'meshMaterialGroups'>,
  options: {
    manager?: THREE.LoadingManager;
  } = {},
): void {
  const authoredMaterials = getGeometryAuthoredMaterials(geometry);
  const textureLoader = resolveTextureLoader(options.manager);
  const textureCache = new Map<string, THREE.Texture>();
  const replacedMaterials = new Set<THREE.Material>();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry) || !mesh.material) {
      return;
    }

    const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, object);
    const meshGroups = getGeometryMeshMaterialGroupsForMesh(geometry, meshKey);
    const currentMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const templateMaterial =
      currentMaterial ??
      createMatteMaterial({
        color: '#ffffff',
        preserveExactColor: true,
        name: 'paint_slot_0',
      });

    if (meshGroups.length === 0) {
      const nextBaseMaterial = createPaletteMaterial({
        descriptor: authoredMaterials[0],
        slotIndex: 0,
        template: templateMaterial,
        textureCache,
        textureLoader,
      });
      const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
      mesh.geometry.clearGroups();
      mesh.material = nextBaseMaterial;
      (Array.isArray(previousMaterial)
        ? previousMaterial
        : previousMaterial
          ? [previousMaterial]
          : []
      ).forEach((material) => replacedMaterials.add(material));
      return;
    }

    const maxMaterialIndex = meshGroups.reduce(
      (currentMax, group) => Math.max(currentMax, group.materialIndex),
      0,
    );
    const nextMaterials = Array.from({ length: maxMaterialIndex + 1 }, (_, materialIndex) =>
      createPaletteMaterial({
        descriptor: authoredMaterials[materialIndex],
        slotIndex: materialIndex,
        template: templateMaterial,
        textureCache,
        textureLoader,
      }),
    );
    const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
    mesh.geometry.clearGroups();
    meshGroups.forEach((group) => {
      mesh.geometry.addGroup(group.start, group.count, group.materialIndex);
    });
    mesh.material = nextMaterials;
    (Array.isArray(previousMaterial)
      ? previousMaterial
      : previousMaterial
        ? [previousMaterial]
        : []
    ).forEach((material) => replacedMaterials.add(material));
  });

  replacedMaterials.forEach((material) => {
    if (isProtectedMaterial(material)) {
      return;
    }

    material.dispose();
  });
}

export function getBufferGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
  return getGeometryTriangleCount(geometry);
}
