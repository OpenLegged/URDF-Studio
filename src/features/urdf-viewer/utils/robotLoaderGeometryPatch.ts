import type { RefObject } from 'react';
import * as THREE from 'three';
import { URDFCollider, URDFVisual } from '@/core/parsers/urdf/loader';
import { createLoadingManager, type ColladaRootNormalizationHints } from '@/core/loaders';
import {
  getBoxFaceMaterialPalette,
  getCollisionGeometryEntries,
  hasGeometryMeshMaterialGroups,
  getVisualGeometryEntries,
} from '@/core/robot';
import { createBoxFaceMaterialArray } from '@/core/utils/boxFaceMaterialArray';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { forceObjectMaterialSide } from '@/core/utils/three/materialSide';
import {
  applyVisualMaterialOverrideToObject,
  resolveVisualMaterialOverrideFromGeometry,
} from '@/core/utils/visualMaterialOverrides';
import { GeometryType } from '@/types';
import type { UrdfLink, UrdfVisual as LinkGeometry } from '@/types';
import { collisionBaseMaterial, createMatteMaterial, enhanceMaterials } from './materials';
import { disposeObject3D } from './dispose';
import { SHARED_MATERIALS } from '../constants';
import {
  DEFAULT_VEC3,
  type GeometryPatchCandidate,
  sameGeometry,
  sameOrigin,
  sameVec3,
  sameVisibleFlag,
} from './robotLoaderDiff';
import {
  applyOriginToGroup,
  clearGroupChildren,
  disposeReplacedMaterials,
  findRobotLinkObject,
  markCollisionObject,
  markVisualObject,
  rebuildLinkMeshMapForLink,
  updateVisualMaterialPalette,
  updateVisualMaterial,
} from './robotLoaderPatchUtils';
import { createViewerMeshLoader } from './createViewerMeshLoader';
import { applyURDFMaterials, collectURDFMaterialsFromVisualGeometry } from './urdfMaterials';
import { getSyntheticGeomParentName, resolveRuntimeGeometryRoot } from './runtimeGeometrySelection';

interface PatchCategoryOptions {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  linkName: string;
  category: 'visual' | 'collision';
  geometry: LinkGeometry;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
  targetGroup?: THREE.Object3D;
}

