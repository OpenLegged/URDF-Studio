import { useCallback, type RefObject } from 'react';
import {
  applyMeshMaterialPaintEdit,
  getVisualGeometryByObjectIndex,
  hasGeometryMeshMaterialGroups,
  resolveVisualMaterialOverride,
  updateVisualGeometryByObjectIndex,
} from '@/core/robot';
import {
  captureRuntimeVisualMaterialDescriptor,
  getBufferGeometryTriangleCount,
  hasDistinctRuntimeBaseMaterialsWithinVisual,
  resolveMeshFaceSelection,
  resolveRuntimeMeshMaterialGroupKey,
  resolveRuntimeMeshRootWithinVisual,
} from '@/core/utils/meshMaterialGroups';
import type { RobotData, UrdfLink } from '@/types';
import { GeometryType } from '@/types';
import type {
  RobotModelProps,
  ViewerPaintFaceHit,
  ViewerPaintInteractionState,
  ViewerPaintOperation,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
} from '../types';

const PAINTABLE_VISUAL_GEOMETRY_TYPES = new Set<GeometryType>([
  GeometryType.MESH,
  GeometryType.BOX,
  GeometryType.PLANE,
  GeometryType.SPHERE,
  GeometryType.ELLIPSOID,
  GeometryType.CYLINDER,
  GeometryType.CAPSULE,
]);

interface UseRobotModelPaintInteractionOptions {
  isMeshPreview: boolean;
  robotMaterials: RobotData['materials'] | undefined;
  robotLinks: Record<string, UrdfLink> | undefined;
  paintColor: string;
  paintSelectionScope: ViewerPaintSelectionScope;
  paintOperation: ViewerPaintOperation;
  paintInteractionRef: RefObject<ViewerPaintInteractionState> | undefined;
  onPaintStatusChange: ((status: ViewerPaintStatus | null) => void) | undefined;
  onUpdate: RobotModelProps['onUpdate'];
  t: RobotModelProps['t'];
}

/** Owns validation and model mutation for one face-paint interaction. */
export function useRobotModelPaintInteraction({
  isMeshPreview,
  robotMaterials,
  robotLinks,
  paintColor,
  paintSelectionScope,
  paintOperation,
  paintInteractionRef,
  onPaintStatusChange,
  onUpdate,
  t,
}: UseRobotModelPaintInteractionOptions) {
  return useCallback(
    async ({ linkId, objectIndex, mesh, faceIndex }: ViewerPaintFaceHit) => {
      const activePaintColor = paintInteractionRef?.current.color ?? paintColor;
      const activePaintOperation = paintInteractionRef?.current.operation ?? paintOperation;
      const activePaintSelectionScope =
        paintInteractionRef?.current.selectionScope ?? paintSelectionScope;
      if (isMeshPreview) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintUnsupportedRobotOnly,
        });
        return;
      }

      if (!Number.isInteger(faceIndex) || faceIndex < 0) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintErrorFaceUnavailable,
        });
        return;
      }

      const link = robotLinks?.[linkId];
      const visualGeometry = link
        ? getVisualGeometryByObjectIndex(link, objectIndex)?.geometry
        : null;
      if (!link || !visualGeometry || !PAINTABLE_VISUAL_GEOMETRY_TYPES.has(visualGeometry.type)) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintErrorVisualMeshOnly,
        });
        return;
      }

      const resolvedMaterial = resolveVisualMaterialOverride(
        { materials: robotMaterials ?? {} },
        link,
        visualGeometry,
        { isPrimaryVisual: objectIndex === 0 },
      );
      const hasCustomMeshGroups = hasGeometryMeshMaterialGroups(visualGeometry);
      const builtInMultiMaterialTarget =
        !hasCustomMeshGroups &&
        (Array.isArray(mesh.material) || (visualGeometry.authoredMaterials?.length || 0) > 1);
      if (builtInMultiMaterialTarget || hasDistinctRuntimeBaseMaterialsWithinVisual(mesh)) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintErrorMultiMaterial,
        });
        return;
      }

      const triangleCount = getBufferGeometryTriangleCount(mesh.geometry);
      if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= triangleCount) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintErrorFaceUnavailable,
        });
        return;
      }

      const selectedFaceIndices = resolveMeshFaceSelection(
        mesh.geometry,
        faceIndex,
        activePaintSelectionScope,
      );
      if (selectedFaceIndices.length === 0) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintErrorSelectionUnavailable,
        });
        return;
      }

      const meshRoot = resolveRuntimeMeshRootWithinVisual(mesh);
      const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, meshRoot);
      const baseMaterial = captureRuntimeVisualMaterialDescriptor(
        mesh,
        visualGeometry.authoredMaterials?.[0],
        {
          name: `paint_base_${objectIndex}`,
          color: resolvedMaterial.color,
          colorRgba: resolvedMaterial.colorRgba,
          texture: resolvedMaterial.texture,
          textureRotation: resolvedMaterial.textureRotation,
          opacity: resolvedMaterial.opacity,
          roughness: resolvedMaterial.roughness,
          metalness: resolvedMaterial.metalness,
          emissive: resolvedMaterial.emissive,
          emissiveIntensity: resolvedMaterial.emissiveIntensity,
          alphaTest: resolvedMaterial.alphaTest,
          passes: resolvedMaterial.passes,
        },
      );
      const paintEdit = applyMeshMaterialPaintEdit({
        geometry: visualGeometry,
        meshKey,
        triangleCount,
        selectedFaceIndices,
        paintColor: activePaintColor,
        erase: activePaintOperation === 'erase',
        baseMaterial,
        materialNamePrefix: `paint_${linkId}_${objectIndex}`,
      });
      const { changed, ...geometryPatch } = paintEdit;
      if (!onUpdate) {
        onPaintStatusChange?.({
          tone: 'error',
          message: t.paintUnsupportedRobotOnly,
        });
        return;
      }
      if (!changed) {
        if (activePaintOperation === 'erase') {
          onPaintStatusChange?.({
            tone: 'info',
            message: t.paintStatusNothingToRestore,
          });
        }
        return;
      }

      const nextLink = updateVisualGeometryByObjectIndex(link, objectIndex, {
        ...geometryPatch,
        color: undefined,
      });
      onUpdate('link', link.id, nextLink);
      onPaintStatusChange?.({
        tone: 'success',
        message: activePaintOperation === 'erase' ? t.paintStatusRemoved : t.paintStatusApplied,
      });
    },
    [
      isMeshPreview,
      onPaintStatusChange,
      onUpdate,
      paintColor,
      paintInteractionRef,
      paintOperation,
      paintSelectionScope,
      robotLinks,
      robotMaterials,
      t,
    ],
  );
}
