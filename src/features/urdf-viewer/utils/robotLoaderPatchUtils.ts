import type { RefObject } from 'react';
import * as THREE from 'three';
import { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import type { VisualMaterialOverride } from '@/core/utils/visualMaterialOverrides';
import { disposeObject3D, disposeMaterial } from './dispose';
import { disposeReplacedMaterials } from '@/shared/components/3d/materialDisposal';
import {
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  createHighlightOverrideMaterial,
  createMatteMaterial,
} from './materials';
import { SHARED_MATERIALS } from '../constants';
import { DEFAULT_RPY, DEFAULT_VEC3 } from './robotLoaderDiff';
import { syncMjcfTendonVisualMeshMap } from './mjcfTendonVisualMeshMap';
import type { UrdfJoint, UrdfVisual as LinkGeometry } from '@/types';
import { applyURDFMaterialInfoToMaterial, type URDFMaterialInfo } from './urdfMaterials';

export { disposeReplacedMaterials } from '@/shared/components/3d/materialDisposal';

function normalizeVisualColorOverride(color: string | undefined): string | undefined {
  const trimmed = color?.trim();
  return trimmed ? trimmed : undefined;
}

function meshUsesAuthoredVertexColors(mesh: THREE.Mesh): boolean {
  if (!mesh.geometry?.getAttribute('color')) {
    return false;
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some(
    (material) =>
      Boolean(material) &&
      ((material as { vertexColors?: boolean }).vertexColors === true ||
        material.userData?.usesVertexColors === true),
  );
}

function normalizeUnitIntervalValue(value: unknown): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value: unknown): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

function normalizeMaterialOverride(
  override: VisualMaterialOverride | string | undefined,
): VisualMaterialOverride | null {
  if (typeof override === 'string') {
    const color = normalizeVisualColorOverride(override);
    return color ? { color } : null;
  }

  if (!override) {
    return null;
  }

  const color = normalizeVisualColorOverride(override.color);
  const texture = normalizeVisualColorOverride(override.texture);
  const emissive = normalizeVisualColorOverride(override.emissive);
  const opacity = normalizeUnitIntervalValue(override.opacity);
  const roughness = normalizeUnitIntervalValue(override.roughness);
  const metalness = normalizeUnitIntervalValue(override.metalness);
  const emissiveIntensity = normalizeNonNegativeValue(override.emissiveIntensity);

  if (
    !color &&
    !texture &&
    opacity === undefined &&
    roughness === undefined &&
    metalness === undefined &&
    !emissive &&
    emissiveIntensity === undefined
  ) {
    return null;
  }

  return {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    ...(metalness !== undefined ? { metalness } : {}),
    ...(emissive ? { emissive } : {}),
    ...(emissiveIntensity !== undefined ? { emissiveIntensity } : {}),
  };
}

function resolveEmissiveColor(material: THREE.Material): THREE.Color | undefined {
  const parsedUrdfEmissive = material.userData?.urdfEmissiveApplied
    ? parseThreeColorWithOpacity(material.userData.urdfEmissive)
    : null;
  if (parsedUrdfEmissive?.color) {
    return parsedUrdfEmissive.color.clone();
  }

  const originalEmissive = material.userData?.originalEmissive;
  if ((originalEmissive as THREE.Color | undefined)?.isColor) {
    return (originalEmissive as THREE.Color).clone();
  }

  const materialEmissive = (material as THREE.MeshStandardMaterial & { emissive?: THREE.Color })
    .emissive;
  if (materialEmissive?.isColor) {
    return materialEmissive.clone();
  }

  return undefined;
}

function resolveExistingMaterialParams(material: THREE.Material) {
  const materialWithPbrState = material as THREE.MeshStandardMaterial;
  const resolvedOpacity =
    normalizeUnitIntervalValue(
      material.userData?.urdfOpacityApplied ? material.userData.urdfOpacity : undefined,
    ) ??
    material.opacity ??
    1;
  const resolvedRoughness =
    normalizeUnitIntervalValue(
      material.userData?.urdfRoughnessApplied ? material.userData.urdfRoughness : undefined,
    ) ??
    normalizeUnitIntervalValue(materialWithPbrState.roughness) ??
    normalizeUnitIntervalValue(material.userData?.originalRoughness);
  const resolvedMetalness =
    normalizeUnitIntervalValue(
      material.userData?.urdfMetalnessApplied ? material.userData.urdfMetalness : undefined,
    ) ??
    normalizeUnitIntervalValue(materialWithPbrState.metalness) ??
    normalizeUnitIntervalValue(material.userData?.originalMetalness);
  const resolvedEmissive = resolveEmissiveColor(material);
  const resolvedEmissiveIntensity =
    normalizeNonNegativeValue(
      material.userData?.urdfEmissiveIntensityApplied
        ? material.userData.urdfEmissiveIntensity
        : undefined,
    ) ??
    normalizeNonNegativeValue(materialWithPbrState.emissiveIntensity) ??
    normalizeNonNegativeValue(material.userData?.originalEmissiveIntensity);

  return {
    opacity: resolvedOpacity,
    roughness: resolvedRoughness,
    metalness: resolvedMetalness,
    emissive: resolvedEmissive,
    emissiveIntensity: resolvedEmissiveIntensity,
  };
}

export interface HighlightedMaterialStateSnapshot {
  transparent: boolean;
  opacity: number;
  depthTest: boolean;
  depthWrite: boolean;
  colorHex?: number;
  emissiveHex?: number;
  emissiveIntensity?: number;
}

export interface HighlightedMeshSnapshotLike {
  material: THREE.Material | THREE.Material[];
  materialStates: HighlightedMaterialStateSnapshot[];
  activeRole: 'visual' | 'collision' | null;
}

export function captureHighlightedMaterialState(
  material: THREE.Material,
): HighlightedMaterialStateSnapshot {
  return {
    transparent: material.transparent ?? false,
    opacity: material.opacity ?? 1,
    depthTest: material.depthTest ?? true,
    depthWrite: material.depthWrite ?? true,
    colorHex: (material as any)?.color?.isColor ? (material as any).color.getHex() : undefined,
    emissiveHex: (material as any)?.emissive?.isColor
      ? (material as any).emissive.getHex()
      : undefined,
    emissiveIntensity: Number.isFinite((material as any)?.emissiveIntensity)
      ? Number((material as any).emissiveIntensity)
      : undefined,
  };
}

export function getHighlightedMeshSnapshot(mesh: THREE.Mesh): HighlightedMeshSnapshotLike | null {
  const snapshot = mesh.userData?.__urdfHighlightSnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  if (!('material' in snapshot) || !('materialStates' in snapshot)) {
    return null;
  }

  return snapshot as HighlightedMeshSnapshotLike;
}

export function applyOriginToGroup(
  group: THREE.Object3D,
  origin: LinkGeometry['origin'] | undefined,
): void {
  const xyz = origin?.xyz || DEFAULT_VEC3;
  const rpy = origin?.rpy || DEFAULT_RPY;

  group.position.set(xyz.x, xyz.y, xyz.z);
  group.rotation.set(0, 0, 0);
  group.quaternion.setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
}

export function applyOriginToJoint(
  joint: RuntimeURDFJoint,
  origin: UrdfJoint['origin'] | undefined,
): void {
  const xyz = origin?.xyz || DEFAULT_VEC3;
  const rpy = origin?.rpy || DEFAULT_RPY;

  joint.position.set(xyz.x, xyz.y, xyz.z);
  joint.rotation.set(0, 0, 0);
  joint.quaternion.setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
}

export function clearGroupChildren(group: THREE.Object3D): void {
  while (group.children.length > 0) {
    disposeObject3D(group.children[0], true, SHARED_MATERIALS);
  }
}

export function disposeTempMaterialMap(materials: Map<string, THREE.Material>): void {
  materials.forEach((material) => {
    if (!SHARED_MATERIALS.has(material)) {
      disposeMaterial(material, true, SHARED_MATERIALS);
    }
  });
}

export function findRobotLinkObject(
  robotModel: THREE.Object3D,
  linkName: string,
): THREE.Object3D | null {
  const links = (robotModel as any).links as Record<string, THREE.Object3D> | undefined;
  if (links?.[linkName]) return links[linkName];

  let found: THREE.Object3D | null = null;
  robotModel.traverse((child: any) => {
    if (!found && child.isURDFLink && child.name === linkName) {
      found = child;
    }
  });

  return found;
}

export function updateVisualMaterial(
  mesh: THREE.Mesh,
  override: VisualMaterialOverride | string | undefined,
  disposedMaterials: Set<THREE.Material>,
): void {
  const normalizedOverride = normalizeMaterialOverride(override);
  if (!normalizedOverride) {
    return;
  }

  const parsedColorOverride = parseThreeColorWithOpacity(normalizedOverride.color);
  const parsedEmissiveOverride = parseThreeColorWithOpacity(normalizedOverride.emissive);
  const highlightedSnapshot = getHighlightedMeshSnapshot(mesh);

  const update = (mat: THREE.Material): THREE.Material => {
    const map = (mat as any).map || null;
    const existingParams = resolveExistingMaterialParams(mat);
    const effectiveColor =
      parsedColorOverride?.color ??
      (mat.userData?.urdfColorApplied
        ? (parseThreeColorWithOpacity(mat.userData.urdfColor)?.color ?? null)
        : null) ??
      ((mat as any).color?.clone?.() || new THREE.Color('#ffffff'));
    const effectiveOpacity =
      normalizedOverride.opacity ?? parsedColorOverride?.opacity ?? existingParams.opacity;
    const effectiveRoughness = normalizedOverride.roughness ?? existingParams.roughness;
    const effectiveMetalness = normalizedOverride.metalness ?? existingParams.metalness;
    const effectiveEmissive = parsedEmissiveOverride?.color ?? existingParams.emissive;
    const effectiveEmissiveIntensity =
      normalizedOverride.emissiveIntensity ?? existingParams.emissiveIntensity;
    const next = createMatteMaterial({
      color: effectiveColor,
      opacity: effectiveOpacity,
      transparent: mat.transparent || effectiveOpacity < 1,
      side: mat.side,
      map,
      roughness: effectiveRoughness,
      metalness: effectiveMetalness,
      emissive: effectiveEmissive,
      emissiveIntensity: effectiveEmissiveIntensity,
      name: mat.name,
      preserveExactColor:
        Boolean(parsedColorOverride) || Boolean(map) || Boolean(parsedEmissiveOverride),
    });
    next.userData = {
      ...(mat.userData ?? {}),
      ...(next.userData ?? {}),
    };
    if (parsedColorOverride) {
      next.userData.urdfColorApplied = true;
      next.userData.urdfColor = parsedColorOverride.color.clone();
    }
    if (normalizedOverride.opacity !== undefined) {
      next.userData.urdfOpacityApplied = true;
      next.userData.urdfOpacity = normalizedOverride.opacity;
    }
    if (normalizedOverride.roughness !== undefined) {
      next.userData.urdfRoughnessApplied = true;
      next.userData.urdfRoughness = normalizedOverride.roughness;
    }
    if (normalizedOverride.metalness !== undefined) {
      next.userData.urdfMetalnessApplied = true;
      next.userData.urdfMetalness = normalizedOverride.metalness;
    }
    if (parsedEmissiveOverride) {
      next.userData.urdfEmissiveApplied = true;
      next.userData.urdfEmissive = parsedEmissiveOverride.color.clone();
    }
    if (normalizedOverride.emissiveIntensity !== undefined) {
      next.userData.urdfEmissiveIntensityApplied = true;
      next.userData.urdfEmissiveIntensity = normalizedOverride.emissiveIntensity;
    }
    return next;
  };

  if (highlightedSnapshot?.activeRole) {
    const previousVisibleMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const previousSnapshotMaterial = highlightedSnapshot.material;
    const snapshotMaterials = Array.isArray(previousSnapshotMaterial)
      ? previousSnapshotMaterial
      : [previousSnapshotMaterial];
    const nextBaseMaterials = snapshotMaterials.map((mat) => update(mat));
    const nextVisibleMaterials = nextBaseMaterials.map((mat) =>
      createHighlightOverrideMaterial(mat, highlightedSnapshot.activeRole || 'visual'),
    );

    highlightedSnapshot.material = Array.isArray(previousSnapshotMaterial)
      ? nextBaseMaterials
      : nextBaseMaterials[0];
    highlightedSnapshot.materialStates = nextBaseMaterials.map((mat) =>
      captureHighlightedMaterialState(mat),
    );
    mesh.material = Array.isArray(previousVisibleMaterial)
      ? nextVisibleMaterials
      : nextVisibleMaterials[0];

    disposeReplacedMaterials(previousVisibleMaterial, disposedMaterials, false);
    disposeReplacedMaterials(previousSnapshotMaterial, disposedMaterials, false);
    return;
  }

  const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((mat) => update(mat));
  } else if (mesh.material) {
    mesh.material = update(mesh.material);
  }

  disposeReplacedMaterials(previousMaterial, disposedMaterials, false);
}