function patchGeometryCategory({
  robotModel,
  linkObject,
  linkName,
  category,
  geometry,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
  targetGroup: explicitTargetGroup,
}: PatchCategoryOptions): void {
  const isCollision = category === 'collision';

  const groupPredicate = isCollision
    ? (child: THREE.Object3D) => (child as any).isURDFCollider
    : (child: THREE.Object3D) => (child as any).isURDFVisual;

  let targetGroup =
    explicitTargetGroup ?? (linkObject.children.find(groupPredicate) as THREE.Object3D | undefined);

  if (!targetGroup) {
    targetGroup = isCollision ? new URDFCollider() : new URDFVisual();
    linkObject.add(targetGroup);
  } else if (targetGroup.parent !== linkObject) {
    linkObject.add(targetGroup);
  }

  targetGroup.visible = isCollision ? showCollision : true;
  clearGroupChildren(targetGroup);
  applyOriginToGroup(targetGroup, geometry.origin);

  const patchToken = ((targetGroup.userData.__patchToken as number) || 0) + 1;
  targetGroup.userData.__patchToken = patchToken;

  const dims = geometry.dimensions || DEFAULT_VEC3;
  const visualColor = geometry.color || '#808080';
  const boxFacePalette = !isCollision ? getBoxFaceMaterialPalette(geometry) : [];
  const createVisualMaterial = () =>
    createMatteMaterial({
      color: visualColor,
      preserveExactColor: Boolean(geometry.color),
    });
  const visualMaterialOverride =
    !isCollision && boxFacePalette.length === 0
      ? resolveVisualMaterialOverrideFromGeometry(geometry)
      : null;
  const authoredMaterialPalette =
    !isCollision && boxFacePalette.length === 0
      ? collectURDFMaterialsFromVisualGeometry(geometry)
      : null;
  const textureManager =
    !isCollision && visualMaterialOverride?.texture
      ? createLoadingManager(assets, sourceFileDir ?? '')
      : null;
  const applyPrimitiveVisualOverride = (mesh: THREE.Mesh) => {
    if (!isCollision && visualMaterialOverride) {
      applyVisualMaterialOverrideToObject(
        mesh,
        visualMaterialOverride,
        textureManager ?? undefined,
      );
    }
  };
  const addPrimitive = (mesh: THREE.Mesh) => {
    if (isCollision) {
      markCollisionObject(mesh, linkName);
    } else {
      markVisualObject(mesh, linkName, geometry.color, showVisual);
    }
    targetGroup!.add(mesh);
  };

  if (geometry.type === GeometryType.NONE) {
    rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
    robotModel.updateMatrixWorld(true);
    invalidate();
    return;
  }

  if (geometry.type === GeometryType.BOX) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      isCollision
        ? collisionBaseMaterial
        : boxFacePalette.length > 0
          ? createBoxFaceMaterialArray(
              boxFacePalette.map((entry) => entry.material),
              {
                fallbackColor: geometry.color,
                manager: createLoadingManager(assets, sourceFileDir ?? ''),
                label: 'EditorViewer:patch-box-face-material',
              },
            )
          : createVisualMaterial(),
    );
    mesh.scale.set(dims.x || 0.1, dims.y || 0.1, dims.z || 0.1);
    addPrimitive(mesh);
    applyPrimitiveVisualOverride(mesh);
  } else if (geometry.type === GeometryType.PLANE) {
    const material = isCollision ? collisionBaseMaterial : createVisualMaterial();
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(dims.x || 1, dims.y || 1, 1);
    addPrimitive(mesh);
    applyPrimitiveVisualOverride(mesh);

    // Add overlay meshes for multi-pass Gazebo materials (e.g. alpha-blended
    // texture layers like field marking lines on a grass carpet).
    if (!isCollision) {
      const authoredMaterial = geometry.authoredMaterials?.[0];
      const overlayPasses =
        authoredMaterial?.passes?.filter(
          (pass) => pass.texture && pass.sceneBlend === 'alpha_blend',
        ) ?? [];

      for (const overlayPass of overlayPasses) {
        if (!overlayPass.texture) {
          continue;
        }

        const overlayMat = createMatteMaterial({
          color: '#ffffff',
          opacity: 1,
          transparent: true,
          preserveExactColor: true,
        });
        overlayMat.side = THREE.DoubleSide;
        overlayMat.depthWrite = false;
        overlayMat.polygonOffset = true;
        overlayMat.polygonOffsetFactor = -1;
        overlayMat.polygonOffsetUnits = -1;

        const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat);
        overlayMesh.scale.set(dims.x || 1, dims.y || 1, 1);
        overlayMesh.renderOrder = 1;
        addPrimitive(overlayMesh);

        const overlayLoader = new THREE.TextureLoader(
          createLoadingManager(assets, sourceFileDir ?? ''),
        );
        overlayLoader.load(
          overlayPass.texture,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            overlayMat.map = texture;
            overlayMat.needsUpdate = true;
          },
          undefined,
          (error) => {
            console.error(
              '[EditorViewer] Failed to load multi-pass overlay texture:',
              overlayPass.texture,
              error,
            );
          },
        );
      }
    }
  } else if (geometry.type === GeometryType.SPHERE || geometry.type === GeometryType.ELLIPSOID) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 30, 30),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    const sx = dims.x || 0.1;
    const sy = dims.y || sx;
    const sz = dims.z || sx;
    mesh.scale.set(sx, sy, sz);
    addPrimitive(mesh);
    applyPrimitiveVisualOverride(mesh);
  } else if (geometry.type === GeometryType.CYLINDER) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 30),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    mesh.scale.set(dims.x || 0.05, dims.y || 0.5, dims.z || dims.x || 0.05);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    addPrimitive(mesh);
    applyPrimitiveVisualOverride(mesh);
  } else if (geometry.type === GeometryType.CAPSULE) {
    const radius = Math.max(dims.x || 0.05, 1e-5);
    const totalLength = Math.max(dims.y || 0.5, radius * 2);
    const bodyLength = Math.max(totalLength - 2 * radius, 0);
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, bodyLength, 8, 16),
      isCollision ? collisionBaseMaterial : createVisualMaterial(),
    );
    mesh.rotation.set(Math.PI / 2, 0, 0);
    addPrimitive(mesh);
    applyPrimitiveVisualOverride(mesh);
  } else if (geometry.type === GeometryType.MESH) {
    if (!geometry.meshPath) {
      rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
      robotModel.updateMatrixWorld(true);
      invalidate();
      return;
    }

    const urdfDir = sourceFileDir ?? '';
    const manager = textureManager ?? createLoadingManager(assets, urdfDir);
    const meshLoader = createViewerMeshLoader(assets, manager, urdfDir, {
      colladaRootNormalizationHints,
    });

    meshLoader(geometry.meshPath, manager, (obj, err) => {
      if (!obj) return;

      if (
        (targetGroup!.userData.__patchToken as number) !== patchToken ||
        (isPatchTargetValid && !isPatchTargetValid())
      ) {
        disposeObject3D(obj, true, SHARED_MATERIALS);
        return;
      }

      if (err) {
        console.error('[EditorViewer] Failed to patch mesh geometry:', err);
      }

      if (isCollision) {
        markCollisionObject(obj, linkName);
      } else {
        markVisualObject(obj, linkName, geometry.color, showVisual);
        if (authoredMaterialPalette && authoredMaterialPalette.size > 1) {
          applyURDFMaterials(obj, authoredMaterialPalette);
          enhanceMaterials(obj);
        } else if (visualMaterialOverride) {
          applyVisualMaterialOverrideToObject(obj, visualMaterialOverride, manager);
        }
        if (hasGeometryMeshMaterialGroups(geometry)) {
          applyVisualMeshMaterialGroupsToObject(obj, geometry, { manager });
        }
        if (geometry.doubleSided === true) {
          forceObjectMaterialSide(obj, THREE.DoubleSide);
        }
      }

      targetGroup!.add(obj);
      rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
      robotModel.updateMatrixWorld(true);
      invalidate();
    });

    return;
  }

  rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
  robotModel.updateMatrixWorld(true);
  invalidate();
}

