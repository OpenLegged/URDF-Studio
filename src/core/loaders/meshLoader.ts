/**
 * Mesh Loader - Handles loading of mesh files (STL, MSH, DAE, OBJ, GLTF/GLB, PLY, VTK)
 *
 * Features:
 * - Pre-indexed asset lookup for O(1) complexity
 * - First-detection mode for automatic unit scaling
 * - Optional placeholder meshes for callers that explicitly opt in
 * - Support for STL, MSH, DAE, OBJ, GLTF/GLB, PLY, VTK formats
 */

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import { buildExplicitlyScaledMeshPathHints, hasExplicitMeshScaleHint } from './meshScaleHints';
import { mitigateCoplanarMaterialZFighting } from './coplanarMaterialOffset';
import { type ColladaRootNormalizationHints } from './colladaRootNormalization';
import { loadSerializedColladaSceneData } from './colladaParseWorkerBridge';
import { createSceneFromSerializedColladaData } from './colladaWorkerSceneData';
import { parseColladaMeshDataWithWasm } from './colladaWasmParser';
import { registerManagedTextureHandlers } from './textureLoaderHandlers';
import { cleanFilePath } from './pathNormalization';
import {
  failFastInDev,
  logRuntimeFailure,
  normalizeRuntimeError,
} from '@/core/utils/runtimeDiagnostics';
import { MATERIAL_CONFIG } from '@/core/utils/materialFactory';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';
import { createGeometryFromSerializedMshData } from './mshGeometryData';
import { loadSerializedMshGeometryData } from './mshParseWorkerBridge';
import {
  applyObjMaterialLibrariesToObject,
  cloneObjSceneWithOwnedResources,
} from './objMaterialUtils';
import {
  addMainThreadMaterialPerformance,
  durationMs,
  readHighResolutionEpochMs,
} from './meshLoadPerformance';
import {
  createObjectFromSerializedObjDataAsync,
  loadSerializedObjModelData,
} from './objParseWorkerBridge';
import { createGeometryFromSerializedStlData } from './stlGeometryData';
import { loadSerializedStlGeometryData } from './stlParseWorkerBridge';
import {
  buildAssetIndex,
  findAssetByIndex,
  findAssetByPath,
  getPathExtension,
  SUPPORTED_MESH_EXTENSIONS,
  type AssetIndex,
} from './assetPathIndex';
import { markSharedThreeResource } from '@/core/utils/threeResourceOwnership';

// Re-exported so existing deep imports from './meshLoader' keep resolving after
// the asset path-index engine moved to ./assetPathIndex.
export { buildAssetIndex, findAssetByIndex, findAssetByPath };
export type { AssetIndex };

// ============================================================
// SHARED MATERIALS - Avoid shader recompilation for each mesh
// ============================================================
const DEFAULT_MESH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x707070, // Medium-dark grey for proper exposure in bright studio lighting
  roughness: MATERIAL_CONFIG.roughness,
  metalness: MATERIAL_CONFIG.metalness,
  envMapIntensity: MATERIAL_CONFIG.envMapIntensity,
});
const PLACEHOLDER_MATERIAL = markSharedThreeResource(
  new THREE.MeshPhongMaterial({
    color: 0xff6b6b,
    transparent: true,
    opacity: 0.7,
  }),
);

// Reusable Vector3 for size calculations (object pooling)
const _tempSize = new THREE.Vector3();
const _tempBox = new THREE.Box3();
const _tempChildBox = new THREE.Box3();

export const postProcessColladaScene = (root: THREE.Object3D): number => {
  const lightsToRemove: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  _tempBox.makeEmpty();

  root.traverse((child: THREE.Object3D) => {
    if ((child as any).isLight) {
      lightsToRemove.push(child);
      return;
    }

    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geometry = mesh.geometry;
      if (geometry) {
        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }

        if (geometry.boundingBox) {
          _tempChildBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          _tempBox.union(_tempChildBox);
        }
      }

      mitigateCoplanarMaterialZFighting(mesh);
    }
  });

  for (let i = 0; i < lightsToRemove.length; i += 1) {
    lightsToRemove[i].parent?.remove(lightsToRemove[i]);
  }

  if (_tempBox.isEmpty()) {
    return 0;
  }

  _tempBox.getSize(_tempSize);
  return Math.max(_tempSize.x, _tempSize.y, _tempSize.z);
};

