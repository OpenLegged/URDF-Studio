import { DEFAULT_LINK, GeometryType, type RobotData, type UsdSceneSnapshot } from '@/types';
import { getLinkPathFromMeshId } from '../runtime/viewer/link-rotation/shared.js';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';

const USD_SYNTHETIC_ROOT_LINK_ID = 'usd_scene_root';
const USD_FALLBACK_ROOT_LINK_PATH = '/usd_scene_root';
const USD_RUNTIME_MESH_LEAF_PATTERN = /^(?:primitive(?:_\d+)?|geomsubset(?:_\d+)?)$/i;

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '').trim().replace(/[<>]/g, '').replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getPathBasename(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function stripRuntimeMeshLeaf(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';

  const protoLinkPath = getLinkPathFromMeshId(normalized);
  if (protoLinkPath) {
    return normalizeUsdPath(protoLinkPath);
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return '';

  const lastSegment = segments[segments.length - 1] || '';
  if (USD_RUNTIME_MESH_LEAF_PATTERN.test(lastSegment)) {
    segments.pop();
  }

  return segments.length > 0 ? `/${segments.join('/')}` : '';
}

function toAncestorPaths(path: string | null | undefined): string[] {
  const normalized = stripRuntimeMeshLeaf(path);
  if (!normalized) return [];

  const segments = normalized.split('/').filter(Boolean);
  const ancestors: string[] = [];
  for (let index = segments.length; index > 0; index -= 1) {
    ancestors.push(`/${segments.slice(0, index).join('/')}`);
  }
  return ancestors;
}

function getRootLinkPathFromResolution(resolution: ViewerRobotDataResolution | null | undefined): string | null {
  if (!resolution) return null;

  const byRootId = normalizeUsdPath(resolution.linkPathById[resolution.robotData.rootLinkId]);
  if (byRootId) {
    return byRootId;
  }

  const firstKnownLinkPath = Object.keys(resolution.linkIdByPath).find(Boolean);
  return normalizeUsdPath(firstKnownLinkPath) || null;
}

function inferCommonMeshRootPath(meshIds: Iterable<string>): string {
  const normalizedPaths = Array.from(meshIds)
    .map((meshId) => stripRuntimeMeshLeaf(meshId))
    .filter(Boolean);
  if (normalizedPaths.length === 0) {
    return USD_FALLBACK_ROOT_LINK_PATH;
  }

  let commonSegments = normalizedPaths[0]!.split('/').filter(Boolean);
  for (const path of normalizedPaths.slice(1)) {
    const candidateSegments = path.split('/').filter(Boolean);
    let sharedLength = 0;
    while (
      sharedLength < commonSegments.length
      && sharedLength < candidateSegments.length
      && commonSegments[sharedLength] === candidateSegments[sharedLength]
    ) {
      sharedLength += 1;
    }
    commonSegments = commonSegments.slice(0, sharedLength);
    if (commonSegments.length === 0) break;
  }

  return commonSegments.length > 0
    ? `/${commonSegments.join('/')}`
    : normalizedPaths[0]!;
}

function createSyntheticRootRobotData(robotName: string): RobotData {
  return {
    name: robotName,
    links: {
      [USD_SYNTHETIC_ROOT_LINK_ID]: {
        ...DEFAULT_LINK,
        id: USD_SYNTHETIC_ROOT_LINK_ID,
        name: USD_SYNTHETIC_ROOT_LINK_ID,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      },
    },
    joints: {},
    rootLinkId: USD_SYNTHETIC_ROOT_LINK_ID,
  };
}

export function createSyntheticUsdViewerRobotResolution({
  fileName,
  stageSourcePath,
  snapshot,
  meshIds = [],
}: {
  fileName?: string | null;
  stageSourcePath?: string | null;
  snapshot?: UsdSceneSnapshot | null;
  meshIds?: Iterable<string>;
}): ViewerRobotDataResolution {
  const normalizedStageSourcePath = normalizeUsdPath(stageSourcePath || snapshot?.stageSourcePath) || null;
  const rootLinkPath = normalizeUsdPath(
    snapshot?.stage?.defaultPrimPath
      || inferCommonMeshRootPath(meshIds),
  ) || USD_FALLBACK_ROOT_LINK_PATH;
  const robotName = fileName?.split('/').pop()?.replace(/\.[^/.]+$/, '')
    || getPathBasename(snapshot?.stage?.defaultPrimPath)
    || getPathBasename(normalizedStageSourcePath)
    || 'usd_scene';

  return {
    stageSourcePath: normalizedStageSourcePath,
    linkIdByPath: {
      [rootLinkPath]: USD_SYNTHETIC_ROOT_LINK_ID,
    },
    linkPathById: {
      [USD_SYNTHETIC_ROOT_LINK_ID]: rootLinkPath,
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    runtimeLinkMappingMode: 'synthetic-root',
    robotData: createSyntheticRootRobotData(robotName),
  };
}

export function resolveUsdRuntimeLinkPathForMesh({
  meshId,
  resolution,
  resolvedPrimPath,
}: {
  meshId: string;
  resolution?: ViewerRobotDataResolution | null;
  resolvedPrimPath?: string | null;
}): string | null {
  const knownLinkIdByPath = resolution?.linkIdByPath || null;
  const directLinkPath = normalizeUsdPath(getLinkPathFromMeshId(meshId));
  if (directLinkPath && (!knownLinkIdByPath || knownLinkIdByPath[directLinkPath])) {
    return directLinkPath;
  }

  const candidates = [
    normalizeUsdPath(resolvedPrimPath),
    directLinkPath,
    normalizeUsdPath(meshId),
  ].filter(Boolean);

  if (knownLinkIdByPath) {
    for (const candidate of candidates) {
      for (const ancestorPath of toAncestorPaths(candidate)) {
        if (knownLinkIdByPath[ancestorPath]) {
          return ancestorPath;
        }
      }
    }

    return getRootLinkPathFromResolution(resolution);
  }

  return candidates.map((candidate) => stripRuntimeMeshLeaf(candidate)).find(Boolean) || null;
}
