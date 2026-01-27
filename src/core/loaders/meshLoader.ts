/**
 * Mesh Loader - Handles loading of mesh files (STL, DAE, OBJ, GLTF/GLB)
 *
 * Features:
 * - Pre-indexed asset lookup for O(1) complexity
 * - First-detection mode for automatic unit scaling
 * - Placeholder mesh for missing/failed loads
 * - Support for STL, DAE, OBJ, GLTF/GLB formats
 */

import * as THREE from 'three';

// ============================================================
// SHARED MATERIALS - Avoid shader recompilation for each mesh
// ============================================================
const DEFAULT_MESH_MATERIAL = new THREE.MeshStandardMaterial({
    color: 0x707070,      // Medium-dark grey for proper exposure in bright studio lighting
    roughness: 0.45,      // Lower roughness for visible surface gloss and sharper edges
    metalness: 0.15,      // Low metalness for industrial plastic/painted metal look
    envMapIntensity: 1.0  // Full environment reflection for realistic highlights
});
const PLACEHOLDER_MATERIAL = new THREE.MeshPhongMaterial({
    color: 0xff6b6b,
    transparent: true,
    opacity: 0.7
});

// Reusable Vector3 for size calculations (object pooling)
const _tempSize = new THREE.Vector3();
const _tempBox = new THREE.Box3();

