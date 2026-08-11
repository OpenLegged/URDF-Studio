import * as THREE from 'three';

import {
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type Euler,
  type UrdfJointUsdPhysicsFrame,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
  type UsdClosedLoopConstraintEntry,
  type UsdJointCatalogEntry,
  type UsdLinkDynamicsEntry,
  type UsdMeshCountsEntry,
  type UsdSceneMaterialRecord,
  type UsdRobotMetadataSnapshot,
  type UsdSceneMeshDescriptor,
  type UsdSceneSnapshot,
  type Vector3,
} from '@/types';

export type MeshPrimitiveCounts = Record<string, number | undefined>;
export type MeshCountsEntry = UsdMeshCountsEntry;
export type JointCatalogEntry = UsdJointCatalogEntry;
export type ClosedLoopConstraintEntry = UsdClosedLoopConstraintEntry;
export type LinkDynamicsEntry = UsdLinkDynamicsEntry;
export type MaterialRecord = UsdSceneMaterialRecord;
export type RobotMetadataSnapshot = UsdRobotMetadataSnapshot;
export type MeshDescriptor = UsdSceneMeshDescriptor;
export type RobotSceneSnapshot = UsdSceneSnapshot;
export type ResolvedUsdGeometry = Pick<UrdfVisual, 'type' | 'dimensions'> & {
  origin?: UrdfVisual['origin'];
};

export function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function getPathBasename(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

export function getPathParent(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

export function isUsdInternalMeshLibraryPath(path: string | null | undefined): boolean {
  const segments = normalizeUsdPath(path).split('/').filter(Boolean);
  return segments.some((segment) => segment.toLowerCase() === '__meshlibrary');
}

export function shouldOmitUsdInternalMeshLibraryPaths(
  paths: Iterable<string | null | undefined>,
): boolean {
  let hasInternalMeshLibraryPath = false;
  let hasRobotLinkPath = false;

  for (const path of paths) {
    const normalized = normalizeUsdPath(path);
    if (!normalized) {
      continue;
    }

    if (isUsdInternalMeshLibraryPath(normalized)) {
      hasInternalMeshLibraryPath = true;
    } else {
      hasRobotLinkPath = true;
    }

    if (hasInternalMeshLibraryPath && hasRobotLinkPath) {
      return true;
    }
  }

  return false;
}

export function colorArrayToHex(
  value: ArrayLike<number> | null | undefined,
  opacityOverride?: number | null,
  colorSpace?: string | null,
): string | null {
  const source = Array.isArray(value)
    ? value
    : value && typeof value.length === 'number'
      ? Array.from(value)
      : null;
  if (!source || source.length < 3) {
    return null;
  }

  const r = Number(source[0]);
  const g = Number(source[1]);
  const b = Number(source[2]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  const to255 = (channel: number) => (Math.abs(channel) <= 1 ? channel * 255 : channel);
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, '0');
  const colorSpaceToken = String(colorSpace || '')
    .trim()
    .toLowerCase();
  const shouldReadAsSrgb =
    colorSpaceToken === 'srgb' ||
    colorSpaceToken === 'srgbcolorspace' ||
    colorSpaceToken === 's-rgb';
  const normalizedColor =
    Math.abs(r) <= 1 && Math.abs(g) <= 1 && Math.abs(b) <= 1
      ? new THREE.Color().setRGB(
          Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b)),
          shouldReadAsSrgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace,
        )
      : null;

  const a = opacityOverride ?? (source.length >= 4 ? Number(source[3]) : null);
  const rgb = normalizedColor
    ? [normalizedColor.getHexString()]
    : [toHex(to255(r)), toHex(to255(g)), toHex(to255(b))];

  if (a !== null && Number.isFinite(a) && a < 0.999) {
    rgb.push(toHex(to255(Number(a))));
  }

  return `#${rgb.join('')}`;
}

function normalizeMaterialColorSource(value: string | null | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return normalized || null;
}

function resolveAuthoredScalarColorSpace(
  material: MaterialRecord | null | undefined,
  colorSpace: string | null | undefined,
): string | null | undefined {
  return normalizeMaterialColorSource(material?.colorSource) === 'authored'
    ? 'linear'
    : colorSpace;
}

