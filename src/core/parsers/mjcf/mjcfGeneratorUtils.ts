import * as THREE from 'three';

import type { RobotState, UrdfLink, UrdfMjcfSite } from '@/types';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import { normalizeColorRgbaTuple, type ColorRgbaTuple } from '@/core/utils/color';

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

export const LOCKED_JOINT_RANGE_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Number / string formatting
// ---------------------------------------------------------------------------

export const formatScalar = (n: number) => formatNumberWithMaxDecimals(n, MAX_PROPERTY_DECIMALS);
export const formatShape = (n: number) =>
  formatNumberWithMaxDecimals(n, MAX_GEOMETRY_DIMENSION_DECIMALS);
export const formatInertiaScalar = (n: number) => formatNumberWithMaxDecimals(n, 10);
export const vecStr = (v: { x: number; y: number; z: number }) =>
  `${formatScalar(v.x)} ${formatScalar(v.y)} ${formatScalar(v.z)}`;
export const quatStr = (v: { r: number; p: number; y: number }) => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.r, v.p, v.y, 'ZYX'));
  return `${formatScalar(quaternion.w)} ${formatScalar(quaternion.x)} ${formatScalar(quaternion.y)} ${formatScalar(quaternion.z)}`;
};
export const hasRotation = (v: { r: number; p: number; y: number } | undefined) =>
  Boolean(v && (Math.abs(v.r) > 1e-9 || Math.abs(v.p) > 1e-9 || Math.abs(v.y) > 1e-9));
export const quatAttr = (v: { r: number; p: number; y: number } | undefined) =>
  hasRotation(v) ? ` quat="${quatStr(v!)}"` : '';

export const hasFiniteJointRange = (joint: RobotState['joints'][string] | undefined): boolean =>
  Boolean(
    joint?.limit && Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper),
  );

