import type { RefObject } from 'react';
import * as THREE from 'three';
import {
  createRobotCapsuleGeometry,
  createRobotCylinderGeometry,
  createRobotSphereGeometry,
  type RobotPrimitiveGeometryDetail,
  URDFCollider,
  URDFVisual,
} from '@/core/parsers/urdf/loader';
import {
  createLoadingManager,
  createMeshLoader,
  type ColladaRootNormalizationHints,
} from '@/core/loaders';
import {
  getBoxFaceMaterialPalette,
  getCollisionGeometryEntries,
  hasGeometryMeshMaterialGroups,
  getVisualGeometryEntries,
} from '@/core/robot';
import { createBoxFaceMaterialArray } from '@/core/utils/boxFaceMaterialArray';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { forceObjectMaterialSide } from '@/core/utils/three/materialSide';
import {
  applyVisualMaterialOverrideToObject,
  resolveVisualMaterialOverrideFromGeometry,
} from '@/core/utils/visualMaterialOverrides';
import { GeometryType } from '@/types';
import type { UrdfLink, UrdfVisual as LinkGeometry } from '@/types';
import {
  collisionBaseMaterial,
  createHighlightOverrideMaterial,
  createMatteMaterial,
  enhanceMaterials,
} from './materials';
import { disposeObject3D } from './dispose';
import { SHARED_MATERIALS } from '../constants';
import {
  DEFAULT_VEC3,
  type GeometryPatchCandidate,
  sameGeometry,
  sameOrigin,
  sameVec3,
  sameVisibleFlag,
} from './robotLoaderDiff';
import {
  applyOriginToGroup,
  captureHighlightedMaterialState,
  clearGroupChildren,
  disposeReplacedMaterials,
  findRobotLinkObject,
  getHighlightedMeshSnapshot,
  markCollisionObject,
  markVisualObject,
  rebuildLinkMeshMapForLink,
  updateVisualMaterialPalette,
  updateVisualMaterial,
} from './robotLoaderPatchUtils';
import {
  applyURDFMaterials,
  applyURDFMaterialTextures,
  collectURDFMaterialsFromVisualGeometry,
} from './urdfMaterials';
import { getSyntheticGeomParentName, resolveRuntimeGeometryRoot } from './runtimeGeometrySelection';
import {
  toPrimaryAuthoredMaterialGeometry,
  PATCHABLE_VISUAL_MATERIAL_GROUP_GEOMETRY_TYPES,
  PatchCategoryOptions,
  applyMeshScaleToGroup,
  hasMirroredMeshScale,
  patchGeometryCategory,
  getDirectCollisionGroups,
  getDirectVisualGroups,
  patchVisualEntriesInPlace,
  patchCollisionEntriesInPlace,
  sameGeometryStructure,
  getAuthoredMaterialSignature,
  getAuthoredMaterialSlotSignature,
  getMeshMaterialGroupSignature,
  canPatchGeometryInPlace,
  findFirstMeshInObject,
  patchPrimitiveDimensionsInPlace,
  patchGeometryGroupInPlace,
  ApplyGeometryPatchOptions,
  ApplyGeometryPatchesOptions,
  ResolvedPatchTarget,
  updateRuntimeLinkDisplayName,
  getSyntheticGeomOrdinal,
  resolveSyntheticAttachmentTargetGroup,
  resolvePatchTarget,
  getPatchRuntimeLinkName,
  getPatchRuntimeNames,
} from './robotLoaderGeometryPatchHelpers';

/**
 * Narrow a geometry to just its first authored material so the single-override resolver
 * accepts it. That resolver bails out on multi-material palettes by design; this is the
 * explicit opt-in for the case where the palette turned out not to be applicable.
 */
