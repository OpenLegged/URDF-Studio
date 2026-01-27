/**
 * USD Loader - Loads USD/USDA/USDC/USDZ files into Three.js scene
 *
 * Based on robot_viewer/USDAdapter.js
 *
 * USD formats use OpenUSD WASM loader or Three.js USDZLoader for rendering.
 * This module provides a unified interface for loading USD files.
 */

import * as THREE from 'three';

// ============================================================
// USD TYPES
// ============================================================

export interface USDGeometry {
    type: 'box' | 'sphere' | 'cylinder' | 'mesh';
    size?: {
        x?: number;
        y?: number;
        z?: number;
        radius?: number;
        height?: number;
    };
    filename?: string;
}

export interface USDVisual {
    name: string;
    geometry: USDGeometry;
    origin: {
        xyz: [number, number, number];
        rpy: [number, number, number];
    };
    threeObject?: THREE.Object3D;
}

export interface USDLink {
    name: string;
    visuals: USDVisual[];
    threeObject?: THREE.Object3D;
}

export interface USDModel {
    name: string;
    links: Map<string, USDLink>;
    threeObject?: THREE.Object3D;
    userData?: Record<string, any>;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function createDefaultMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.7,
        metalness: 0.1,
        envMapIntensity: 0.8
    });
}

function parseUSDArray(value: string): number[] {
    const cleaned = value.replace(/[()]/g, '').trim();
    return cleaned.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
}

// ============================================================
// GEOMETRY EXTRACTION
// ============================================================

function extractGeometryInfo(geometry: THREE.BufferGeometry): USDGeometry {
    const geomType: USDGeometry = { type: 'mesh' };

    if (geometry.type === 'BoxGeometry') {
        geomType.type = 'box';
        const params = (geometry as any).parameters;
        geomType.size = {
            x: params?.width || 1,
            y: params?.height || 1,
            z: params?.depth || 1
        };
    } else if (geometry.type === 'SphereGeometry') {
        geomType.type = 'sphere';
        const params = (geometry as any).parameters;
        geomType.size = {
            radius: params?.radius || 0.5
        };
    } else if (geometry.type === 'CylinderGeometry') {
        geomType.type = 'cylinder';
        const params = (geometry as any).parameters;
        geomType.size = {
            radius: params?.radiusTop || 0.5,
            height: params?.height || 1
        };
    }

    return geomType;
}

// ============================================================
// GEOMETRY MESH CREATION
// ============================================================

function createGeometryMesh(geometry: USDGeometry): THREE.Mesh | null {
    let threeGeometry: THREE.BufferGeometry | null = null;

    switch (geometry.type) {
        case 'box':
            if (geometry.size) {
                const size = geometry.size.x || 0.1;
                threeGeometry = new THREE.BoxGeometry(
                    geometry.size.x || size,
                    geometry.size.y || size,
                    geometry.size.z || size
                );
            }
            break;

        case 'sphere':
            if (geometry.size?.radius) {
                threeGeometry = new THREE.SphereGeometry(geometry.size.radius, 32, 32);
            }
            break;

        case 'cylinder':
            if (geometry.size) {
                threeGeometry = new THREE.CylinderGeometry(
                    geometry.size.radius || 0.1,
                    geometry.size.radius || 0.1,
                    geometry.size.height || 0.1,
                    32
                );
            }
            break;
    }

    if (!threeGeometry) return null;

    return new THREE.Mesh(threeGeometry, createDefaultMaterial());
}

// ============================================================
// THREE.JS GROUP CONVERSION
// ============================================================

function convertThreeGroupToModel(group: THREE.Object3D, fileName: string): USDModel {
    const model: USDModel = {
        name: fileName.replace(/\.(usdz|usdc|usd|usda)$/i, ''),
        links: new Map(),
        threeObject: group
    };

    let linkIndex = 0;
    group.traverse((child: any) => {
        if (child.isMesh || child.isGroup) {
            const linkName = child.name || `link_${linkIndex++}`;
            const link: USDLink = {
                name: linkName,
                visuals: [],
                threeObject: child
            };

            if (child.isMesh && child.geometry) {
                const visual: USDVisual = {
                    name: child.name || linkName,
                    geometry: extractGeometryInfo(child.geometry),
                    origin: {
                        xyz: [0, 0, 0],
                        rpy: [0, 0, 0]
                    },
                    threeObject: child
                };
                link.visuals.push(visual);
            }

            model.links.set(linkName, link);
        }
    });

    return model;
}

// ============================================================
// USD ASCII PARSER (Basic)
// ============================================================

function parseUSDAGeometry(type: string, lines: string[], startIndex: number): USDGeometry {
    const geometry: USDGeometry = { type: type.toLowerCase() as any };

    for (let i = startIndex; i < Math.min(startIndex + 20, lines.length); i++) {
        const line = lines[i].trim();
        if (line === '}') break;

        const attrMatch = line.match(/(\w+)\s*=\s*(.+)/);
        if (attrMatch) {
            const attrName = attrMatch[1];
            const attrValue = attrMatch[2].trim();

            switch (type) {
                case 'Cube':
                    if (attrName === 'size') {
                        const size = parseFloat(attrValue);
                        geometry.size = { x: size, y: size, z: size };
                    }
                    break;
                case 'Sphere':
                    if (attrName === 'radius') {
                        geometry.size = { radius: parseFloat(attrValue) };
                    }
                    break;
                case 'Cylinder':
                    if (attrName === 'radius') {
                        const radius = parseFloat(attrValue);
                        geometry.size = { radius, height: radius * 2 };
                    }
                    if (attrName === 'height') {
                        if (!geometry.size) geometry.size = {};
                        geometry.size.height = parseFloat(attrValue);
                    }
                    break;
            }
        }
    }

    return geometry;
}