export const getMujocoJointRange = (
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

export const normalizeExportRelativePath = (filePath: string): string => {
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

// ---------------------------------------------------------------------------
// Inertia validation
// ---------------------------------------------------------------------------

export const computeSymmetricEigenvalues3x3 = (
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

export const hasInvalidMujocoInertia = (link: UrdfLink): boolean => {
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

// ---------------------------------------------------------------------------
// Color / XML helpers
// ---------------------------------------------------------------------------

export const clampUnitForRgba = (value: number) => Math.max(0, Math.min(1, Number(value)));

export const hexToRgba = (hex: string, opacityOverride?: number) => {
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

export const escapeXmlAttribute = (value: string) =>
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

export interface ExportedMjcfSite {
  name: string;
  type: string;
  size?: readonly number[];
  rgba?: readonly number[];
  pos?: { x: number; y: number; z: number };
  quat?: readonly number[];
  group?: number;
}

export const sanitizeMjcfIdentifier = (value: string, fallback: string): string =>
  value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || fallback;

export const ensureFiniteVector3 = (
  value: { x: number; y: number; z: number },
  errorPrefix: string,
): void => {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    throw new Error(`${errorPrefix} must use finite XYZ coordinates.`);
  }
};

export const formatVectorTuple = (values: readonly number[]) =>
  values.map((value) => formatScalar(value)).join(' ');

export const formatRgbaTuple = (values: readonly number[]) =>
  values.map((value) => formatNumberWithMaxDecimals(value, 4)).join(' ');

export const convertMjcfSite = (site: UrdfMjcfSite): ExportedMjcfSite => ({
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

export const renderMjcfSite = (site: ExportedMjcfSite, indent: string): string => {
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

// ---------------------------------------------------------------------------
// Mesh asset helpers
// ---------------------------------------------------------------------------

export type MeshScaleTuple = [number, number, number];
export type MeshRefPosTuple = [number, number, number];
export type MeshRefQuatTuple = [number, number, number, number];
export interface MeshAssetEntry {
  key: string;
  path: string | null;
  sourceAssetName: string | null;
  vertices: number[] | null;
  scale: MeshScaleTuple;
  refpos: MeshRefPosTuple | null;
  refquat: MeshRefQuatTuple | null;
}

/**
 * Compute a compensating quaternion for a negative mesh scale.
 * A single negative scale component is a reflection, which cannot be
 * represented by a rotation alone.  We approximate it with a 180° rotation
 * around a perpendicular axis, which gives a visually acceptable result for
 * the common case of symmetric meshes (e.g. left/right finger pairs).
 *
 * Returns null when no compensation is needed (all components positive).
 */
export const negativeScaleCompensationQuat = (
  dimensions?: { x: number; y: number; z: number },
): MeshRefQuatTuple | null => {
  if (!dimensions) return null;

  const negX = Number.isFinite(dimensions.x) && dimensions.x < -1e-9;
  const negY = Number.isFinite(dimensions.y) && dimensions.y < -1e-9;
  const negZ = Number.isFinite(dimensions.z) && dimensions.z < -1e-9;
  const count = (negX ? 1 : 0) + (negY ? 1 : 0) + (negZ ? 1 : 0);

  // Zero or three negative components cannot be compensated by rotation.
  if (count === 0 || count === 3) return null;

  // One negative: rotate 180° around a perpendicular axis.
  if (count === 1) {
    if (negX) return [0, 0, 1, 0]; // 180° around Y
    if (negY) return [0, 1, 0, 0]; // 180° around X
    return [0, 1, 0, 0]; // negZ: 180° around X
  }

  // Two negatives: rotate 180° around the positive axis.
  if (count === 2) {
    if (!negX) return [0, 1, 0, 0]; // Y,Z negative → 180° around X
    if (!negY) return [0, 0, 1, 0]; // X,Z negative → 180° around Y
    return [0, 0, 0, 1]; // X,Y negative → 180° around Z
  }

  return null;
};

export const normalizeMeshScale = (
  dimensions?: { x: number; y: number; z: number },
): { scale: MeshScaleTuple; compensationQuat: MeshRefQuatTuple | null } => {
  const normalize = (value: number | undefined) => {
    if (Number.isFinite(value) && Math.abs(value as number) > 1e-9) {
      return Math.abs(value as number);
    }
    return 1;
  };

  return {
    scale: [normalize(dimensions?.x), normalize(dimensions?.y), normalize(dimensions?.z)],
    compensationQuat: negativeScaleCompensationQuat(dimensions),
  };
};

export const meshScaleKey = (scale: MeshScaleTuple) =>
  `${formatShape(scale[0])} ${formatShape(scale[1])} ${formatShape(scale[2])}`;

export const normalizeMeshRefpos = (refpos?: readonly number[] | null): MeshRefPosTuple | null => {
  if (!refpos || refpos.length < 3) {
    return null;
  }

  return [Number(refpos[0] ?? 0), Number(refpos[1] ?? 0), Number(refpos[2] ?? 0)];
};

export const normalizeMeshRefquat = (refquat?: readonly number[] | null): MeshRefQuatTuple | null => {
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

export const normalizeMjcfMeshScale = (
  mjcfMesh?: UrdfLink['visual']['mjcfMesh'],
  dimensions?: { x: number; y: number; z: number },
): { scale: MeshScaleTuple; compensationQuat: MeshRefQuatTuple | null } => {
  if (mjcfMesh?.scale && mjcfMesh.scale.length >= 3) {
    return {
      scale: [
        Number(mjcfMesh.scale[0] ?? 1) || 1,
        Number(mjcfMesh.scale[1] ?? 1) || 1,
        Number(mjcfMesh.scale[2] ?? 1) || 1,
      ],
      compensationQuat: negativeScaleCompensationQuat({
        x: Number(mjcfMesh.scale[0] ?? 1),
        y: Number(mjcfMesh.scale[1] ?? 1),
        z: Number(mjcfMesh.scale[2] ?? 1),
      }),
    };
  }

  return normalizeMeshScale(dimensions);
};

export const buildMeshAssetKey = (entry: Omit<MeshAssetEntry, 'key'>) =>
  JSON.stringify({
    path: entry.path,
    sourceAssetName: entry.sourceAssetName,
    vertices: entry.vertices || [],
    scale: entry.scale,
    refpos: entry.refpos,
    refquat: entry.refquat,
  });

export const mergeRefquat = (
  existing: MeshRefQuatTuple | null,
  compensation: MeshRefQuatTuple | null,
): MeshRefQuatTuple | null => {
  if (!compensation && !existing) return null;
  if (!compensation) return existing;
  if (!existing) return compensation;

  const eq = new THREE.Quaternion(existing[1], existing[2], existing[3], existing[0]);
  const cq = new THREE.Quaternion(compensation[1], compensation[2], compensation[3], compensation[0]);
  const merged = cq.multiply(eq);
  return [merged.w, merged.x, merged.y, merged.z];
};

// ---------------------------------------------------------------------------
// Hfield asset helpers
// ---------------------------------------------------------------------------

export type HfieldSizeTuple = [number, number, number, number];
export interface HfieldAssetEntry {
  key: string;
  name: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size: HfieldSizeTuple;
  elevation?: number[];
}

export const normalizeHfieldSize = (geometry: UrdfLink['visual']): HfieldSizeTuple | null => {
  const size = geometry.mjcfHfield?.size;
  if (!size) {
    return null;
  }

  return [size.radiusX, size.radiusY, size.elevationZ, size.baseZ];
};

export const buildHfieldAssetKey = (geometry: UrdfLink['visual']): string | null => {
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

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

export const clampUnitScalar = (value: number | null | undefined): number | undefined => {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, Number(value)));
};

export const colorRgbaToMjcfRgba = (
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

export const materialToMjcfRgba = (
  color: string,
  colorRgba?: readonly number[] | null,
  opacity?: number,
): string => colorRgbaToMjcfRgba(colorRgba, opacity) ?? hexToRgba(color, opacity);

export const sanitizeMaterialAssetName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'material';

export const normalizeMaterialIdentifier = (value: unknown): string | null => {
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

export const resolveVisualEntryKey = (linkId: string, objectIndex: number): string =>
  `${linkId}@@${objectIndex}`;
export const resolveVisualVariantKey = (visualKey: string, variantIndex: number): string =>
  `${visualKey}@@variant_${variantIndex}`;

export interface VisualMaterialAssetEntry {
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

export interface CubeTextureAssetEntry {
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

export interface VisualVariantMaterialAssetEntry {
  key: string;
  linkId: string;
  objectIndex: number;
  color: string;
  colorRgba?: ColorRgbaTuple;
  opacity?: number;
  texture?: string;
  specular?: number;
}