export function hasMaterialRecordContent(material: MaterialRecord | null | undefined): boolean {
  if (!material || typeof material !== 'object') {
    return false;
  }

  return Object.values(material).some((value) => {
    if (value == null) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength > 0;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  });
}

export function resolveSnapshotMaterialColorHex(
  material: MaterialRecord | null | undefined,
): string | null {
  const authoredColor = colorArrayToHex(
    material?.color,
    material?.opacity,
    resolveAuthoredScalarColorSpace(material, material?.colorSpace),
  );
  if (authoredColor) {
    return authoredColor;
  }

  const opacity = Number(material?.opacity);
  const hasPrimaryTexture = Boolean(
    String(material?.mapPath || material?.alphaMapPath || '').trim(),
  );
  if (hasPrimaryTexture && Number.isFinite(opacity) && opacity < 0.999) {
    return colorArrayToHex([1, 1, 1], opacity);
  }

  return null;
}

export function resolveSnapshotMaterialTexturePath(
  material: MaterialRecord | null | undefined,
): string | undefined {
  const texturePath = String(material?.mapPath || '').trim();
  return texturePath || undefined;
}

export function resolveSnapshotMaterialEmissionEnabled(
  material: MaterialRecord | null | undefined,
): boolean {
  if (!material || typeof material !== 'object') {
    return true;
  }
  if (material.emissiveEnabled === true) {
    return true;
  }
  if (material.emissiveEnabled === false) {
    return false;
  }
  return material.isOmniPbr === true ? false : true;
}

export function resolveSnapshotAuthoredMaterial(
  material: MaterialRecord | null | undefined,
  materialId?: string | null,
): UrdfVisualMaterial | null {
  if (!material) {
    return null;
  }

  const name =
    String(material.name || '').trim() ||
    getPathBasename(material.materialId || materialId || '') ||
    undefined;
  const color = resolveSnapshotMaterialColorHex(material) || undefined;
  const texture = resolveSnapshotMaterialTexturePath(material);
  const opacity = Number(material.opacity);
  const roughness = Number(material.roughness);
  const metalness = Number(material.metalness);
  const emissiveEnabled = resolveSnapshotMaterialEmissionEnabled(material);
  const emissive = emissiveEnabled
    ? colorArrayToHex(
        material.emissive,
        null,
        resolveAuthoredScalarColorSpace(material, material.emissiveColorSpace),
      ) || undefined
    : undefined;
  const emissiveIntensity = emissiveEnabled ? Number(material.emissiveIntensity) : Number.NaN;

  if (
    !name &&
    !color &&
    !texture &&
    !Number.isFinite(opacity) &&
    !Number.isFinite(roughness) &&
    !Number.isFinite(metalness) &&
    !emissive &&
    !Number.isFinite(emissiveIntensity)
  ) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(Number.isFinite(opacity) ? { opacity } : {}),
    ...(Number.isFinite(roughness) ? { roughness } : {}),
    ...(Number.isFinite(metalness) ? { metalness } : {}),
    ...(emissive ? { emissive } : {}),
    ...(Number.isFinite(emissiveIntensity) ? { emissiveIntensity } : {}),
  };
}

export function toVector3(
  value: ArrayLike<number> | null | undefined,
  fallback: Vector3 = { x: 0, y: 0, z: 0 },
): Vector3 {
  return {
    x: Number.isFinite(Number(value?.[0])) ? Number(value?.[0]) : fallback.x,
    y: Number.isFinite(Number(value?.[1])) ? Number(value?.[1]) : fallback.y,
    z: Number.isFinite(Number(value?.[2])) ? Number(value?.[2]) : fallback.z,
  };
}

