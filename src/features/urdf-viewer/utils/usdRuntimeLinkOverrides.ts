import * as THREE from 'three';
import { getCollisionGeometryByObjectIndex, getVisualGeometryByObjectIndex } from '@/core/robot';
import { GeometryType, type UrdfLink, type UrdfVisual } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';

const DEFAULT_POSITION = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION = { r: 0, p: 0, y: 0 };
const DEFAULT_SCALE = { x: 1, y: 1, z: 1 };

export interface UsdRuntimeLinkDynamicsRecord {
  linkPath: string;
  mass: number;
  centerOfMassLocal: THREE.Vector3;
  diagonalInertia: THREE.Vector3 | null;
  principalAxesLocal: THREE.Quaternion;
}

function toQuaternionFromGeometryOrigin(origin?: UrdfVisual['origin']): THREE.Quaternion {
  const rpy = origin?.rpy || DEFAULT_ROTATION;
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
}

function normalizeColor(value?: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function resolveUsdRuntimeGeometry(
  link: UrdfLink | null | undefined,
  role: 'visual' | 'collision',
  objectIndex?: number,
): UrdfVisual | undefined {
  if (!link) {
    return undefined;
  }

  if (role === 'visual') {
    return getVisualGeometryByObjectIndex(link, objectIndex ?? 0)?.geometry;
  }

  if (typeof objectIndex !== 'number' || !Number.isInteger(objectIndex) || objectIndex < 0) {
    return undefined;
  }

  return getCollisionGeometryByObjectIndex(link, objectIndex)?.geometry;
}

export function isUsdRuntimeGeometryVisible({
  link,
  role,
  objectIndex,
  showVisual,
  showCollision,
  respectLinkVisibility = true,
}: {
  link: UrdfLink | null | undefined;
  role: 'visual' | 'collision';
  objectIndex?: number;
  showVisual: boolean;
  showCollision: boolean;
  respectLinkVisibility?: boolean;
}): boolean {
  if (role === 'collision' && !Number.isInteger(objectIndex)) {
    return false;
  }

  const geometry = resolveUsdRuntimeGeometry(link, role, objectIndex);
  if (geometry?.type === GeometryType.NONE) {
    return false;
  }

  if (role === 'visual') {
    return showVisual && link?.visible !== false && geometry?.visible !== false;
  }

  return (
    showCollision &&
    (!respectLinkVisibility || link?.visible !== false) &&
    geometry?.visible !== false
  );
}

export function composeUsdGeometryLocalOverrideMatrix(
  geometry: UrdfVisual | null | undefined,
): THREE.Matrix4 {
  const position = geometry?.origin?.xyz || DEFAULT_POSITION;
  const scale = geometry?.dimensions || DEFAULT_SCALE;

  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    toQuaternionFromGeometryOrigin(geometry?.origin),
    new THREE.Vector3(scale.x, scale.y, scale.z),
  );
}

export function composeUsdMeshOverrideWorldMatrix({
  authoredWorldMatrix,
  geometry,
  linkWorldMatrix,
}: {
  authoredWorldMatrix: THREE.Matrix4;
  geometry: UrdfVisual | null | undefined;
  linkWorldMatrix: THREE.Matrix4;
}): THREE.Matrix4 {
  const linkWorldInverse = linkWorldMatrix.clone().invert();
  return composeUsdMeshOverrideWorldMatrixFromBaseLocal({
    baseLocalMatrix: linkWorldInverse.multiply(authoredWorldMatrix.clone()),
    geometry,
    linkWorldMatrix,
  });
}

export function deriveUsdMeshBaseLocalMatrix({
  authoredWorldMatrix,
  baselineGeometry,
  linkWorldMatrix,
}: {
  authoredWorldMatrix: THREE.Matrix4;
  baselineGeometry: UrdfVisual | null | undefined;
  linkWorldMatrix: THREE.Matrix4;
}): THREE.Matrix4 {
  const authoredLocalMatrix = linkWorldMatrix
    .clone()
    .invert()
    .multiply(authoredWorldMatrix.clone());
  const baselineGeometryLocalMatrix = composeUsdGeometryLocalOverrideMatrix(baselineGeometry);

  return baselineGeometryLocalMatrix.clone().invert().multiply(authoredLocalMatrix);
}