function getDirectCollisionGroups(linkObject: THREE.Object3D): THREE.Object3D[] {
  return linkObject.children.filter((child: any) => child.isURDFCollider) as THREE.Object3D[];
}

function getDirectVisualGroups(linkObject: THREE.Object3D): THREE.Object3D[] {
  return linkObject.children.filter((child: any) => child.isURDFVisual) as THREE.Object3D[];
}

function patchVisualEntriesInPlace({
  robotModel,
  linkObject,
  linkName,
  previousLinkData,
  nextLinkData,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
}: {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  linkName: string;
  previousLinkData: UrdfLink;
  nextLinkData: UrdfLink;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
}): boolean {
  const previousEntries = getVisualGeometryEntries(previousLinkData);
  const nextEntries = getVisualGeometryEntries(nextLinkData);
  const existingGroups = getDirectVisualGroups(linkObject);

  if (existingGroups.length !== previousEntries.length) {
    return false;
  }

  let applied = false;
  const sharedCount = Math.min(previousEntries.length, nextEntries.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    const group = existingGroups[index];

    if (!previousEntry || !nextEntry || !group) {
      return false;
    }

    if (sameGeometry(previousEntry.geometry, nextEntry.geometry)) {
      continue;
    }

    applied = true;

    if (
      patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'visual',
        linkData: nextLinkData,
        previousGeometry: previousEntry.geometry,
        geometry: nextEntry.geometry,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: group,
      })
    ) {
      continue;
    }

    patchGeometryCategory({
      robotModel,
      linkObject,
      linkName,
      category: 'visual',
      geometry: nextEntry.geometry,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual,
      showCollision,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid,
      targetGroup: group,
    });
  }

  if (existingGroups.length > nextEntries.length) {
    existingGroups.slice(nextEntries.length).forEach((group) => {
      linkObject.remove(group);
      disposeObject3D(group, true, SHARED_MATERIALS);
    });
    applied = true;
  }

  if (nextEntries.length > existingGroups.length) {
    nextEntries.slice(existingGroups.length).forEach((entry) => {
      const targetGroup = new URDFVisual();
      linkObject.add(targetGroup);
      patchGeometryCategory({
        robotModel,
        linkObject,
        linkName,
        category: 'visual',
        geometry: entry.geometry,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
        targetGroup,
      });
    });
    applied = true;
  }

  if (!applied) {
    return true;
  }

  rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