function extractColladaUrlBase(assetUrl: string): string {
  const queryIndex = assetUrl.search(/[?#]/);
  const cleanUrl = queryIndex >= 0 ? assetUrl.slice(0, queryIndex) : assetUrl;
  const slashIndex = cleanUrl.lastIndexOf('/');
  return slashIndex >= 0 ? assetUrl.slice(0, slashIndex + 1) : '';
}

async function loadColladaSceneForMeshLoader(
  assetUrl: string,
  manager: THREE.LoadingManager,
  runMainThreadTask: <T>(task: () => T | Promise<T>) => Promise<T>,
): Promise<THREE.Object3D> {
  if (typeof Worker !== 'undefined') {
    try {
      const serializedScene = await loadSerializedColladaSceneData(assetUrl);
      return await runMainThreadTask(() =>
        createSceneFromSerializedColladaData(serializedScene, { manager }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/collada parse worker is (?:unavailable|not available)/i.test(message)) {
        console.error(`[MeshLoader] Collada parse failed for "${assetUrl}":`, error);
        throw error;
      }
      console.warn(`[MeshLoader] ${message}; parsing Collada asset in-process.`);
    }
  }

  ensureWorkerXmlDomApis();
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Collada asset: ${response.status} ${response.statusText}`);
  }

  const serializedScene = await parseColladaMeshDataWithWasm(
    await response.arrayBuffer(),
    extractColladaUrlBase(assetUrl),
  );
  return await runMainThreadTask(() =>
    createSceneFromSerializedColladaData(serializedScene, { manager }),
  );
}

const tryResolveManagedAssetUrl = (
  url: string,
  assetIndex: AssetIndex,
  urdfDir: string = '',
): string | null => {
  // Blob/data URLs are normally already resolved. Collada can sometimes build
  // malformed blob-relative paths like "blob:http://host/texture.png", so try
  // to recover the filename and remap it back through the imported asset index.
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const blobMatch = url.match(/^blob:https?:\/\/[^/]+\/(.+)$/);
    if (
      blobMatch?.[1] &&
      /\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb|ply|vtk|bin)$/i.test(blobMatch[1])
    ) {
      const found = findAssetByIndex(blobMatch[1], assetIndex, urdfDir);
      if (found) {
        return found;
      }
    }
    return url;
  }

  const found = findAssetByIndex(url, assetIndex, urdfDir);
  if (found) {
    return found;
  }

  // Allow HTTP/HTTPS URLs to pass through (e.g. cloud storage or CDN links)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return null;
};

// Loading manager that resolves asset URLs from our blob storage
export const resolveManagedAssetUrl = (
  url: string,
  assetIndex: AssetIndex,
  urdfDir: string = '',
): string => {
  const resolvedUrl = tryResolveManagedAssetUrl(url, assetIndex, urdfDir);
  if (resolvedUrl) {
    return resolvedUrl;
  }

  console.error('[MeshLoader] Asset not found:', url);
  const unresolvedAssetError = new Error(
    `Asset lookup failed for "${url}" under "${urdfDir || '.'}".`,
  );

  failFastInDev('MeshLoader:resolveManagedAssetUrl', unresolvedAssetError);
  throw unresolvedAssetError;
};

export const createLoadingManager = (assets: Record<string, string>, urdfDir: string = '') => {
  const manager = new THREE.LoadingManager();
  const assetIndex = buildAssetIndex(assets, urdfDir);

  manager.setURLModifier((url: string) => resolveManagedAssetUrl(url, assetIndex, urdfDir));
  registerManagedTextureHandlers(manager);

  return manager;
};

// Shared placeholder geometry (created once)
const PLACEHOLDER_GEOMETRY = markSharedThreeResource(
  new THREE.BoxGeometry(0.05, 0.05, 0.05),
);

interface MeshLoadIssue {
  message: string;
  path: string;
}

// Optional placeholder mesh for callers that explicitly opt into degraded rendering.
export const createPlaceholderMesh = (
  path: string,
  meshLoadIssue?: MeshLoadIssue,
): THREE.Object3D => {
  // Use shared geometry and material to avoid shader recompilation
  const mesh = new THREE.Mesh(PLACEHOLDER_GEOMETRY, PLACEHOLDER_MATERIAL);
  mesh.userData.isPlaceholder = true;
  mesh.userData.missingMeshPath = path;
  if (meshLoadIssue) {
    mesh.userData.meshLoadIssue = meshLoadIssue;
  }
  return mesh;
};

// ============================================================
// PERFORMANCE: First-detection mode for unit scaling
// Once we detect the scale factor, apply it to all subsequent meshes
// ============================================================
// State moved to createMeshLoader closure

// Reset unit detection (call when loading new model)
// Deprecated: State is now scoped to createMeshLoader closure
export const resetUnitDetection = () => {
  // No-op
};

export interface MeshLoaderOptions {
  assetIndex?: AssetIndex;
  allowPlaceholderMeshes?: boolean;
  explicitScaleMeshPaths?: Iterable<string>;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  yieldIfNeeded?: () => Promise<void>;
  yieldBudgetMs?: number;
}

interface CachedMeshAsset {
  createInstance: () => THREE.Object3D;
  maxDimension: number | null;
  hasDeclaredUnitScale: boolean;
  supportsAutoUnitScale: boolean;
}

const resolveMeshLoaderExtension = (
  requestedPath: string,
  resolvedAssetPath: string = '',
): string => {
  const requestedExtension = getPathExtension(requestedPath);
  const resolvedExtension = getPathExtension(resolvedAssetPath);
  if (
    resolvedExtension &&
    resolvedExtension !== requestedExtension &&
    SUPPORTED_MESH_EXTENSIONS.has(resolvedExtension)
  ) {
    return resolvedExtension;
  }

  if (SUPPORTED_MESH_EXTENSIONS.has(requestedExtension)) {
    return requestedExtension;
  }

  if (SUPPORTED_MESH_EXTENSIONS.has(resolvedExtension)) {
    return resolvedExtension;
  }

  return requestedExtension;
};

const cloneMaterialInstance = <TMaterial extends THREE.Material>(
  material: TMaterial,
): TMaterial => {
  const clonedMaterial = material.clone() as TMaterial;
  clonedMaterial.userData = {
    ...(material.userData ?? {}),
    ...(clonedMaterial.userData ?? {}),
  };
  return clonedMaterial;
};

const cloneMaterialsInObject = <TObject extends THREE.Object3D>(root: TObject): TObject => {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => cloneMaterialInstance(material));
      return;
    }

    if (mesh.material) {
      mesh.material = cloneMaterialInstance(mesh.material);
    }
  });

  return root;
};

const objectHasSkinnedMeshes = (root: THREE.Object3D): boolean => {
  let hasSkinnedMeshes = false;

  root.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      hasSkinnedMeshes = true;
    }
  });

  return hasSkinnedMeshes;
};

const cloneObject3DForReuse = (
  source: THREE.Object3D,
  options: { preserveSkeletons?: boolean } = {},
): THREE.Object3D => {
  const clonedRoot = options.preserveSkeletons ? cloneSkeleton(source) : source.clone(true);

  return cloneMaterialsInObject(clonedRoot);
};

/**
 * Check whether any descendant of the given root has a non-identity local
 * scale.  DAE files exported from tools like Blender may encode unit
 * conversions (e.g. inch → meter as 0.0254) in child node <matrix>
 * transforms rather than in the root <unit> element.
 */
const hasDescendantNodeScale = (root: THREE.Object3D): boolean => {
  const stack = Array.from(root.children);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      Math.abs(node.scale.x - 1) > 1e-6 ||
      Math.abs(node.scale.y - 1) > 1e-6 ||
      Math.abs(node.scale.z - 1) > 1e-6
    ) {
      return true;
    }
    for (let i = 0; i < node.children.length; i += 1) {
      stack.push(node.children[i]);
    }
  }
  return false;
};

const applyDetectedUnitScale = (meshObject: THREE.Object3D, unitScale: number | null): void => {
  if (!unitScale || unitScale === 1) {
    return;
  }

  meshObject.scale.set(unitScale, unitScale, unitScale);
};

// Custom mesh loader callback with first-detection unit scaling
export const createMeshLoader = (
  assets: Record<string, string>,
  manager: THREE.LoadingManager,
  urdfDir: string = '',
  options: MeshLoaderOptions = {},
) => {
  // Scoped state for this loader instance
  let _detectedUnitScale: number | null = null;
  let pendingRequestCounter = 0;
  const cachedMeshAssetPromises = new Map<string, Promise<CachedMeshAsset>>();
  const assetIndex = options.assetIndex ?? buildAssetIndex(assets, urdfDir);
  const assetUrlToPath = new Map<string, string>();
  Object.entries(assets).forEach(([assetPath, assetUrl]) => {
    if (!assetUrlToPath.has(assetUrl)) {
      assetUrlToPath.set(assetUrl, cleanFilePath(assetPath));
    }
  });
  const explicitScaleHints = options.explicitScaleMeshPaths
    ? buildExplicitlyScaledMeshPathHints(options.explicitScaleMeshPaths, urdfDir)
    : null;
  const allowPlaceholderMeshes = options.allowPlaceholderMeshes === true;
  const yieldIfNeeded =
    options.yieldIfNeeded ?? createMainThreadYieldController(options.yieldBudgetMs);
  let mainThreadTaskQueue: Promise<void> = Promise.resolve();
  const placeholderMeshFailures: MeshLoadIssue[] = [];
  let placeholderMeshFailureWarningScheduled = false;

  const runMainThreadTask = async <T>(task: () => T | Promise<T>): Promise<T> => {
    const nextTask = mainThreadTaskQueue.then(async () => {
      await yieldIfNeeded();
      const result = await task();
      await yieldIfNeeded();
      return result;
    });

    mainThreadTaskQueue = nextTask.then(
      () => undefined,
      () => undefined,
    );

    return await nextTask;
  };

  const schedulePlaceholderMeshFailureWarning = (issue: MeshLoadIssue) => {
    placeholderMeshFailures.push(issue);
    if (placeholderMeshFailureWarningScheduled) {
      return;
    }

    placeholderMeshFailureWarningScheduled = true;
    setTimeout(() => {
      placeholderMeshFailureWarningScheduled = false;
      const failures = placeholderMeshFailures.splice(0);
      if (failures.length === 0) {
        return;
      }

      console.warn(
        `[MeshLoader] Missing ${failures.length} mesh asset(s); rendering placeholders instead.`,
        failures.slice(0, 20).map((failure) => failure.path),
      );
    }, 0);
  };

  const resolveMeshFailure = (
    path: string,
    message: string,
    cause?: unknown,
  ): { error?: Error; object: THREE.Object3D | null } => {
    const error = normalizeRuntimeError(cause, message);
    const issue: MeshLoadIssue = { message, path };

    if (allowPlaceholderMeshes) {
      schedulePlaceholderMeshFailureWarning(issue);
      return {
        object: createPlaceholderMesh(path, issue),
      };
    }

    logRuntimeFailure('MeshLoader', new Error(`${message} (${path})`, { cause: error }));

    return {
      error,
      object: null,
    };
  };

  const loadOrCreateCachedMeshAsset = async (
    assetUrl: string,
    ext: string,
  ): Promise<CachedMeshAsset> => {
    const cacheKey = `${ext}:${assetUrl}`;
    const cachedPromise = cachedMeshAssetPromises.get(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }

    const pendingPromise = (async (): Promise<CachedMeshAsset> => {
      if (ext === 'stl') {
        const serializedGeometry = await loadSerializedStlGeometryData(assetUrl);
        const geometry = createGeometryFromSerializedStlData(serializedGeometry);
        await yieldIfNeeded();

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: serializedGeometry.maxDimension,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: true,
        };
      }

      if (ext === 'msh') {
        const serializedGeometry = await loadSerializedMshGeometryData(assetUrl);
        const geometry = createGeometryFromSerializedMshData(serializedGeometry);
        await yieldIfNeeded();

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: serializedGeometry.maxDimension,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: true,
        };
      }

      if (ext === 'dae') {
        const scene = await loadColladaSceneForMeshLoader(assetUrl, manager, runMainThreadTask);

        await yieldIfNeeded();
        const maxDimension = postProcessColladaScene(scene);
        scene.updateMatrix();
        await yieldIfNeeded();

        // When the DAE file carries a unit conversion — either as a root
        // scale (baked by createSceneFromSerializedColladaData from the
        // <unit> element) or as a non-identity scale in any descendant node
        // (e.g. Blender exports inch→meter as a 0.0254 <matrix> transform
        // on child nodes) — the auto-unit heuristic (maxDimension > 10 →
        // ×0.001) must NOT fire, because the geometry is already at the
        // correct scale.  Applying the heuristic would override the
        // authored conversion and shrink the model by the wrong factor.
        const hasExplicitDaeUnitScale =
          Math.abs(scene.scale.x - 1) > 1e-6 ||
          Math.abs(scene.scale.y - 1) > 1e-6 ||
          Math.abs(scene.scale.z - 1) > 1e-6 ||
          hasDescendantNodeScale(scene);

        return {
          createInstance: () => cloneObject3DForReuse(scene),
          maxDimension,
          hasDeclaredUnitScale: Number.isFinite(
            (scene.userData as { colladaUnitScale?: unknown })?.colladaUnitScale,
          ),
          supportsAutoUnitScale: !hasExplicitDaeUnitScale,
        };
      }

      if (ext === 'obj') {
        const sourcePath = assetUrlToPath.get(assetUrl) ?? '';
        const serializedObject = await loadSerializedObjModelData(assetUrl);
        const object = await runMainThreadTask(() =>
          createObjectFromSerializedObjDataAsync(serializedObject, { yieldIfNeeded }),
        );
        if (serializedObject.materialLibraries.length === 0) {
          await yieldIfNeeded();

          return {
            createInstance: () => cloneObject3DForReuse(object),
            maxDimension: null,
            hasDeclaredUnitScale: false,
            supportsAutoUnitScale: false,
          };
        }

        const objManager = new THREE.LoadingManager();
        const objAssetBaseDir = getSourceFileDirectory(sourcePath);
        objManager.setURLModifier((url: string) => {
          const resolvedUrl = tryResolveManagedAssetUrl(url, assetIndex, objAssetBaseDir);
          if (resolvedUrl) {
            return resolvedUrl;
          }

          const baseDir = objAssetBaseDir ? objAssetBaseDir.replace(/\/?$/, '/') : '.';
          const normalizedUrl = url.replace(/^\.?\//, '');
          const lookupPath =
            objAssetBaseDir &&
            !/^(?:[a-z]+:)?\/\//i.test(url) &&
            !url.startsWith('/') &&
            !normalizedUrl.startsWith(baseDir)
              ? `${baseDir}${normalizedUrl}`
              : url;
          throw new Error(`Asset lookup failed for "${lookupPath}" under "${baseDir}".`);
        });
        registerManagedTextureHandlers(objManager);
        const materialStartedAt = readHighResolutionEpochMs();
        await applyObjMaterialLibrariesToObject(
          object,
          serializedObject.materialLibraries,
          objManager,
          sourcePath,
          { yieldIfNeeded },
        );
        addMainThreadMaterialPerformance(
          serializedObject.loadPerformance,
          durationMs(materialStartedAt),
        );
        if (serializedObject.loadPerformance) {
          object.userData = {
            ...(object.userData ?? {}),
            meshLoadPerformance: serializedObject.loadPerformance,
          };
        }
        await yieldIfNeeded();

        return {
          createInstance: () => cloneObjSceneWithOwnedResources(object),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      if (ext === 'gltf' || ext === 'glb') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader(manager);
        const gltfModel = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
          loader.load(assetUrl, resolve, undefined, reject);
        });
        const preserveSkeletons = objectHasSkinnedMeshes(gltfModel.scene);

        return {
          createInstance: () => cloneObject3DForReuse(gltfModel.scene, { preserveSkeletons }),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      if (ext === 'ply') {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const loader = new PLYLoader(manager);
        const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          loader.load(assetUrl, resolve, undefined, reject);
        });
        if (!geometry.getAttribute('normal')) {
          geometry.computeVertexNormals();
        }
        const hasVertexColors = Boolean(geometry.getAttribute('color'));

        return {
          createInstance: () => {
            const material = DEFAULT_MESH_MATERIAL.clone();
            material.vertexColors = hasVertexColors;
            if (hasVertexColors) {
              material.color.set(0xffffff);
              material.toneMapped = false;
            }
            return new THREE.Mesh(geometry, material);
          },
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      if (ext === 'vtk') {
        const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js');
        const loader = new VTKLoader(manager);
        const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
          loader.load(assetUrl, resolve, undefined, reject);
        });

        return {
          createInstance: () => new THREE.Mesh(geometry, DEFAULT_MESH_MATERIAL.clone()),
          maxDimension: null,
          hasDeclaredUnitScale: false,
          supportsAutoUnitScale: false,
        };
      }

      throw new Error(`Unsupported mesh format: ${ext}`);
    })();

    cachedMeshAssetPromises.set(cacheKey, pendingPromise);

    try {
      return await pendingPromise;
    } catch (error) {
      cachedMeshAssetPromises.delete(cacheKey);
      throw error;
    }
  };

  return async (
    path: string,
    _manager: THREE.LoadingManager,
    done: (result: THREE.Object3D | null, err?: Error) => void,
  ) => {
    const pendingRequestToken = `__urdf_studio_mesh_loader__${pendingRequestCounter++}:${path}`;
    manager.itemStart(pendingRequestToken);

    try {
      const assetUrl = findAssetByIndex(path, assetIndex, urdfDir);

      if (assetUrl) {
        // Asset found, proceed with loading
      }

      if (!assetUrl) {
        const failure = resolveMeshFailure(path, 'Mesh asset could not be resolved.');
        done(failure.object, failure.error);
        return;
      }

      const resolvedAssetPath = assetUrlToPath.get(assetUrl) ?? '';
      const ext = resolveMeshLoaderExtension(path, resolvedAssetPath);
      const hasExplicitScale = hasExplicitMeshScaleHint(path, explicitScaleHints, urdfDir);

      const cachedMeshAsset = await loadOrCreateCachedMeshAsset(assetUrl, ext);
      const meshObject = cachedMeshAsset.createInstance();

      if (
        cachedMeshAsset.supportsAutoUnitScale &&
        !cachedMeshAsset.hasDeclaredUnitScale &&
        !hasExplicitScale
      ) {
        if (_detectedUnitScale !== null) {
          applyDetectedUnitScale(meshObject, _detectedUnitScale);
        } else if ((cachedMeshAsset.maxDimension ?? 0) > 10) {
          _detectedUnitScale = 0.001;
          applyDetectedUnitScale(meshObject, _detectedUnitScale);
        }
      }

      if (meshObject) {
        await yieldIfNeeded();
        if (ext !== 'dae') {
          meshObject.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              mitigateCoplanarMaterialZFighting(child as THREE.Mesh);
            }
          });
        }
        done(meshObject);
      } else {
        const failure = resolveMeshFailure(
          path,
          `Unsupported mesh format "${ext}" returned no mesh object.`,
        );
        done(failure.object, failure.error);
      }
    } catch (error) {
      const failure = resolveMeshFailure(path, 'Mesh loading failed.', error);
      done(failure.object, failure.error);
    } finally {
      manager.itemEnd(pendingRequestToken);
    }
  };
};
