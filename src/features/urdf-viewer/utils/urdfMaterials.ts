import * as THREE from 'three';

// ============================================================
// URDF Material Parser - Extract rgba colors from URDF XML
// Supports multiple materials per visual (for DAE files with named materials)
// ============================================================
export interface URDFMaterialInfo {
    name?: string;
    rgba?: [number, number, number, number];
}

/**
 * Parse URDF materials - returns a Map keyed by material NAME (not link name)
 * This allows matching materials in DAE files by their name
 */
export function parseURDFMaterials(urdfContent: string): Map<string, URDFMaterialInfo> {
    const namedMaterials = new Map<string, URDFMaterialInfo>();

    console.log('[RobotModel] parseURDFMaterials called, content length:', urdfContent.length);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(urdfContent, 'text/xml');

        // First pass: collect global materials (defined at robot level)
        const robotMaterials = doc.querySelectorAll('robot > material');
        robotMaterials.forEach(matEl => {
            const name = matEl.getAttribute('name');
            if (name) {
                const colorEl = matEl.querySelector('color');
                if (colorEl) {
                    const rgbaStr = colorEl.getAttribute('rgba');
                    if (rgbaStr) {
                        const parts = rgbaStr.trim().split(/\s+/).map(Number);
                        if (parts.length >= 3) {
                            namedMaterials.set(name, {
                                name,
                                rgba: [parts[0], parts[1], parts[2], parts[3] ?? 1]
                            });
                        }
                    }
                }
            }
        });

        // Second pass: get ALL materials from each link's visual elements
        // This handles DAE files where each visual can have multiple named materials
        const links = doc.querySelectorAll('link');
        links.forEach(linkEl => {
            const linkName = linkEl.getAttribute('name');
            if (!linkName) return;

            // Get ALL visual elements (not just first)
            const visualEls = linkEl.querySelectorAll('visual');
            visualEls.forEach(visualEl => {
                // Get ALL material elements in this visual (not just first)
                const matEls = visualEl.querySelectorAll('material');
                matEls.forEach(matEl => {
                    const matName = matEl.getAttribute('name');
                    if (!matName) return;

                    const colorEl = matEl.querySelector('color');
                    if (colorEl) {
                        const rgbaStr = colorEl.getAttribute('rgba');
                        if (rgbaStr) {
                            const parts = rgbaStr.trim().split(/\s+/).map(Number);
                            if (parts.length >= 3) {
                                const rgba: [number, number, number, number] = [parts[0], parts[1], parts[2], parts[3] ?? 1];
                                namedMaterials.set(matName, {
                                    name: matName,
                                    rgba
                                });
                            }
                        }
                    }
                });
            });
        });
    } catch (error) {
        console.error('[RobotModel] Failed to parse URDF materials:', error);
    }

    console.log(`[RobotModel] parseURDFMaterials complete: ${namedMaterials.size} named materials`);
    if (namedMaterials.size > 0) {
        console.log('[RobotModel] Material names:', Array.from(namedMaterials.keys()).slice(0, 20));
    }
    return namedMaterials;
}

/**
 * Apply URDF materials to robot model by matching material NAMES
 * This works with DAE files where materials have specific names like "深色橡胶_005-effect"
 */
export function applyURDFMaterials(robot: THREE.Object3D, materials: Map<string, URDFMaterialInfo>): void {
    if (materials.size === 0) return;

    console.log(`[RobotModel] Applying ${materials.size} URDF materials by name`);

    let appliedCount = 0;
    let meshCount = 0;

    robot.traverse((child: any) => {
        if (!child.isMesh) return;
        meshCount++;

        // Process each material on this mesh
        const processMaterial = (mat: THREE.Material): THREE.Material => {
            // Try to match by material name
            const matName = mat.name;
            const matInfo = materials.get(matName);

            if (matInfo && matInfo.rgba) {
                const [r, g, b, a] = matInfo.rgba;
                const color = new THREE.Color(r, g, b);

                const cloned = mat.clone();
                (cloned as any).color = color;
                // Mark this material as having URDF color applied
                cloned.userData.urdfColorApplied = true;
                cloned.userData.urdfColor = color.clone();
                cloned.needsUpdate = true;

                if (a < 1) {
                    cloned.transparent = true;
                    cloned.opacity = a;
                }

                appliedCount++;
                return cloned;
            }

            return mat;
        };

        if (Array.isArray(child.material)) {
            child.material = child.material.map(processMaterial);
        } else if (child.material) {
            child.material = processMaterial(child.material);
        }
    });

    console.log(`[RobotModel] Applied URDF colors to ${appliedCount} materials across ${meshCount} meshes`);
}
