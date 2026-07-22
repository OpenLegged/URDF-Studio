import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { UrdfLink } from '@/types';
import { getCollisionGeometryByObjectIndex } from '@/core/robot';
import { createHighlightOverrideMaterial, disposeMaterial } from '../utils/materials';
import {
  useSemanticOutline,
  type SemanticOutlineIntent,
} from '@/shared/components/3d';
import { _pooledRay, _pooledBox3 } from '../constants';
import { collectPickTargets, type PickTargetMode } from '../utils/pickTargets';
import { resolveTopLayerInteractionSubType } from '../utils/interactionMode';
import {
  getSyntheticGeomParentName,
  resolveRuntimeGeometryRoot,
} from '../utils/runtimeGeometrySelection';

export interface UseHighlightManagerOptions {
  robot: THREE.Object3D | null;
  robotVersion: number;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  robotLinks?: Record<string, UrdfLink>;
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
}

export interface UseHighlightManagerResult {
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: SemanticOutlineIntent,
  ) => void;
  revertAllHighlights: () => void;
  getRobotBoundingBox: (forceRefresh?: boolean) => THREE.Box3 | null;
  rayIntersectsBoundingBox: (raycaster: THREE.Raycaster, forceRefresh?: boolean) => boolean;
  highlightedMeshesRef: React.RefObject<Map<THREE.Mesh, HighlightedMeshSnapshot>>;
  boundingBoxNeedsUpdateRef: React.RefObject<boolean>;
  getTriangleVertices: (
    geometry: THREE.BufferGeometry,
    faceIndex: number,
    outV0: THREE.Vector3,
    outV1: THREE.Vector3,
    outV2: THREE.Vector3,
  ) => void;
}

interface HighlightedMaterialState {
  transparent: boolean;
  opacity: number;
  depthTest: boolean;
  depthWrite: boolean;
  colorHex?: number;
  emissiveHex?: number;
  emissiveIntensity?: number;
}

export interface HighlightedMeshSnapshot {
  material: THREE.Material | THREE.Material[];
  renderOrder: number;
  materialStates: HighlightedMaterialState[];
  activeRole: 'visual' | 'collision' | null;
}

type HighlightGeometryArguments = [
  subType?: 'visual' | 'collision',
  meshToHighlight?: THREE.Object3D | null | number,
  intent?: SemanticOutlineIntent,
];