export function applyGeometryPatchInPlace({
  robotModel,
  patch,
  assets,
  sourceFileDir,
  colladaRootNormalizationHints,
  showVisual,
  showCollision,
  linkMeshMapRef,
  invalidate,
  isPatchTargetValid,
  primitiveGeometryDetail,
}: ApplyGeometryPatchOptions): boolean {
  const { linkRuntimeName, linkDisplayName } = getPatchRuntimeNames(patch);
  const resolvedPatchTarget = resolvePatchTarget(robotModel, linkRuntimeName);
  if (!resolvedPatchTarget) return false;

  const { linkObject, visualTargetGroup, collisionTargetGroup, usesSyntheticAttachmentMapping } =
    resolvedPatchTarget;
  const metadataChanged = patch.linkNameChanged
    ? updateRuntimeLinkDisplayName(linkObject, linkDisplayName)
    : false;

  if (
    !patch.visualChanged &&
    !patch.visualBodiesChanged &&
    !patch.collisionChanged &&
    !patch.collisionBodiesChanged
  ) {
    if (metadataChanged) {
      invalidate();
    }
    return true;
  }

  if (patch.visualChanged || patch.visualBodiesChanged) {
    let visualPatched = false;

    if (!usesSyntheticAttachmentMapping) {
      visualPatched = patchVisualEntriesInPlace({
        robotModel,
        linkObject,
        linkName: linkRuntimeName,
        previousLinkData: patch.previousLinkData,
        nextLinkData: patch.linkData,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
        primitiveGeometryDetail,
      });
    }

    if (!visualPatched && usesSyntheticAttachmentMapping && visualTargetGroup) {
      visualPatched = patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'visual',
        linkData: patch.linkData,
        previousGeometry: patch.previousLinkData.visual,
        geometry: patch.linkData.visual,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: visualTargetGroup,
        primitiveGeometryDetail,
      });

      if (!visualPatched) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'visual',
          geometry: patch.linkData.visual,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          targetGroup: visualTargetGroup,
          primitiveGeometryDetail,
        });
        visualPatched = true;
      }
    }

    if (!visualPatched && !usesSyntheticAttachmentMapping) {
      if (
        !patchGeometryGroupInPlace({
          robotModel,
          linkObject,
          category: 'visual',
          linkData: patch.linkData,
          previousGeometry: patch.previousLinkData.visual,
          geometry: patch.linkData.visual,
          showVisual,
          showCollision,
          invalidate,
          primitiveGeometryDetail,
        })
      ) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'visual',
          geometry: patch.linkData.visual,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          primitiveGeometryDetail,
        });
      }
    }
  }

  if (patch.collisionChanged || patch.collisionBodiesChanged) {
    let collisionPatched = false;

    if (!usesSyntheticAttachmentMapping) {
      collisionPatched = patchCollisionEntriesInPlace({
        robotModel,
        linkObject,
        linkName: linkRuntimeName,
        previousLinkData: patch.previousLinkData,
        nextLinkData: patch.linkData,
        assets,
        sourceFileDir,
        colladaRootNormalizationHints,
        showVisual,
        showCollision,
        linkMeshMapRef,
        invalidate,
        isPatchTargetValid,
        primitiveGeometryDetail,
      });
    }

    if (!collisionPatched && usesSyntheticAttachmentMapping && collisionTargetGroup) {
      collisionPatched = patchGeometryGroupInPlace({
        robotModel,
        linkObject,
        category: 'collision',
        linkData: patch.linkData,
        previousGeometry: patch.previousLinkData.collision,
        geometry: patch.linkData.collision,
        showVisual,
        showCollision,
        invalidate,
        targetGroup: collisionTargetGroup,
        primitiveGeometryDetail,
      });

      if (!collisionPatched) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'collision',
          geometry: patch.linkData.collision,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          targetGroup: collisionTargetGroup,
          primitiveGeometryDetail,
        });
        collisionPatched = true;
      }
    }

    if (!collisionPatched && !usesSyntheticAttachmentMapping) {
      if (
        !patchGeometryGroupInPlace({
          robotModel,
          linkObject,
          category: 'collision',
          linkData: patch.linkData,
          previousGeometry: patch.previousLinkData.collision,
          geometry: patch.linkData.collision,
          showVisual,
          showCollision,
          invalidate,
          primitiveGeometryDetail,
        })
      ) {
        patchGeometryCategory({
          robotModel,
          linkObject,
          linkName: linkRuntimeName,
          category: 'collision',
          geometry: patch.linkData.collision,
          assets,
          sourceFileDir,
          colladaRootNormalizationHints,
          showVisual,
          showCollision,
          linkMeshMapRef,
          invalidate,
          isPatchTargetValid,
          primitiveGeometryDetail,
        });
      }
    }
  }

  return true;
}

export function applyGeometryPatchesInPlace({
  robotModel,
  patches,
  ...options
}: ApplyGeometryPatchesOptions): boolean {
  const allPatchTargetsExist = patches.every((patch) =>
    Boolean(resolvePatchTarget(robotModel, getPatchRuntimeLinkName(patch))),
  );
  if (!allPatchTargetsExist) {
    return false;
  }

  for (const patch of patches) {
    if (!applyGeometryPatchInPlace({ ...options, robotModel, patch })) {
      return false;
    }
  }

  return true;
}
