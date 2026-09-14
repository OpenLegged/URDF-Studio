import * as THREE from 'three';
import { getCollisionGeometryEntries } from '@/core/robot';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { collectSelectableHelperTargets } from '../../utils/pickTargets.ts';
import { reconcileUsdCollisionMeshAssignments } from '../../utils/usdCollisionMeshAssignments.ts';
import { resolveUsdRuntimeLinkPathForMesh } from '../../utils/usdRuntimeMeshMapping.ts';
import {
  resolveUsdVisualMeshObjectOrder,
  type UsdRuntimeMeshObjectOrderRenderInterface,
} from '../../utils/usdRuntimeMeshObjectOrder.ts';
import { prepareUsdVisualMesh } from '../../utils/usdVisualRendering.ts';
import type {
  UsdOffscreenMeshRole as UsdMeshRole,
  UsdOffscreenRuntimeMeshMeta as RuntimeMeshMeta,
  UsdOffscreenRuntimeMeshIndex,
} from '../../utils/usdOffscreenInteractionState.ts';

interface UsdWorkerMeshRenderInterface extends UsdRuntimeMeshObjectOrderRenderInterface {
  meshes?: Record<string, { _mesh?: THREE.Mesh } | null | undefined>;
  getResolvedPrimPathForMeshId?: (meshId: string) => string | null | undefined;
  getResolvedVisualTransformPrimPathForMeshId?: (meshId: string) => string | null | undefined;
  getUrdfCollisionEntryForMeshId?: (meshId: string) => unknown;
  getUrdfTruthForCurrentStage?: () => {
    collisionsByLinkName?: {
      get?: (linkName: string) => { all?: unknown[] } | null | undefined;
    };
  } | null;
}

const USD_COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;

function getPathBasename(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '');
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function resolveUsdCollisionMeshAuthoredOrder({
  renderInterface,
  linkPath,
  meshId,
  fallbackOrder,
}: {
  renderInterface: UsdWorkerMeshRenderInterface | null | undefined;
  linkPath: string;
  meshId: string;
  fallbackOrder: number;
}): number {
  const truth = renderInterface?.getUrdfTruthForCurrentStage?.();
  const runtimeEntry = renderInterface?.getUrdfCollisionEntryForMeshId?.(meshId);
  const linkName = getPathBasename(linkPath);
  const authoredEntries = linkName ? truth?.collisionsByLinkName?.get?.(linkName)?.all : null;

  if (runtimeEntry && Array.isArray(authoredEntries)) {
    const authoredIndex = authoredEntries.indexOf(runtimeEntry);
    if (authoredIndex >= 0) {
      return authoredIndex;
    }
  }

  return fallbackOrder;
}

function isUsdCollisionMeshId(meshId: string, meshName = ''): boolean {
  return (
    USD_COLLISION_SEGMENT_PATTERN.test(String(meshId || '').toLowerCase()) ||
    USD_COLLISION_SEGMENT_PATTERN.test(String(meshName || '').toLowerCase())
  );
}

function getUsdMeshRole(meshId: string, meshName = ''): UsdMeshRole {
  if (isUsdCollisionMeshId(meshId, meshName)) {
    return 'collision';
  }

  return 'visual';
}

