import * as THREE from 'three';

// Highlight material like robot_viewer's urdf-manipulator-element
export const highlightMaterial = new THREE.MeshPhongMaterial({
    shininess: 10,
    color: 0x60a5fa, // Blue-400
    emissive: 0x60a5fa,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
});

export const highlightFaceMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthTest: false, // Render on top
    depthWrite: false
});

export const collisionHighlightMaterial = new THREE.MeshPhongMaterial({
    shininess: 10,
    color: 0xfacc15, // Yellow-400 for high visibility
    emissive: 0xfacc15,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
});

export const collisionBaseMaterial = new THREE.MeshBasicMaterial({
    color: '#a855f7', // Purple-500
    wireframe: false,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
});

// Empty raycast function to disable raycast on collision meshes
export const emptyRaycast = () => {};

// Enhance materials for better lighting (from robot_viewer)
export const enhanceMaterials = (robotObject: THREE.Object3D) => {
    robotObject.traverse((child: any) => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat: THREE.Material) => enhanceSingleMaterial(mat));
            } else {
                child.material = enhanceSingleMaterial(child.material);
            }
            
            // Enable shadows
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
};

export const enhanceSingleMaterial = (material: THREE.Material): THREE.Material => {
    if ((material as any).isMeshPhongMaterial || (material as any).isMeshStandardMaterial) {
        const mat = material as THREE.MeshPhongMaterial;
        
        // Preserve existing color - don't override URDF colors
        const existingColor = mat.color ? mat.color.clone() : null;
        
        // Increase shininess for better highlights
        if (mat.shininess !== undefined) {
            mat.shininess = 120; // Higher shininess for glossy look
        }
        
        // Enhance specular reflection
        if (!mat.specular) {
            mat.specular = new THREE.Color(0.5, 0.5, 0.5); // Moderate specular
        } else if (mat.specular.isColor) {
            mat.specular.setRGB(0.5, 0.5, 0.5);
        }
        
        // If standard material (PBR), make it more metallic/glossy
        if ((mat as any).isMeshStandardMaterial) {
            const stdMat = mat as unknown as THREE.MeshStandardMaterial;
            stdMat.roughness = 0.15; // Even smoother for more gloss
            stdMat.metalness = 0.15; // Slight metalness for plastic-like gloss
            stdMat.envMapIntensity = 1.5; // Stronger environment reflections
        }
        
        // Restore color if it was set
        if (existingColor) {
            mat.color = existingColor;
        }
        
        mat.needsUpdate = true;
        return mat;
        
    } else if ((material as any).isMeshBasicMaterial) {
        // Convert to Phong for better lighting, preserving color
        const oldMat = material as THREE.MeshBasicMaterial;
        const newMat = new THREE.MeshPhongMaterial({
            color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
            map: oldMat.map,
            transparent: oldMat.transparent,
            opacity: oldMat.opacity,
            side: oldMat.side,
            shininess: 50,
            specular: new THREE.Color(0.3, 0.3, 0.3)
        });
        return newMat;
    }
    
    return material;
};