// ============================================================
// PERFORMANCE: Optimized cleanFilePath without array allocations
// Uses string manipulation instead of split/reduce/join
// ============================================================
export const cleanFilePath = (path: string): string => {
    // Fast path: no special characters
    if (!path.includes('..') && !path.includes('./') && !path.includes('\\')) {
        return path.replace(/\/+/g, '/'); // Just normalize multiple slashes
    }

    // Normalize backslashes first
    let result = path.replace(/\\/g, '/');

    // Remove ./ references
    result = result.replace(/\/\.\//g, '/').replace(/^\.\//g, '');

    // Handle .. by iterative replacement (avoids array allocation)
    let prev = '';
    while (prev !== result) {
        prev = result;
        // Replace /segment/../ with / (but not /../ at start)
        result = result.replace(/\/[^\/]+\/\.\.\//, '/');
        // Handle trailing /segment/..
        result = result.replace(/\/[^\/]+\/\.\.$/g, '');
    }

    // Clean up any leading ../
    result = result.replace(/^\.\.\/+/g, '');

    // Normalize multiple slashes
    result = result.replace(/\/+/g, '/');

    return result;
};

// ============================================================
// PERFORMANCE: Pre-indexed asset lookup for O(1) complexity
// Build once, lookup many times
// ============================================================
export interface AssetIndex {
    // Direct path -> URL mapping
    direct: Map<string, string>;
    // Lowercase path -> URL mapping (case-insensitive)
    lowercase: Map<string, string>;
    // Filename only -> URL mapping
    filename: Map<string, string>;
    // Lowercase filename -> URL mapping
    filenameLower: Map<string, string>;
    // Suffix matches (for fuzzy matching)
    suffixes: Map<string, string>;
}

// Build pre-indexed asset lookup (call once during model load)
export const buildAssetIndex = (assets: Record<string, string>, urdfDir: string = ''): AssetIndex => {
    const index: AssetIndex = {
        direct: new Map(),
        lowercase: new Map(),
        filename: new Map(),
        filenameLower: new Map(),
        suffixes: new Map(),
    };

    for (const [key, value] of Object.entries(assets)) {
        // Direct mapping
        index.direct.set(key, value);

        // Cleaned path
        const cleaned = cleanFilePath(key);
        index.direct.set(cleaned, value);

        // With urdfDir prefix
        if (urdfDir) {
            index.direct.set(urdfDir + cleaned, value);
            index.direct.set(urdfDir + key, value);
        }

        // Lowercase variants
        index.lowercase.set(key.toLowerCase(), value);
        index.lowercase.set(cleaned.toLowerCase(), value);

        // Filename only
        const filename = key.split('/').pop() || key;
        index.filename.set(filename, value);
        index.filenameLower.set(filename.toLowerCase(), value);

        // Suffix matching: store the shortest unique suffix
        const cleanedLower = cleaned.toLowerCase();
        for (let i = cleanedLower.length - 1; i >= 0; i--) {
            if (cleanedLower[i] === '/') {
                const suffix = cleanedLower.substring(i + 1);
                if (!index.suffixes.has(suffix)) {
                    index.suffixes.set(suffix, value);
                }
                break;
            }
        }
    }

    return index;
};

// Fast O(1) asset lookup using pre-built index
export const findAssetByIndex = (path: string, index: AssetIndex, urdfDir: string = ''): string | null => {
    // Strategy 0: Direct match (most common case)
    let result = index.direct.get(path);
    if (result) return result;

    // Clean the path (optimized version)
    let cleanPath = path.replace(/\\/g, '/');

    // Remove blob: prefix if present
    if (cleanPath.startsWith('blob:')) {
        const slashIdx = cleanPath.indexOf('/', 5);
        if (slashIdx !== -1) {
            cleanPath = cleanPath.substring(slashIdx + 1);
        }
    }

    // Remove package:// prefix
    if (cleanPath.startsWith('package://')) {
        cleanPath = cleanPath.substring(10);
        const slashIdx = cleanPath.indexOf('/');
        if (slashIdx !== -1) {
            cleanPath = cleanPath.substring(slashIdx + 1);
        }
    }

    // Remove leading ./
    if (cleanPath.startsWith('./')) {
        cleanPath = cleanPath.substring(2);
    }

    // Normalize path
    const normalizedPath = cleanFilePath(cleanPath);

    // Strategy 1: Direct lookup with normalized path
    result = index.direct.get(normalizedPath);
    if (result) return result;

    // Strategy 2: With urdfDir
    if (urdfDir) {
        result = index.direct.get(urdfDir + normalizedPath);
        if (result) return result;
    }

    // Strategy 3: Clean path
    result = index.direct.get(cleanPath);
    if (result) return result;

    // Strategy 4: Lowercase lookup
    const lowerPath = normalizedPath.toLowerCase();
    result = index.lowercase.get(lowerPath);
    if (result) return result;

    // Strategy 5: Filename only
    const lastSlash = normalizedPath.lastIndexOf('/');
    const filename = lastSlash === -1 ? normalizedPath : normalizedPath.substring(lastSlash + 1);
    result = index.filename.get(filename);
    if (result) return result;

    // Strategy 6: Lowercase filename
    result = index.filenameLower.get(filename.toLowerCase());
    if (result) return result;

    // Strategy 7: Suffix match
    result = index.suffixes.get(lowerPath);
    if (result) return result;

    return null;
};

// Legacy function for backward compatibility (uses non-indexed lookup)
export const findAssetByPath = (path: string, assets: Record<string, string>, urdfDir: string = ''): string | null => {
    // Strategy 0: Direct match
    if (assets[path]) return assets[path];

    // Clean the path
    let cleanPath = path.replace(/\\/g, '/');
    if (cleanPath.startsWith('blob:')) {
        const slashIdx = cleanPath.indexOf('/', 5);
        if (slashIdx !== -1) cleanPath = cleanPath.substring(slashIdx + 1);
    }
    if (cleanPath.startsWith('package://')) {
        cleanPath = cleanPath.substring(10);
        const slashIdx = cleanPath.indexOf('/');
        if (slashIdx !== -1) cleanPath = cleanPath.substring(slashIdx + 1);
    }
    if (cleanPath.startsWith('./')) cleanPath = cleanPath.substring(2);

    const normalizedPath = cleanFilePath(cleanPath);
    const fullPath = urdfDir + normalizedPath;

    if (assets[fullPath]) return assets[fullPath];
    if (assets[normalizedPath]) return assets[normalizedPath];
    if (assets[cleanPath]) return assets[cleanPath];

    const lastSlash = normalizedPath.lastIndexOf('/');
    const filename = lastSlash === -1 ? normalizedPath : normalizedPath.substring(lastSlash + 1);
    if (assets[filename]) return assets[filename];

    const lowerFilename = filename.toLowerCase();
    for (const key of Object.keys(assets)) {
        if (key.toLowerCase() === lowerFilename) return assets[key];
    }

    const searchLower = normalizedPath.toLowerCase();
    for (const key of Object.keys(assets)) {
        const keyLower = key.toLowerCase();
        if (keyLower.endsWith(searchLower)) return assets[key];
        const keyFilename = keyLower.split('/').pop() || '';
        if (searchLower.endsWith(keyFilename)) return assets[key];
    }

    // Diagnostic logging for failure
    if (Object.keys(assets).length > 0) {
        console.warn(`[MeshLoader] Asset lookup failed for: "${path}"`);
        console.warn(`[MeshLoader] Search path was: "${searchLower}"`);
        const keys = Object.keys(assets);
        console.warn(`[MeshLoader] Available assets (first 10):`, keys.slice(0, 10));
        // Check if any key contains the filename
        const fn = path.split('/').pop() || '';
        const partialMatches = keys.filter(k => k.toLowerCase().includes(fn.toLowerCase()));
        if (partialMatches.length > 0) {
            console.warn(`[MeshLoader] Potential partial matches found:`, partialMatches);
        }
    }

    return null;
};

// Loading manager that resolves asset URLs from our blob storage
export const createLoadingManager = (assets: Record<string, string>, urdfDir: string = '') => {
    const manager = new THREE.LoadingManager();

    manager.setURLModifier((url: string) => {
        // If already a blob/data URL, return as-is
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            // Check if it's a malformed blob URL
            const blobMatch = url.match(/^blob:https?:\/\/[^\/]+\/(.+)$/);
            if (blobMatch && blobMatch[1]) {
                const fileName = blobMatch[1];
                // If it looks like a filename, it's malformed
                if (/\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb)$/i.test(fileName)) {
                    const found = findAssetByPath(fileName, assets, urdfDir);
                    if (found) return found;
                }
            }
            return url;
        }

        const found = findAssetByPath(url, assets, urdfDir);
        if (found) return found;

        console.warn('[MeshLoader] Asset not found:', url);
        // Return a transparent 1x1 pixel for missing textures instead of invalid URL
        // This prevents the browser from trying to load package:// URLs
        if (/\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp)$/i.test(url)) {
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        }
        // For mesh files, return empty string to let mesh loader handle it with placeholder
        return '';
    });

    return manager;
};