export function toOptionalVector3(value: ArrayLike<number> | null | undefined): Vector3 | undefined {
  if (!value || typeof value.length !== 'number' || value.length < 3) {
    return undefined;
  }

  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (![x, y, z].every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  return { x, y, z };
}

export function toQuaternionWxyz(
  value: ArrayLike<number> | null | undefined,
): [number, number, number, number] | undefined {
  if (!value || typeof value.length !== 'number' || value.length < 4) {
    return undefined;
  }

  const w = Number(value[0]);
  const x = Number(value[1]);
  const y = Number(value[2]);
  const z = Number(value[3]);
  if (![w, x, y, z].every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  return [w, x, y, z];
}

export function resolveUsdPhysicsFrameFromViewerEntry(
  entry: JointCatalogEntry,
): UrdfJointUsdPhysicsFrame | undefined {
  const jointTypeName = String(
    entry.usdPhysicsJointTypeName || entry.jointTypeName || entry.jointType || '',
  ).trim();
  const isUsdPhysicsJointEntry = /Physics[A-Za-z]*Joint/i.test(jointTypeName);
  const axisToken = String(entry.axisToken || '').trim();
  const localPos0 =
    toOptionalVector3(entry.localPos0) ??
    (isUsdPhysicsJointEntry || axisToken ? toOptionalVector3(entry.originXyz) : undefined);
  const localRot0Wxyz = toQuaternionWxyz(entry.localRot0Wxyz);
  const localPos1 = toOptionalVector3(entry.localPos1);
  const localRot1Wxyz = toQuaternionWxyz(entry.localRot1Wxyz);
  const limitAxes =
    entry.usdLimitAxes && typeof entry.usdLimitAxes === 'object'
      ? structuredClone(entry.usdLimitAxes)
      : undefined;
  const driveAxes =
    entry.usdDriveAxes && typeof entry.usdDriveAxes === 'object'
      ? structuredClone(entry.usdDriveAxes)
      : undefined;

  if (
    !jointTypeName &&
    !localPos0 &&
    !localRot0Wxyz &&
    !localPos1 &&
    !localRot1Wxyz &&
    !axisToken &&
    !limitAxes &&
    !driveAxes
  ) {
    return undefined;
  }

  return {
    ...(jointTypeName ? { jointTypeName } : {}),
    ...(axisToken ? { axisToken } : {}),
    ...(localPos0 ? { localPos0 } : {}),
    ...(localRot0Wxyz ? { localRot0Wxyz } : {}),
    ...(localPos1 ? { localPos1 } : {}),
    ...(localRot1Wxyz ? { localRot1Wxyz } : {}),
    ...(limitAxes ? { limitAxes } : {}),
    ...(driveAxes ? { driveAxes } : {}),
  };
}

export function quaternionComponentsToEuler(
  x: unknown,
  y: unknown,
  z: unknown,
  w: unknown,
  fallback: Euler = { r: 0, p: 0, y: 0 },
): Euler {
  const quaternion = new THREE.Quaternion(
    Number(x) || 0,
    Number(y) || 0,
    Number(z) || 0,
    Number(w) || 0,
  );
  if (quaternion.lengthSq() <= 1e-12) {
    return fallback;
  }

  quaternion.normalize();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(quaternion, 'ZYX');
  return {
    r: euler.x,
    p: euler.y,
    y: euler.z,
  };
}

export function getDynamicsOriginRotation(dynamicsEntry?: LinkDynamicsEntry | null): Euler {
  const principalAxesLocal = dynamicsEntry?.principalAxesLocal;
  if (
    principalAxesLocal &&
    typeof principalAxesLocal.length === 'number' &&
    principalAxesLocal.length >= 4
  ) {
    return quaternionComponentsToEuler(
      principalAxesLocal[0],
      principalAxesLocal[1],
      principalAxesLocal[2],
      principalAxesLocal[3],
    );
  }

  const principalAxesLocalWxyz = dynamicsEntry?.principalAxesLocalWxyz;
  if (
    principalAxesLocalWxyz &&
    typeof principalAxesLocalWxyz.length === 'number' &&
    principalAxesLocalWxyz.length >= 4
  ) {
    return quaternionComponentsToEuler(
      principalAxesLocalWxyz[1],
      principalAxesLocalWxyz[2],
      principalAxesLocalWxyz[3],
      principalAxesLocalWxyz[0],
    );
  }

  return { r: 0, p: 0, y: 0 };
}

export function degreesToRadians(value: number | null | undefined): number | undefined {
  return Number.isFinite(Number(value)) ? (Number(value) * Math.PI) / 180 : undefined;
}

export function jointTypeFromViewerValue(value: string | null | undefined): JointType {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return JointType.REVOLUTE;
  }

  if (normalized === 'fixed' || normalized.includes('fixed')) {
    return JointType.FIXED;
  }
  if (normalized === 'continuous' || normalized.includes('continuous')) {
    return JointType.CONTINUOUS;
  }
  if (normalized === 'prismatic' || normalized.includes('prismatic')) {
    return JointType.PRISMATIC;
  }
  if (normalized === 'ball' || normalized.includes('ball') || normalized.includes('spherical')) {
    return JointType.BALL;
  }
  if (normalized === 'planar' || normalized.includes('planar')) {
    return JointType.PLANAR;
  }
  if (normalized === 'floating' || normalized.includes('floating')) {
    return JointType.FLOATING;
  }
  if (
    normalized === 'joint' ||
    normalized === 'physicsjoint' ||
    normalized === 'usdphysicsjoint' ||
    normalized === 'free' ||
    normalized.includes('d6') ||
    normalized.includes('6dof') ||
    normalized.includes('sixdof') ||
    normalized.includes('generic') ||
    normalized.includes('freejoint') ||
    normalized.includes('distance')
  ) {
    return JointType.FLOATING;
  }

  return JointType.REVOLUTE;
}

export function axisFromToken(token: string | null | undefined): Vector3 {
  const normalized = String(token || '')
    .trim()
    .toUpperCase();
  switch (normalized) {
    case 'Y':
      return { x: 0, y: 1, z: 0 };
    case 'Z':
      return { x: 0, y: 0, z: 1 };
    case 'X':
    default:
      return { x: 1, y: 0, z: 0 };
  }
}

export function axisFromViewerEntry(entry: JointCatalogEntry): Vector3 {
  const axisLocal = entry.axisLocal;
  if (axisLocal && typeof axisLocal.length === 'number' && axisLocal.length >= 3) {
    const vector = toVector3(axisLocal, axisFromToken(entry.axisToken));
    if (vector.x !== 0 || vector.y !== 0 || vector.z !== 0) {
      return vector;
    }
  }
  return axisFromToken(entry.axisToken);
}

export function geometryTypeFromCollisionPrimitive(
  counts: MeshPrimitiveCounts | null | undefined,
): GeometryType {
  if (!counts || typeof counts !== 'object') {
    return GeometryType.MESH;
  }

  const preferredOrder: Array<[string, GeometryType]> = [
    ['box', GeometryType.BOX],
    ['cube', GeometryType.BOX],
    ['sphere', GeometryType.SPHERE],
    ['cylinder', GeometryType.CYLINDER],
    ['capsule', GeometryType.CAPSULE],
    ['mesh', GeometryType.MESH],
  ];

  for (const [key, geometryType] of preferredOrder) {
    if (Number(counts[key] || 0) > 0) {
      return geometryType;
    }
  }

  return GeometryType.MESH;
}

export function createPlaceholderVisual(
  type: GeometryType,
  color: string,
  meshPath?: string,
): UrdfVisual {
  return {
    ...DEFAULT_LINK.visual,
    type,
    color,
    meshPath,
    dimensions: type === GeometryType.NONE ? { x: 0, y: 0, z: 0 } : { x: 1, y: 1, z: 1 },
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

export function getCollisionGeometryVisualProxy(link: UrdfLink): UrdfVisual | null {
  const candidates = [link.collision, ...(link.collisionBodies || [])];

  for (const candidate of candidates) {
    if (candidate && candidate.type !== GeometryType.NONE) {
      return candidate;
    }
  }

  return null;
}

export function createUniqueId(base: string, used: Set<string>, fallbackPath: string): string {
  const normalizedBase = String(base || 'link').replace(/[^\w]+/g, '_') || 'link';
  if (!used.has(normalizedBase)) {
    used.add(normalizedBase);
    return normalizedBase;
  }

  const sanitizedPath =
    String(fallbackPath || '')
      .replace(/[^\w]+/g, '_')
      .replace(/^_+|_+$/g, '') || normalizedBase;
  if (!used.has(sanitizedPath)) {
    used.add(sanitizedPath);
    return sanitizedPath;
  }

  let suffix = 2;
  while (used.has(`${sanitizedPath}_${suffix}`)) {
    suffix += 1;
  }
  const candidate = `${sanitizedPath}_${suffix}`;
  used.add(candidate);
  return candidate;
}
