import * as THREE from 'three';

const MIN_PICKABLE_OPACITY = 1e-3;

function isRuntimeUrdfNode(object: THREE.Object3D | null): boolean {
  if (!object) {
    return false;
  }

  const candidate = object as THREE.Object3D & {
    isURDFLink?: boolean;
    isURDFJoint?: boolean;
    isURDFVisual?: boolean;
    isURDFCollider?: boolean;
    type?: string;
  };

  return (
    candidate.isURDFLink === true ||
    candidate.isURDFJoint === true ||
    candidate.isURDFVisual === true ||
    candidate.isURDFCollider === true ||
    candidate.type === 'URDFLink' ||
    candidate.type === 'URDFJoint' ||
    candidate.type === 'URDFVisual' ||
    candidate.type === 'URDFCollider'
  );
}

function isMjcfTendonVisualizationNode(object: THREE.Object3D | null): boolean {
  return object?.userData?.isMjcfTendon === true || object?.userData?.isMjcfTendonsGroup === true;
}

export function isSelectableHelperNode(object: THREE.Object3D | null): boolean {
  return object?.userData?.isSelectableHelper === true;
}

export function isBlockingGizmoNode(object: THREE.Object3D | null): boolean {
  if (!object || object.userData?.isGizmo !== true) {
    return false;
  }

  return !isSelectableHelperNode(object);
}

export function isSelectableHelperObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (isSelectableHelperNode(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

export function isPickOnlyMesh(object: THREE.Object3D | null): boolean {
  if (!(object as THREE.Mesh | null)?.isMesh) {
    return false;
  }

  const material = (object as THREE.Mesh).material;
  const materials = Array.isArray(material) ? material : [material];
  if (materials.length === 0) {
    return false;
  }

  return materials.every((entry) => {
    if (!entry || entry.visible === false) {
      return true;
    }

    const opacity = typeof entry.opacity === 'number' ? entry.opacity : 1;
    return entry.colorWrite === false || opacity <= MIN_PICKABLE_OPACITY;
  });
}

export function hasVisibleDepthTestDisabledMaterial(object: THREE.Object3D | null): boolean {
  const material = (object as { material?: THREE.Material | THREE.Material[] } | null)?.material;
  if (!material) {
    return false;
  }

  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => {
    if (!entry || entry.visible === false || entry.colorWrite === false) {
      return false;
    }

    const opacity = typeof entry.opacity === 'number' ? entry.opacity : 1;
    return entry.depthTest === false && opacity > MIN_PICKABLE_OPACITY;
  });
}

export function hasOverlayPresentation(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (!isPickOnlyMesh(current) && hasVisibleDepthTestDisabledMaterial(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

export function isInternalHelperObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (isMjcfTendonVisualizationNode(current)) {
      current = current.parent;
      continue;
    }

    if (isSelectableHelperNode(current)) {
      current = current.parent;
      continue;
    }

    if (current.userData?.internalUsdJointChildFrame === true) {
      // This frame preserves the authored USD joint pivot for rendered link
      // geometry. It is an internal transform, not a helper overlay, so its
      // `__`-prefixed name must not make the movable link subtree unpickable.
      current = current.parent;
      continue;
    }

    if (isBlockingGizmoNode(current) || current.userData?.isHelper === true) {
      return true;
    }

    if (String(current.name || '').startsWith('__') && !isRuntimeUrdfNode(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

export function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }

  return true;
}

export function hasPickableMaterial(
  material: THREE.Material | THREE.Material[] | undefined,
): boolean {
  if (!material) {
    return true;
  }

  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => {
    if (!entry || entry.visible === false) {
      return false;
    }

    const opacity = typeof entry.opacity === 'number' ? entry.opacity : 1;
    return opacity > MIN_PICKABLE_OPACITY;
  });
}

export function isPickableMeshObject(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object as THREE.Mesh).isMesh) {
    return false;
  }

  const mesh = object as THREE.Mesh;
  if (isInternalHelperObject(mesh)) {
    return false;
  }

  if (!isVisibleInHierarchy(mesh)) {
    return false;
  }

  if (typeof (mesh as unknown as { raycast?: unknown }).raycast !== 'function') {
    return false;
  }

  return hasPickableMaterial(mesh.material);
}
