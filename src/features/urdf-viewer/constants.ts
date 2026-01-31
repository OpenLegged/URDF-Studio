import * as THREE from 'three';
import {
    highlightMaterial,
    highlightFaceMaterial,
    collisionHighlightMaterial,
    collisionBaseMaterial
} from './utils/materials';

// ============================================================
// SHARED MATERIALS
// Set of shared materials that should NOT be disposed (module-level singletons)
// ============================================================
export const SHARED_MATERIALS = new Set<THREE.Material>([
    highlightMaterial,
    highlightFaceMaterial,
    collisionHighlightMaterial,
    collisionBaseMaterial
]);

// ============================================================
// PERFORMANCE: Module-level object pool to eliminate GC pressure
// These objects are reused across all instances and frames
// ============================================================
export const _pooledVec2 = new THREE.Vector2();
export const _pooledVec3A = new THREE.Vector3();
export const _pooledVec3B = new THREE.Vector3();
export const _pooledBox3 = new THREE.Box3();
export const _pooledRay = new THREE.Ray();

// ============================================================
// THRESHOLD CONSTANTS
// ============================================================
// Minimum pixel movement threshold before triggering raycast (state locking)
export const MOUSE_MOVE_THRESHOLD = 2;
// Throttle interval in ms (~30fps)
export const THROTTLE_INTERVAL = 33;