export function useHighlightManager({
  robot,
  robotVersion,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  robotLinks,
  linkMeshMapRef,
}: UseHighlightManagerOptions): UseHighlightManagerResult {
  const BOUNDING_BOX_CACHE_MS = 33;
  // PERFORMANCE: Cached robot bounding box for two-phase detection
  const robotBoundingBoxRef = useRef<THREE.Box3 | null>(null);
  const robotBoundingBoxUpdatedAtRef = useRef(0);
  const boundingBoxNeedsUpdateRef = useRef(true);

  // Map to track currently highlighted meshes for O(1) revert instead of traverse
  const highlightedMeshesRef = useRef<Map<THREE.Mesh, HighlightedMeshSnapshot>>(new Map());
  const semanticOutline = useSemanticOutline();
  const semanticOutlineOwnerRef = useRef(Symbol('urdf-semantic-outline'));

  // Refs for visibility state
  const showVisualRef = useRef(showVisual);
  const showCollisionRef = useRef(showCollision);
  const robotLinksRef = useRef(robotLinks);

  // PERFORMANCE: Pre-allocated vectors for triangle vertices (object pooling)

  // Keep refs in sync
  useEffect(() => {
    showVisualRef.current = showVisual;
  }, [showVisual]);
  useEffect(() => {
    showCollisionRef.current = showCollision;
  }, [showCollision]);
  useEffect(() => {
    robotLinksRef.current = robotLinks;
  }, [robotLinks]);

  // PERFORMANCE: Update robot bounding box when robot changes
  useEffect(() => {
    if (robot) {
      boundingBoxNeedsUpdateRef.current = true;
      robotBoundingBoxUpdatedAtRef.current = 0;
    }
  }, [robot, robotVersion]);

  // Visibility mode changes alter which meshes participate in setFromObject().
  // Mark bbox dirty so hover broad-phase remains accurate after toggles.
  useEffect(() => {
    if (robot) {
      boundingBoxNeedsUpdateRef.current = true;
      robotBoundingBoxUpdatedAtRef.current = 0;
    }
  }, [robot, showCollision, showVisual, showCollisionAlwaysOnTop, robotLinks]);

  const getCollisionGeometryByIndex = useCallback(
    (linkData: UrdfLink | undefined, colliderIndex: number) => {
      if (!linkData) return undefined;
      return getCollisionGeometryByObjectIndex(linkData, colliderIndex)?.geometry;
    },
    [],
  );

  const getColliderIndex = useCallback((collider: THREE.Object3D): number => {
    const linkObject =
      collider.parent && (collider.parent as any).isURDFLink ? collider.parent : null;
    if (!linkObject) return 0;

    const colliders = linkObject.children.filter((child: any) => child.isURDFCollider);
    const colliderIndex = colliders.indexOf(collider);
    return colliderIndex >= 0 ? colliderIndex : 0;
  }, []);

  const getMeshVisibility = useCallback(
    (mesh: THREE.Mesh) => {
      const linkName =
        typeof mesh.userData?.parentLinkName === 'string'
          ? mesh.userData.parentLinkName
          : undefined;
      const linkData = linkName ? robotLinksRef.current?.[linkName] : undefined;

      if (mesh.userData?.isCollisionMesh || (mesh.parent && (mesh.parent as any).isURDFCollider)) {
        const colliderRoot =
          mesh.parent && (mesh.parent as any).isURDFCollider ? mesh.parent : null;
        const colliderIndex = colliderRoot ? getColliderIndex(colliderRoot) : 0;
        const geometry = getCollisionGeometryByIndex(linkData, colliderIndex);
        return showCollisionRef.current && geometry?.visible !== false;
      }

      return (
        showVisualRef.current && linkData?.visible !== false && linkData?.visual.visible !== false
      );
    },
    [getColliderIndex, getCollisionGeometryByIndex],
  );

  const getActiveBoundingMode = useCallback((): PickTargetMode | null => {
    if (showVisualRef.current && showCollisionRef.current) return 'all';
    if (showCollisionRef.current) return 'collision';
    if (showVisualRef.current) return 'visual';
    return null;
  }, []);

  // Helper to get/update robot bounding box (cached)
  const getRobotBoundingBox = useCallback(
    (forceRefresh = false) => {
      if (!robot) return null;

      if (!robotBoundingBoxRef.current) {
        robotBoundingBoxRef.current = new THREE.Box3();
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const shouldRefresh =
        forceRefresh ||
        boundingBoxNeedsUpdateRef.current ||
        robotBoundingBoxUpdatedAtRef.current === 0 ||
        now - robotBoundingBoxUpdatedAtRef.current >= BOUNDING_BOX_CACHE_MS;

      if (shouldRefresh) {
        const targetMode = getActiveBoundingMode();
        const boundingBox = robotBoundingBoxRef.current;
        const pickTargets = targetMode
          ? collectPickTargets(linkMeshMapRef.current, targetMode, robot)
          : [];
        // Only include actual link geometry in the bounding box.
        // Helper objects (joint-axis arrows, origin axes, etc.) can extend far
        // beyond the robot mesh and must not inflate the broad-phase check.
        const boundingTargets = pickTargets;

        boundingBox.makeEmpty();

        if (boundingTargets.length > 0) {
          if (
            forceRefresh ||
            boundingBoxNeedsUpdateRef.current ||
            robotBoundingBoxUpdatedAtRef.current === 0
          ) {
            // Dirty-only walk: setJointValue / component transforms / bridges
            // all flag the chain they touch, so force=false still produces
            // current world matrices for any node that actually moved. Using
            // force=true here was an every-frame O(N×L) sweep — in a
            // multi-component assembly that dominated drag latency because
            // hover broad-phase runs from useFrame (i.e. once per render).
            robot.updateMatrixWorld(false);
          }

          for (let i = 0; i < boundingTargets.length; i += 1) {
            const target = boundingTargets[i] as THREE.Object3D & {
              geometry?: THREE.BufferGeometry;
            };
            const geometry = target.geometry;

            if (!geometry) continue;
            if (!geometry.boundingBox) {
              geometry.computeBoundingBox();
            }
            if (!geometry.boundingBox) continue;

            _pooledBox3.copy(geometry.boundingBox).applyMatrix4(target.matrixWorld);
            boundingBox.union(_pooledBox3);
          }

          if (!boundingBox.isEmpty()) {
            boundingBox.expandByScalar(0.05);
          }
        }

        boundingBoxNeedsUpdateRef.current = false;
        robotBoundingBoxUpdatedAtRef.current = now;
      }

      return robotBoundingBoxRef.current.isEmpty() ? null : robotBoundingBoxRef.current;
    },
    [robot, getActiveBoundingMode, linkMeshMapRef],
  );

  // PERFORMANCE: Two-phase detection - check bounding box first
  const rayIntersectsBoundingBox = useCallback(
    (raycaster: THREE.Raycaster, forceRefresh = false): boolean => {
      const bbox = getRobotBoundingBox(forceRefresh);
      if (!bbox) return false;
      // Use pooled ray to avoid allocation
      _pooledRay.copy(raycaster.ray);
      return _pooledRay.intersectsBox(bbox);
    },
    [getRobotBoundingBox],
  );

  // Helper function to get triangle vertices - writes to provided output vectors (no allocation)
  const getTriangleVertices = useCallback(
    (
      geometry: THREE.BufferGeometry,
      faceIndex: number,
      outV0: THREE.Vector3,
      outV1: THREE.Vector3,
      outV2: THREE.Vector3,
    ): void => {
      const positionAttribute = geometry.getAttribute('position');
      const indexAttribute = geometry.getIndex();

      let a: number, b: number, c: number;
      if (indexAttribute) {
        a = indexAttribute.getX(faceIndex * 3);
        b = indexAttribute.getX(faceIndex * 3 + 1);
        c = indexAttribute.getX(faceIndex * 3 + 2);
      } else {
        a = faceIndex * 3;
        b = faceIndex * 3 + 1;
        c = faceIndex * 3 + 2;
      }

      // Write directly to output vectors - no allocation
      outV0.set(positionAttribute.getX(a), positionAttribute.getY(a), positionAttribute.getZ(a));
      outV1.set(positionAttribute.getX(b), positionAttribute.getY(b), positionAttribute.getZ(b));
      outV2.set(positionAttribute.getX(c), positionAttribute.getY(c), positionAttribute.getZ(c));
    },
    [],
  );

  const captureHighlightedMeshSnapshot = useCallback(
    (mesh: THREE.Mesh): HighlightedMeshSnapshot => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      const snapshot = {
        material: mesh.material,
        renderOrder: mesh.renderOrder,
        materialStates: materials.map((material) => ({
          transparent: material?.transparent ?? false,
          opacity: material?.opacity ?? 1,
          depthTest: material?.depthTest ?? true,
          depthWrite: material?.depthWrite ?? true,
          colorHex: (material as any)?.color?.isColor
            ? (material as any).color.getHex()
            : undefined,
          emissiveHex: (material as any)?.emissive?.isColor
            ? (material as any).emissive.getHex()
            : undefined,
          emissiveIntensity: Number.isFinite((material as any)?.emissiveIntensity)
            ? Number((material as any).emissiveIntensity)
            : undefined,
        })),
        activeRole: null,
      };

      mesh.userData.__urdfHighlightSnapshot = snapshot;
      return snapshot;
    },
    [],
  );

  const disposeHighlightOverrideMaterials = useCallback(
    (material: THREE.Material | THREE.Material[]) => {
      const materials = Array.isArray(material) ? material : [material];
      materials.forEach((entry) => {
        if (!entry) return;
        if ((entry as any).userData?.isHighlightOverrideMaterial !== true) return;
        disposeMaterial(entry, false);
      });
    },
    [],
  );

  const restoreHighlightedMeshSnapshot = useCallback(
    (mesh: THREE.Mesh, snapshot: HighlightedMeshSnapshot, shouldBeVisible: boolean) => {
      const currentMaterial = mesh.material;
      if (currentMaterial !== snapshot.material) {
        disposeHighlightOverrideMaterials(currentMaterial as THREE.Material | THREE.Material[]);
      }

      mesh.material = snapshot.material;
      mesh.renderOrder = snapshot.renderOrder;
      mesh.visible = shouldBeVisible;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material, index) => {
        const materialState = snapshot.materialStates[index];
        if (!material || !materialState) return;

        material.transparent = materialState.transparent;
        material.opacity = materialState.opacity;
        material.depthTest = materialState.depthTest;
        material.depthWrite = materialState.depthWrite;
        if (materialState.colorHex !== undefined && (material as any).color?.isColor) {
          (material as any).color.setHex(materialState.colorHex);
        }
        if (materialState.emissiveHex !== undefined && (material as any).emissive?.isColor) {
          (material as any).emissive.setHex(materialState.emissiveHex);
        }
        if (
          materialState.emissiveIntensity !== undefined &&
          'emissiveIntensity' in (material as any)
        ) {
          (material as any).emissiveIntensity = materialState.emissiveIntensity;
        }
        material.needsUpdate = true;
      });
      snapshot.activeRole = null;
      delete mesh.userData.__urdfHighlightSnapshot;
    },
    [disposeHighlightOverrideMaterials],
  );

  const syncSemanticOutline = useCallback(
    (intent: SemanticOutlineIntent = 'hover') => {
      semanticOutline?.setTargets(
        semanticOutlineOwnerRef.current,
        [...highlightedMeshesRef.current.keys()],
        intent,
      );
    },
    [semanticOutline],
  );

  const applyHighlightToMesh = useCallback(
    (
      mesh: THREE.Mesh,
      targetSubType: 'visual' | 'collision',
      intent: SemanticOutlineIntent,
    ) => {
      let snapshot = highlightedMeshesRef.current.get(mesh);
      if (!snapshot) {
        snapshot = captureHighlightedMeshSnapshot(mesh);
        highlightedMeshesRef.current.set(mesh, snapshot);
      } else if (snapshot.activeRole === targetSubType) {
        mesh.visible = true;
        if (mesh.parent) mesh.parent.visible = true;
        if (targetSubType === 'collision') {
          mesh.renderOrder = 1000;
        }
        syncSemanticOutline(intent);
        return;
      } else {
        restoreHighlightedMeshSnapshot(mesh, snapshot, true);
        mesh.userData.__urdfHighlightSnapshot = snapshot;
      }

      // Link hover/selection is a screen-space outline. Keep the original PBR
      // material attached so authored color, textures, and highlights do not shift.
      // Tendons retain their legacy high-contrast overlay because thin line-like
      // geometry is not reliably visible through a silhouette pass alone.
      if (mesh.userData?.isMjcfTendon === true) {
        const sourceMaterials = Array.isArray(snapshot.material)
          ? snapshot.material
          : [snapshot.material];
        const overrideMaterials = sourceMaterials.map((sourceMaterial) =>
          createHighlightOverrideMaterial(sourceMaterial, targetSubType),
        );
        mesh.material = Array.isArray(snapshot.material)
          ? overrideMaterials
          : overrideMaterials[0];
      }
      mesh.visible = true;
      if (mesh.parent) mesh.parent.visible = true;
      if (targetSubType === 'collision' || mesh.userData?.isMjcfTendon === true) {
        mesh.renderOrder = 1000;
      }
      snapshot.activeRole = targetSubType;
      syncSemanticOutline(intent);
    },
    [captureHighlightedMeshSnapshot, restoreHighlightedMeshSnapshot, syncSemanticOutline],
  );

  // Revert all highlighted meshes using the tracked Map (O(n) where n = highlighted, not total)
  const revertAllHighlights = useCallback(() => {
    highlightedMeshesRef.current.forEach((snapshot, mesh) => {
      const isCollider = (mesh as any).isURDFCollider || mesh.userData.isCollisionMesh;
      const shouldBeVisible = getMeshVisibility(mesh);
      restoreHighlightedMeshSnapshot(mesh, snapshot, shouldBeVisible);

      if (isCollider) {
        if (mesh.parent && (mesh.parent as any).isURDFCollider)
          mesh.parent.visible = shouldBeVisible;
      }
    });
    highlightedMeshesRef.current.clear();
    semanticOutline?.clearTargets(semanticOutlineOwnerRef.current);
  }, [getMeshVisibility, restoreHighlightedMeshSnapshot, semanticOutline]);

  useEffect(() => {
    revertAllHighlights();
  }, [revertAllHighlights, robot, robotVersion]);

  useEffect(
    () => () => semanticOutline?.clearTargets(semanticOutlineOwnerRef.current),
    [semanticOutline],
  );

  // PERFORMANCE: Helper function to highlight/unhighlight link geometry
  // Uses pre-built linkMeshMap for O(1) lookup instead of traverse
  const highlightGeometry = useCallback(
    (
      linkName: string | null,
      revert: boolean,
      ...[
        subType,
        meshToHighlight,
        intent = 'hover',
      ]: HighlightGeometryArguments
    ) => {
      if (!robot) return;

      try {
        const targetSubType =
          subType ||
          resolveTopLayerInteractionSubType({
            showVisual,
            showCollision,
            collisionAlwaysOnTop: showCollisionAlwaysOnTop,
          });
        if (!targetSubType) {
          return;
        }

        // CRITICAL: Check if the corresponding display option is enabled
        // In link mode, only highlight if showVisual is true
        // In collision mode, only highlight if showCollision is true
        if (!revert) {
          if (targetSubType === 'visual' && !showVisual) {
            // Link mode but visual display is off - don't highlight
            return;
          }
          if (targetSubType === 'collision' && !showCollision) {
            // Collision mode but collision display is off - don't highlight
            return;
          }
          if (linkName) {
            const linkData = robotLinksRef.current?.[linkName];
            if (
              targetSubType === 'visual' &&
              (linkData?.visible === false || linkData?.visual.visible === false)
            ) {
              return;
            }
            if (targetSubType === 'collision') {
              const collisionIndex = typeof meshToHighlight === 'number' ? meshToHighlight : 0;
              const geometry = getCollisionGeometryByIndex(linkData, collisionIndex);
              if (geometry?.visible === false) {
                return;
              }
            }
          }
        }

        // OPTIMIZED: Use Map-based revert instead of traversing
        if (revert) {
          revertAllHighlights();
          return;
        }

        // PERFORMANCE: If highlighting a specific object subtree, use direct access.
        if (meshToHighlight && typeof meshToHighlight !== 'number') {
          let highlightedAnyMesh = false;

          (meshToHighlight as THREE.Object3D).traverse((child: any) => {
            if (!child.isMesh || child.userData?.isGizmo) return;
            if (!getMeshVisibility(child)) return;

            highlightedAnyMesh = true;
            applyHighlightToMesh(child, targetSubType, intent);
          });

          if (highlightedAnyMesh) {
            return;
          }
        }

        // PERFORMANCE: Use pre-built linkMeshMap for O(1) lookup
        if (linkName) {
          if (typeof meshToHighlight === 'number') {
            const runtimeLinkCandidates = [linkName, getSyntheticGeomParentName(linkName)].filter(
              (candidate): candidate is string => Boolean(candidate),
            );
            const linkObj = runtimeLinkCandidates
              .map((candidate) => (robot as any).links?.[candidate] as THREE.Object3D | undefined)
              .find((candidate): candidate is THREE.Object3D => Boolean(candidate));
            if (linkObj) {
              const targetGroup = resolveRuntimeGeometryRoot(
                linkObj,
                linkName,
                targetSubType,
                meshToHighlight,
              );
              if (targetGroup) {
                targetGroup.traverse((c: any) => {
                  if (c.isMesh && !c.userData?.isGizmo) {
                    if (!getMeshVisibility(c)) return;
                    applyHighlightToMesh(c, targetSubType, intent);
                  }
                });
                return;
              }
            }
          }

          const mapKey = `${linkName}:${targetSubType}`;
          const meshes = linkMeshMapRef.current.get(mapKey);

          if (meshes && meshes.length > 0) {
            for (let i = 0; i < meshes.length; i++) {
              const mesh = meshes[i];
              if (mesh.userData?.isGizmo) continue;
              if (!getMeshVisibility(mesh)) continue;

              applyHighlightToMesh(mesh, targetSubType, intent);
            }
            return;
          }

          // Fallback to traverse if map lookup fails (shouldn't happen normally)
          const linkObj = (robot as any).links?.[linkName];
          if (linkObj) {
            const fallbackTraverse = (c: any) => {
              if (c.isURDFJoint || c.userData?.isGizmo) return;
              if (c.isMesh) {
                const isCollider = c.isURDFCollider || c.userData.isCollisionMesh;
                const shouldHighlight =
                  (targetSubType === 'collision' && isCollider) ||
                  (targetSubType === 'visual' && !isCollider);
                if (shouldHighlight && getMeshVisibility(c)) {
                  applyHighlightToMesh(c, targetSubType, intent);
                }
              }
              c.children?.forEach(fallbackTraverse);
            };
            fallbackTraverse(linkObj);
          }
        }
      } catch (err) {
        console.error('Error in highlightGeometry:', err);
      }
    },
    [
      robot,
      showCollision,
      showVisual,
      showCollisionAlwaysOnTop,
      revertAllHighlights,
      linkMeshMapRef,
      getCollisionGeometryByIndex,
      getMeshVisibility,
      applyHighlightToMesh,
    ],
  );

  return {
    highlightGeometry,
    revertAllHighlights,
    getRobotBoundingBox,
    rayIntersectsBoundingBox,
    highlightedMeshesRef,
    boundingBoxNeedsUpdateRef,
    getTriangleVertices,
  };
}
