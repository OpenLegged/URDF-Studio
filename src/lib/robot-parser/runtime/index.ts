import * as THREE from 'three';
import { createLoadingManager, createMeshLoader } from '@/core/loaders';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import {
  buildRuntimeRobotFromState,
  type BuildRuntimeRobotFromStateOptions,
} from '@/core/parsers/urdf/loader/buildRuntimeRobotFromState';
import {
  URDFJoint as RobotRuntimeJoint,
  URDFLink as RobotRuntimeLink,
  URDFRobot as RobotRuntime,
} from '@/core/parsers/urdf/loader/URDFClasses';
import type { ColladaRootNormalizationHints } from '@/core/loaders/colladaRootNormalization';
import type { RobotData } from '@/types/robot';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import { parseRobotDefinition, parseRobotDefinitionAsync } from '../dispatch';
import type { ParseRobotDefinitionOptions } from '../types';

export interface RobotRuntimeLoadProgress {
  loaded: number;
  total: number;
  url: string;
}

export interface BuildRobotRuntimeOptions {
  /** Map of source-relative asset paths to fetchable blob/data/http URLs. */
  assets?: Record<string, string>;
  /** Original source path, used to resolve relative mesh and texture paths. */
  sourceFilePath?: string;
  parseVisual?: boolean;
  parseCollision?: boolean;
  allowPlaceholderMeshes?: boolean;
  primitiveGeometryDetail?: BuildRuntimeRobotFromStateOptions['primitiveGeometryDetail'];
  explicitScaleMeshPaths?: Iterable<string>;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  manager?: THREE.LoadingManager;
  signal?: AbortSignal;
  onProgress?: (progress: RobotRuntimeLoadProgress) => void;
  yieldIfNeeded?: () => Promise<void>;
}

export interface RobotRuntimeModel {
  /** Package-owned articulated Three.js scene root. */
  root: RobotRuntime;
  /** Non-fixed joints available for animation and motion tooling. */
  joints: RobotRuntimeJoint[];
  links: RobotRuntimeLink[];
  robotData: RobotData;
  /** Release package-owned geometries, materials, textures, and hierarchy. */
  dispose: () => void;
}

export interface LoadRobotRuntimeOptions extends BuildRobotRuntimeOptions {
  parse?: ParseRobotDefinitionOptions;
}

export interface LoadedRobotRuntime extends RobotRuntimeModel {
  format: Exclude<ReturnType<typeof parseRobotDefinition>['format'], null | 'usd'>;
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Robot runtime load aborted', 'AbortError');
  }
};

/** Dispose a runtime root created by this package. Safe to call more than once. */
export function disposeRobotRuntime(root: THREE.Object3D): void {
  disposeObject3D(root);
}

/**
 * Build the canonical URDF Studio Three.js scene graph from a RobotData DTO.
 * The returned root owns the articulated links, joints, geometry, materials,
 * and textures for every supported source format.
 */
export async function buildRobotRuntimeFromData(
  robotData: RobotData,
  options: BuildRobotRuntimeOptions = {},
): Promise<RobotRuntimeModel> {
  throwIfAborted(options.signal);

  const assets = options.assets ?? {};
  const sourceFileDir = getSourceFileDirectory(options.sourceFilePath);
  const manager = options.manager ?? createLoadingManager(assets, sourceFileDir);
  const previousOnProgress = manager.onProgress;
  if (options.onProgress) {
    manager.onProgress = (url, loaded, total) => {
      previousOnProgress?.(url, loaded, total);
      options.onProgress?.({ url, loaded, total });
    };
  }

  let resolveAssets!: () => void;
  const assetsReady = new Promise<void>((resolve) => {
    resolveAssets = resolve;
  });
  const previousOnLoad = manager.onLoad;
  manager.onLoad = () => {
    previousOnLoad?.();
    resolveAssets();
  };

  const completionKey = `__urdf_studio_robot_runtime__:${robotData.name || 'robot'}`;
  manager.itemStart(completionKey);

  let robot: RobotRuntime;
  try {
    robot = await buildRuntimeRobotFromState({
      robotName: robotData.name,
      links: robotData.links,
      joints: robotData.joints,
      materials: robotData.materials,
      inspectionContext: robotData.inspectionContext,
      rootLinkId: robotData.rootLinkId,
      manager,
      loadMeshCb: createMeshLoader(assets, manager, sourceFileDir, {
        allowPlaceholderMeshes: options.allowPlaceholderMeshes,
        explicitScaleMeshPaths: options.explicitScaleMeshPaths,
        colladaRootNormalizationHints: options.colladaRootNormalizationHints,
        yieldIfNeeded: options.yieldIfNeeded,
      }),
      parseVisual: options.parseVisual ?? true,
      parseCollision: options.parseCollision ?? true,
      primitiveGeometryDetail: options.primitiveGeometryDetail,
      yieldIfNeeded: options.yieldIfNeeded,
    });
  } finally {
    manager.itemEnd(completionKey);
  }

  try {
    await assetsReady;
    throwIfAborted(options.signal);
  } catch (error) {
    // Once the articulated graph has been constructed, the caller cannot own or
    // release it until this function returns. Keep abort/error paths symmetric
    // with the public runtime ownership contract.
    disposeRobotRuntime(robot);
    throw error;
  }

  let disposed = false;
  return {
    root: robot,
    robotData,
    joints: Object.values(robot.joints).filter((joint) => joint.jointType !== 'fixed'),
    links: Object.values(robot.links),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeRobotRuntime(robot);
    },
  };
}

/** Parse and render URDF/MJCF/SDF/Xacro through one package-owned pipeline. */
export async function loadRobotRuntime(
  content: string,
  filename: string,
  options: LoadRobotRuntimeOptions = {},
): Promise<LoadedRobotRuntime> {
  const parsed = await parseRobotDefinitionAsync(content, filename, {
    ...options.parse,
    assets: options.assets,
    signal: options.signal,
    sourcePath: options.sourceFilePath ?? filename,
  });
  if (parsed.status === 'needs_usd_runtime') {
    throw new Error('USD requires loadUsdRobotRuntime from @urdf-studio/robot-runtime/usd.');
  }
  if (parsed.status === 'error') {
    throw new Error(parsed.message);
  }

  const runtime = await buildRobotRuntimeFromData(parsed.robotData, {
    ...options,
    sourceFilePath: options.sourceFilePath ?? filename,
  });
  return { ...runtime, format: parsed.format };
}

export { RobotRuntime, RobotRuntimeJoint, RobotRuntimeLink };
export type { RobotData } from '@/types/robot';
export type { ParseRobotDefinitionOptions } from '../types';