export function composeUsdMeshOverrideWorldMatrixFromBaseLocal({
  baseLocalMatrix,
  geometry,
  linkWorldMatrix,
}: {
  baseLocalMatrix: THREE.Matrix4;
  geometry: UrdfVisual | null | undefined;
  linkWorldMatrix: THREE.Matrix4;
}): THREE.Matrix4 {
  return linkWorldMatrix
    .clone()
    .multiply(composeUsdGeometryLocalOverrideMatrix(geometry))
    .multiply(baseLocalMatrix.clone());
}

function hasMultipleRuntimeAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  return Array.isArray(geometry?.authoredMaterials) && geometry.authoredMaterials.length > 1;
}

function hasMultipleVisualMaterialSlots(mesh: THREE.Mesh | null | undefined): boolean {
  if (!mesh) {
    return false;
  }

  const materialCount = Array.isArray(mesh.material)
    ? mesh.material.filter(Boolean).length
    : mesh.material
      ? 1
      : 0;
  if (materialCount > 1) {
    return true;
  }

  const groups = Array.isArray(mesh.geometry?.groups) ? mesh.geometry.groups : [];
  const materialIndexes = new Set<number>();
  for (const group of groups) {
    const materialIndex = Number(group?.materialIndex ?? 0);
    if (!Number.isInteger(materialIndex) || materialIndex < 0) {
      continue;
    }
    materialIndexes.add(materialIndex);
    if (materialIndexes.size > 1) {
      return true;
    }
  }

  return false;
}

export function resolveUsdVisualColorOverride(
  currentGeometry: UrdfVisual | null | undefined,
  baselineGeometry: UrdfVisual | null | undefined,
): string | null {
  if (
    hasMultipleRuntimeAuthoredMaterials(currentGeometry) ||
    hasMultipleRuntimeAuthoredMaterials(baselineGeometry)
  ) {
    return null;
  }

  const currentColor = normalizeColor(currentGeometry?.color);
  if (!currentColor) {
    return null;
  }

  return currentColor !== normalizeColor(baselineGeometry?.color)
    ? currentGeometry?.color?.trim() || null
    : null;
}

export function resolveUsdVisualColorOverrideForMesh(
  mesh: THREE.Mesh | null | undefined,
  currentGeometry: UrdfVisual | null | undefined,
  baselineGeometry: UrdfVisual | null | undefined,
): string | null {
  const colorOverride = resolveUsdVisualColorOverride(currentGeometry, baselineGeometry);
  if (!colorOverride) {
    return null;
  }

  return hasMultipleVisualMaterialSlots(mesh) ? null : colorOverride;
}

export function createUsdLinkDynamicsRecord(
  linkPath: string,
  link: UrdfLink | null | undefined,
): UsdRuntimeLinkDynamicsRecord | null {
  const inertial = link?.inertial;
  if (!inertial || !Number.isFinite(Number(inertial.mass)) || Number(inertial.mass) <= 0) {
    return null;
  }

  const xyz = inertial.origin?.xyz || DEFAULT_POSITION;
  const diagonalInertia = new THREE.Vector3(
    Number(inertial.inertia.ixx) || 0,
    Number(inertial.inertia.iyy) || 0,
    Number(inertial.inertia.izz) || 0,
  );

  return {
    linkPath,
    mass: Number(inertial.mass),
    centerOfMassLocal: new THREE.Vector3(xyz.x, xyz.y, xyz.z),
    diagonalInertia: diagonalInertia.lengthSq() > 1e-12 ? diagonalInertia : null,
    principalAxesLocal: toQuaternionFromGeometryOrigin(inertial.origin),
  };
}

export function buildUsdLinkDynamicsRecordMap({
  resolution,
  robotLinks,
}: {
  resolution: ViewerRobotDataResolution | null | undefined;
  robotLinks?: Record<string, UrdfLink> | null;
}): Map<string, UsdRuntimeLinkDynamicsRecord> {
  const records = new Map<string, UsdRuntimeLinkDynamicsRecord>();
  if (!resolution) {
    return records;
  }

  const sourceLinks = robotLinks || resolution.robotData.links;

  Object.entries(resolution.linkIdByPath).forEach(([linkPath, linkId]) => {
    const record = createUsdLinkDynamicsRecord(linkPath, sourceLinks[linkId]);
    if (record) {
      records.set(linkPath, record);
    }
  });

  return records;
}
