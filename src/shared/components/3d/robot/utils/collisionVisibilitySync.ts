import * as THREE from 'three';

import type { UrdfLink } from '@/types/index';
import { getCollisionGeometryByObjectIndex } from '@/core/robot/index';

import { collisionBaseMaterial } from '@/core/utils/three/collisionOverlayMaterial';
import { resolveCollisionRenderOrder, syncCollisionBaseMaterialPriority } from '@/shared/components/3d/materials';
import { disposeReplacedMaterials } from '@/shared/components/3d/robot/utils/robotLoaderPatchUtils';

const COLLIDER_MESH_CACHE_KEY = '__collisionMeshesCache';

function isCollisionGroupObject(object: THREE.Object3D | null | undefined): boolean {
  return Boolean((object as any)?.isURDFCollider || object?.userData?.isCollisionGroup === true);
}

function getCollisionGeometryByIndex(linkData: UrdfLink | undefined, colliderIndex: number) {
  if (!linkData) return undefined;
  return getCollisionGeometryByObjectIndex(linkData, colliderIndex)?.geometry;
}

function isCollisionGeometryVisible(
  linkData: UrdfLink | undefined,
  colliderIndex: number,
  showCollision: boolean,
  respectLinkVisibility: boolean,
): boolean {
  if (!showCollision) return false;
  if (!linkData) return true;
  if (respectLinkVisibility && linkData.visible === false) return false;

  const geometry = getCollisionGeometryByIndex(linkData, colliderIndex);
  return geometry ? geometry.visible !== false : true;
}

function getColliderIndex(collider: THREE.Object3D): number {
  const linkObject =
    collider.parent && (collider.parent as any).isURDFLink ? collider.parent : null;
  if (!linkObject) return 0;

  const colliders = linkObject.children.filter((child) => isCollisionGroupObject(child));
  const colliderIndex = colliders.indexOf(collider);
  return colliderIndex >= 0 ? colliderIndex : 0;
}

export interface SyncCollisionGroupVisibilityOptions {
  collider: THREE.Object3D;
  linkData?: UrdfLink;
  showCollision: boolean;
  showVisual?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  respectLinkVisibility?: boolean;
  highlightedMeshes?: ReadonlyMap<THREE.Mesh, unknown>;
}

function getColliderMeshes(collider: THREE.Object3D): THREE.Mesh[] {
  const cachedMeshes = collider.userData?.[COLLIDER_MESH_CACHE_KEY];
  if (Array.isArray(cachedMeshes) && cachedMeshes.every((mesh) => mesh instanceof THREE.Mesh)) {
    return cachedMeshes as THREE.Mesh[];
  }

  const meshes: THREE.Mesh[] = [];
  collider.traverse((inner: any) => {
    if (inner.isMesh) {
      meshes.push(inner as THREE.Mesh);
    }
  });

  collider.userData[COLLIDER_MESH_CACHE_KEY] = meshes;
  return meshes;
}

export function syncCollisionGroupVisibility({
  collider,
  linkData,
  showCollision,
  showVisual = true,
  showCollisionAlwaysOnTop = true,
  respectLinkVisibility = true,
  highlightedMeshes,
}: SyncCollisionGroupVisibilityOptions): boolean {
  const colliderIndex = getColliderIndex(collider);
  const isVisible = isCollisionGeometryVisible(
    linkData,
    colliderIndex,
    showCollision,
    respectLinkVisibility,
  );
  let changed = collider.visible !== isVisible;
  const disposedMaterials = new Set<THREE.Material>();
  if (syncCollisionBaseMaterialPriority(showCollisionAlwaysOnTop, showVisual)) {
    changed = true;
  }

  collider.visible = isVisible;

  if (!isVisible) {
    return changed;
  }

  getColliderMeshes(collider).forEach((inner) => {
    const meshWithOriginalMaterial = inner as THREE.Mesh & {
      __origMaterial?: THREE.Material | THREE.Material[];
    };

    if (inner.userData.isCollisionMesh !== true) {
      changed = true;
    }
    inner.userData.isCollisionMesh = true;

    if (inner.raycast !== THREE.Mesh.prototype.raycast) {
      changed = true;
    }
    inner.raycast = THREE.Mesh.prototype.raycast;

    if (inner.visible !== true) {
      changed = true;
    }
    inner.visible = true;

    if (highlightedMeshes?.has(inner)) {
      return;
    }

    if (inner.material !== collisionBaseMaterial) {
      changed = true;
      const previousMaterial = inner.material as THREE.Material | THREE.Material[] | undefined;
      meshWithOriginalMaterial.__origMaterial ??= previousMaterial;
      inner.material = collisionBaseMaterial;
      disposeReplacedMaterials(previousMaterial, disposedMaterials, true);
    } else {
      meshWithOriginalMaterial.__origMaterial ??= inner.material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
    }

    const collisionRenderOrder = resolveCollisionRenderOrder(showCollisionAlwaysOnTop);
    if (inner.renderOrder !== collisionRenderOrder) {
      changed = true;
    }
    inner.renderOrder = collisionRenderOrder;
  });

  return changed;
}
