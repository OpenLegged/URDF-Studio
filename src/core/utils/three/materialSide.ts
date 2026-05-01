import * as THREE from 'three';

export function forceObjectMaterialSide(object: THREE.Object3D, side: THREE.Side): boolean {
  let changed = false;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material || material.side === side) {
        return;
      }

      material.side = side;
      material.needsUpdate = true;
      changed = true;
    });
  });

  return changed;
}
