/**
 * Loaders Module
 * Provides mesh loading utilities for STL, DAE, OBJ, GLTF/GLB formats
 */

export {
    cleanFilePath,
    buildAssetIndex,
    findAssetByIndex,
    findAssetByPath,
    createLoadingManager,
    createPlaceholderMesh,
    resetUnitDetection,
    createMeshLoader
} from './meshLoader';

export type { AssetIndex } from './meshLoader';