function patchCollisionEntriesInPlace({
  robotModel,
  linkObject,
  linkName,
  previousLinkData,
  nextLinkData,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
}: {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  linkName: string;
  previousLinkData: UrdfLink;
  nextLinkData: UrdfLink;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
}): boolean {
  const previousEntries = getCollisionGeometryEntries(previousLinkData);
  const nextEntries = getCollisionGeometryEntries(nextLinkData);
  const existingGroups = getDirectCollisionGroups(linkObject);

  if (existingGroups.length !== previousEntries.length) {
    return false;
  }

  let applied = false;
  const sharedCount = Math.min(previousEntries.length, nextEntries.length);

  for (let index = 0; index < sharedCount; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    const group = existingGroups[index];

    if (!previousEntry || !nextEntry || !group) {
      return false;
    }

    if (sameGeometry(previousEntry.geometry, nextEntry.geometry)) {
      continue;
    }

    applied = true;

    if (
      patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'collision',
        linkData: nextLinkData,
        previousGeometry: previousEntry.geometry,
        geometry: nextEntry.geometry,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: group,
      })
    ) {
      continue;
    }

    patchGeometryCategory({
      robotModel,
      linkObject,
      linkName,
      category: 'collision',
      geometry: nextEntry.geometry,
      assets,
      sourceFileDir,
      colladaRootNormalizationHints,
      showVisual,
      showCollision,
      linkMeshMapRef,
      invalidate,
      isPatchTargetValid,
      targetGroup: group,
    });
  }

  if (existingGroups.length > nextEntries.length) {
    existingGroups.slice(nextEntries.length).forEach((group) => {
      linkObject.remove(group);
      disposeObject3D(group, true, SHARED_MATERIALS);
    });
    applied = true;
  }

  if (nextEntries.length > existingGroups.length) {
    nextEntries.slice(existingGroups.length).forEach((entry) => {
      const targetGroup = new URDFCollider();
      linkObject.add(targetGroup);
      patchGeometryCategory({
        robotModel,
        linkObject,
        linkName,
        category: 'collision',
        geometry: entry.geometry,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
        targetGroup,
      });
    });
    applied = true;
  }

  if (!applied) {
    return true;
  }

  rebuildLinkMeshMapForLink(linkMeshMapRef, linkObject, linkName);
  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

function sameGeometryStructure(a: LinkGeometry | undefined, b: LinkGeometry | undefined): boolean {
  if (!a || !b) return a === b;
  return a.type === b.type && (a.meshPath || '') === (b.meshPath || '');
}

function getAuthoredMaterialSignature(geometry: LinkGeometry | undefined): string {
  const authoredMaterials = geometry?.authoredMaterials ?? [];
  return JSON.stringify(
    authoredMaterials.map((material) => ({
      name: (material.name || '').trim(),
      color: (material.color || '').trim().toLowerCase(),
      colorRgba: material.colorRgba ?? null,
      texture: (material.texture || '').trim(),
      opacity: material.opacity ?? null,
      roughness: material.roughness ?? null,
      metalness: material.metalness ?? null,
      emissive: (material.emissive || '').trim().toLowerCase(),
      emissiveIntensity: material.emissiveIntensity ?? null,
    })),
  );
}

function getAuthoredMaterialSlotSignature(geometry: LinkGeometry | undefined): string {
  const authoredMaterials = geometry?.authoredMaterials ?? [];
  return JSON.stringify(
    authoredMaterials.map((material) => ({
      name: (material.name || '').trim(),
      texture: (material.texture || '').trim(),
    })),
  );
}

