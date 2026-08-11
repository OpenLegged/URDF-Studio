/**
 * MuJoCo XML Generator
 * Generates MuJoCo MJCF format from RobotState
 */

import * as THREE from 'three';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  RobotState,
  GeometryType,
  JointType,
  UrdfLink,
} from '@/types';
import { formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import { colorRgbaTupleToHex, type ColorRgbaTuple } from '@/core/utils/color';
import {
  getGeometryAuthoredMaterials,
  collectGeometryTexturePaths,
  computeLinkWorldMatrices,
  getBoxFaceMaterialPalette,
  getVisualGeometryEntries,
  resolveVisualMaterialOverride,
} from '@/core/robot';
import { resolveJointKey, resolveLinkKey } from '@/core/robot/identity';
import {
  buildTextureExportPathOverrides,
  normalizeMeshPathForExport,
  resolveTextureExportPath,
} from '../meshPathUtils';

import {
  formatScalar,
  formatShape,
  formatInertiaScalar,
  vecStr,
  quatStr,
  quatAttr,
  getMujocoJointRange,
  normalizeExportRelativePath,
  hasInvalidMujocoInertia,
  hexToRgba,
  escapeXmlAttribute,
  sanitizeMjcfIdentifier,
  ensureFiniteVector3,
  convertMjcfSite,
  renderMjcfSite,
  meshScaleKey,
  normalizeMeshRefpos,
  normalizeMeshRefquat,
  normalizeMjcfMeshScale,
  buildMeshAssetKey,
  mergeRefquat,
  normalizeHfieldSize,
  buildHfieldAssetKey,
  clampUnitScalar,
  materialToMjcfRgba,
  sanitizeMaterialAssetName,
  normalizeMaterialIdentifier,
  resolveVisualEntryKey,
  resolveVisualVariantKey,
  type MjcfActuatorType,
  type MjcfVisualMeshVariant,
  type MujocoExportOptions,
  type ExportedMjcfSite,
  type MeshAssetEntry,
  type HfieldAssetEntry,
  type VisualMaterialAssetEntry,
  type CubeTextureAssetEntry,
  type VisualVariantMaterialAssetEntry,
} from './mjcfGeneratorUtils';

export type { MjcfActuatorType, MjcfVisualMeshVariant, MujocoExportOptions };

export const generateMujocoXML = (robot: RobotState, options: MujocoExportOptions = {}): string => {
  const FIXED_SPATIAL_TENDON_RANGE_EPSILON = 1e-6;
  const { name, links, joints, rootLinkId } = robot;
  const meshdir = options.meshdir ?? '../meshes/';
  const texturedir =
    options.texturedir ??
    (meshdir.includes('meshes') ? meshdir.replace(/meshes\/?$/, 'textures/') : '../textures/');
  const addFloatBase = options.addFloatBase ?? false;
  const includeActuators = options.includeActuators ?? true;
  const actuatorType = options.actuatorType ?? 'position';
  const includeSceneHelpers = options.includeSceneHelpers ?? false;
  const meshPathOverrides = options.meshPathOverrides;
  const visualMeshVariants = options.visualMeshVariants;
  const texturePathOverrides = buildTextureExportPathOverrides([
    ...Object.values(links).flatMap((link) => [
      ...getVisualGeometryEntries(link).flatMap((entry) =>
        collectGeometryTexturePaths(entry.geometry),
      ),
      ...collectGeometryTexturePaths(link.collision),
      ...(link.collisionBodies || []).flatMap((body) => collectGeometryTexturePaths(body)),
    ]),
    ...Object.values(robot.materials || {})
      .map((material) => material.texture)
      .filter((texture): texture is string => Boolean(texture)),
  ]);

  // Helper to convert hex color to rgba string
  /**
   * Compute a compensating quaternion for a negative mesh scale.
   * A single negative scale component is a reflection, which cannot be
   * represented by a rotation alone.  We approximate it with a 180° rotation
   * around a perpendicular axis, which gives a visually acceptable result for
   * the common case of symmetric meshes (e.g. left/right finger pairs).
   *
   * Returns null when no compensation is needed (all components positive).
   */
  const resolveVisualMeshVariants = (
    meshPath?: string,
  ): readonly MjcfVisualMeshVariant[] | undefined => {
    if (!meshPath) {
      return undefined;
    }

    const normalizedPath = normalizeMeshPathForExport(meshPath);
    if (!normalizedPath) {
      return undefined;
    }

    const variants =
      visualMeshVariants?.get(meshPath || '') || visualMeshVariants?.get(normalizedPath);
    return variants && variants.length > 0 ? variants : undefined;
  };

  const resolveExportMeshPath = (meshPath?: string): string => {
    if (!meshPath) {
      return '';
    }

    const normalizedPath = normalizeMeshPathForExport(meshPath);
    if (!normalizedPath) {
      return '';
    }

    const overridePath =
      meshPathOverrides?.get(meshPath || '') || meshPathOverrides?.get(normalizedPath);
    if (!overridePath) {
      return normalizedPath;
    }

    return normalizeExportRelativePath(overridePath) || overridePath;
  };

  const meshAssets = new Map<string, MeshAssetEntry>();
  const registerMeshAsset = (geometry: UrdfLink['visual']) => {
    const mjcfMesh = geometry.mjcfMesh;
    const normalizedPath = resolveExportMeshPath(mjcfMesh?.file || geometry.meshPath);
    const inlineVertices =
      !mjcfMesh?.file && mjcfMesh?.vertices?.length ? [...mjcfMesh.vertices] : null;
    if (!normalizedPath && !inlineVertices) {
      return;
    }

    const { scale, compensationQuat } = normalizeMjcfMeshScale(mjcfMesh, geometry.dimensions);
    const entryWithoutKey: Omit<MeshAssetEntry, 'key'> = {
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || geometry.assetRef || null,
      vertices: inlineVertices,
      scale,
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: mergeRefquat(normalizeMeshRefquat(mjcfMesh?.refquat), compensationQuat),
    };
    const key = buildMeshAssetKey(entryWithoutKey);
    if (!meshAssets.has(key)) {
      meshAssets.set(key, {
        key,
        ...entryWithoutKey,
      });
    }
  };

  Object.values(links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type !== GeometryType.MESH && entry.geometry.type !== GeometryType.SDF) {
        return;
      }

      const variants = resolveVisualMeshVariants(entry.geometry.meshPath);
      if (variants) {
        variants.forEach((variant) => {
          registerMeshAsset({
            ...entry.geometry,
            meshPath: variant.meshPath,
            mjcfMesh: entry.geometry.mjcfMesh
              ? {
                  ...entry.geometry.mjcfMesh,
                  file: variant.meshPath,
                  vertices: undefined,
                }
              : undefined,
          });
        });
      } else {
        registerMeshAsset(entry.geometry);
      }
    });
    if (
      link.collision &&
      (link.collision.type === GeometryType.MESH || link.collision.type === GeometryType.SDF)
    ) {
      registerMeshAsset(link.collision);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH || body.type === GeometryType.SDF) {
        registerMeshAsset(body);
      }
    });
  });

  const meshAssetNameMap = new Map<string, string>();
  const usedAssetNames = new Set<string>();
  const buildMeshAssetName = (entry: MeshAssetEntry): string => {
    const base =
      (entry.sourceAssetName || entry.path || 'mesh')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'mesh';

    let candidate = base;
    let i = 2;
    while (usedAssetNames.has(candidate)) {
      candidate = `${base}_${i}`;
      i += 1;
    }
    usedAssetNames.add(candidate);
    return candidate;
  };

  Array.from(meshAssets.values()).forEach((entry) => {
    meshAssetNameMap.set(entry.key, buildMeshAssetName(entry));
  });

  const resolveMeshAssetName = (
    meshPath?: string,
    dimensions?: { x: number; y: number; z: number },
    mjcfMesh?: UrdfLink['visual']['mjcfMesh'],
    assetRef?: string,
  ): string | null => {
    const normalizedPath = resolveExportMeshPath(mjcfMesh?.file || meshPath);
    const inlineVertices =
      !mjcfMesh?.file && mjcfMesh?.vertices?.length ? [...mjcfMesh.vertices] : null;
    if (!normalizedPath && !inlineVertices) {
      return null;
    }

    const { scale, compensationQuat } = normalizeMjcfMeshScale(mjcfMesh, dimensions);
    const key = buildMeshAssetKey({
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || assetRef || null,
      vertices: inlineVertices,
      scale,
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: mergeRefquat(normalizeMeshRefquat(mjcfMesh?.refquat), compensationQuat),
    });
    return meshAssetNameMap.get(key) || null;
  };

  const hfieldAssets = new Map<string, HfieldAssetEntry>();
  const hfieldAssetNameMap = new Map<string, string>();
  const usedHfieldAssetNames = new Set<string>();
  const buildHfieldAssetName = (link: UrdfLink, geometry: UrdfLink['visual']): string => {
    const base =
      (geometry.assetRef || geometry.mjcfHfield?.name || `${link.name || link.id}_hfield`)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'hfield';

    let candidate = base;
    let suffix = 2;
    while (usedHfieldAssetNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedHfieldAssetNames.add(candidate);
    return candidate;
  };

  const registerHfieldAsset = (link: UrdfLink, geometry: UrdfLink['visual']) => {
    if (geometry.type !== GeometryType.HFIELD) {
      return;
    }

    const key = buildHfieldAssetKey(geometry);
    const size = normalizeHfieldSize(geometry);
    if (!key || !size || hfieldAssets.has(key)) {
      return;
    }

    const assetName = buildHfieldAssetName(link, geometry);
    hfieldAssets.set(key, {
      key,
      name: assetName,
      file: geometry.mjcfHfield?.file,
      contentType: geometry.mjcfHfield?.contentType,
      nrow: geometry.mjcfHfield?.nrow,
      ncol: geometry.mjcfHfield?.ncol,
      size,
      elevation: geometry.mjcfHfield?.elevation ? [...geometry.mjcfHfield.elevation] : undefined,
    });
    hfieldAssetNameMap.set(key, assetName);
  };

  Object.values(links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      registerHfieldAsset(link, entry.geometry);
    });
    registerHfieldAsset(link, link.collision);
    (link.collisionBodies || []).forEach((body) => {
      registerHfieldAsset(link, body);
    });
  });

  const resolveHfieldAssetName = (geometry: UrdfLink['visual']): string | null => {
    const key = buildHfieldAssetKey(geometry);
    if (!key) {
      return null;
    }

    return hfieldAssetNameMap.get(key) || null;
  };

  const resolveLinkMaterialPbr = (
    link: UrdfLink,
  ): Pick<VisualMaterialAssetEntry, 'specular' | 'shininess' | 'reflectance' | 'emission'> => {
    const material = robot.materials?.[link.id] || robot.materials?.[link.name];
    const usdMaterial = material?.usdMaterial;
    if (!usdMaterial || typeof usdMaterial !== 'object') {
      return {
        specular: 0,
      };
    }

    const roughness = clampUnitScalar(usdMaterial.roughness);
    const reflectance = clampUnitScalar(usdMaterial.metalness);
    const emissive =
      usdMaterial.emissive && typeof usdMaterial.emissive.length === 'number'
        ? Array.from(usdMaterial.emissive)
            .slice(0, 3)
            .map((channel) => Number(channel))
            .filter((channel) => Number.isFinite(channel))
        : [];
    const emissivePeak =
      emissive.length >= 3 ? Math.max(emissive[0] || 0, emissive[1] || 0, emissive[2] || 0) : null;
    const emissiveIntensity = Number.isFinite(usdMaterial.emissiveIntensity)
      ? Math.max(0, Number(usdMaterial.emissiveIntensity))
      : null;
    const emission =
      usdMaterial.emissiveEnabled === false
        ? undefined
        : clampUnitScalar(
            emissivePeak !== null ? emissivePeak * (emissiveIntensity ?? 1) : emissiveIntensity,
          );

    return {
      specular: 0,
      ...(roughness !== undefined ? { shininess: clampUnitScalar(1 - roughness) } : {}),
      ...(reflectance !== undefined ? { reflectance } : {}),
      ...(emission !== undefined ? { emission } : {}),
    };
  };

  const resolveVisualMaterialState = (
    link: UrdfLink,
    visual: UrdfLink['visual'],
    options: { isPrimaryVisual: boolean },
  ): {
    color: string;
    colorRgba?: ColorRgbaTuple;
    opacity?: number;
    texture?: string;
    source: 'authored' | 'legacy-link' | 'inline';
  } => {
    const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
      isPrimaryVisual: options.isPrimaryVisual,
    });

    if (resolvedMaterial.source === 'authored') {
      return {
        color:
          resolvedMaterial.color ||
          colorRgbaTupleToHex(resolvedMaterial.colorRgba) ||
          (resolvedMaterial.texture ? '#ffffff' : undefined) ||
          visual.color ||
          '#808080',
        ...(resolvedMaterial.colorRgba ? { colorRgba: resolvedMaterial.colorRgba } : {}),
        ...(Number.isFinite(resolvedMaterial.opacity)
          ? { opacity: Number(resolvedMaterial.opacity) }
          : {}),
        texture: resolvedMaterial.texture,
        source: 'authored',
      };
    }

    if (resolvedMaterial.source === 'legacy-link') {
      return {
        color:
          resolvedMaterial.color ||
          colorRgbaTupleToHex(resolvedMaterial.colorRgba) ||
          (resolvedMaterial.texture ? '#ffffff' : undefined) ||
          visual.color ||
          '#808080',
        ...(resolvedMaterial.colorRgba ? { colorRgba: resolvedMaterial.colorRgba } : {}),
        ...(Number.isFinite(resolvedMaterial.opacity)
          ? { opacity: Number(resolvedMaterial.opacity) }
          : {}),
        texture: resolvedMaterial.texture,
        source: 'legacy-link',
      };
    }

    return {
      color: visual.color || '#808080',
      source: 'inline',
    };
  };

  const resolveVisualVariantMaterialState = (
    visual: UrdfLink['visual'],
    variant: MjcfVisualMeshVariant,
    fallback: Pick<
      ReturnType<typeof resolveVisualMaterialState>,
      'color' | 'colorRgba' | 'opacity' | 'texture'
    >,
  ): {
    color: string;
    colorRgba?: ColorRgbaTuple;
    opacity?: number;
    texture?: string;
  } => {
    const authoredMaterials = getGeometryAuthoredMaterials(visual);
    const fallbackState = {
      color: variant.color || fallback.color,
      ...(!variant.color && fallback.colorRgba ? { colorRgba: fallback.colorRgba } : {}),
      ...(!variant.color && Number.isFinite(fallback.opacity)
        ? { opacity: Number(fallback.opacity) }
        : {}),
      ...(fallback.texture ? { texture: fallback.texture } : {}),
    };

    if (authoredMaterials.length === 0) {
      return fallbackState;
    }

    const normalizedVariantMaterialName = normalizeMaterialIdentifier(variant.sourceMaterialName);
    if (normalizedVariantMaterialName) {
      const matchedMaterial = authoredMaterials.find((material) => {
        const normalizedMaterialName = normalizeMaterialIdentifier(material.name);
        return normalizedMaterialName === normalizedVariantMaterialName;
      });

      if (matchedMaterial) {
        return {
          color:
            variant.color ||
            matchedMaterial.color ||
            colorRgbaTupleToHex(matchedMaterial.colorRgba) ||
            (matchedMaterial.texture ? '#ffffff' : undefined) ||
            fallback.color,
          ...(!variant.color && matchedMaterial.colorRgba
            ? { colorRgba: matchedMaterial.colorRgba }
            : {}),
          ...(!variant.color && Number.isFinite(matchedMaterial.opacity)
            ? { opacity: Number(matchedMaterial.opacity) }
            : {}),
          ...(matchedMaterial.texture ? { texture: matchedMaterial.texture } : {}),
        };
      }

      return fallbackState;
    }

    if (authoredMaterials.length === 1) {
      const [singleMaterial] = authoredMaterials;
      if (singleMaterial) {
        return {
          color:
            variant.color ||
            singleMaterial.color ||
            colorRgbaTupleToHex(singleMaterial.colorRgba) ||
            (singleMaterial.texture ? '#ffffff' : undefined) ||
            fallback.color,
          ...(!variant.color && singleMaterial.colorRgba
            ? { colorRgba: singleMaterial.colorRgba }
            : {}),
          ...(!variant.color && Number.isFinite(singleMaterial.opacity)
            ? { opacity: Number(singleMaterial.opacity) }
            : {}),
          ...(singleMaterial.texture ? { texture: singleMaterial.texture } : {}),
        };
      }
    }

    return fallbackState;
  };

  const visualMaterialAssets = new Map<string, VisualMaterialAssetEntry>();
  const visualMaterialNameMap = new Map<string, string>();
  const visualVariantMaterialAssets = new Map<string, VisualVariantMaterialAssetEntry>();
  const visualVariantMaterialNameMap = new Map<string, string>();
  const visualInlineColorMap = new Map<string, string>();
  const cubeTextureAssets = new Map<string, CubeTextureAssetEntry>();
  const cubeTextureAssetNameMap = new Map<string, string>();
  const usedMaterialNames = new Set<string>();
  const usedCubeTextureNames = new Set<string>();
  const buildVisualMaterialAssetName = (link: UrdfLink, objectIndex: number): string => {
    const base = sanitizeMaterialAssetName(
      objectIndex === 0
        ? `${link.name || link.id}_mat`
        : `${link.name || link.id}_mat_${objectIndex + 1}`,
    );
    let candidate = base;
    let suffix = 2;
    while (usedMaterialNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedMaterialNames.add(candidate);
    return candidate;
  };

  const buildVisualVariantMaterialAssetName = (
    link: UrdfLink,
    objectIndex: number,
    variantIndex: number,
  ): string => {
    const suffix =
      objectIndex === 0 ? `${variantIndex + 1}` : `${objectIndex + 1}_${variantIndex + 1}`;
    const base = sanitizeMaterialAssetName(`${link.name || link.id}_mat_${suffix}`);
    let candidate = base;
    let duplicateIndex = 2;
    while (usedMaterialNames.has(candidate)) {
      candidate = `${base}_${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedMaterialNames.add(candidate);
    return candidate;
  };

  const buildCubeTextureAssetKey = (facePaths: string[]): string => JSON.stringify(facePaths);

  const buildCubeTextureAssetName = (link: UrdfLink, objectIndex: number): string => {
    const base = sanitizeMaterialAssetName(
      objectIndex === 0
        ? `${link.name || link.id}_cube_tex`
        : `${link.name || link.id}_cube_tex_${objectIndex + 1}`,
    );
    let candidate = base;
    let suffix = 2;
    while (usedCubeTextureNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedCubeTextureNames.add(candidate);
    return candidate;
  };

  Object.entries(links).forEach(([linkId, link]) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.NONE) {
        return;
      }

      const visualKey = resolveVisualEntryKey(linkId, entry.objectIndex);
      const materialState = resolveVisualMaterialState(link, entry.geometry, {
        isPrimaryVisual: entry.bodyIndex === null,
      });
      visualInlineColorMap.set(visualKey, materialState.color);
      const boxFacePalette = getBoxFaceMaterialPalette(entry.geometry);

      const variants =
        entry.geometry.type === GeometryType.MESH
          ? resolveVisualMeshVariants(entry.geometry.meshPath)
          : undefined;
      if (variants) {
        variants.forEach((variant, variantIndex) => {
          const key = resolveVisualVariantKey(visualKey, variantIndex);
          const materialName = buildVisualVariantMaterialAssetName(
            link,
            entry.objectIndex,
            variantIndex,
          );
          const variantMaterialState = resolveVisualVariantMaterialState(
            entry.geometry,
            variant,
            materialState,
          );
          visualVariantMaterialAssets.set(key, {
            key,
            linkId,
            objectIndex: entry.objectIndex,
            color: variantMaterialState.color,
            ...(variantMaterialState.colorRgba
              ? { colorRgba: variantMaterialState.colorRgba }
              : {}),
            ...(Number.isFinite(variantMaterialState.opacity)
              ? { opacity: Number(variantMaterialState.opacity) }
              : {}),
            texture: variantMaterialState.texture,
            specular: 0,
          });
          visualVariantMaterialNameMap.set(key, materialName);
        });
        return;
      }

      const pbr = entry.bodyIndex === null ? resolveLinkMaterialPbr(link) : {};
      const cubeTextureFacePaths = boxFacePalette.map((faceEntry) =>
        resolveTextureExportPath(faceEntry.material.texture || '', texturePathOverrides),
      );
      const canExportCubeTexture =
        boxFacePalette.length > 0 && cubeTextureFacePaths.every((path) => Boolean(path));
      let cubeTextureKey: string | undefined;
      if (canExportCubeTexture) {
        cubeTextureKey = buildCubeTextureAssetKey(cubeTextureFacePaths);
        if (!cubeTextureAssets.has(cubeTextureKey)) {
          cubeTextureAssets.set(cubeTextureKey, {
            key: cubeTextureKey,
            owningLinkId: linkId,
            owningObjectIndex: entry.objectIndex,
            fileright: cubeTextureFacePaths[0]!,
            fileleft: cubeTextureFacePaths[1]!,
            fileup: cubeTextureFacePaths[2]!,
            filedown: cubeTextureFacePaths[3]!,
            filefront: cubeTextureFacePaths[4]!,
            fileback: cubeTextureFacePaths[5]!,
          });
          cubeTextureAssetNameMap.set(
            cubeTextureKey,
            buildCubeTextureAssetName(link, entry.objectIndex),
          );
        }
      }

      const shouldCreateMaterialAsset =
        Boolean(cubeTextureKey) ||
        materialState.source !== 'inline' ||
        Object.values(pbr).some((value) => Number.isFinite(value as number));
      if (!shouldCreateMaterialAsset) {
        return;
      }

      const materialName = buildVisualMaterialAssetName(link, entry.objectIndex);
      visualMaterialAssets.set(visualKey, {
        visualKey,
        linkId,
        objectIndex: entry.objectIndex,
        color: cubeTextureKey ? '#ffffff' : materialState.color,
        ...(!cubeTextureKey && materialState.colorRgba
          ? { colorRgba: materialState.colorRgba }
          : {}),
        ...(!cubeTextureKey && Number.isFinite(materialState.opacity)
          ? { opacity: Number(materialState.opacity) }
          : {}),
        texture: cubeTextureKey ? undefined : materialState.texture,
        ...(cubeTextureKey ? { cubeTextureKey } : {}),
        ...pbr,
      });
      visualMaterialNameMap.set(visualKey, materialName);
    });
  });

  interface TextureAssetEntry {
    path: string;
    owningLinkId: string;
    owningObjectIndex: number;
  }

  const textureAssets = new Map<string, TextureAssetEntry>();
  const registerTextureAsset = (linkId: string, objectIndex: number, texturePath?: string) => {
    const normalizedPath = resolveTextureExportPath(texturePath || '', texturePathOverrides);
    if (!normalizedPath) {
      return;
    }

    if (!textureAssets.has(normalizedPath)) {
      textureAssets.set(normalizedPath, {
        path: normalizedPath,
        owningLinkId: linkId,
        owningObjectIndex: objectIndex,
      });
    }
  };

  visualMaterialAssets.forEach(({ linkId, objectIndex, texture }) => {
    registerTextureAsset(linkId, objectIndex, texture);
  });
  visualVariantMaterialAssets.forEach(({ linkId, objectIndex, texture }) => {
    registerTextureAsset(linkId, objectIndex, texture);
  });

  const textureAssetNameMap = new Map<string, string>();
  const usedTextureNames = new Set<string>();
  const buildTextureAssetName = (link: UrdfLink, objectIndex: number): string => {
    const base = sanitizeMaterialAssetName(
      objectIndex === 0
        ? `${link.name || link.id}_tex`
        : `${link.name || link.id}_tex_${objectIndex + 1}`,
    );
    let candidate = base;
    let suffix = 2;
    while (usedTextureNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedTextureNames.add(candidate);
    return candidate;
  };

  Array.from(textureAssets.values()).forEach(({ path, owningLinkId, owningObjectIndex }) => {
    const owningLink = links[owningLinkId];
    textureAssetNameMap.set(
      path,
      buildTextureAssetName(
        owningLink || {
          ...DEFAULT_LINK,
          id: owningLinkId,
          name: owningLinkId,
        },
        owningObjectIndex,
      ),
    );
  });

  const resolveTextureAssetName = (texturePath?: string): string | null => {
    const normalizedPath = resolveTextureExportPath(texturePath || '', texturePathOverrides);
    if (!normalizedPath) {
      return null;
    }

    return textureAssetNameMap.get(normalizedPath) || null;
  };

  const resolveCubeTextureAssetName = (cubeTextureKey?: string): string | null => {
    if (!cubeTextureKey) {
      return null;
    }

    return cubeTextureAssetNameMap.get(cubeTextureKey) || null;
  };

  const hasGeometry = (link: UrdfLink | undefined): boolean => {
    if (!link) return false;

    const hasVisual = getVisualGeometryEntries(link).length > 0;
    const hasCollision = link.collision.type !== GeometryType.NONE;
    const hasExtraCollisions = (link.collisionBodies || []).some(
      (body) => body.type !== GeometryType.NONE,
    );

    return hasVisual || hasCollision || hasExtraCollisions;
  };

  const isSyntheticWorldRoot = (linkId: string): boolean => {
    const link = links[linkId];
    if (!link) return false;

    const normalizedName = (link.name || '').trim().toLowerCase();
    if (normalizedName !== 'world') return false;

    const hasMass = (link.inertial?.mass || 0) > 0;
    return !hasMass && !hasGeometry(link);
  };

  const needsBalanceInertia = Object.values(links).some((link) => hasInvalidMujocoInertia(link));

  const exportedSiteNames = new Set<string>();
  Object.values(links).forEach((link) => {
    (link.mjcfSites || []).forEach((site) => {
      exportedSiteNames.add(site.sourceName || site.name);
    });
  });

  const buildUniqueSiteName = (base: string): string => {
    const sanitizedBase = sanitizeMjcfIdentifier(base, 'site');
    let candidate = sanitizedBase;
    let suffix = 2;
    while (exportedSiteNames.has(candidate)) {
      candidate = `${sanitizedBase}_${suffix}`;
      suffix += 1;
    }
    exportedSiteNames.add(candidate);
    return candidate;
  };

  const generatedSitesByLink = new Map<string, ExportedMjcfSite[]>();
  const registerGeneratedSite = (
    linkId: string,
    constraintId: string,
    suffix: 'a' | 'b',
    pos: { x: number; y: number; z: number },
  ): ExportedMjcfSite => {
    ensureFiniteVector3(
      pos,
      `[MJCF export] Closed-loop constraint "${constraintId}" generated site "${suffix}"`,
    );
    const site: ExportedMjcfSite = {
      name: buildUniqueSiteName(`${constraintId}_${suffix}_site`),
      type: 'sphere',
      pos,
      size: [0.001],
      rgba: [0, 0, 0, 0],
      group: 5,
    };
    const existingSites = generatedSitesByLink.get(linkId) ?? [];
    existingSites.push(site);
    generatedSitesByLink.set(linkId, existingSites);
    return site;
  };

  const equalityLines: string[] = [];
  const tendonBlocks: string[] = [];
  const linkWorldMatrices = robot.closedLoopConstraints?.length
    ? computeLinkWorldMatrices(robot)
    : undefined;

  Object.values(joints).forEach((joint) => {
    if (!joint.mimic?.joint) {
      return;
    }

    const targetJointId = resolveJointKey(joints, joint.mimic.joint);
    if (!targetJointId) {
      throw new Error(
        `[MJCF export] Mimic joint "${joint.name}" references missing joint "${joint.mimic.joint}".`,
      );
    }

    const targetJoint = joints[targetJointId];
    if (!targetJoint) {
      throw new Error(
        `[MJCF export] Mimic joint "${joint.name}" references missing joint "${joint.mimic.joint}".`,
      );
    }

    const multiplier = joint.mimic.multiplier === undefined ? 1 : Number(joint.mimic.multiplier);
    const offset = joint.mimic.offset === undefined ? 0 : Number(joint.mimic.offset);
    if (!Number.isFinite(multiplier) || !Number.isFinite(offset)) {
      throw new Error(
        `[MJCF export] Mimic joint "${joint.name}" must use finite multiplier and offset values.`,
      );
    }

    equalityLines.push(
      `    <joint name="${escapeXmlAttribute(`${joint.name}_mimic`)}" joint1="${escapeXmlAttribute(joint.name)}" joint2="${escapeXmlAttribute(targetJoint.name)}" polycoef="${formatScalar(offset)} ${formatScalar(multiplier)} 0 0 0" />`,
    );
  });

  (robot.closedLoopConstraints || []).forEach((constraint) => {
    const linkAId = resolveLinkKey(links, constraint.linkAId);
    const linkBId = resolveLinkKey(links, constraint.linkBId);
    if (!linkAId || !linkBId) {
      throw new Error(
        `[MJCF export] Closed-loop constraint "${constraint.id}" references missing link "${!linkAId ? constraint.linkAId : constraint.linkBId}".`,
      );
    }

    const linkA = links[linkAId];
    const linkB = links[linkBId];
    const linkAMatrix = linkWorldMatrices?.[linkAId];
    if (!linkA || !linkB || !linkAMatrix) {
      throw new Error(
        `[MJCF export] Closed-loop constraint "${constraint.id}" could not resolve exported link transforms.`,
      );
    }

    ensureFiniteVector3(
      constraint.anchorLocalA,
      `[MJCF export] Closed-loop constraint "${constraint.id}" anchor A`,
    );
    ensureFiniteVector3(
      constraint.anchorLocalB,
      `[MJCF export] Closed-loop constraint "${constraint.id}" anchor B`,
    );

    const anchorWorld = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkAMatrix);
    ensureFiniteVector3(
      {
        x: anchorWorld.x,
        y: anchorWorld.y,
        z: anchorWorld.z,
      },
      `[MJCF export] Closed-loop constraint "${constraint.id}" anchor world`,
    );

    if (constraint.type === 'connect') {
      equalityLines.push(
        `    <connect name="${escapeXmlAttribute(constraint.id)}" body1="${escapeXmlAttribute(linkA.name)}" body2="${escapeXmlAttribute(linkB.name)}" anchor="${vecStr(constraint.anchorLocalA)}" />`,
      );
      return;
    }

    if (!Number.isFinite(constraint.restDistance)) {
      throw new Error(
        `[MJCF export] Distance closed-loop constraint "${constraint.id}" has a non-finite rest distance.`,
      );
    }
    if (constraint.restDistance < 0) {
      throw new Error(
        `[MJCF export] Distance closed-loop constraint "${constraint.id}" must use a non-negative rest distance.`,
      );
    }

    const siteA = registerGeneratedSite(linkAId, constraint.id, 'a', constraint.anchorLocalA);
    const siteB = registerGeneratedSite(linkBId, constraint.id, 'b', constraint.anchorLocalB);
    const minDistance = formatScalar(constraint.restDistance);
    const maxDistance = formatScalar(constraint.restDistance + FIXED_SPATIAL_TENDON_RANGE_EPSILON);
    tendonBlocks.push(
      [
        `    <spatial name="${escapeXmlAttribute(constraint.id)}" limited="true" range="${minDistance} ${maxDistance}">`,
        `      <site site="${escapeXmlAttribute(siteA.name)}" />`,
        `      <site site="${escapeXmlAttribute(siteB.name)}" />`,
        `    </spatial>`,
      ].join('\n'),
    );
  });

  const getExportedSites = (linkId: string, link: UrdfLink): ExportedMjcfSite[] => [
    ...(link.mjcfSites || []).map(convertMjcfSite),
    ...(generatedSitesByLink.get(linkId) || []),
  ];

  let xml = `<mujoco model="${name}">\n`;
  const compilerAttrs = [`angle="radian"`, `meshdir="${meshdir}"`];
  if (textureAssets.size > 0) {
    compilerAttrs.push(`texturedir="${texturedir}"`);
  }
  if (needsBalanceInertia) {
    compilerAttrs.push(`balanceinertia="true"`);
  }
  xml += `  <compiler ${compilerAttrs.join(' ')} />\n`;

  // Assets Section
  xml += `  <asset>\n`;
  meshAssets.forEach(({ key, path, vertices, scale, refpos, refquat }) => {
    const meshName = meshAssetNameMap.get(key) || 'mesh';
    const scaleAttr = meshScaleKey(scale) === '1 1 1' ? '' : ` scale="${meshScaleKey(scale)}"`;
    const refposAttr = refpos
      ? ` refpos="${refpos.map((value) => formatScalar(value)).join(' ')}"`
      : '';
    const refquatAttr = refquat
      ? ` refquat="${refquat.map((value) => formatScalar(value)).join(' ')}"`
      : '';
    if (path) {
      xml += `    <mesh name="${meshName}" file="${path}"${scaleAttr}${refposAttr}${refquatAttr} />\n`;
      return;
    }

    if (vertices?.length) {
      xml += `    <mesh name="${meshName}" vertex="${vertices.map((value) => formatShape(value)).join(' ')}"${scaleAttr}${refposAttr}${refquatAttr} />\n`;
    }
  });
  hfieldAssets.forEach(({ name: hfieldName, file, contentType, nrow, ncol, size, elevation }) => {
    const attrs = [
      `name="${hfieldName}"`,
      file ? `file="${file}"` : '',
      contentType ? `content_type="${contentType}"` : '',
      !file && Number.isFinite(nrow) ? `nrow="${nrow}"` : '',
      !file && Number.isFinite(ncol) ? `ncol="${ncol}"` : '',
      `size="${formatShape(size[0])} ${formatShape(size[1])} ${formatShape(size[2])} ${formatShape(size[3])}"`,
      !file && elevation && elevation.length > 0
        ? `elevation="${elevation.map((value) => formatShape(value)).join(' ')}"`
        : '',
    ].filter(Boolean);
    xml += `    <hfield ${attrs.join(' ')} />\n`;
  });
  textureAssets.forEach(({ path }) => {
    const textureName = textureAssetNameMap.get(path);
    if (!textureName) {
      return;
    }
    xml += `    <texture name="${textureName}" type="2d" file="${path}" />\n`;
  });
  cubeTextureAssets.forEach((cubeTextureAsset) => {
    const textureName = cubeTextureAssetNameMap.get(cubeTextureAsset.key);
    if (!textureName) {
      return;
    }

    xml += `    <texture name="${textureName}" type="cube" fileright="${cubeTextureAsset.fileright}" fileleft="${cubeTextureAsset.fileleft}" fileup="${cubeTextureAsset.fileup}" filedown="${cubeTextureAsset.filedown}" filefront="${cubeTextureAsset.filefront}" fileback="${cubeTextureAsset.fileback}" />\n`;
  });
  visualMaterialAssets.forEach(
    ({
      visualKey,
      color,
      colorRgba,
      opacity,
      texture,
      cubeTextureKey,
      specular,
      shininess,
      reflectance,
      emission,
    }) => {
      const materialName = visualMaterialNameMap.get(visualKey);
      if (!materialName) {
        return;
      }
      const textureAssetName = resolveTextureAssetName(texture);
      const cubeTextureAssetName = resolveCubeTextureAssetName(cubeTextureKey);
      const pbrAttrs = [
        Number.isFinite(specular) ? ` specular="${formatNumberWithMaxDecimals(specular!, 4)}"` : '',
        Number.isFinite(shininess)
          ? ` shininess="${formatNumberWithMaxDecimals(shininess!, 4)}"`
          : '',
        Number.isFinite(reflectance)
          ? ` reflectance="${formatNumberWithMaxDecimals(reflectance!, 4)}"`
          : '',
        Number.isFinite(emission) ? ` emission="${formatNumberWithMaxDecimals(emission!, 4)}"` : '',
      ].join('');
      const rgba = materialToMjcfRgba(color, colorRgba, opacity);
      xml += cubeTextureAssetName
        ? `    <material name="${materialName}" rgba="${rgba}" texture="${cubeTextureAssetName}"${pbrAttrs} />\n`
        : textureAssetName
          ? `    <material name="${materialName}" rgba="${rgba}" texture="${textureAssetName}"${pbrAttrs} />\n`
          : `    <material name="${materialName}" rgba="${rgba}"${pbrAttrs} />\n`;
    },
  );
  visualVariantMaterialAssets.forEach(({ key, color, colorRgba, opacity, texture, specular }) => {
    const materialName = visualVariantMaterialNameMap.get(key);
    if (!materialName) {
      return;
    }

    const textureAssetName = resolveTextureAssetName(texture);
    const specularAttr = Number.isFinite(specular)
      ? ` specular="${formatNumberWithMaxDecimals(specular!, 4)}"`
      : '';
    const rgba = materialToMjcfRgba(color, colorRgba, opacity);
    xml += textureAssetName
      ? `    <material name="${materialName}" rgba="${rgba}" texture="${textureAssetName}"${specularAttr} />\n`
      : `    <material name="${materialName}" rgba="${rgba}"${specularAttr} />\n`;
  });
  xml += `  </asset>\n\n`;

  xml += `  <worldbody>\n`;
  if (includeSceneHelpers) {
    xml += `    <light pos="0 0 10" dir="0 0 -1" diffuse="1 1 1"/>\n`;
    xml += `    <geom type="plane" size="5 5 0.1" rgba=".9 .9 .9 1"/>\n`;
  }
  const syntheticWorldRoot = isSyntheticWorldRoot(rootLinkId) ? links[rootLinkId] : undefined;
  if (syntheticWorldRoot) {
    getExportedSites(rootLinkId, syntheticWorldRoot).forEach((site) => {
      xml += renderMjcfSite(site, '    ');
    });
  }

  // Recursive Body Builder
  const buildBody = (linkId: string, indent: string, path = new Set<string>()) => {
    const link = links[linkId];
    if (!link) return '';

    if (path.has(linkId)) {
      console.error(`[MJCFGenerator] Skipping cyclic link reference at "${linkId}"`);
      return '';
    }

    const nextPath = new Set(path);
    nextPath.add(linkId);

    // Find the joint that connects to this link (if not root)
    const parentJoint = Object.values(joints).find((j) => j.childLinkId === linkId);

    // Body transforms should preserve the imported chain exactly. Root bodies
    // stay at the world origin unless the source state encodes an explicit
    // parent joint offset.
    let pos = '0 0 0';
    let bodyRotation: { r: number; p: number; y: number } | undefined;

    if (parentJoint) {
      pos = vecStr(parentJoint.origin.xyz);
      bodyRotation = parentJoint.origin.rpy;
    }

    const bodyName =
      (link.name || link.id).trim().toLowerCase() === 'world' ? 'world_link' : link.name;
    let bodyXml = `${indent}<body name="${escapeXmlAttribute(bodyName)}" pos="${pos}"${quatAttr(bodyRotation)}>\n`;

    // 1. Joint Definition (inside the body it belongs to)
    if (parentJoint && parentJoint.type !== JointType.FIXED) {
      if (parentJoint.type === JointType.FLOATING) {
        bodyXml += `${indent}  <freejoint name="${parentJoint.name}"/>\n`;
      } else if (parentJoint.type === JointType.PLANAR) {
        console.warn(
          `[MJCF export] Joint "${parentJoint.name}" uses unsupported planar type, degrading to freejoint.`,
        );
        bodyXml += `${indent}  <freejoint name="${parentJoint.name}"/>\n`;
      } else {
        let jType = 'hinge';
        if (parentJoint.type === JointType.PRISMATIC) {
          jType = 'slide';
        } else if (parentJoint.type === JointType.BALL) {
          jType = 'ball';
        }

        const jointRange =
          !parentJoint.mimic &&
          parentJoint.type !== JointType.CONTINUOUS &&
          parentJoint.type !== JointType.BALL
            ? getMujocoJointRange(parentJoint)
            : null;
        const shouldEmitRange = Boolean(jointRange);
        const limitStr = jointRange
          ? ` range="${formatScalar(jointRange[0])} ${formatScalar(jointRange[1])}"`
          : '';
        const limitedStr = shouldEmitRange ? ' limited="true"' : '';
        const axisStr =
          parentJoint.type === JointType.BALL
            ? ''
            : ` axis="${vecStr(parentJoint.axis ?? DEFAULT_JOINT.axis)}"`;
        const supportsScalarReference =
          parentJoint.type === JointType.REVOLUTE ||
          parentJoint.type === JointType.CONTINUOUS ||
          parentJoint.type === JointType.PRISMATIC;
        const referencePosition = Number.isFinite(parentJoint.referencePosition)
          ? parentJoint.referencePosition
          : undefined;
        const referencePositionStr =
          supportsScalarReference && referencePosition !== undefined
            ? ` ref="${formatScalar(referencePosition)}"`
            : '';
        const armature = parentJoint.hardware?.armature;
        const armatureStr =
          Number.isFinite(armature) && Math.abs(armature as number) > 1e-12
            ? ` armature="${formatScalar(armature as number)}"`
            : '';

        bodyXml += `${indent}  <joint name="${parentJoint.name}" type="${jType}"${axisStr}${limitedStr}${limitStr}${referencePositionStr}${armatureStr} damping="${formatScalar(parentJoint.dynamics.damping)}" frictionloss="${formatScalar(parentJoint.dynamics.friction)}"${Number.isFinite(parentJoint.dynamics.stiffness) && (parentJoint.dynamics.stiffness ?? 0) !== 0 ? ` stiffness="${formatScalar(parentJoint.dynamics.stiffness!)}"` : ''}/>\n`;
      }
    }

    // 2. Inertial
    // Preserve URDF semantics: links may legitimately omit inertial data.
    // In that case, do not synthesize arbitrary mass/inertia on MJCF export.
    if (link.inertial) {
      const inertialOrigin = link.inertial.origin || {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      };
      const inertialRPY = inertialOrigin.rpy || { r: 0, p: 0, y: 0 };
      const hasInertialRotation =
        Math.abs(inertialRPY.r) > 1e-9 ||
        Math.abs(inertialRPY.p) > 1e-9 ||
        Math.abs(inertialRPY.y) > 1e-9;
      const inertia = link.inertial.inertia;
      const hasOffDiagonalInertia =
        Math.abs(inertia.ixy) > 1e-12 ||
        Math.abs(inertia.ixz) > 1e-12 ||
        Math.abs(inertia.iyz) > 1e-12;
      const inertialTensorAttr = hasOffDiagonalInertia
        ? `fullinertia="${formatInertiaScalar(inertia.ixx)} ${formatInertiaScalar(inertia.iyy)} ${formatInertiaScalar(inertia.izz)} ${formatInertiaScalar(inertia.ixy)} ${formatInertiaScalar(inertia.ixz)} ${formatInertiaScalar(inertia.iyz)}"`
        : `diaginertia="${formatInertiaScalar(inertia.ixx)} ${formatInertiaScalar(inertia.iyy)} ${formatInertiaScalar(inertia.izz)}"`;
      const inertialQuatAttr = hasInertialRotation ? ` quat="${quatStr(inertialRPY)}"` : '';
      bodyXml += `${indent}  <inertial pos="${vecStr(inertialOrigin.xyz || { x: 0, y: 0, z: 0 })}" mass="${formatScalar(link.inertial.mass)}"${inertialQuatAttr} ${inertialTensorAttr}/>\n`;
    }

    const exportedSites = getExportedSites(linkId, link);
    exportedSites.forEach((site) => {
      bodyXml += renderMjcfSite(site, `${indent}  `);
    });

    // 3. Visual Geom
    // Offset visual geom by its origin
    getVisualGeometryEntries(link).forEach((visualEntry) => {
      const v = visualEntry.geometry;
      const visualKey = resolveVisualEntryKey(linkId, visualEntry.objectIndex);
      const defaultVisualRgba = hexToRgba(
        visualInlineColorMap.get(visualKey) || v.color || '#808080',
      );
      let vPos = '0 0 0';
      if (v.origin) {
        vPos = vecStr(v.origin.xyz);
      }

      const meshVariants =
        v.type === GeometryType.MESH ? resolveVisualMeshVariants(v.meshPath) : undefined;

      const buildVisualGeomAttrs = (
        meshPathOverride?: string,
        materialNameOverride?: string,
        rgbaOverride: string = defaultVisualRgba,
      ) => {
        let vGeomAttrs = `pos="${vPos}"${quatAttr(v.origin?.rpy)} group="1" contype="0" conaffinity="0"`;
        if (materialNameOverride) {
          vGeomAttrs += ` material="${materialNameOverride}"`;
        } else {
          vGeomAttrs += ` rgba="${rgbaOverride}"`;
        }

        if (v.type === GeometryType.BOX) {
          vGeomAttrs += ` type="box" size="${formatScalar(v.dimensions.x / 2)} ${formatScalar(v.dimensions.y / 2)} ${formatScalar(v.dimensions.z / 2)}"`;
        } else if (v.type === GeometryType.PLANE) {
          vGeomAttrs += ` type="plane" size="${formatShape(v.dimensions.x / 2)} ${formatShape(v.dimensions.y / 2)} 0.1"`;
        } else if (v.type === GeometryType.CYLINDER) {
          vGeomAttrs += ` type="cylinder" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y / 2)}"`;
        } else if (v.type === GeometryType.SPHERE) {
          vGeomAttrs += ` type="sphere" size="${formatShape(v.dimensions.x)}"`;
        } else if (v.type === GeometryType.ELLIPSOID) {
          vGeomAttrs += ` type="ellipsoid" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y)} ${formatShape(v.dimensions.z)}"`;
        } else if (v.type === GeometryType.CAPSULE) {
          vGeomAttrs += ` type="capsule" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y / 2)}"`;
        } else if (v.type === GeometryType.HFIELD) {
          const hfieldAssetName = resolveHfieldAssetName(v);
          if (!hfieldAssetName) {
            throw new Error(
              `[MJCF export] Height field geometry on link "${link.name}" is missing MJCF hfield asset metadata.`,
            );
          }
          vGeomAttrs += ` type="hfield" hfield="${hfieldAssetName}"`;
        } else if (v.type === GeometryType.SDF) {
          const meshAssetName = resolveMeshAssetName(
            v.meshPath,
            v.dimensions,
            v.mjcfMesh,
            v.assetRef,
          );
          const fallbackMeshRef = v.assetRef || resolveExportMeshPath(v.meshPath);
          if (!meshAssetName && !fallbackMeshRef) {
            throw new Error(
              `[MJCF export] Signed distance field geometry on link "${link.name}" is missing a mesh asset reference.`,
            );
          }
          vGeomAttrs += ` type="sdf" mesh="${meshAssetName || fallbackMeshRef}"`;
        } else if (v.type === GeometryType.MESH) {
          if (!meshPathOverride && !v.meshPath && !v.mjcfMesh?.vertices?.length) {
            throw new Error(
              `[MJCF export] Mesh geometry on link "${link.name}" is missing an exportable mesh path${v.assetRef ? ` (asset "${v.assetRef}" is inline-only today)` : ''}.`,
            );
          }
          const meshAssetName = resolveMeshAssetName(
            meshPathOverride || v.meshPath,
            v.dimensions,
            meshPathOverride && v.mjcfMesh
              ? {
                  ...v.mjcfMesh,
                  file: meshPathOverride,
                  vertices: undefined,
                }
              : v.mjcfMesh,
            v.assetRef,
          );
          if (meshAssetName) {
            vGeomAttrs += ` type="mesh" mesh="${meshAssetName}"`;
          } else {
            const fallback = resolveExportMeshPath(meshPathOverride || v.meshPath);
            if (fallback) vGeomAttrs += ` type="mesh" mesh="${fallback}"`;
          }
        }

        return vGeomAttrs;
      };

      if (meshVariants && meshVariants.length > 0) {
        meshVariants.forEach((variant, variantIndex) => {
          const variantMaterialName = visualVariantMaterialNameMap.get(
            resolveVisualVariantKey(visualKey, variantIndex),
          );
          bodyXml += `${indent}  <geom ${buildVisualGeomAttrs(
            variant.meshPath,
            variantMaterialName,
            variant.color ? hexToRgba(variant.color) : defaultVisualRgba,
          )} />\n`;
        });
      } else {
        const visualMaterialName = visualMaterialNameMap.get(visualKey);
        bodyXml += `${indent}  <geom ${buildVisualGeomAttrs(
          v.meshPath,
          visualMaterialName,
          defaultVisualRgba,
        )} />\n`;
      }
    });

    // 4. Collision geoms use a dedicated visualization group so the runtime
    // loader can classify them as collision-only and keep them hidden unless
    // collision display is explicitly enabled.
    const collisionGeoms = [link.collision, ...(link.collisionBodies || [])].filter(
      (c) => c && c.type !== GeometryType.NONE,
    );

    collisionGeoms.forEach((c) => {
      let cPos = '0 0 0';
      if (c.origin) {
        cPos = vecStr(c.origin.xyz);
      }
      let cGeomAttrs = `pos="${cPos}"${quatAttr(c.origin?.rpy)} rgba="${hexToRgba(c.color || DEFAULT_LINK.collision.color)}" group="3" contype="1" conaffinity="1"`;
      const collisionName = c.name?.trim();
      if (collisionName) {
        cGeomAttrs += ` name="${escapeXmlAttribute(collisionName)}"`;
      }

      if (c.type === GeometryType.BOX) {
        cGeomAttrs += ` type="box" size="${formatScalar(c.dimensions.x / 2)} ${formatScalar(c.dimensions.y / 2)} ${formatScalar(c.dimensions.z / 2)}"`;
      } else if (c.type === GeometryType.PLANE) {
        cGeomAttrs += ` type="plane" size="${formatShape(c.dimensions.x / 2)} ${formatShape(c.dimensions.y / 2)} 0.1"`;
      } else if (c.type === GeometryType.CYLINDER) {
        cGeomAttrs += ` type="cylinder" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y / 2)}"`;
      } else if (c.type === GeometryType.SPHERE) {
        cGeomAttrs += ` type="sphere" size="${formatShape(c.dimensions.x)}"`;
      } else if (c.type === GeometryType.ELLIPSOID) {
        cGeomAttrs += ` type="ellipsoid" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y)} ${formatShape(c.dimensions.z)}"`;
      } else if (c.type === GeometryType.CAPSULE) {
        cGeomAttrs += ` type="capsule" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y / 2)}"`;
      } else if (c.type === GeometryType.HFIELD) {
        const hfieldAssetName = resolveHfieldAssetName(c);
        if (!hfieldAssetName) {
          throw new Error(
            `[MJCF export] Height field collision geometry on link "${link.name}" is missing MJCF hfield asset metadata.`,
          );
        }
        cGeomAttrs += ` type="hfield" hfield="${hfieldAssetName}"`;
      } else if (c.type === GeometryType.SDF) {
        const meshAssetName = resolveMeshAssetName(
          c.meshPath,
          c.dimensions,
          c.mjcfMesh,
          c.assetRef,
        );
        const fallbackMeshRef = c.assetRef || resolveExportMeshPath(c.meshPath);
        if (!meshAssetName && !fallbackMeshRef) {
          throw new Error(
            `[MJCF export] Signed distance field collision geometry on link "${link.name}" is missing a mesh asset reference.`,
          );
        }
        cGeomAttrs += ` type="sdf" mesh="${meshAssetName || fallbackMeshRef}"`;
      } else if (c.type === GeometryType.MESH) {
        if (!c.meshPath && !c.mjcfMesh?.vertices?.length) {
          throw new Error(
            `[MJCF export] Collision mesh geometry on link "${link.name}" is missing an exportable mesh path${c.assetRef ? ` (asset "${c.assetRef}" is inline-only today)` : ''}.`,
          );
        }

        const meshAssetName = resolveMeshAssetName(
          c.meshPath,
          c.dimensions,
          c.mjcfMesh,
          c.assetRef,
        );
        if (meshAssetName) {
          cGeomAttrs += ` type="mesh" mesh="${meshAssetName}"`;
        } else {
          const fallback = resolveExportMeshPath(c.meshPath);
          if (fallback) cGeomAttrs += ` type="mesh" mesh="${fallback}"`;
        }
      }

      bodyXml += `${indent}  <geom ${cGeomAttrs} />\n`;
    });

    // 5. Recursively add children
    const childJoints = Object.values(joints).filter((j) => j.parentLinkId === linkId);
    childJoints.forEach((childJoint) => {
      bodyXml += buildBody(childJoint.childLinkId, indent + '  ', nextPath);
    });

    bodyXml += `${indent}</body>\n`;
    return bodyXml;
  };

  const emitRootBodies = (): string => {
    if (!isSyntheticWorldRoot(rootLinkId)) {
      return buildBody(rootLinkId, '    ');
    }

    const rootChildren = Object.values(joints).filter((joint) => joint.parentLinkId === rootLinkId);
    return rootChildren.map((joint) => buildBody(joint.childLinkId, '    ')).join('');
  };

  const injectFreeJoint = (bodyXml: string): string => {
    const firstNewline = bodyXml.indexOf('\n');
    if (firstNewline === -1) {
      return bodyXml;
    }

    return (
      bodyXml.slice(0, firstNewline + 1) + '      <freejoint/>\n' + bodyXml.slice(firstNewline + 1)
    );
  };

  const rootBodyXml = emitRootBodies();
  const rootBodyAlreadyHasFreeJoint = /<freejoint\b/.test(rootBodyXml);
  if (addFloatBase && !rootBodyAlreadyHasFreeJoint) {
    xml += injectFreeJoint(rootBodyXml);
  } else {
    xml += rootBodyXml;
  }

  xml += `  </worldbody>\n`;

  if (equalityLines.length > 0) {
    xml += `  <equality>\n`;
    equalityLines.forEach((line) => {
      xml += `${line}\n`;
    });
    xml += `  </equality>\n`;
  }

  if (tendonBlocks.length > 0) {
    xml += `  <tendon>\n`;
    tendonBlocks.forEach((block) => {
      xml += `${block}\n`;
    });
    xml += `  </tendon>\n`;
  }

  // Actuators (conditional)
  if (includeActuators && actuatorType !== 'motor') {
    xml += `  <actuator>\n`;
    Object.values(joints).forEach((j) => {
      if (
        !j.mimic &&
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        // Use joint dynamics for actuator gains
        const kv = j.dynamics?.damping ?? 1.0;
        const kp = j.limit?.effort ? j.limit.effort * 0.5 : 100.0;
        const effortLimit = Number.isFinite(j.limit?.effort)
          ? Math.abs(Number(j.limit?.effort))
          : 0;
        const forceRangeStr =
          effortLimit > 1e-12
            ? ` forcelimited="true" forcerange="${formatScalar(-effortLimit)} ${formatScalar(effortLimit)}"`
            : '';

        if (actuatorType === 'position') {
          xml += `    <position name="${j.name}_servo" joint="${j.name}" kp="${formatScalar(kp)}"${forceRangeStr} />\n`;
        } else if (actuatorType === 'velocity') {
          xml += `    <velocity name="${j.name}_vel" joint="${j.name}" kv="${formatScalar(kv)}"${forceRangeStr} />\n`;
        }
      }
    });
    xml += `  </actuator>\n`;
  } else if (includeActuators && actuatorType === 'motor') {
    xml += `  <actuator>\n`;
    Object.values(joints).forEach((j) => {
      if (
        !j.mimic &&
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        const effortLimit = Number.isFinite(j.limit?.effort)
          ? Math.abs(Number(j.limit?.effort))
          : 0;
        const controlRangeStr =
          effortLimit > 1e-12
            ? ` ctrllimited="true" ctrlrange="${formatScalar(-effortLimit)} ${formatScalar(effortLimit)}"`
            : '';
        xml += `    <motor name="${j.name}_motor" joint="${j.name}" gear="${j.hardware?.motorDirection === -1 ? '-1' : '1'}"${controlRangeStr} />\n`;
      }
    });
    xml += `  </actuator>\n`;
  }

  xml += `</mujoco>`;
  return xml;
};