export function updateVisualMaterialPalette(
  mesh: THREE.Mesh,
  materials: Map<string, URDFMaterialInfo>,
  disposedMaterials: Set<THREE.Material>,
): void {
  if (materials.size === 0) {
    return;
  }

  const highlightedSnapshot = getHighlightedMeshSnapshot(mesh);
  const applyPalette = (material: THREE.Material): THREE.Material =>
    applyURDFMaterialInfoToMaterial(material, materials);

  if (highlightedSnapshot?.activeRole) {
    const previousVisibleMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const previousSnapshotMaterial = highlightedSnapshot.material;
    const snapshotMaterials = Array.isArray(previousSnapshotMaterial)
      ? previousSnapshotMaterial
      : [previousSnapshotMaterial];
    const nextBaseMaterials = snapshotMaterials.map(applyPalette);
    const changed = nextBaseMaterials.some(
      (material, index) => material !== snapshotMaterials[index],
    );
    if (!changed) {
      return;
    }

    const nextVisibleMaterials = nextBaseMaterials.map((material) =>
      createHighlightOverrideMaterial(material, highlightedSnapshot.activeRole || 'visual'),
    );
    highlightedSnapshot.material = Array.isArray(previousSnapshotMaterial)
      ? nextBaseMaterials
      : nextBaseMaterials[0];
    highlightedSnapshot.materialStates = nextBaseMaterials.map((material) =>
      captureHighlightedMaterialState(material),
    );
    mesh.material = Array.isArray(previousVisibleMaterial)
      ? nextVisibleMaterials
      : nextVisibleMaterials[0];

    disposeReplacedMaterials(previousVisibleMaterial, disposedMaterials, false);
    disposeReplacedMaterials(previousSnapshotMaterial, disposedMaterials, false);
    return;
  }

  const previousMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
  const previousMaterials = Array.isArray(previousMaterial)
    ? previousMaterial
    : previousMaterial
      ? [previousMaterial]
      : [];
  const nextMaterials = previousMaterials.map(applyPalette);
  const changed = nextMaterials.some((material, index) => material !== previousMaterials[index]);
  if (!changed) {
    return;
  }

  mesh.material = Array.isArray(previousMaterial) ? nextMaterials : nextMaterials[0];
  disposeReplacedMaterials(previousMaterial, disposedMaterials, false);
}

