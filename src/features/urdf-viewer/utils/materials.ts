import * as THREE from 'three';

// ============================================================
// UNIFIED MATERIAL CONFIGURATION
// PBR settings optimized for IBL (Image-Based Lighting)
// ============================================================
export const MATERIAL_CONFIG = {
    // PBR properties for realistic matte finish
    roughness: 0.7,         // 0.6-0.8 range for matte plastic/metal look
    metalness: 0.1,         // Low metalness for plastic-like appearance
    envMapIntensity: 0.8,   // Environment reflection intensity

    // Color adjustment: slightly reduce white reflectivity to prevent overexposure
    whiteColorMultiplier: 0.9, // Apply to pure white colors (1,1,1 -> 0.9,0.9,0.9)
} as const;

// ============================================================
// UNIFIED MATERIAL FACTORY
// Creates consistent MeshStandardMaterial for PBR rendering with IBL
// ============================================================
export interface CreateMaterialOptions {
    color: THREE.ColorRepresentation;
    opacity?: number;
    transparent?: boolean;
    side?: THREE.Side;
    map?: THREE.Texture | null;
    name?: string;
}

/**
 * Creates a unified MeshStandardMaterial for PBR rendering with IBL.
 * Optimized for realistic matte finish with proper roughness/metalness.
 *
 * @param options - Material configuration options
 * @returns THREE.MeshStandardMaterial
 */
export function createMatteMaterial(options: CreateMaterialOptions): THREE.MeshStandardMaterial {
    const {
        color,
        opacity = 1.0,
        transparent = false,
        side = THREE.DoubleSide,
        map = null,
        name = ''
    } = options;

    let finalColor = new THREE.Color(color);

    // Reduce very bright/white colors to prevent overexposure
    if (finalColor.r > 0.95 && finalColor.g > 0.95 && finalColor.b > 0.95) {
        finalColor.multiplyScalar(MATERIAL_CONFIG.whiteColorMultiplier);
    }

    // Use MeshStandardMaterial for PBR rendering with IBL
    const material = new THREE.MeshStandardMaterial({
        color: finalColor,
        roughness: MATERIAL_CONFIG.roughness,
        metalness: MATERIAL_CONFIG.metalness,
        envMapIntensity: MATERIAL_CONFIG.envMapIntensity,
        side,
        transparent: transparent || opacity < 1.0,
        opacity,
        depthWrite: opacity >= 1.0,
        map,
    });

    if (name) material.name = name;

    // Store original values for potential restoration
    material.userData.originalColor = finalColor.clone();
    material.userData.originalRoughness = MATERIAL_CONFIG.roughness;
    material.userData.originalMetalness = MATERIAL_CONFIG.metalness;
    material.userData.originalEnvMapIntensity = MATERIAL_CONFIG.envMapIntensity;

    return material;
}

/**
 * Applies unified material properties to an existing mesh's materials.
 * Converts any material type to MeshStandardMaterial for PBR rendering.
 *
 * @param mesh - The mesh to apply materials to
 * @param color - Optional color override (uses existing color if not provided)
 * @param opacity - Optional opacity (1.0 = fully opaque)
 */
export function applyMatteMaterialToMesh(
    mesh: THREE.Mesh,
    color?: THREE.ColorRepresentation,
    opacity: number = 1.0
): void {
    const processMaterial = (oldMat: THREE.Material): THREE.MeshStandardMaterial => {
        // Extract existing color if not overridden
        let matColor: THREE.Color;
        if (color !== undefined) {
            matColor = new THREE.Color(color);
        } else if ((oldMat as any).color) {
            matColor = (oldMat as any).color.clone();
        } else {
            matColor = new THREE.Color(0x888888);
        }

        // Extract existing texture if any
        const existingMap = (oldMat as any).map || null;

        return createMatteMaterial({
            color: matColor,
            opacity,
            transparent: opacity < 1.0 || oldMat.transparent,
            side: oldMat.side,
            map: existingMap,
            name: oldMat.name
        });
    };

    if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(processMaterial);
    } else if (mesh.material) {
        mesh.material = processMaterial(mesh.material);
    }
}

// ============================================================
// HIGHLIGHT MATERIALS (for selection/hover)
// ============================================================
export const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x60a5fa, // Blue-400
    roughness: 0.5,
    metalness: 0.0,
    emissive: 0x60a5fa,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
});

export const highlightFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
});

export const collisionHighlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfacc15, // Yellow-400
    roughness: 0.5,
    metalness: 0.0,
    emissive: 0xfacc15,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
});

export const collisionBaseMaterial = new THREE.MeshStandardMaterial({
    color: 0xa855f7, // Purple-500
    transparent: true,
    opacity: 0.35,
    roughness: 0.8,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,      // Critical: transparent objects should not write to depth buffer
    depthTest: false,       // Disable depth test so collision always renders above visual mesh
    polygonOffset: true,    // Prevent Z-fighting with ground plane
    polygonOffsetFactor: -1.0,
    polygonOffsetUnits: -4.0,
});
// Set flags to prevent opacity modification and mark as collision material
collisionBaseMaterial.userData.isCollisionMaterial = true;
collisionBaseMaterial.userData.isSharedMaterial = true;  // Prevent opacity modification

// Empty raycast function to disable raycast on collision meshes
export const emptyRaycast = () => { };

// ============================================================
// MATERIAL ENHANCEMENT
// Converts all materials to unified MeshStandardMaterial for PBR
// ============================================================

