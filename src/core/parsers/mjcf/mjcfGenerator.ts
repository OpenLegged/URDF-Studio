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
  type UrdfMjcfSite,
} from '@/types';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import {
  colorRgbaTupleToHex,
  normalizeColorRgbaTuple,
  type ColorRgbaTuple,
} from '@/core/utils/color';
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

export type MjcfActuatorType = 'position' | 'velocity' | 'motor';

export interface MjcfVisualMeshVariant {
  meshPath: string;
  color?: string;
  sourceMaterialName?: string;
}

export interface MujocoExportOptions {
  meshdir?: string;
  texturedir?: string;
  addFloatBase?: boolean;
  includeActuators?: boolean;
  actuatorType?: MjcfActuatorType;
  includeSceneHelpers?: boolean;
  meshPathOverrides?: ReadonlyMap<string, string>;
  visualMeshVariants?: ReadonlyMap<string, readonly MjcfVisualMeshVariant[]>;
}

export const generateMujocoXML = (robot: RobotState, options: MujocoExportOptions = {}): string => {
  const FIXED_SPATIAL_TENDON_RANGE_EPSILON = 1e-6;
  const LOCKED_JOINT_RANGE_EPSILON = 1e-6;
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

  // Helper to format numbers
  const formatScalar = (n: number) => formatNumberWithMaxDecimals(n, MAX_PROPERTY_DECIMALS);
  const formatShape = (n: number) =>
    formatNumberWithMaxDecimals(n, MAX_GEOMETRY_DIMENSION_DECIMALS);
  const formatInertiaScalar = (n: number) => formatNumberWithMaxDecimals(n, 10);
  const vecStr = (v: { x: number; y: number; z: number }) =>
    `${formatScalar(v.x)} ${formatScalar(v.y)} ${formatScalar(v.z)}`;
  const quatStr = (v: { r: number; p: number; y: number }) => {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.r, v.p, v.y, 'ZYX'));
    return `${formatScalar(quaternion.w)} ${formatScalar(quaternion.x)} ${formatScalar(quaternion.y)} ${formatScalar(quaternion.z)}`;
  };
  const hasRotation = (v: { r: number; p: number; y: number } | undefined) =>
    Boolean(v && (Math.abs(v.r) > 1e-9 || Math.abs(v.p) > 1e-9 || Math.abs(v.y) > 1e-9));
  const quatAttr = (v: { r: number; p: number; y: number } | undefined) =>
    hasRotation(v) ? ` quat="${quatStr(v!)}"` : '';
  const hasFiniteJointRange = (joint: RobotState['joints'][string] | undefined): boolean =>
    Boolean(
      joint?.limit && Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper),
    );
  const getMujocoJointRange = (
    joint: RobotState['joints'][string] | undefined,
  ): [number, number] | null => {
    if (!hasFiniteJointRange(joint)) {
      return null;
    }

    const lower = Number(joint!.limit!.lower);
    const upper = Number(joint!.limit!.upper);
    if (upper > lower) {
      return [lower, upper];
    }

    if (Math.abs(upper - lower) <= LOCKED_JOINT_RANGE_EPSILON) {
      const halfEpsilon = LOCKED_JOINT_RANGE_EPSILON / 2;
      return [lower - halfEpsilon, upper + halfEpsilon];
    }

    return [lower, upper];
  };

  const normalizeExportRelativePath = (filePath: string): string => {
    const normalized = String(filePath || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, '')
      .replace(/^(\.\/)+/, '');

    if (!normalized) {
      return '';
    }

    const segments = normalized.split('/');
    const collapsed: string[] = [];
    for (const segment of segments) {
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (collapsed.length > 0) {
          collapsed.pop();
        }
        continue;
      }
      collapsed.push(segment);
    }

    return collapsed.join('/');
  };

  const computeSymmetricEigenvalues3x3 = (
    matrix: [[number, number, number], [number, number, number], [number, number, number]],
  ): [number, number, number] => {
    const working = matrix.map((row) => [...row]) as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];

    for (let iteration = 0; iteration < 24; iteration += 1) {
      let pivotRow = 0;
      let pivotCol = 1;
      let pivotValue = Math.abs(working[pivotRow][pivotCol]);

      for (const [row, col] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const) {
        const candidate = Math.abs(working[row][col]);
        if (candidate > pivotValue) {
          pivotRow = row;
          pivotCol = col;
          pivotValue = candidate;
        }
      }

      if (pivotValue <= 1e-12) {
        break;
      }

      const app = working[pivotRow][pivotRow];
      const aqq = working[pivotCol][pivotCol];
      const apq = working[pivotRow][pivotCol];
      const tau = (aqq - app) / (2 * apq);
      const tangent = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const cosine = 1 / Math.sqrt(1 + tangent * tangent);
      const sine = tangent * cosine;

      for (let row = 0; row < 3; row += 1) {
        if (row === pivotRow || row === pivotCol) {
          continue;
        }

        const arp = working[row][pivotRow];
        const arq = working[row][pivotCol];
        working[row][pivotRow] = arp * cosine - arq * sine;
        working[pivotRow][row] = working[row][pivotRow];
        working[row][pivotCol] = arp * sine + arq * cosine;
        working[pivotCol][row] = working[row][pivotCol];
      }

      working[pivotRow][pivotRow] =
        app * cosine * cosine - 2 * apq * cosine * sine + aqq * sine * sine;
      working[pivotCol][pivotCol] =
        app * sine * sine + 2 * apq * cosine * sine + aqq * cosine * cosine;
      working[pivotRow][pivotCol] = 0;
      working[pivotCol][pivotRow] = 0;
    }

    return [working[0][0], working[1][1], working[2][2]].sort((left, right) => left - right) as [
      number,
      number,
      number,
    ];
  };

  const hasInvalidMujocoInertia = (link: UrdfLink): boolean => {
    const inertial = link.inertial;
    if (!inertial || !Number.isFinite(inertial.mass) || inertial.mass <= 0) {
      return false;
    }

    const inertia = inertial.inertia;
    if (!inertia) {
      return false;
    }

    const components = [
      inertia.ixx,
      inertia.ixy,
      inertia.ixz,
      inertia.iyy,
      inertia.iyz,
      inertia.izz,
    ];
    if (components.some((value) => !Number.isFinite(value))) {
      return true;
    }

    const principalMoments = computeSymmetricEigenvalues3x3([
      [inertia.ixx, inertia.ixy, inertia.ixz],
      [inertia.ixy, inertia.iyy, inertia.iyz],
      [inertia.ixz, inertia.iyz, inertia.izz],
    ]);
    if (principalMoments.some((value) => !Number.isFinite(value) || value <= 0)) {
      return true;
    }

    return principalMoments[0] + principalMoments[1] < principalMoments[2];
  };

  // Helper to convert hex color to rgba string
  const clampUnitForRgba = (value: number) => Math.max(0, Math.min(1, Number(value)));

  const hexToRgba = (hex: string, opacityOverride?: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(
      String(hex || '').trim(),
    );
    if (!result) return '0.8 0.8 0.8 1.0';
    const r = parseInt(result[1], 16) / 255;
    const g = parseInt(result[2], 16) / 255;
    const b = parseInt(result[3], 16) / 255;
    const a = Number.isFinite(opacityOverride)
      ? clampUnitForRgba(Number(opacityOverride))
      : result[4]
        ? parseInt(result[4], 16) / 255
        : 1;
    return `${formatNumberWithMaxDecimals(r, 4)} ${formatNumberWithMaxDecimals(g, 4)} ${formatNumberWithMaxDecimals(b, 4)} ${formatNumberWithMaxDecimals(a, 4)}`;
  };

  const escapeXmlAttribute = (value: string) =>
    value.replace(/[<>&"']/g, (char) => {
      switch (char) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case '"':
          return '&quot;';
        case "'":
          return '&apos;';
        default:
          return char;
      }
    });

  interface ExportedMjcfSite {
    name: string;
    type: string;
    size?: readonly number[];
    rgba?: readonly number[];
    pos?: { x: number; y: number; z: number };
    quat?: readonly number[];
    group?: number;
  }

  const sanitizeMjcfIdentifier = (value: string, fallback: string): string =>
    value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || fallback;

  const ensureFiniteVector3 = (
    value: { x: number; y: number; z: number },
    errorPrefix: string,
  ): void => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
      throw new Error(`${errorPrefix} must use finite XYZ coordinates.`);
    }
  };

  const formatVectorTuple = (values: readonly number[]) =>
    values.map((value) => formatScalar(value)).join(' ');

  const formatRgbaTuple = (values: readonly number[]) =>
    values.map((value) => formatNumberWithMaxDecimals(value, 4)).join(' ');

  const convertMjcfSite = (site: UrdfMjcfSite): ExportedMjcfSite => ({
    name: site.sourceName || site.name,
    type: site.type || 'sphere',
    ...(site.size?.length ? { size: site.size } : {}),
    ...(site.rgba?.length ? { rgba: site.rgba } : {}),
    ...(site.pos?.length
      ? {
          pos: {
            x: site.pos[0] ?? 0,
            y: site.pos[1] ?? 0,
            z: site.pos[2] ?? 0,
          },
        }
      : {}),
    ...(site.quat?.length ? { quat: site.quat } : {}),
    ...(Number.isFinite(site.group) ? { group: site.group } : {}),
  });

  const renderMjcfSite = (site: ExportedMjcfSite, indent: string): string => {
    const attrs = [`name="${escapeXmlAttribute(site.name)}"`];
    attrs.push(`type="${escapeXmlAttribute(site.type || 'sphere')}"`);
    if (site.pos) {
      attrs.push(`pos="${vecStr(site.pos)}"`);
    }
    if (site.quat && site.quat.length >= 4) {
      attrs.push(`quat="${formatVectorTuple(site.quat.slice(0, 4))}"`);
    }
    if (site.size?.length) {
      attrs.push(`size="${formatVectorTuple(site.size)}"`);
    }
    if (site.rgba?.length) {
      attrs.push(`rgba="${formatRgbaTuple(site.rgba.slice(0, 4))}"`);
    }
    if (Number.isFinite(site.group)) {
      attrs.push(`group="${site.group}"`);
    }
    return `${indent}<site ${attrs.join(' ')} />\n`;
  };

  type MeshScaleTuple = [number, number, number];
  type MeshRefPosTuple = [number, number, number];
  type MeshRefQuatTuple = [number, number, number, number];
  interface MeshAssetEntry {
    key: string;
    path: string | null;
    sourceAssetName: string | null;
    vertices: number[] | null;
    scale: MeshScaleTuple;
    refpos: MeshRefPosTuple | null;
    refquat: MeshRefQuatTuple | null;
  }

  const normalizeMeshScale = (dimensions?: { x: number; y: number; z: number }): MeshScaleTuple => {
    const normalize = (value: number | undefined) => {
      if (Number.isFinite(value) && Math.abs(value as number) > 1e-9) {
        return Math.abs(value as number);
      }
      return 1;
    };

    return [normalize(dimensions?.x), normalize(dimensions?.y), normalize(dimensions?.z)];
  };

  const meshScaleKey = (scale: MeshScaleTuple) =>
    `${formatShape(scale[0])} ${formatShape(scale[1])} ${formatShape(scale[2])}`;

  const normalizeMeshRefpos = (refpos?: readonly number[] | null): MeshRefPosTuple | null => {
    if (!refpos || refpos.length < 3) {
      return null;
    }

    return [Number(refpos[0] ?? 0), Number(refpos[1] ?? 0), Number(refpos[2] ?? 0)];
  };

  const normalizeMeshRefquat = (refquat?: readonly number[] | null): MeshRefQuatTuple | null => {
    if (!refquat || refquat.length < 4) {
      return null;
    }

    return [
      Number(refquat[0] ?? 1),
      Number(refquat[1] ?? 0),
      Number(refquat[2] ?? 0),
      Number(refquat[3] ?? 0),
    ];
  };

  const normalizeMjcfMeshScale = (
    mjcfMesh?: UrdfLink['visual']['mjcfMesh'],
    dimensions?: { x: number; y: number; z: number },
  ): MeshScaleTuple => {
    if (mjcfMesh?.scale && mjcfMesh.scale.length >= 3) {
      return [
        Number(mjcfMesh.scale[0] ?? 1) || 1,
        Number(mjcfMesh.scale[1] ?? 1) || 1,
        Number(mjcfMesh.scale[2] ?? 1) || 1,
      ];
    }

    return normalizeMeshScale(dimensions);
  };

  const buildMeshAssetKey = (entry: Omit<MeshAssetEntry, 'key'>) =>
    JSON.stringify({
      path: entry.path,
      sourceAssetName: entry.sourceAssetName,
      vertices: entry.vertices || [],
      scale: entry.scale,
      refpos: entry.refpos,
      refquat: entry.refquat,
    });

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

    const entryWithoutKey: Omit<MeshAssetEntry, 'key'> = {
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || geometry.assetRef || null,
      vertices: inlineVertices,
      scale: normalizeMjcfMeshScale(mjcfMesh, geometry.dimensions),
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: normalizeMeshRefquat(mjcfMesh?.refquat),
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

    const key = buildMeshAssetKey({
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || assetRef || null,
      vertices: inlineVertices,
      scale: normalizeMjcfMeshScale(mjcfMesh, dimensions),
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: normalizeMeshRefquat(mjcfMesh?.refquat),
    });
    return meshAssetNameMap.get(key) || null;
  };

  type HfieldSizeTuple = [number, number, number, number];
  interface HfieldAssetEntry {
    key: string;
    name: string;
    file?: string;
    contentType?: string;
    nrow?: number;
    ncol?: number;
    size: HfieldSizeTuple;
    elevation?: number[];
  }

  const normalizeHfieldSize = (geometry: UrdfLink['visual']): HfieldSizeTuple | null => {
    const size = geometry.mjcfHfield?.size;
    if (!size) {
      return null;
    }

    return [size.radiusX, size.radiusY, size.elevationZ, size.baseZ];
  };

  const buildHfieldAssetKey = (geometry: UrdfLink['visual']): string | null => {
    const size = normalizeHfieldSize(geometry);
    if (!size) {
      return null;
    }

    return JSON.stringify({
      assetRef: geometry.assetRef || geometry.mjcfHfield?.name || '',
      file: geometry.mjcfHfield?.file || '',
      contentType: geometry.mjcfHfield?.contentType || '',
      nrow: geometry.mjcfHfield?.nrow ?? null,
      ncol: geometry.mjcfHfield?.ncol ?? null,
      size,
      elevation: geometry.mjcfHfield?.elevation || [],
    });
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

  interface VisualMaterialAssetEntry {
    visualKey: string;
    linkId: string;
    objectIndex: number;
    color: string;
    colorRgba?: ColorRgbaTuple;
    opacity?: number;
    texture?: string;
    cubeTextureKey?: string;
    specular?: number;
    shininess?: number;
    reflectance?: number;
    emission?: number;
  }

  interface CubeTextureAssetEntry {
    key: string;
    owningLinkId: string;
    owningObjectIndex: number;
    fileright: string;
    fileleft: string;
    fileup: string;
    filedown: string;
    filefront: string;
    fileback: string;
  }

  interface VisualVariantMaterialAssetEntry {
    key: string;
    linkId: string;
    objectIndex: number;
    color: string;
    colorRgba?: ColorRgbaTuple;
    opacity?: number;
    texture?: string;
    specular?: number;
  }

  const clampUnitScalar = (value: number | null | undefined): number | undefined => {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, Number(value)));
  };

  const colorRgbaToMjcfRgba = (
    colorRgba?: readonly number[] | null,
    opacityOverride?: number,
  ): string | null => {
    const normalized = normalizeColorRgbaTuple(colorRgba);
    if (!normalized) {
      return null;
    }

    const opacity = clampUnitScalar(opacityOverride) ?? normalized[3];
    return [normalized[0], normalized[1], normalized[2], opacity]
      .map((value) => formatNumberWithMaxDecimals(value, 4))
      .join(' ');
  };

  const materialToMjcfRgba = (
    color: string,
    colorRgba?: readonly number[] | null,
    opacity?: number,
  ): string => colorRgbaToMjcfRgba(colorRgba, opacity) ?? hexToRgba(color, opacity);

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

  const sanitizeMaterialAssetName = (value: string): string =>
    value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'material';

  const normalizeMaterialIdentifier = (value: unknown): string | null => {
    const normalized = String(value || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase();
    if (!normalized) {
      return null;
    }

    let current = normalized;
    let previous = '';
    while (current !== previous) {
      previous = current;
      current = current.replace(/(?:[\s._-]*(?:effect|material))$/u, '').trim();
    }

    const collapsed = current.replace(/[\s._-]+/gu, '');
    return collapsed || null;
  };

  const resolveVisualEntryKey = (linkId: string, objectIndex: number): string =>
    `${linkId}@@${objectIndex}`;
  const resolveVisualVariantKey = (visualKey: string, variantIndex: number): string =>
    `${visualKey}@@variant_${variantIndex}`;
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
      } else {
        if (parentJoint.type === JointType.PLANAR) {
          throw new Error(
            `[MJCF export] Joint "${parentJoint.name}" uses unsupported planar type.`,
          );
        }

        let jType = 'hinge';
        if (parentJoint.type === JointType.PRISMATIC) {
          jType = 'slide';
        } else if (parentJoint.type === JointType.BALL) {
          jType = 'ball';
        }

        const jointRange =
          parentJoint.type !== JointType.CONTINUOUS && parentJoint.type !== JointType.BALL
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

        bodyXml += `${indent}  <joint name="${parentJoint.name}" type="${jType}"${axisStr}${limitedStr}${limitStr}${referencePositionStr}${armatureStr} damping="${formatScalar(parentJoint.dynamics.damping)}" frictionloss="${formatScalar(parentJoint.dynamics.friction)}"/>\n`;
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

    const exportedSites = [
      ...(link.mjcfSites || []).map(convertMjcfSite),
      ...(generatedSitesByLink.get(linkId) || []),
    ];
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
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        // Use joint dynamics for actuator gains
        const kv = j.dynamics?.damping ?? 1.0;
        const kp = j.limit?.effort ? j.limit.effort * 0.5 : 100.0;
        const effortLimit = Number.isFinite(j.limit?.effort) ? Math.abs(Number(j.limit?.effort)) : 0;
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
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        const effortLimit = Number.isFinite(j.limit?.effort) ? Math.abs(Number(j.limit?.effort)) : 0;
        const controlRangeStr =
          effortLimit > 1e-12
            ? ` ctrllimited="true" ctrlrange="${formatScalar(-effortLimit)} ${formatScalar(effortLimit)}"`
            : '';
        xml += `    <motor name="${j.name}_motor" joint="${j.name}" gear="1"${controlRangeStr} />\n`;
      }
    });
    xml += `  </actuator>\n`;
  }

  xml += `</mujoco>`;
  return xml;
};