export function markVisualObject(
  obj: THREE.Object3D,
  linkName: string,
  color: string | undefined,
  showVisual: boolean,
): void {
  const colorOverride = normalizeVisualColorOverride(color);
  const disposedMaterials = new Set<THREE.Material>();

  obj.traverse((child: any) => {
    if (!child.isMesh) return;
    child.userData.parentLinkName = linkName;
    child.userData.isVisualMesh = true;
    child.visible = showVisual;
    if (colorOverride && !meshUsesAuthoredVertexColors(child)) {
      updateVisualMaterial(child, colorOverride, disposedMaterials);
    }
  });
}

export function markCollisionObject(obj: THREE.Object3D, linkName: string): void {
  const disposedMaterials = new Set<THREE.Material>();

  obj.traverse((child: any) => {
    if (!child.isMesh) return;

    const previousMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
    child.userData.parentLinkName = linkName;
    child.userData.isCollisionMesh = true;
    child.userData.isCollision = true;
    child.userData.isVisual = false;
    child.userData.isVisualMesh = false;
    child.material = collisionBaseMaterial;
    child.renderOrder = COLLISION_OVERLAY_RENDER_ORDER;

    disposeReplacedMaterials(previousMaterial, disposedMaterials, true);
  });
}

export function rebuildLinkMeshMapForLink(
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>,
  linkObject: THREE.Object3D,
  linkName: string,
): void {
  const visualKey = `${linkName}:visual`;
  const collisionKey = `${linkName}:collision`;
  const visualMeshes: THREE.Mesh[] = [];
  const collisionMeshes: THREE.Mesh[] = [];

  const collectGroupMeshes = (group: THREE.Object3D, kind: 'visual' | 'collision') => {
    group.traverse((child: any) => {
      if (!child.isMesh) return;
      if (child.userData?.isGizmo || String(child.name || '').startsWith('__')) return;

      child.userData.parentLinkName = linkName;

      if (kind === 'collision') {
        child.userData.isCollisionMesh = true;
        child.userData.isVisualMesh = false;
        collisionMeshes.push(child as THREE.Mesh);
      } else {
        child.userData.isVisualMesh = true;
        child.userData.isCollisionMesh = false;
        visualMeshes.push(child as THREE.Mesh);
      }
    });
  };

  linkObject.children.forEach((child: any) => {
    if (child.userData?.isGizmo || String(child.name || '').startsWith('__')) return;

    if (child.isURDFCollider || child.userData?.isCollisionGroup === true) {
      collectGroupMeshes(child, 'collision');
      return;
    }

    if (child.isURDFVisual) {
      collectGroupMeshes(child, 'visual');
      return;
    }

    if (child.isMesh) {
      child.userData.parentLinkName = linkName;
      child.userData.isVisualMesh = true;
      child.userData.isCollisionMesh = false;
      visualMeshes.push(child as THREE.Mesh);
    }
  });

  linkMeshMapRef.current.delete(visualKey);
  linkMeshMapRef.current.delete(collisionKey);
  if (visualMeshes.length > 0) linkMeshMapRef.current.set(visualKey, visualMeshes);
  if (collisionMeshes.length > 0) linkMeshMapRef.current.set(collisionKey, collisionMeshes);

  let robotRoot: THREE.Object3D = linkObject;
  while (robotRoot.parent) {
    robotRoot = robotRoot.parent;
  }

  syncMjcfTendonVisualMeshMap(linkMeshMapRef.current, robotRoot, linkName);
}