function getMeshMaterialGroupSignature(geometry: LinkGeometry | undefined): string {
  const meshMaterialGroups = geometry?.meshMaterialGroups ?? [];
  return JSON.stringify(
    meshMaterialGroups.map((group) => ({
      meshKey: (group.meshKey || '').trim(),
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
    })),
  );
}

function canPatchGeometryInPlace(
  previousGeometry: LinkGeometry | undefined,
  geometry: LinkGeometry | undefined,
  category: 'visual' | 'collision',
): boolean {
  if (!previousGeometry || !geometry) return false;
  if (!sameGeometryStructure(previousGeometry, geometry)) return false;
  if (geometry.type === GeometryType.NONE) return false;

  const dimensionsChanged = !sameVec3(previousGeometry.dimensions, geometry.dimensions);
  const colorChanged = (previousGeometry.color || '') !== (geometry.color || '');
  const authoredMaterialsChanged =
    category === 'visual' &&
    getAuthoredMaterialSignature(previousGeometry) !== getAuthoredMaterialSignature(geometry);
  const authoredMaterialSlotsChanged =
    category === 'visual' &&
    getAuthoredMaterialSlotSignature(previousGeometry) !==
      getAuthoredMaterialSlotSignature(geometry);
  const meshMaterialGroupsChanged =
    category === 'visual' &&
    getMeshMaterialGroupSignature(previousGeometry) !== getMeshMaterialGroupSignature(geometry);

  if (dimensionsChanged && geometry.type === GeometryType.MESH) return false;
  if (colorChanged && category === 'collision') return false;
  if (authoredMaterialSlotsChanged && geometry.type !== GeometryType.MESH) return false;
  if (authoredMaterialsChanged && geometry.type !== GeometryType.MESH) return false;
  if (meshMaterialGroupsChanged && geometry.type !== GeometryType.MESH) return false;

  return true;
}

function findFirstMeshInObject(object: THREE.Object3D): THREE.Mesh | null {
  let firstMesh: THREE.Mesh | null = null;

  object.traverse((child: any) => {
    if (!firstMesh && child.isMesh) {
      firstMesh = child as THREE.Mesh;
    }
  });

  return firstMesh;
}

function patchPrimitiveDimensionsInPlace(
  targetGroup: THREE.Object3D,
  geometry: LinkGeometry,
  isCollision: boolean,
): boolean {
  const mesh = findFirstMeshInObject(targetGroup);
  if (!mesh) return false;

  const dims = geometry.dimensions || DEFAULT_VEC3;

  switch (geometry.type) {
    case GeometryType.BOX:
      if (!(mesh.geometry instanceof THREE.BoxGeometry) && mesh.geometry.type !== 'BoxGeometry') {
        const previousMeshGeometry = mesh.geometry;
        mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
        previousMeshGeometry?.dispose?.();
      }

      mesh.scale.set(dims.x || 0.1, dims.y || 0.1, dims.z || 0.1);
      mesh.rotation.set(0, 0, 0);
      return true;
    case GeometryType.PLANE:
      mesh.scale.set(dims.x || 1, dims.y || 1, 1);
      return true;
    case GeometryType.SPHERE: {
      const radius = dims.x || 0.1;
      mesh.scale.set(radius, radius, radius);
      return true;
    }
    case GeometryType.ELLIPSOID: {
      const sx = dims.x || 0.1;
      const sy = dims.y || sx;
      const sz = dims.z || sx;
      mesh.scale.set(sx, sy, sz);
      return true;
    }
    case GeometryType.CYLINDER:
      mesh.scale.set(dims.x || 0.05, dims.y || 0.5, dims.z || dims.x || 0.05);
      mesh.rotation.set(Math.PI / 2, 0, 0);
      return true;
    case GeometryType.CAPSULE: {
      const radius = Math.max(dims.x || 0.05, 1e-5);
      const totalLength = Math.max(dims.y || 0.5, radius * 2);
      const bodyLength = Math.max(totalLength - 2 * radius, 0);
      const previousMeshGeometry = mesh.geometry;
      mesh.geometry = new THREE.CapsuleGeometry(radius, bodyLength, 8, 16);
      previousMeshGeometry?.dispose?.();
      mesh.scale.set(1, 1, 1);
      mesh.rotation.set(Math.PI / 2, 0, 0);
      return true;
    }
    default:
      return false;
  }
}

