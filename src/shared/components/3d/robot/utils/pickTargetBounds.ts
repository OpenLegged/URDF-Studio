import * as THREE from 'three';

interface PickTargetBoundsEntry {
  localBounds: THREE.Box3;
  matrixWorld: THREE.Matrix4;
  worldBounds: THREE.Box3;
}

/**
 * Reuses the eight-corner bounds transform while a mesh's actual inputs match.
 * Callers still update world matrices and collect visible targets on each pick;
 * this cache does not rely on editor events or a time-based invalidation delay.
 */
export class PickTargetBoundsCache {
  private readonly entries = new WeakMap<THREE.Object3D, PickTargetBoundsEntry>();

  getWorldBounds(target: THREE.Object3D): THREE.Box3 | null {
    const geometry = (target as THREE.Object3D & { geometry?: THREE.BufferGeometry }).geometry;
    if (!geometry) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return null;

    const localBounds = geometry.boundingBox;
    let entry = this.entries.get(target);
    if (!entry) {
      entry = {
        localBounds: localBounds.clone(),
        matrixWorld: target.matrixWorld.clone(),
        worldBounds: localBounds.clone().applyMatrix4(target.matrixWorld),
      };
      this.entries.set(target, entry);
    } else if (
      !entry.matrixWorld.equals(target.matrixWorld) ||
      !entry.localBounds.equals(localBounds)
    ) {
      entry.localBounds.copy(localBounds);
      entry.matrixWorld.copy(target.matrixWorld);
      entry.worldBounds.copy(localBounds).applyMatrix4(target.matrixWorld);
    }

    return entry.worldBounds;
  }
}
