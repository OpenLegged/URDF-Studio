import * as THREE from 'three';

function normalizeLinkName(linkName: string | null | undefined): string | null {
  if (typeof linkName !== 'string') {
    return null;
  }

  const trimmed = linkName.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function isTrackedMjcfTendonMesh(mesh: THREE.Mesh, linkName: string | null): boolean {
  if (mesh.userData?.isMjcfTendon !== true) {
    return false;
  }

  if (!linkName) {
    return true;
  }

  return normalizeLinkName(mesh.userData?.parentLinkName) === linkName;
}

function sameMeshArray(left: THREE.Mesh[], right: THREE.Mesh[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function collectVisibleMjcfTendonMeshesByVisualKey(
  robot: THREE.Object3D,
  linkName: string | null,
): Map<string, THREE.Mesh[]> {
  const meshesByKey = new Map<string, THREE.Mesh[]>();
  const tendonsGroup = robot.userData.__mjcfTendons as THREE.Object3D | undefined;

  if (!tendonsGroup) {
    return meshesByKey;
  }

  tendonsGroup.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (mesh.userData?.isMjcfTendon !== true) {
      return;
    }

    if (!mesh.geometry || !isVisibleInHierarchy(mesh)) {
      return;
    }

    const parentLinkName = normalizeLinkName(mesh.userData?.parentLinkName);
    if (!parentLinkName || (linkName && parentLinkName !== linkName)) {
      return;
    }

    const key = `${parentLinkName}:visual`;
    const bucket = meshesByKey.get(key);
    if (bucket) {
      bucket.push(mesh);
      return;
    }

    meshesByKey.set(key, [mesh]);
  });

  return meshesByKey;
}

export function syncMjcfTendonVisualMeshMap(
  linkMeshMap: Map<string, THREE.Mesh[]>,
  robot: THREE.Object3D,
  linkName?: string | null,
): boolean {
  const normalizedLinkName = normalizeLinkName(linkName);
  const nextMjcfTendonMeshesByKey = collectVisibleMjcfTendonMeshesByVisualKey(
    robot,
    normalizedLinkName,
  );
  const touchedKeys = new Set<string>();

  linkMeshMap.forEach((meshes, key) => {
    if (!key.endsWith(':visual')) {
      return;
    }

    const containsTrackedTendonMesh = meshes.some((mesh) =>
      isTrackedMjcfTendonMesh(mesh, normalizedLinkName),
    );
    if (!containsTrackedTendonMesh) {
      return;
    }

    touchedKeys.add(key);
  });

  nextMjcfTendonMeshesByKey.forEach((_meshes, key) => {
    touchedKeys.add(key);
  });

  let changed = false;

  touchedKeys.forEach((key) => {
    const currentMeshes = linkMeshMap.get(key) ?? [];
    const retainedMeshes = currentMeshes.filter(
      (mesh) => !isTrackedMjcfTendonMesh(mesh, normalizedLinkName),
    );
    const nextTendonMeshes = nextMjcfTendonMeshesByKey.get(key) ?? [];
    const nextMeshes = [...retainedMeshes, ...nextTendonMeshes];

    if (sameMeshArray(currentMeshes, nextMeshes)) {
      return;
    }

    changed = true;

    if (nextMeshes.length === 0) {
      linkMeshMap.delete(key);
      return;
    }

    linkMeshMap.set(key, nextMeshes);
  });

  return changed;
}