function patchGeometryGroupInPlace({
  robotModel,
  linkObject,
  category,
  linkData,
  previousGeometry,
  geometry,
  showVisual,
  showCollision,
  invalidate,
  targetGroup: explicitTargetGroup,
}: {
  robotModel: THREE.Object3D;
  linkObject: THREE.Object3D;
  category: 'visual' | 'collision';
  linkData: UrdfLink;
  previousGeometry: LinkGeometry | undefined;
  geometry: LinkGeometry | undefined;
  showVisual: boolean;
  showCollision: boolean;
  invalidate: () => void;
  targetGroup?: THREE.Object3D;
}): boolean {
  if (!previousGeometry || !geometry) return false;
  if (!canPatchGeometryInPlace(previousGeometry, geometry, category)) return false;

  const isCollision = category === 'collision';
  const groupPredicate = isCollision
    ? (child: THREE.Object3D) => (child as any).isURDFCollider
    : (child: THREE.Object3D) => (child as any).isURDFVisual;

  const targetGroup =
    explicitTargetGroup ?? (linkObject.children.find(groupPredicate) as THREE.Object3D | undefined);
  if (!targetGroup) return false;

  const originChanged = !sameOrigin(previousGeometry.origin, geometry.origin);
  const visibilityChanged = !sameVisibleFlag(previousGeometry.visible, geometry.visible);
  const dimensionsChanged = !sameVec3(previousGeometry.dimensions, geometry.dimensions);
  const colorChanged = (previousGeometry.color || '') !== (geometry.color || '');
  const authoredMaterialsChanged =
    !isCollision &&
    getAuthoredMaterialSignature(previousGeometry) !== getAuthoredMaterialSignature(geometry);
  const meshMaterialGroupsChanged =
    !isCollision &&
    getMeshMaterialGroupSignature(previousGeometry) !== getMeshMaterialGroupSignature(geometry);

  if (originChanged) {
    applyOriginToGroup(targetGroup, geometry.origin);
  }

  const isVisible = isCollision
    ? showCollision && linkData.visible !== false && geometry.visible !== false
    : showVisual && linkData.visible !== false && geometry.visible !== false;

  if (visibilityChanged || category === 'visual') {
    targetGroup.visible = isVisible;
    targetGroup.traverse((child: any) => {
      if (child.isMesh) {
        child.visible = isVisible;
      }
    });
  }

  if (dimensionsChanged && !patchPrimitiveDimensionsInPlace(targetGroup, geometry, isCollision)) {
    return false;
  }

  if (!isCollision && colorChanged) {
    const disposedMaterials = new Set<THREE.Material>();
    targetGroup.traverse((child: any) => {
      if (child.isMesh) {
        updateVisualMaterial(child as THREE.Mesh, { color: geometry.color }, disposedMaterials);
      }
    });
  }

  if (!isCollision && authoredMaterialsChanged) {
    const authoredMaterialPalette = collectURDFMaterialsFromVisualGeometry(geometry);
    const disposedMaterials = new Set<THREE.Material>();

    if (authoredMaterialPalette.size > 1) {
      targetGroup.traverse((child: any) => {
        if (child.isMesh) {
          updateVisualMaterialPalette(
            child as THREE.Mesh,
            authoredMaterialPalette,
            disposedMaterials,
          );
        }
      });
    } else {
      const visualMaterialOverride = resolveVisualMaterialOverrideFromGeometry(geometry);
      targetGroup.traverse((child: any) => {
        if (child.isMesh && visualMaterialOverride) {
          updateVisualMaterial(child as THREE.Mesh, visualMaterialOverride, disposedMaterials);
        }
      });
    }
  }

  const hasCustomMeshMaterialGroups =
    !isCollision &&
    (hasGeometryMeshMaterialGroups(previousGeometry) || hasGeometryMeshMaterialGroups(geometry));

  if (
    !isCollision &&
    hasCustomMeshMaterialGroups &&
    (authoredMaterialsChanged || meshMaterialGroupsChanged)
  ) {
    const disposedMaterials = new Set<THREE.Material>();
    targetGroup.traverse((child: any) => {
      if (!child.isMesh) {
        return;
      }

      const highlightSnapshot = child.userData?.__urdfHighlightSnapshot;
      if (!highlightSnapshot?.activeRole) {
        return;
      }

      const previousVisibleMaterial = child.material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      child.material = highlightSnapshot.material;
      delete child.userData.__urdfHighlightSnapshot;
      disposeReplacedMaterials(previousVisibleMaterial, disposedMaterials, false);
    });

    targetGroup.children.forEach((child) => {
      applyVisualMeshMaterialGroupsToObject(child, geometry);
    });
  }

  if (!isCollision && geometry.doubleSided === true) {
    forceObjectMaterialSide(targetGroup, THREE.DoubleSide);
  }

  robotModel.updateMatrixWorld(true);
  invalidate();
  return true;
}

