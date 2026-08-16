/**
 * MJCF Loader entrypoint.
 * Parses MJCF XML and delegates hierarchy construction to shared builders.
 */

import * as THREE from 'three';
import { type MJCFMeshCache } from './mjcfGeometry';
import { buildMJCFHierarchy } from './mjcfHierarchyBuilder';
import { resolveMJCFMeshBackedPrimitiveGeoms } from './mjcfMeshBackedPrimitiveResolver';
import {
  clearParsedMJCFModelCache,
  getParsedMJCFModelError,
  parseMJCFModel,
  type MJCFModelTendonAttachment,
} from './mjcfModel';
import { looksLikeMJCFDocument } from './mjcfUtils';
import { disposeColladaParseWorkerPoolClient } from '@/core/loaders/colladaParseWorkerBridge';
import { disposeObjParseWorkerPoolClient } from '@/core/loaders/objParseWorkerBridge';
import { disposeStlParseWorkerPoolClient } from '@/core/loaders/stlParseWorkerBridge';
import { createMainThreadYieldController, yieldToMainThread } from '@/core/utils/yieldToMainThread';
import {
  disposeTransientObject3D,
  isMJCFLoadAbortedError,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';
import { disposeMJCFMeshCache } from './mjcfMeshAssetLoader';

const MJCF_VIEWER_LOAD_YIELD_BUDGET_MS = 4;

interface MJCFBody {
  name: string;
  pos: [number, number, number];
  quat?: [number, number, number, number];
  euler?: [number, number, number];
  geoms: MJCFGeom[];
  sites?: MJCFSite[];
  joints: MJCFJoint[];
  children: MJCFBody[];
}

interface MJCFGeom {
  name?: string;
  className?: string;
  classQName?: string;
  type: string;
  size?: number[];
  mesh?: string;
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
  fromto?: number[];
  contype?: number;
  conaffinity?: number;
  group?: number;
  material?: string;
}

interface MJCFJoint {
  name: string;
  type: string;
  axis?: [number, number, number];
  range?: [number, number];
  pos?: [number, number, number];
  stiffness?: number;
}

interface MJCFSite {
  name: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
}

interface MJCFTendonVisualizationData {
  name: string;
  rgba?: [number, number, number, number];
  attachmentRefs: string[];
  attachments?: MJCFModelTendonAttachment[];
  width?: number;
}

function resolveTendonVisualizationAttachmentRef(
  attachment: MJCFModelTendonAttachment,
): string | undefined {
  return attachment.ref || attachment.sidesite;
}

export interface MJCFLoadProgress {
  phase: 'preparing-scene' | 'streaming-meshes' | 'finalizing-scene' | 'ready';
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
}

export interface LoadMJCFToThreeJSOptions {
  abortSignal?: MJCFLoadAbortSignal;
  onAsyncSceneMutation?: () => void;
}

/** Load MJCF XML content and create a Three.js scene graph. */
export async function loadMJCFToThreeJS(
  xmlContent: string,
  assets: Record<string, string>,
  sourceFileDir = '',
  onProgress?: (progress: MJCFLoadProgress) => void,
  options: LoadMJCFToThreeJSOptions = {},
): Promise<THREE.Object3D> {
  const emitProgress = (progress: MJCFLoadProgress) => {
    onProgress?.(progress);
  };
  const { abortSignal, onAsyncSceneMutation } = options;
  const throwIfAborted = () => {
    throwIfMJCFLoadAborted(abortSignal);
  };

  let rootGroup: THREE.Group | null = null;
  const meshCache: MJCFMeshCache = new Map();

  try {
    const yieldIfNeeded = createMainThreadYieldController(MJCF_VIEWER_LOAD_YIELD_BUDGET_MS);
    const cooperativeYieldIfNeeded = async () => {
      throwIfAborted();
      await yieldIfNeeded();
      throwIfAborted();
    };

    throwIfAborted();
    emitProgress({
      phase: 'preparing-scene',
      progressPercent: 0,
    });

    await yieldToMainThread();
    throwIfAborted();
    const parsedModel = parseMJCFModel(xmlContent);
    if (!parsedModel) {
      const parseFailureReason = getParsedMJCFModelError(xmlContent);
      const message = parseFailureReason
        ? `[MJCFLoader] Failed to parse MJCF model document: ${parseFailureReason}`
        : '[MJCFLoader] Failed to parse MJCF model document.';
      throw new Error(message);
    }

    const modelName = parsedModel.modelName;
    const compilerSettings = parsedModel.compilerSettings;

    emitProgress({
      phase: 'preparing-scene',
      progressPercent: 16,
    });
    await cooperativeYieldIfNeeded();

    await resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, {
      assets,
      abortSignal,
      meshCache,
      sourceFileDir,
      yieldIfNeeded: cooperativeYieldIfNeeded,
    });

    emitProgress({
      phase: 'preparing-scene',
      progressPercent: 28,
    });
    await cooperativeYieldIfNeeded();

    const meshMap = parsedModel.meshMap;
    const materialMap = parsedModel.materialMap;
    const textureMap = parsedModel.textureMap;
    const bodies: MJCFBody[] = [parsedModel.worldBody as MJCFBody];

    rootGroup = new THREE.Group();
    rootGroup.name = modelName;
    (rootGroup as any).isURDFRobot = true;
    rootGroup.userData.__mjcfTendonsData = Array.from(parsedModel.tendonMap.values())
      .filter((tendon) => tendon.type === 'spatial')
      .map((tendon) =>
        ({
          name: tendon.name,
          rgba: tendon.rgba,
          ...(typeof tendon.width === 'number' ? { width: tendon.width } : {}),
          attachmentRefs: tendon.attachments
            .map(resolveTendonVisualizationAttachmentRef)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
          attachments: tendon.attachments.map((attachment) => ({ ...attachment })),
        }) satisfies MJCFTendonVisualizationData,
      );

    const { linksMap, jointsMap, deferredTextureApplicationsReady } = await buildMJCFHierarchy({
      bodies,
      rootGroup,
      meshMap,
      assets,
      abortSignal,
      meshCache,
      compilerSettings,
      materialMap,
      textureMap,
      actuatorMap: parsedModel.actuatorMap,
      sourceFileDir,
      onAsyncSceneMutation,
      onProgress: ({ processedGeoms, totalGeoms }) => {
        const normalizedPercent = totalGeoms > 0 ? 28 + (processedGeoms / totalGeoms) * 60 : 88;

        emitProgress({
          phase: 'streaming-meshes',
          loadedCount: processedGeoms,
          totalCount: totalGeoms,
          progressPercent: normalizedPercent,
        });
      },
      yieldIfNeeded: cooperativeYieldIfNeeded,
    });

    emitProgress({
      phase: 'finalizing-scene',
      progressPercent: 96,
    });
    await cooperativeYieldIfNeeded();

    (rootGroup as any).links = linksMap;
    (rootGroup as any).joints = jointsMap;

    await deferredTextureApplicationsReady;

    emitProgress({
      phase: 'ready',
      progressPercent: 100,
    });

    return rootGroup;
  } catch (error) {
    disposeMJCFMeshCache(meshCache);
    disposeTransientObject3D(rootGroup);

    if (isMJCFLoadAbortedError(error)) {
      throw error;
    }

    const detail = error instanceof Error ? error.message : String(error || 'unknown-error');
    throw new Error(`[MJCFLoader] Failed to load MJCF runtime scene: ${detail}`, { cause: error });
  } finally {
    // Parsed MJCF model trees are only needed while constructing the
    // current scene. Releasing them here prevents old robots from staying
    // resident after the viewer switches to another MJCF document.
    clearParsedMJCFModelCache(xmlContent);
    // MJCF switches can drive large mesh parse workloads. Tear down the
    // shared parse worker pools here so worker-side heap does not stay
    // resident across document switches.
    disposeColladaParseWorkerPoolClient();
    disposeObjParseWorkerPoolClient();
    disposeStlParseWorkerPoolClient();
  }
}

/** Check whether XML root element is MJCF `<mujoco>`. */
export function isMJCFContent(content: string): boolean {
  return looksLikeMJCFDocument(content);
}