function normalizeLinkName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIgnoredLinkMesh(mesh: THREE.Mesh): boolean {
  if (
    mesh.userData?.isGizmo === true ||
    mesh.userData?.isHelper === true ||
    mesh.userData?.isSelectableHelper === true ||
    mesh.userData?.isMjcfTendon === true
  ) {
    return true;
  }

  return String(mesh.name || '').startsWith('__');
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (!current.visible) {
      return false;
    }

    current = current.parent;
  }

  return true;
}

function resolveLinkMeshRole(mesh: THREE.Mesh): 'visual' | 'collision' | null {
  let current: THREE.Object3D | null = mesh;
  let role: 'visual' | 'collision' | null = null;

  while (current) {
    if (
      current.userData?.isCollisionMesh === true ||
      current.userData?.isCollision === true ||
      current.userData?.isCollisionGroup === true ||
      current.userData?.geometryRole === 'collision' ||
      (current as any).isURDFCollider === true
    ) {
      role = 'collision';
    } else if (
      !role &&
      (current.userData?.isVisualMesh === true ||
        current.userData?.isVisual === true ||
        current.userData?.isVisualGroup === true ||
        current.userData?.geometryRole === 'visual' ||
        (current as any).isURDFVisual === true)
    ) {
      role = 'visual';
    }

    current = current.parent;
  }

  return role;
}