/**
 * Enhances all materials in a robot model with unified PBR finish.
 * Converts all material types to MeshStandardMaterial for IBL support.
 * Preserves original colors while applying consistent PBR properties.
 *
 * @param robotObject - The robot Object3D to enhance
 * @param envMap - Optional environment map (used for realistic reflections)
 */
export const enhanceMaterials = (robotObject: THREE.Object3D, envMap?: THREE.Texture | null) => {
    let enhancedCount = 0;
    let totalMeshes = 0;

    robotObject.traverse((child: any) => {
        if (child.isMesh && child.material) {
            totalMeshes++;

            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat: THREE.Material) => {
                    const enhanced = enhanceSingleMaterial(mat, envMap);
                    if (enhanced !== mat) enhancedCount++;
                    return enhanced;
                });
            } else {
                const enhanced = enhanceSingleMaterial(child.material, envMap);
                if (enhanced !== child.material) enhancedCount++;
                child.material = enhanced;
            }

            // Enable shadows for better depth perception
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

};

/**
 * Enhances a single material with unified PBR properties.
 * Converts any material type to MeshStandardMaterial for IBL support.
 *
 * @param material - The material to enhance
 * @param envMap - Optional environment map (for realistic reflections)
 * @returns Enhanced MeshStandardMaterial
 */
export const enhanceSingleMaterial = (material: THREE.Material, envMap?: THREE.Texture | null): THREE.Material => {
    // Extract color from existing material
    // Priority: URDF color > existing material color > default gray
    let color: THREE.Color;
    if (material.userData.urdfColorApplied && material.userData.urdfColor) {
        // Preserve URDF-defined color (from applyURDFMaterials)
        color = (material.userData.urdfColor as THREE.Color).clone();
    } else if ((material as any).color) {
        color = (material as any).color.clone();
    } else {
        color = new THREE.Color(0x888888);
    }

    // Reduce very bright/white colors to prevent overexposure
    // But skip this for URDF colors to preserve exact values
    if (!material.userData.urdfColorApplied &&
        color.r > 0.95 && color.g > 0.95 && color.b > 0.95) {
        color.multiplyScalar(MATERIAL_CONFIG.whiteColorMultiplier);
    }

    // Extract existing properties
    const existingMap = (material as any).map || null;
    const existingOpacity = material.opacity !== undefined ? material.opacity : 1.0;
    const existingTransparent = material.transparent || existingOpacity < 1.0;
    const existingSide = material.side !== undefined ? material.side : THREE.DoubleSide;

    // Create unified MeshStandardMaterial for PBR rendering with IBL
    const newMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: MATERIAL_CONFIG.roughness,
        metalness: MATERIAL_CONFIG.metalness,
        envMapIntensity: MATERIAL_CONFIG.envMapIntensity,
        map: existingMap,
        transparent: existingTransparent,
        opacity: existingOpacity,
        side: existingSide,
        depthWrite: existingOpacity >= 1.0,
    });

    // Apply environment map if provided
    if (envMap) {
        newMat.envMap = envMap;
    }

    // Ensure textures use sRGB color space for proper gamma
    if (newMat.map && newMat.map.colorSpace !== THREE.SRGBColorSpace) {
        newMat.map.colorSpace = THREE.SRGBColorSpace;
        newMat.map.needsUpdate = true;
    }

    // Store original values for potential restoration
    newMat.userData.originalColor = color.clone();
    newMat.userData.originalRoughness = MATERIAL_CONFIG.roughness;
    newMat.userData.originalMetalness = MATERIAL_CONFIG.metalness;
    newMat.userData.originalEnvMapIntensity = MATERIAL_CONFIG.envMapIntensity;
    // Preserve URDF color flag for future material operations
    if (material.userData.urdfColorApplied) {
        newMat.userData.urdfColorApplied = true;
        newMat.userData.urdfColor = color.clone();
    }
    newMat.name = material.name;

    newMat.needsUpdate = true;
    return newMat;
};

/**
 * Toggle material enhancement on a robot model.
 * When enabled, applies PBR finish. When disabled, restores original values.
 *
 * @param robotObject - The robot Object3D
 * @param enabled - Whether to enable material enhancement
 * @param envMap - Optional environment map
 */
export const toggleEnhancedLighting = (robotObject: THREE.Object3D, enabled: boolean, envMap?: THREE.Texture | null) => {
    let toggledCount = 0;

    robotObject.traverse((child: any) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach((mat: THREE.Material) => {
                if ((mat as any).isMeshStandardMaterial) {
                    const stdMat = mat as THREE.MeshStandardMaterial;

                    if (enabled) {
                        // Apply PBR finish
                        stdMat.roughness = MATERIAL_CONFIG.roughness;
                        stdMat.metalness = MATERIAL_CONFIG.metalness;
                        stdMat.envMapIntensity = MATERIAL_CONFIG.envMapIntensity;

                        if (envMap && !stdMat.envMap) {
                            stdMat.envMap = envMap;
                        }
                    } else {
                        // Restore original properties
                        stdMat.roughness = stdMat.userData.originalRoughness ?? 0.7;
                        stdMat.metalness = stdMat.userData.originalMetalness ?? 0.1;
                        stdMat.envMapIntensity = stdMat.userData.originalEnvMapIntensity ?? 0.8;
                    }

                    stdMat.needsUpdate = true;
                    toggledCount++;
                }
            });
        }
    });

};