interface ApplyGeometryPatchOptions {
  robotModel: THREE.Object3D;
  patch: GeometryPatchCandidate;
  assets: Record<string, string>;
  sourceFileDir?: string;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  showVisual: boolean;
  showCollision: boolean;
  linkMeshMapRef: RefObject<Map<string, THREE.Mesh[]>>;
  invalidate: () => void;
  isPatchTargetValid?: () => boolean;
}

interface ResolvedPatchTarget {
  linkObject: THREE.Object3D;
  visualTargetGroup?: THREE.Object3D;
  collisionTargetGroup?: THREE.Object3D;
  usesSyntheticAttachmentMapping: boolean;
}

function updateRuntimeLinkDisplayName(
  linkObject: THREE.Object3D,
  displayName: string | undefined,
): boolean {
  const nextDisplayName = displayName?.trim() || linkObject.userData?.linkId || linkObject.name;
  if (linkObject.userData?.displayName === nextDisplayName) {
    return false;
  }

  if (!linkObject.userData) {
    linkObject.userData = {};
  }
  linkObject.userData.displayName = nextDisplayName;
  return true;
}

function getSyntheticGeomOrdinal(linkName: string): number | null {
  const match = linkName.trim().match(/^(.*)_geom_(\d+)$/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[2]);
  return Number.isInteger(numeric) && numeric >= 1 ? numeric : null;
}

function resolveSyntheticAttachmentTargetGroup(
  linkObject: THREE.Object3D,
  linkName: string,
  category: 'visual' | 'collision',
): THREE.Object3D | undefined {
  const resolvedByMetadata = resolveRuntimeGeometryRoot(linkObject, linkName, category, 0);
  if (resolvedByMetadata) {
    return resolvedByMetadata;
  }

  const ordinal = getSyntheticGeomOrdinal(linkName);
  if (ordinal === null) {
    return undefined;
  }

  const directGroups =
    category === 'collision'
      ? getDirectCollisionGroups(linkObject)
      : getDirectVisualGroups(linkObject);
  return directGroups[ordinal];
}

function resolvePatchTarget(
  robotModel: THREE.Object3D,
  linkName: string,
): ResolvedPatchTarget | null {
  const directLinkObject = findRobotLinkObject(robotModel, linkName);
  if (directLinkObject) {
    return {
      linkObject: directLinkObject,
      usesSyntheticAttachmentMapping: false,
    };
  }

  const syntheticParentName = getSyntheticGeomParentName(linkName);
  if (!syntheticParentName) {
    return null;
  }

  const parentLinkObject = findRobotLinkObject(robotModel, syntheticParentName);
  if (!parentLinkObject) {
    return null;
  }

  const visualTargetGroup = resolveSyntheticAttachmentTargetGroup(
    parentLinkObject,
    linkName,
    'visual',
  );
  const collisionTargetGroup = resolveSyntheticAttachmentTargetGroup(
    parentLinkObject,
    linkName,
    'collision',
  );

  if (!visualTargetGroup && !collisionTargetGroup) {
    return null;
  }

  return {
    linkObject: parentLinkObject,
    visualTargetGroup,
    collisionTargetGroup,
    usesSyntheticAttachmentMapping: true,
  };
}

