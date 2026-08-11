import * as THREE from 'three';

import {
  createLoadingManager,
  createMeshLoader,
  type MeshLoaderOptions,
} from '@/core/loaders/meshLoader';
import { buildAssetIndex, findAssetByIndex } from '@/core/loaders/assetPathIndex';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import { disposeObject3D } from '@/shared/utils/three/dispose';

export interface RobotMeshLoaderOptions extends Omit<MeshLoaderOptions, 'assetIndex'> {
  /** Map of source-relative asset paths to fetchable blob/data/http URLs. */
  assets?: Record<string, string>;
  /** Robot definition or package entry path used to resolve relative assets. */
  sourceFilePath?: string;
  /** Optional manager owned by the consumer. */
  manager?: THREE.LoadingManager;
}

export interface RobotMeshLoadOptions {
  signal?: AbortSignal;
}

export interface RobotMeshLoader {
  /** Load one mesh asset as its complete package-authored Object3D hierarchy. */
  load(path: string, options?: RobotMeshLoadOptions): Promise<THREE.Object3D>;
  /**
   * Invalidate pending loads and release every Object3D returned by this session.
   * Blob URLs remain owned by the consumer and are not revoked here.
   */
  dispose(): void;
}

/** Resolve a robot-relative asset through the same canonical path index used by the mesh pipeline. */
export function resolveRobotAsset(
  path: string,
  assets: Record<string, string>,
  sourceFilePath?: string,
): string | null {
  if (/^(blob:|data:|https?:)/i.test(path)) return path;
  const sourceFileDir = getSourceFileDirectory(sourceFilePath);
  return findAssetByIndex(path, buildAssetIndex(assets, sourceFileDir), sourceFileDir);
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('Robot mesh load aborted', 'AbortError');
}

/**
 * Create a reusable facade over URDF Studio's canonical mesh pipeline.
 *
 * The session shares parsed mesh data across duplicate requests and supports
 * STL, MuJoCo MSH, DAE, OBJ, GLTF/GLB, PLY, and VTK. The session owns every
 * returned object; call dispose only after all of its instances leave the scene.
 */
export function createRobotMeshLoader(options: RobotMeshLoaderOptions = {}): RobotMeshLoader {
  const assets = options.assets ?? {};
  const sourceFileDir = getSourceFileDirectory(options.sourceFilePath);
  const manager = options.manager ?? createLoadingManager(assets, sourceFileDir);
  const loadMesh = createMeshLoader(assets, manager, sourceFileDir, {
    allowPlaceholderMeshes: options.allowPlaceholderMeshes,
    explicitScaleMeshPaths: options.explicitScaleMeshPaths,
    colladaRootNormalizationHints: options.colladaRootNormalizationHints,
    yieldIfNeeded: options.yieldIfNeeded,
    yieldBudgetMs: options.yieldBudgetMs,
  });
  const ownedObjects = new Set<THREE.Object3D>();
  const pendingRejectors = new Set<(error: Error) => void>();
  let disposed = false;

  return {
    load(path, loadOptions = {}) {
      if (disposed) {
        return Promise.reject(createAbortError());
      }
      if (loadOptions.signal?.aborted) {
        return Promise.reject(createAbortError(loadOptions.signal.reason));
      }

      return new Promise<THREE.Object3D>((resolve, reject) => {
        let settled = false;
        const rejectOnce = (error: Error) => {
          if (settled) return;
          settled = true;
          loadOptions.signal?.removeEventListener('abort', handleAbort);
          pendingRejectors.delete(rejectOnce);
          reject(error);
        };
        const handleAbort = () => rejectOnce(createAbortError(loadOptions.signal?.reason));

        pendingRejectors.add(rejectOnce);
        loadOptions.signal?.addEventListener('abort', handleAbort, { once: true });
        void loadMesh(path, manager, (object, error) => {
          if (error) {
            if (object) disposeObject3D(object);
            rejectOnce(error);
            return;
          }
          if (!object) {
            rejectOnce(new Error(`Robot mesh loader returned no object for "${path}".`));
            return;
          }

          if (disposed || settled || loadOptions.signal?.aborted) {
            disposeObject3D(object);
            rejectOnce(createAbortError(loadOptions.signal?.reason));
            return;
          }

          settled = true;
          loadOptions.signal?.removeEventListener('abort', handleAbort);
          pendingRejectors.delete(rejectOnce);
          ownedObjects.add(object);
          resolve(object);
        });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const abortError = createAbortError();
      Array.from(pendingRejectors).forEach((rejectPending) => rejectPending(abortError));
      pendingRejectors.clear();
      ownedObjects.forEach((object) => disposeObject3D(object));
      ownedObjects.clear();
    },
  };
}