// ============================================================
// MAIN LOADER FUNCTIONS
// ============================================================

/**
 * Load USDZ file using Three.js USDZLoader
 */
export async function loadUSDZ(file: File): Promise<THREE.Object3D | null> {
    try {
        const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js');
        const loader = new USDZLoader();

        const blobUrl = URL.createObjectURL(file);

        try {
            const group = await new Promise<THREE.Object3D>((resolve, reject) => {
                loader.load(
                    blobUrl,
                    (result: THREE.Object3D) => resolve(result),
                    undefined,
                    (error: unknown) => {
                        console.error('[USDLoader] USDZ loading failed:', error);
                        reject(error);
                    }
                );
            });

            URL.revokeObjectURL(blobUrl);

            // Mark as USD robot
            (group as any).isURDFRobot = true;
            group.name = file.name.replace(/\.(usdz|usdc|usd|usda)$/i, '');

            // Create links and joints maps for compatibility
            const linksMap: Record<string, THREE.Object3D> = {};
            const jointsMap: Record<string, THREE.Object3D> = {};

            let linkIndex = 0;
            group.traverse((child: any) => {
                if (child.isMesh) {
                    const name = child.name || `link_${linkIndex++}`;
                    child.isURDFLink = true;
                    linksMap[name] = child;
                }
            });

            (group as any).links = linksMap;
            (group as any).joints = jointsMap;

            return group;

        } catch (error) {
            URL.revokeObjectURL(blobUrl);
            throw error;
        }

    } catch (error) {
        console.error('[USDLoader] Failed to load USDZ:', error);
        return null;
    }
}

/**
 * Parse USD ASCII content (basic parser for simple USD files)
 */
export function parseUSDAToThreeJS(content: string): THREE.Object3D | null {
    if (!content.includes('#usda') && !content.includes('def ')) {
        console.warn('[USDLoader] File may not be valid USD ASCII format');
    }

    const group = new THREE.Group();
    group.name = 'usd_model';
    (group as any).isURDFRobot = true;

    const lines = content.split('\n');
    const linksMap: Record<string, THREE.Object3D> = {};
    const jointsMap: Record<string, THREE.Object3D> = {};

    let currentLink: THREE.Group | null = null;
    const stack: Array<{ type: string; obj: THREE.Object3D }> = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || line.startsWith('#')) continue;

        // Match def definitions
        const defMatch = line.match(/def\s+(\w+)\s+"([^"]+)"\s*\{/);
        if (defMatch) {
            const type = defMatch[1];
            const name = defMatch[2];

            if (type === 'Xform' || type === 'Mesh' || type === 'Cube' || type === 'Sphere' || type === 'Cylinder') {
                if (type === 'Xform' && !currentLink) {
                    currentLink = new THREE.Group();
                    currentLink.name = name;
                    (currentLink as any).isURDFLink = true;
                    linksMap[name] = currentLink;
                    group.add(currentLink);
                    stack.push({ type: 'link', obj: currentLink });
                } else if (currentLink) {
                    const geometry = parseUSDAGeometry(type, lines, i);
                    const mesh = createGeometryMesh(geometry);
                    if (mesh) {
                        mesh.name = name;
                        currentLink.add(mesh);
                    }
                    stack.push({ type: 'visual', obj: mesh || new THREE.Group() });
                }
            }
            continue;
        }

        // Match attributes
        if (currentLink && line.includes('=')) {
            const attrMatch = line.match(/(\w+)\s*=\s*(.+)/);
            if (attrMatch) {
                const attrName = attrMatch[1];
                const attrValue = attrMatch[2].trim();

                if (attrName === 'xformOp:translate') {
                    const values = parseUSDArray(attrValue);
                    if (values.length >= 3 && currentLink.children.length > 0) {
                        const lastChild = currentLink.children[currentLink.children.length - 1];
                        lastChild.position.set(values[0], values[1], values[2]);
                    }
                }
            }
        }

        // Match closing brace
        if (line === '}') {
            if (stack.length > 0) {
                const popped = stack.pop();
                if (popped?.type === 'link') {
                    currentLink = null;
                }
            }
        }
    }

    (group as any).links = linksMap;
    (group as any).joints = jointsMap;

    console.log(`[USDLoader] Parsed USDA with ${Object.keys(linksMap).length} links`);

    return group;
}

/**
 * Check if content is USD format
 */
export function isUSDContent(content: string): boolean {
    return content.includes('#usda') || content.includes('def Xform') || content.includes('def Mesh');
}

/**
 * Check if file is USD format by extension
 */
export function isUSDFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    return ['usd', 'usda', 'usdc', 'usdz'].includes(ext);
}

/**
 * Load USD file (auto-detect format)
 */
export async function loadUSD(
    file: File,
    content?: string
): Promise<THREE.Object3D | null> {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'usdz') {
        return loadUSDZ(file);
    }

    if (ext === 'usda' || ext === 'usd') {
        if (!content) {
            content = await file.text();
        }
        return parseUSDAToThreeJS(content);
    }

    // For USDC (binary), try USDZLoader as fallback
    console.warn('[USDLoader] USDC format requires WASM loader, attempting USDZLoader fallback');
    return loadUSDZ(file);
}
