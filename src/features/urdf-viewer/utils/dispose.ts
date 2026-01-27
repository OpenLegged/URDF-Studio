import * as THREE from 'three';

/**
 * Deep dispose a Three.js object and all its children.
 * Properly disposes geometries, materials, and textures.
 * 
 * @param object The Three.js object to dispose
 * @param disposeTextures Whether to dispose textures (default: true)
 * @param excludeMaterials Set of materials to NOT dispose (e.g., shared/singleton materials)
 */
export function disposeObject3D(
    object: THREE.Object3D | null,
    disposeTextures: boolean = true,
    excludeMaterials?: Set<THREE.Material>
): void {
    if (!object) return;

    // Traverse all children and dispose
    object.traverse((child: any) => {
        // Dispose geometry
        if (child.geometry) {
            child.geometry.dispose();
        }

        // Dispose materials
        if (child.material) {
            disposeMaterial(child.material, disposeTextures, excludeMaterials);
        }
    });

    // Remove from parent
    if (object.parent) {
        object.parent.remove(object);
    }
}

/**
 * Dispose a material or array of materials
 */
export function disposeMaterial(
    material: THREE.Material | THREE.Material[],
    disposeTextures: boolean = true,
    excludeMaterials?: Set<THREE.Material>
): void {
    const materials = Array.isArray(material) ? material : [material];

    for (const mat of materials) {
        if (!mat) continue;
        
        // Skip excluded materials (e.g., shared singletons)
        if (excludeMaterials?.has(mat)) continue;

        // Dispose all texture properties
        if (disposeTextures) {
            disposeTexturesFromMaterial(mat);
        }

        mat.dispose();
    }
}

/**
 * Dispose all textures from a material
 */
export function disposeTexturesFromMaterial(material: THREE.Material): void {
    const textureProperties = [
        'map', 'lightMap', 'bumpMap', 'normalMap', 'specularMap',
        'envMap', 'alphaMap', 'aoMap', 'displacementMap', 'emissiveMap',
        'gradientMap', 'metalnessMap', 'roughnessMap', 'clearcoatMap',
        'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
        'sheenRoughnessMap', 'transmissionMap', 'thicknessMap'
    ];

    for (const prop of textureProperties) {
        const texture = (material as any)[prop];
        if (texture && texture instanceof THREE.Texture) {
            texture.dispose();
        }
    }
}

/**
 * Clean up a scene completely - useful for component unmount
 */
export function cleanupScene(scene: THREE.Scene, excludeMaterials?: Set<THREE.Material>): void {
    // Collect objects to remove (don't modify while traversing)
    const objectsToRemove: THREE.Object3D[] = [];
    
    scene.traverse((child) => {
        if (child !== scene) {
            objectsToRemove.push(child);
        }
    });

    // Dispose and remove each object
    for (const obj of objectsToRemove) {
        disposeObject3D(obj, true, excludeMaterials);
    }
}

/**
 * Cancel a pending animation frame and set the ID ref to null
 */
export function cancelAnimationFrameSafe(animationFrameId: { current: number | null }): void {
    if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
    }
}