export function applyGeometryPatchInPlace({
  robotModel,
  patch,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
}: ApplyGeometryPatchOptions): boolean {
  const linkRuntimeName = patch.linkData.id || patch.previousLinkData.id || patch.linkName;
  const linkDisplayName = patch.linkDisplayName || patch.linkData.name || linkRuntimeName;
  const resolvedPatchTarget = resolvePatchTarget(robotModel, linkRuntimeName);
  if (!resolvedPatchTarget) return false;

  const { linkObject, visualTargetGroup, collisionTargetGroup, usesSyntheticAttachmentMapping } =
    resolvedPatchTarget;
  const metadataChanged = patch.linkNameChanged
    ? updateRuntimeLinkDisplayName(linkObject, linkDisplayName)
    : false;

  if (
    !patch.visualChanged &&
    !patch.visualBodiesChanged &&
    !patch.collisionChanged &&
    !patch.collisionBodiesChanged
  ) {
    if (metadataChanged) {
      invalidate();
    }
    return true;
  }

  if (patch.visualChanged || patch.visualBodiesChanged) {
    let visualPatched = false;

    if (!usesSyntheticAttachmentMapping) {
      visualPatched = patchVisualEntriesInPlace({
        robotModel,
        linkObject,
        linkName: linkRuntimeName,
        previousLinkData: patch.previousLinkData,
        nextLinkData: patch.linkData,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
      });
    }

    if (!visualPatched && usesSyntheticAttachmentMapping && visualTargetGroup) {
      visualPatched = patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'visual',
        linkData: patch.linkData,
        previousGeometry: patch.previousLinkData.visual,
        geometry: patch.linkData.visual,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: visualTargetGroup,
      });

      if (!visualPatched) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'visual',
          geometry: patch.linkData.visual,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          targetGroup: visualTargetGroup,
        });
        visualPatched = true;
      }
    }

    if (!visualPatched && !usesSyntheticAttachmentMapping) {
      if (
        !patchGeometryGroupInPlace({
          robotModel,
          linkObject,
          category: 'visual',
          linkData: patch.linkData,
          previousGeometry: patch.previousLinkData.visual,
          geometry: patch.linkData.visual,
          showVisual,
          showCollision,
          invalidate,
        })
      ) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'visual',
          geometry: patch.linkData.visual,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
        });
      }
    }
  }

  if (patch.collisionChanged || patch.collisionBodiesChanged) {
    let collisionPatched = false;

    if (!usesSyntheticAttachmentMapping) {
      collisionPatched = patchCollisionEntriesInPlace({
        robotModel,
        linkObject,
        linkName: linkRuntimeName,
        previousLinkData: patch.previousLinkData,
        nextLinkData: patch.linkData,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
      });
    }

    if (!collisionPatched && usesSyntheticAttachmentMapping && collisionTargetGroup) {
      collisionPatched = patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'collision',
        linkData: patch.linkData,
        previousGeometry: patch.previousLinkData.collision,
        geometry: patch.linkData.collision,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: collisionTargetGroup,
      });

      if (!collisionPatched) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'collision',
          geometry: patch.linkData.collision,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          targetGroup: collisionTargetGroup,
        });
        collisionPatched = true;
      }
    }

    if (!collisionPatched && !usesSyntheticAttachmentMapping) {
      if (
        !patchGeometryGroupInPlace({
          robotModel,
          linkObject,
          category: 'collision',
          linkData: patch.linkData,
          previousGeometry: patch.previousLinkData.collision,
          geometry: patch.linkData.collision,
          showVisual,
          showCollision,
          invalidate,
        })
      ) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'collision',
          geometry: patch.linkData.collision,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
        });
      }
    }
  }

  return true;
}