// Shared placeholder geometry (created once)
const PLACEHOLDER_GEOMETRY = new THREE.BoxGeometry(0.05, 0.05, 0.05);

// Create a placeholder mesh when mesh is not found or fails to load
export const createPlaceholderMesh = (path: string): THREE.Object3D => {
    // Use shared geometry and material to avoid shader recompilation
    const mesh = new THREE.Mesh(PLACEHOLDER_GEOMETRY, PLACEHOLDER_MATERIAL);
    mesh.userData.isPlaceholder = true;
    mesh.userData.missingMeshPath = path;
    return mesh;
};

// ============================================================
// PERFORMANCE: First-detection mode for unit scaling
// Once we detect the scale factor, apply it to all subsequent meshes
// ============================================================
let _detectedUnitScale: number | null = null;
let _unitScaleDetectionCount = 0;
const MAX_UNIT_DETECTION_SAMPLES = 3; // Sample first few meshes then use cached scale

// Reset unit detection (call when loading new model)
export const resetUnitDetection = () => {
    _detectedUnitScale = null;
    _unitScaleDetectionCount = 0;
};

// Custom mesh loader callback with first-detection unit scaling
export const createMeshLoader = (assets: Record<string, string>, manager: THREE.LoadingManager, urdfDir: string = '', assetIndex?: AssetIndex) => {
    return async (
        path: string,
        _manager: THREE.LoadingManager,
        done: (result: THREE.Object3D, err?: Error) => void
    ) => {
        try {
            // PERFORMANCE: Use pre-indexed lookup if available, fallback to legacy
            const assetUrl = assetIndex
                ? findAssetByIndex(path, assetIndex, urdfDir)
                : findAssetByPath(path, assets, urdfDir);

            if (assetUrl) {
                // Asset found, proceed with loading
            }

            if (!assetUrl) {
                console.warn('[MeshLoader] Mesh not found, using placeholder:', path);
                done(createPlaceholderMesh(path));
                return;
            }

            // PERFORMANCE: Avoid split, use lastIndexOf
            const lastSlash = path.lastIndexOf('/');
            const filename = lastSlash === -1 ? path : path.substring(lastSlash + 1);
            const lastDot = filename.lastIndexOf('.');
            const ext = lastDot === -1 ? '' : filename.substring(lastDot + 1).toLowerCase();

            let meshObject: THREE.Object3D | null = null;

            if (ext === 'stl') {
                const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
                const loader = new STLLoader(manager);
                const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });

                // Use default material - urdf-loader will override with URDF-defined materials if present
                meshObject = new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone());

                // PERFORMANCE: First-detection mode for unit scaling
                if (_detectedUnitScale !== null) {
                    // Use cached scale factor
                    if (_detectedUnitScale !== 1) {
                        meshObject.scale.set(_detectedUnitScale, _detectedUnitScale, _detectedUnitScale);
                    }
                } else if (_unitScaleDetectionCount < MAX_UNIT_DETECTION_SAMPLES) {
                    // Sample this mesh to detect unit scale
                    geometry.computeBoundingBox();
                    if (geometry.boundingBox) {
                        geometry.boundingBox.getSize(_tempSize);
                        const maxDim = Math.max(_tempSize.x, _tempSize.y, _tempSize.z);
                        if (maxDim > 10) {
                            _detectedUnitScale = 0.001;
                            console.warn('[MeshLoader] Detected mm units, caching scale factor 0.001 for subsequent meshes');
                            meshObject.scale.set(0.001, 0.001, 0.001);
                        }
                    }
                    _unitScaleDetectionCount++;
                    if (_unitScaleDetectionCount >= MAX_UNIT_DETECTION_SAMPLES && _detectedUnitScale === null) {
                        _detectedUnitScale = 1; // Units are correct, no scaling needed
                    }
                }

            } else if (ext === 'dae') {
                const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
                const loader = new ColladaLoader(manager);
                const result = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = result.scene;

                if (meshObject) {
                    meshObject.rotation.set(0, 0, 0);

                    // PERFORMANCE: First-detection mode for unit scaling
                    if (_detectedUnitScale !== null) {
                        if (_detectedUnitScale !== 1) {
                            meshObject.scale.set(_detectedUnitScale, _detectedUnitScale, _detectedUnitScale);
                        }
                    } else if (_unitScaleDetectionCount < MAX_UNIT_DETECTION_SAMPLES) {
                        // Use pooled Box3 instead of creating new one
                        _tempBox.setFromObject(meshObject);
                        _tempBox.getSize(_tempSize);
                        const maxDim = Math.max(_tempSize.x, _tempSize.y, _tempSize.z);

                        if (maxDim > 10) {
                            _detectedUnitScale = 0.001;
                            console.warn('[MeshLoader] Detected mm units in DAE, caching scale factor 0.001');
                            meshObject.scale.set(0.001, 0.001, 0.001);
                        }
                        _unitScaleDetectionCount++;
                        if (_unitScaleDetectionCount >= MAX_UNIT_DETECTION_SAMPLES && _detectedUnitScale === null) {
                            _detectedUnitScale = 1;
                        }
                    }

                    meshObject.updateMatrix();

                    // Remove lights from Collada (optimized: collect first, then remove)
                    const lightsToRemove: THREE.Object3D[] = [];
                    meshObject.traverse((child: THREE.Object3D) => {
                        if ((child as any).isLight) {
                            lightsToRemove.push(child);
                        }
                    });
                    for (let i = 0; i < lightsToRemove.length; i++) {
                        lightsToRemove[i].parent?.remove(lightsToRemove[i]);
                    }
                }

            } else if (ext === 'obj') {
                const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
                const loader = new OBJLoader(manager);
                meshObject = await new Promise<THREE.Group>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });

            } else if (ext === 'gltf' || ext === 'glb') {
                const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
                const loader = new GLTFLoader(manager);
                const gltfModel = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = gltfModel.scene;
            }

            if (meshObject) {
                done(meshObject);
            } else {
                console.warn('[MeshLoader] Unsupported mesh format, using placeholder:', ext, path);
                done(createPlaceholderMesh(path));
            }

        } catch (error) {
            console.error('[MeshLoader] Mesh loading error, using placeholder:', path, error);
            // Return placeholder instead of failing completely
            done(createPlaceholderMesh(path));
        }
    };
};
