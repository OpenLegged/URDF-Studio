import * as THREE from 'three';

export function updateVisible(object: THREE.Object3D, visible: boolean): boolean {
  if (object.visible === visible) return false;
  object.visible = visible;
  return true;
}

export function updateParentLinkName(object: THREE.Object3D, linkName: string | null): boolean {
  const nextLinkName =
    typeof linkName === 'string' && linkName.trim().length > 0 ? linkName.trim() : null;
  const currentLinkName =
    typeof object.userData?.parentLinkName === 'string' ? object.userData.parentLinkName : null;

  if (currentLinkName === nextLinkName) {
    return false;
  }

  if (!object.userData) {
    object.userData = {};
  }

  if (nextLinkName) {
    object.userData.parentLinkName = nextLinkName;
  } else {
    delete object.userData.parentLinkName;
  }

  return true;
}

export function updateUserDataValue(object: THREE.Object3D, key: string, value: unknown): boolean {
  const currentValue = object.userData?.[key];
  if (currentValue === value) {
    return false;
  }

  if (!object.userData) {
    object.userData = {};
  }

  if (value === undefined) {
    delete object.userData[key];
  } else {
    object.userData[key] = value;
  }

  return true;
}

export function updateVisualMeshMetadata(object: THREE.Object3D, linkName: string | null): boolean {
  let changed = false;

  changed = updateParentLinkName(object, linkName) || changed;
  changed = updateUserDataValue(object, 'isVisual', true) || changed;
  changed = updateUserDataValue(object, 'isCollision', false) || changed;
  changed = updateUserDataValue(object, 'geometryRole', 'visual') || changed;

  if ((object as THREE.Mesh).isMesh) {
    changed = updateUserDataValue(object, 'isVisualMesh', true) || changed;
    changed = updateUserDataValue(object, 'isCollisionMesh', false) || changed;
  }

  return changed;
}

export function updateScale(object: THREE.Object3D, scale: number): boolean {
  if (object.scale.x === scale && object.scale.y === scale && object.scale.z === scale) {
    return false;
  }

  object.scale.set(scale, scale, scale);
  return true;
}

export function updateScale3(object: THREE.Object3D, x: number, y: number, z: number): boolean {
  if (object.scale.x === x && object.scale.y === y && object.scale.z === z) {
    return false;
  }

  object.scale.set(x, y, z);
  return true;
}

export function updatePosition(object: THREE.Object3D, x: number, y: number, z: number): boolean {
  if (object.position.x === x && object.position.y === y && object.position.z === z) {
    return false;
  }

  object.position.set(x, y, z);
  return true;
}

export function updateQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion): boolean {
  if (
    object.quaternion.x === quaternion.x &&
    object.quaternion.y === quaternion.y &&
    object.quaternion.z === quaternion.z &&
    object.quaternion.w === quaternion.w
  ) {
    return false;
  }

  object.quaternion.copy(quaternion);
  return true;
}

export function updateMaterialState(
  material: THREE.Material & {
    opacity?: number;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
    needsUpdate?: boolean;
  },
  nextState: {
    opacity?: number;
    transparent?: boolean;
    depthTest?: boolean;
    depthWrite?: boolean;
  },
): boolean {
  let changed = false;

  if (nextState.opacity !== undefined && material.opacity !== nextState.opacity) {
    material.opacity = nextState.opacity;
    changed = true;
  }

  if (nextState.transparent !== undefined && material.transparent !== nextState.transparent) {
    material.transparent = nextState.transparent;
    changed = true;
  }

  if (nextState.depthTest !== undefined && material.depthTest !== nextState.depthTest) {
    material.depthTest = nextState.depthTest;
    changed = true;
  }

  if (nextState.depthWrite !== undefined && material.depthWrite !== nextState.depthWrite) {
    material.depthWrite = nextState.depthWrite;
    changed = true;
  }

  if (changed) {
    material.needsUpdate = true;
  }

  return changed;
}

export function updateRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  renderOrder: number,
): boolean {
  if (object.renderOrder === renderOrder) return false;
  object.renderOrder = renderOrder;
  return true;
}

export function disposeObject3DResources(object: THREE.Object3D): void {
  object.traverse((child: any) => {
    if (child.geometry?.dispose) {
      child.geometry.dispose();
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material: THREE.Material | undefined) => {
      material?.dispose?.();
    });
  });
}