/** Builds an index without changing the meshes or committing interaction state. */
export function buildUsdWorkerMeshIndex({
  renderInterface,
  resolution,
  root,
}: {
  renderInterface: UsdWorkerMeshRenderInterface | null | undefined;
  resolution: ViewerRobotDataResolution | null;
  root: THREE.Object3D | null;
}): UsdOffscreenRuntimeMeshIndex {
  const currentRobotLinks = resolution?.robotData.links || {};
  const nextMeshMetaByObject = new Map<THREE.Object3D, RuntimeMeshMeta>();
  const nextMeshesByLinkKey = new Map<string, THREE.Mesh[]>();
  const nextPickMeshes: THREE.Mesh[] = [];
  const nextHelperTargets = collectSelectableHelperTargets(root);
  const nextCollisionMeshGroups = new Map<
    string,
    Array<{ mesh: THREE.Mesh; meta: RuntimeMeshMeta }>
  >();
  const collisionMeshFallbackOrderByLinkPath = new Map<string, number>();
  const visualMeshFallbackOrderByLinkPath = new Map<string, number>();

  for (const [meshId, hydraMesh] of Object.entries(renderInterface?.meshes || {})) {
    const meshRecord = hydraMesh ?? null;
    const mesh = meshRecord?._mesh;
    if (!mesh) {
      continue;
    }

    const resolvedPrimPath =
      renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(meshId) ||
      renderInterface?.getResolvedPrimPathForMeshId?.(meshId) ||
      null;
    const linkPath = resolveUsdRuntimeLinkPathForMesh({
      meshId,
      resolution: resolution,
      resolvedPrimPath,
    });
    if (!linkPath) {
      continue;
    }

    const role = getUsdMeshRole(meshId, mesh.name || '');
    const collisionFallbackOrder = collisionMeshFallbackOrderByLinkPath.get(linkPath) ?? 0;
    if (role === 'collision') {
      collisionMeshFallbackOrderByLinkPath.set(linkPath, collisionFallbackOrder + 1);
    }
    const visualFallbackOrder = visualMeshFallbackOrderByLinkPath.get(linkPath) ?? 0;
    const authoredOrder =
      role === 'collision'
        ? resolveUsdCollisionMeshAuthoredOrder({
            renderInterface,
            linkPath,
            meshId,
            fallbackOrder: collisionFallbackOrder,
          })
        : resolveUsdVisualMeshObjectOrder({
            renderInterface,
            meshId,
            fallbackOrder: visualFallbackOrder,
          });
    if (role === 'visual') {
      visualMeshFallbackOrderByLinkPath.set(
        linkPath,
        Math.max(visualFallbackOrder, authoredOrder + 1),
      );
    }

    const meta: RuntimeMeshMeta = {
      linkPath,
      meshId,
      authoredOrder,
      objectIndex: role === 'collision' ? undefined : authoredOrder,
      role,
    };
    nextMeshMetaByObject.set(mesh, meta);
    nextPickMeshes.push(mesh);

    const key = `${linkPath}:${role}`;
    const meshes = nextMeshesByLinkKey.get(key) || [];
    meshes.push(mesh);
    nextMeshesByLinkKey.set(key, meshes);

    if (role === 'collision') {
      const collisionMeshes = nextCollisionMeshGroups.get(linkPath) || [];
      collisionMeshes.push({ mesh, meta });
      nextCollisionMeshGroups.set(linkPath, collisionMeshes);
    }
  }

  nextCollisionMeshGroups.forEach((collisionMeshes, linkPath) => {
    const linkId = resolution?.linkIdByPath[linkPath];
    const linkData = linkId ? currentRobotLinks[linkId] : undefined;
    const currentCount = linkData ? getCollisionGeometryEntries(linkData).length : 0;
    const reconciledAssignments = reconcileUsdCollisionMeshAssignments({
      meshes: collisionMeshes.map(({ meta }) => ({
        meshId: meta.meshId,
        authoredOrder: meta.authoredOrder ?? 0,
      })),
      currentCount,
    });

    collisionMeshes.forEach(({ meta }) => {
      const objectIndex = reconciledAssignments.get(meta.meshId);
      meta.objectIndex = objectIndex;
    });
  });

  return {
    meshMetaByObject: nextMeshMetaByObject,
    meshesByLinkKey: nextMeshesByLinkKey,
    pickMeshes: nextPickMeshes,
    helperTargets: nextHelperTargets,
  };
}

/** Applies the index's rendering metadata; the caller owns the referenced meshes. */
export function applyUsdWorkerMeshIndexMetadata(index: UsdOffscreenRuntimeMeshIndex): void {
  index.meshMetaByObject.forEach((meta, object) => {
    if (meta.role === 'visual' && (object as THREE.Mesh).isMesh) {
      prepareUsdVisualMesh(object as THREE.Mesh);
    }
    Object.assign(object.userData, {
      geometryRole: meta.role,
      isCollisionMesh: meta.role === 'collision',
      isVisualMesh: meta.role === 'visual',
      usdObjectIndex: meta.objectIndex,
      usdLinkPath: meta.linkPath,
      usdMeshId: meta.meshId,
    });
  });
}