function resolveAncestorLinkMetadata(mesh: THREE.Mesh): {
  semanticLinkName: string | null;
  runtimeLinkName: string | null;
} {
  let current: THREE.Object3D | null = mesh;
  let semanticLinkName: string | null = null;
  let runtimeLinkName: string | null = null;

  while (current) {
    semanticLinkName ??= normalizeLinkName(current.userData?.parentLinkName);
    runtimeLinkName ??= normalizeLinkName(current.userData?.runtimeParentLinkName);

    if ((current as any).isURDFLink === true) {
      const currentLinkName = normalizeLinkName(current.name);
      semanticLinkName ??= currentLinkName;
      runtimeLinkName ??= currentLinkName;
    }

    current = current.parent;
  }

  return { semanticLinkName, runtimeLinkName };
}

export function rebuildLinkMeshMapFromRobot(
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>,
  robot: THREE.Object3D,
): void {
  const nextLinkMeshMap = new Map<string, THREE.Mesh[]>();

  const pushMesh = (key: string, mesh: THREE.Mesh) => {
    const existingMeshes = nextLinkMeshMap.get(key);
    if (existingMeshes) {
      existingMeshes.push(mesh);
      return;
    }

    nextLinkMeshMap.set(key, [mesh]);
  };

  robot.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (isIgnoredLinkMesh(mesh) || !mesh.geometry) {
      return;
    }

    const role = resolveLinkMeshRole(mesh);
    if (!role) {
      return;
    }

    if (role === 'collision' && !isVisibleInHierarchy(mesh)) {
      return;
    }

    const { semanticLinkName, runtimeLinkName } = resolveAncestorLinkMetadata(mesh);
    if (!semanticLinkName) {
      return;
    }

    mesh.userData.parentLinkName = semanticLinkName;
    if (runtimeLinkName) {
      mesh.userData.runtimeParentLinkName = runtimeLinkName;
    }
    mesh.userData.isCollisionMesh = role === 'collision';
    mesh.userData.isCollision = role === 'collision';
    mesh.userData.isVisual = role === 'visual';
    mesh.userData.isVisualMesh = role === 'visual';

    pushMesh(`${semanticLinkName}:${role}`, mesh);
  });

  syncMjcfTendonVisualMeshMap(nextLinkMeshMap, robot);
  linkMeshMapRef.current = nextLinkMeshMap;
}
