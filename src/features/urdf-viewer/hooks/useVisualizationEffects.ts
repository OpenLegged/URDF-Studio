import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isProtectedMaterial } from '@/core/utils/three/materialProtection';

import { syncRobotGeometryVisibility } from '../utils/robotGeometryVisibilitySync';
import { getRobotSceneNodeIndex } from '../utils/robotSceneNodeIndex';
import { getRobotVisualMeshIndex } from '../utils/robotVisualMeshIndex';
import { rebuildLinkMeshMapFromRobot } from '../utils/robotLoaderPatchUtils';
import {
  syncInertiaVisualizationForLinks,
  syncIkHandleVisualizationForLinks,
  syncJointHelperInteractionStateForJoints,
  syncJointAxesVisualizationForJoints,
  syncLinkHelperInteractionStateForLinks,
  syncLinkVisualColors,
  syncMjcfSiteVisualizationForLinks,
  syncMjcfTendonVisualizationForRobot,
  syncOriginAxesVisualizationForLinks,
} from '../utils/visualizationObjectSync';
import { syncMjcfTendonVisualMeshMap } from '../utils/mjcfTendonVisualMeshMap';
import {
  isModelOpacitySyncActive,
  shouldRunVisualizationSync,
} from '../utils/visualizationSyncActivity';
import type { RobotData, UrdfJoint, UrdfLink } from '@/types';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import type { ViewerProps } from '../types';
import type { HighlightedMeshSnapshot } from './useHighlightManager';
import type { ViewerRobotSourceFormat } from '../types';

export interface UseVisualizationEffectsOptions {
  robot: THREE.Object3D | null;
  robotVersion: number;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  showInertia: boolean;
  showIkHandles: boolean;
  showIkHandlesAlwaysOnTop?: boolean;
  ikDragActive?: boolean;
  showInertiaOverlay?: boolean;
  showCenterOfMass: boolean;
  showCoMOverlay?: boolean;
  centerOfMassSize: number;
  showOrigins: boolean;
  showOriginsOverlay?: boolean;
  originSize: number;
  showMjcfSites: boolean;
  showJointAxes: boolean;
  showJointAxesOverlay?: boolean;
  jointAxisSize: number;
  modelOpacity: number;
  sourceFormat: ViewerRobotSourceFormat;
  showMjcfWorldLink: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotMaterials?: RobotData['materials'];
  robotJoints?: Record<string, UrdfJoint>;
  selection?: ViewerProps['selection'];
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => void;
  highlightedMeshesRef: React.RefObject<Map<THREE.Mesh, HighlightedMeshSnapshot>>;
  linkMeshMapRef?: RefObject<Map<string, THREE.Mesh[]>>;
}

export interface UseVisualizationEffectsResult {
  syncHoverHighlight: (hoveredSelection?: ViewerProps['selection']) => void;
}

interface VisualMaterialState {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

type StoredHighlightTarget = {
  id: string | null;
  subType: string | null;
  objectIndex?: number;
  highlightObjectId?: number;
};

type ResolvedHighlightTarget = {
  id: string | null;
  subType: 'visual' | 'collision' | undefined;
  objectIndex?: number;
  highlightObjectId?: number;
};

export function areHighlightTargetsEquivalent(
  currentTarget: StoredHighlightTarget,
  nextTarget: ResolvedHighlightTarget,
): boolean {
  if (currentTarget.id !== nextTarget.id) {
    return false;
  }

  if ((currentTarget.subType ?? null) !== (nextTarget.subType ?? null)) {
    return false;
  }

  if (currentTarget.objectIndex !== nextTarget.objectIndex) {
    return false;
  }

  if (
    (currentTarget.highlightObjectId ?? undefined) === (nextTarget.highlightObjectId ?? undefined)
  ) {
    return true;
  }

  return (
    currentTarget.highlightObjectId !== undefined &&
    nextTarget.highlightObjectId === undefined &&
    currentTarget.objectIndex !== undefined
  );
}

export function useVisualizationEffects({
  robot,
  robotVersion,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  showInertia,
  showIkHandles,
  showIkHandlesAlwaysOnTop = true,
  ikDragActive = false,
  showInertiaOverlay = true,
  showCenterOfMass,
  showCoMOverlay = true,
  centerOfMassSize,
  showOrigins,
  showOriginsOverlay = false,
  originSize,
  showMjcfSites,
  showJointAxes,
  showJointAxesOverlay = true,
  jointAxisSize,
  modelOpacity,
  sourceFormat,
  showMjcfWorldLink,
  robotLinks,
  robotMaterials,
  robotJoints,
  selection,
  highlightGeometry,
  highlightedMeshesRef,
  linkMeshMapRef,
}: UseVisualizationEffectsOptions): UseVisualizationEffectsResult {
  const { invalidate } = useThree();
  const snapshotRenderActive = useSnapshotRenderActive();

  // Track current selection/hover for cleanup
  const currentSelectionRef = useRef<{
    id: string | null;
    subType: string | null;
    objectIndex?: number;
    highlightObjectId?: number;
  }>({ id: null, subType: null });
  const currentHoverRef = useRef<{
    id: string | null;
    subType: string | null;
    objectIndex?: number;
    highlightObjectId?: number;
  }>({ id: null, subType: null });
  const latestHoverSelectionRef = useRef<ViewerProps['selection']>(undefined);
  const selectionRef = useRef(selection);
  const visualMaterialStateRef = useRef<Map<THREE.Material, VisualMaterialState>>(new Map());
  const fallbackLinkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
  const pooledLinkBoxRef = useRef(new THREE.Box3());
  const pooledLinkSizeRef = useRef(new THREE.Vector3());
  const helperVisibilityActiveRef = useRef(false);
  const modelOpacityActiveRef = useRef(false);
  const inertiaVisualizationActiveRef = useRef(false);
  const ikHandleVisualizationActiveRef = useRef(false);
  const originAxesActiveRef = useRef(false);
  const jointAxesVisualizationActiveRef = useRef(false);

  const effectiveShowInertia = showInertia && !snapshotRenderActive;
  const effectiveShowIkHandles = showIkHandles && !snapshotRenderActive;
  const effectiveShowCenterOfMass = showCenterOfMass && !snapshotRenderActive;
  const effectiveShowOrigins = showOrigins && !snapshotRenderActive;
  const effectiveShowMjcfSites = showMjcfSites && !snapshotRenderActive;
  const effectiveShowMjcfTendons = sourceFormat === 'mjcf' && !snapshotRenderActive;
  const effectiveShowJointAxes = showJointAxes && !snapshotRenderActive;
  const effectiveSelection = snapshotRenderActive ? undefined : selection;
  const effectiveLinkMeshMapRef = linkMeshMapRef ?? fallbackLinkMeshMapRef;

  // Refs for visibility state
  const showVisualRef = useRef(showVisual);
  const showCollisionRef = useRef(showCollision);

  useEffect(() => {
    visualMaterialStateRef.current.clear();
  }, [robot]);

  useEffect(() => {
    helperVisibilityActiveRef.current = false;
    modelOpacityActiveRef.current = false;
    inertiaVisualizationActiveRef.current = false;
    ikHandleVisualizationActiveRef.current = false;
    originAxesActiveRef.current = false;
    jointAxesVisualizationActiveRef.current = false;
  }, [robot]);

  const resolveStoredHighlightTarget = useCallback(
    (highlightObjectId?: number, objectIndex?: number): THREE.Object3D | number | undefined => {
      if (robot && Number.isInteger(highlightObjectId)) {
        return robot.getObjectById(highlightObjectId as number) ?? objectIndex;
      }

      return objectIndex;
    },
    [robot],
  );

  const resolveTendonHighlightObject = useCallback(
    (tendonName: string, highlightObjectId?: number): THREE.Object3D | null => {
      if (!robot) {
        return null;
      }

      const normalizedTendonName = tendonName.trim();
      if (!normalizedTendonName) {
        return null;
      }

      const resolveHighestTendonAncestor = (object: THREE.Object3D | null) => {
        let current: THREE.Object3D | null = object;
        let tendonObject: THREE.Object3D | null = null;

        while (current) {
          if (
            current.userData?.isMjcfTendon === true &&
            current.userData?.mjcfTendonName === normalizedTendonName
          ) {
            tendonObject = current;
          }
          current = current.parent;
        }

        return tendonObject;
      };

      const highlightedObject = Number.isInteger(highlightObjectId)
        ? (robot.getObjectById(highlightObjectId as number) ?? null)
        : null;
      const highlightedTendonObject = resolveHighestTendonAncestor(highlightedObject);
      if (highlightedTendonObject) {
        return highlightedTendonObject;
      }

      let namedTendonObject: THREE.Object3D | null = null;
      let fallbackTendonObject: THREE.Object3D | null = null;
      robot.traverse((child) => {
        if (
          child.userData?.isMjcfTendon !== true ||
          child.userData?.mjcfTendonName !== normalizedTendonName
        ) {
          return;
        }

        fallbackTendonObject ??= child;
        if (child.name === `__mjcf_tendon__:${normalizedTendonName}`) {
          namedTendonObject = child;
        }
      });

      return namedTendonObject ?? fallbackTendonObject;
    },
    [robot],
  );

  const getVisualMaterialState = (material: THREE.Material): VisualMaterialState => {
    const cachedState = visualMaterialStateRef.current.get(material);
    if (cachedState) return cachedState;

    const state: VisualMaterialState = {
      opacity: material.opacity ?? 1,
      transparent: material.transparent,
      depthWrite: material.depthWrite,
    };

    visualMaterialStateRef.current.set(material, state);
    return state;
  };

  const resolveHighlightTarget = useCallback(
    (
      candidate?: ViewerProps['selection'],
      options: {
        allowHelperSelection?: boolean;
      } = {},
    ): {
      id: string | null;
      subType: 'visual' | 'collision' | undefined;
      objectIndex?: number;
      highlightObjectId?: number;
    } => {
      const allowHelperSelection = options.allowHelperSelection ?? true;

      if (!robot || !candidate?.id || !candidate.type) {
        return { id: null, subType: undefined, highlightObjectId: undefined };
      }

      if (!allowHelperSelection && candidate.helperKind && !candidate.subType) {
        return { id: null, subType: undefined, highlightObjectId: undefined };
      }

      if (candidate.type === 'link') {
        return {
          id: candidate.id,
          subType: candidate.subType,
          objectIndex: candidate.objectIndex,
          highlightObjectId: candidate.highlightObjectId,
        };
      }

      if (candidate.type === 'tendon') {
        const tendonObject = resolveTendonHighlightObject(
          candidate.id,
          candidate.highlightObjectId,
        );
        return {
          id: candidate.id,
          subType: 'visual',
          highlightObjectId: tendonObject?.id ?? candidate.highlightObjectId,
        };
      }

      const jointObj = robot.getObjectByName(candidate.id);
      if (!jointObj) {
        return {
          id: null,
          subType: candidate.subType,
          objectIndex: candidate.objectIndex,
          highlightObjectId: candidate.highlightObjectId,
        };
      }

      const childLink = jointObj.children.find((c: any) => c.isURDFLink);
      if (!childLink) {
        return {
          id: null,
          subType: candidate.subType,
          objectIndex: candidate.objectIndex,
          highlightObjectId: candidate.highlightObjectId,
        };
      }

      return {
        id: childLink.name,
        subType: candidate.subType,
        objectIndex: candidate.objectIndex,
        highlightObjectId: candidate.highlightObjectId,
      };
    },
    [resolveTendonHighlightObject, robot],
  );

  const syncHelperInteractionHighlight = useCallback(
    (hoveredSelection?: ViewerProps['selection']) => {
      if (!robot) return;

      const nextHoveredSelection = snapshotRenderActive ? undefined : hoveredSelection;
      const activeSelection = selectionRef.current;
      const resolveLinkHelperOwnerId = (candidate?: ViewerProps['selection']) => {
        if (!candidate || candidate.subType) {
          return null;
        }

        if (!candidate.helperKind) {
          return candidate.type === 'link' ? candidate.id : null;
        }

        if (candidate.helperKind === 'joint-axis') {
          return null;
        }

        return resolveHighlightTarget(candidate).id;
      };

      const resolveJointHelperOwnerId = (candidate?: ViewerProps['selection']) => {
        if (!candidate || candidate.subType) {
          return null;
        }

        if (candidate.helperKind && candidate.helperKind !== 'joint-axis') {
          return null;
        }

        return candidate.type === 'joint' ? candidate.id : null;
      };

      const hoveredLinkId = resolveLinkHelperOwnerId(nextHoveredSelection);
      const hoveredHelperKind = nextHoveredSelection?.helperKind ?? null;
      const hoveredJointId = resolveJointHelperOwnerId(nextHoveredSelection);
      const selectedLinkId = resolveLinkHelperOwnerId(activeSelection);
      const selectedHelperKind = activeSelection?.helperKind ?? null;
      const selectedJointId = resolveJointHelperOwnerId(activeSelection);
      const { links, joints } = getRobotSceneNodeIndex(robot);

      const linkHelpersMutated = syncLinkHelperInteractionStateForLinks({
        links,
        hoveredLinkId,
        hoveredHelperKind,
        selectedLinkId,
        selectedHelperKind,
      });
      const jointHelpersMutated = syncJointHelperInteractionStateForJoints({
        joints,
        hoveredJointId,
        hoveredHelperKind,
        selectedJointId,
        selectedHelperKind,
      });
      const didMutate = linkHelpersMutated || jointHelpersMutated;

      if (didMutate) {
        invalidate();
      }
    },
    [invalidate, resolveHighlightTarget, robot, snapshotRenderActive],
  );

  useEffect(() => {
    showVisualRef.current = showVisual;
  }, [showVisual]);
  useEffect(() => {
    showCollisionRef.current = showCollision;
  }, [showCollision]);
  useEffect(() => {
    selectionRef.current = effectiveSelection;
  }, [
    effectiveSelection?.type,
    effectiveSelection?.id,
    effectiveSelection?.subType,
    effectiveSelection?.objectIndex,
    effectiveSelection?.helperKind,
  ]);

  // Clean up all tracked highlights on unmount
  useEffect(() => {
    return () => {
      highlightedMeshesRef.current.forEach((snapshot, mesh) => {
        mesh.material = snapshot.material;
        mesh.renderOrder = snapshot.renderOrder;
      });
      highlightedMeshesRef.current.clear();
    };
  }, [highlightedMeshesRef]);

  // Sync per-link / per-geometry visibility for visual and collision content.
  useEffect(() => {
    if (!robot) return;

    // Snapshot the currently-highlighted meshes so we can skip their material
    // assignment. Overwriting a highlighted mesh's material with the base
    // collision material causes a one-frame flash (base → highlight → base …)
    // every time robotLinks or robotVersion changes (e.g. dimension +/-).
    const didMutate = syncRobotGeometryVisibility({
      robot,
      robotLinks,
      sourceFormat: sourceFormat === 'mjcf' ? 'mjcf' : 'urdf',
      showCollision,
      showVisual,
      showMjcfWorldLink,
      showCollisionAlwaysOnTop,
      highlightedMeshes: highlightedMeshesRef.current,
    });

    if (didMutate || effectiveLinkMeshMapRef.current.size === 0) {
      rebuildLinkMeshMapFromRobot(effectiveLinkMeshMapRef, robot);
    }

    if (didMutate) {
      invalidate();
    }
  }, [
    effectiveLinkMeshMapRef,
    robot,
    showCollision,
    showVisual,
    sourceFormat,
    showMjcfWorldLink,
    showCollisionAlwaysOnTop,
    robotLinks,
    robotVersion,
    invalidate,
    highlightedMeshesRef,
  ]);

  // Sync visual mesh colors when robotLinks change
  useEffect(() => {
    if (!robot || !robotLinks) return;

    const didMutate = syncLinkVisualColors({ robot, robotLinks, robotMaterials });

    if (didMutate) {
      invalidate();
    }
  }, [robot, robotLinks, robotMaterials, invalidate]);

  // Update helper visibility for legacy __link_axes_helper__ objects
  useEffect(() => {
    if (!robot) return;
    if (!shouldRunVisualizationSync(effectiveShowOrigins, helperVisibilityActiveRef.current)) {
      return;
    }

    const { links } = getRobotSceneNodeIndex(robot);
    let didMutate = false;

    links.forEach((link: any) => {
      const linkAxesHelper = link.children.find(
        (child: any) => child.name === '__link_axes_helper__',
      );
      if (!linkAxesHelper) return;

      if (linkAxesHelper.visible !== effectiveShowOrigins) {
        linkAxesHelper.visible = effectiveShowOrigins;
        didMutate = true;
      }

      const scale = originSize || 1.0;
      if (
        linkAxesHelper.scale.x !== scale ||
        linkAxesHelper.scale.y !== scale ||
        linkAxesHelper.scale.z !== scale
      ) {
        linkAxesHelper.scale.set(scale, scale, scale);
        didMutate = true;
      }
    });

    if (didMutate) {
      invalidate();
    }
    helperVisibilityActiveRef.current = effectiveShowOrigins;
  }, [effectiveShowOrigins, invalidate, originSize, robot, robotVersion]);

  // Apply model opacity to visual meshes only
  useEffect(() => {
    if (!robot) return;
    const modelOpacityActive = isModelOpacitySyncActive(modelOpacity);
    if (!shouldRunVisualizationSync(modelOpacityActive, modelOpacityActiveRef.current)) {
      return;
    }

    let didMutate = false;

    getRobotVisualMeshIndex(robot, robotVersion).forEach((child: any) => {
      if (!child.material) return;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat: any) => {
        if (mat && !isProtectedMaterial(mat) && mat.depthTest !== false) {
          const baseState = getVisualMaterialState(mat);
          const nextOpacity = THREE.MathUtils.clamp(baseState.opacity * modelOpacity, 0, 1);
          const nextTransparent = baseState.transparent || nextOpacity < 1.0;
          const nextDepthWrite = baseState.depthWrite;

          if (
            mat.transparent !== nextTransparent ||
            mat.opacity !== nextOpacity ||
            mat.depthWrite !== nextDepthWrite
          ) {
            mat.transparent = nextTransparent;
            mat.opacity = nextOpacity;
            mat.depthWrite = nextDepthWrite;
            mat.needsUpdate = true;
            didMutate = true;
          }
        }
      });
    });

    if (didMutate) {
      invalidate();
    }
    modelOpacityActiveRef.current = modelOpacityActive;
  }, [robot, modelOpacity, robotVersion, invalidate]);

  // Effect to handle inertia and CoM visualization
  useEffect(() => {
    if (!robot) return;
    const inertiaVisualizationActive = effectiveShowInertia || effectiveShowCenterOfMass;
    if (
      !shouldRunVisualizationSync(inertiaVisualizationActive, inertiaVisualizationActiveRef.current)
    ) {
      return;
    }

    const didMutate = syncInertiaVisualizationForLinks({
      links: getRobotSceneNodeIndex(robot).links,
      robotLinks,
      showInertia: effectiveShowInertia,
      showInertiaOverlay,
      showCenterOfMass: effectiveShowCenterOfMass,
      showCoMOverlay,
      centerOfMassSize,
      pooledLinkBox: pooledLinkBoxRef.current,
      pooledLinkSize: pooledLinkSizeRef.current,
    });

    if (didMutate) {
      invalidate();
    }
    inertiaVisualizationActiveRef.current = inertiaVisualizationActive;
  }, [
    centerOfMassSize,
    effectiveShowCenterOfMass,
    effectiveShowInertia,
    invalidate,
    robot,
    robotLinks,
    robotVersion,
    showCoMOverlay,
    showInertiaOverlay,
  ]);

  useEffect(() => {
    if (!robot) return;
    if (
      !shouldRunVisualizationSync(effectiveShowIkHandles, ikHandleVisualizationActiveRef.current)
    ) {
      return;
    }

    const didMutate = syncIkHandleVisualizationForLinks({
      links: getRobotSceneNodeIndex(robot).links,
      robotLinks,
      robotJoints,
      showIkHandles: effectiveShowIkHandles,
      showIkHandlesAlwaysOnTop,
      ikDragActive,
    });

    if (didMutate) {
      invalidate();
    }
    ikHandleVisualizationActiveRef.current = effectiveShowIkHandles;
  }, [
    effectiveShowIkHandles,
    invalidate,
    robot,
    robotJoints,
    robotLinks,
    robotVersion,
    ikDragActive,
    showIkHandlesAlwaysOnTop,
  ]);

  useEffect(() => {
    if (!robot) return;

    const didMutate = syncMjcfSiteVisualizationForLinks({
      links: getRobotSceneNodeIndex(robot).links,
      sourceFormat: sourceFormat === 'mjcf' ? 'mjcf' : 'urdf',
      showMjcfSites: effectiveShowMjcfSites,
      showMjcfWorldLink,
    });

    if (didMutate) {
      invalidate();
    }
  }, [effectiveShowMjcfSites, invalidate, robot, robotVersion, showMjcfWorldLink, sourceFormat]);

  useEffect(() => {
    if (!robot) return;

    const didMutateGeometry = syncMjcfTendonVisualizationForRobot({
      robot,
      sourceFormat: sourceFormat === 'mjcf' ? 'mjcf' : 'urdf',
      showMjcfTendons: effectiveShowMjcfTendons,
    });
    const didMutateLinkMeshMap = syncMjcfTendonVisualMeshMap(
      effectiveLinkMeshMapRef.current,
      robot,
    );

    if (didMutateGeometry || didMutateLinkMeshMap) {
      invalidate();
    }
  }, [
    effectiveShowMjcfTendons,
    effectiveLinkMeshMapRef,
    invalidate,
    robot,
    robotVersion,
    sourceFormat,
  ]);

  useFrame(() => {
    if (!robot || !effectiveShowMjcfTendons) {
      return;
    }

    const didMutateGeometry = syncMjcfTendonVisualizationForRobot({
      robot,
      sourceFormat: sourceFormat === 'mjcf' ? 'mjcf' : 'urdf',
      showMjcfTendons: effectiveShowMjcfTendons,
    });
    const didMutateLinkMeshMap = syncMjcfTendonVisualMeshMap(
      effectiveLinkMeshMapRef.current,
      robot,
    );

    if (didMutateGeometry || didMutateLinkMeshMap) {
      invalidate();
    }
  });

  // Effect to handle origin axes visualization for each link
  useEffect(() => {
    if (!robot) return;
    if (!shouldRunVisualizationSync(effectiveShowOrigins, originAxesActiveRef.current)) {
      return;
    }

    const didMutate = syncOriginAxesVisualizationForLinks({
      links: getRobotSceneNodeIndex(robot).links,
      showOrigins: effectiveShowOrigins,
      showOriginsOverlay,
      originSize,
    });

    if (didMutate) {
      invalidate();
    }
    originAxesActiveRef.current = effectiveShowOrigins;
  }, [effectiveShowOrigins, invalidate, originSize, robot, robotVersion, showOriginsOverlay]);

  // Effect to handle joint axes visualization
  useEffect(() => {
    if (!robot) return;

    if (
      !shouldRunVisualizationSync(effectiveShowJointAxes, jointAxesVisualizationActiveRef.current)
    ) {
      return;
    }

    const didMutate = syncJointAxesVisualizationForJoints({
      joints: getRobotSceneNodeIndex(robot).joints,
      showJointAxes: effectiveShowJointAxes,
      showJointAxesOverlay,
      jointAxisSize,
    });

    if (didMutate) {
      invalidate();
    }
    jointAxesVisualizationActiveRef.current = effectiveShowJointAxes;
  }, [
    effectiveShowJointAxes,
    invalidate,
    jointAxisSize,
    robot,
    robotVersion,
    showJointAxesOverlay,
  ]);

  const syncHoverHighlight = useCallback(
    (hoveredSelection?: ViewerProps['selection']) => {
      const nextHoveredSelection = snapshotRenderActive ? undefined : hoveredSelection;
      latestHoverSelectionRef.current = nextHoveredSelection;

      if (!robot) return;

      let didMutateGeometryHighlight = false;
      syncHelperInteractionHighlight(nextHoveredSelection);

      const activeSelection = selectionRef.current;
      const {
        id: selectionHighlightId,
        subType: selectionHighlightSubType,
        objectIndex: selectionHighlightObjectIndex,
        highlightObjectId: selectionHighlightObjectId,
      } = resolveHighlightTarget(activeSelection, { allowHelperSelection: false });

      if (currentHoverRef.current.id) {
        if (
          !areHighlightTargetsEquivalent(currentHoverRef.current, {
            id: selectionHighlightId,
            subType: selectionHighlightSubType,
            objectIndex: selectionHighlightObjectIndex,
            highlightObjectId: selectionHighlightObjectId,
          })
        ) {
          highlightGeometry(
            currentHoverRef.current.id,
            true,
            currentHoverRef.current.subType as any,
            resolveStoredHighlightTarget(
              currentHoverRef.current.highlightObjectId,
              currentHoverRef.current.objectIndex,
            ),
          );
          didMutateGeometryHighlight = true;
          if (selectionHighlightId) {
            highlightGeometry(
              selectionHighlightId,
              false,
              selectionHighlightSubType,
              resolveStoredHighlightTarget(
                selectionHighlightObjectId,
                selectionHighlightObjectIndex,
              ),
              'selection',
            );
            didMutateGeometryHighlight = true;
          }
        }
      }

      const {
        id: hoverTargetId,
        subType: hoverTargetSubType,
        objectIndex: hoverTargetObjectIndex,
        highlightObjectId: hoverTargetHighlightObjectId,
      } = resolveHighlightTarget(nextHoveredSelection, { allowHelperSelection: false });

      if (hoverTargetId) {
        const hoverStateChanged =
          currentHoverRef.current.id !== hoverTargetId ||
          currentHoverRef.current.subType !== (hoverTargetSubType || null) ||
          currentHoverRef.current.objectIndex !== hoverTargetObjectIndex ||
          currentHoverRef.current.highlightObjectId !== hoverTargetHighlightObjectId;
        highlightGeometry(
          hoverTargetId,
          false,
          hoverTargetSubType,
          resolveStoredHighlightTarget(hoverTargetHighlightObjectId, hoverTargetObjectIndex),
        );
        currentHoverRef.current = {
          id: hoverTargetId,
          subType: hoverTargetSubType || null,
          objectIndex: hoverTargetObjectIndex,
          highlightObjectId: hoverTargetHighlightObjectId,
        };
        if (hoverStateChanged || didMutateGeometryHighlight) {
          invalidate();
        }
        return;
      }

      const hadHoverHighlight =
        currentHoverRef.current.id !== null ||
        currentHoverRef.current.subType !== null ||
        currentHoverRef.current.objectIndex !== undefined ||
        currentHoverRef.current.highlightObjectId !== undefined;
      currentHoverRef.current = { id: null, subType: null };
      if (didMutateGeometryHighlight || hadHoverHighlight) {
        invalidate();
      }
    },
    [
      highlightGeometry,
      resolveHighlightTarget,
      resolveStoredHighlightTarget,
      robot,
      snapshotRenderActive,
      syncHelperInteractionHighlight,
    ],
  );

  // Effect to handle selection highlighting
  useEffect(() => {
    if (!robot) return;

    if (currentSelectionRef.current.id) {
      highlightGeometry(
        currentSelectionRef.current.id,
        true,
        currentSelectionRef.current.subType as any,
        resolveStoredHighlightTarget(
          currentSelectionRef.current.highlightObjectId,
          currentSelectionRef.current.objectIndex,
        ),
      );
    }

    const {
      id: targetId,
      subType: targetSubType,
      objectIndex: targetObjectIndex,
      highlightObjectId: targetHighlightObjectId,
    } = resolveHighlightTarget(effectiveSelection, { allowHelperSelection: false });

    if (targetId) {
      highlightGeometry(
        targetId,
        false,
        targetSubType,
        resolveStoredHighlightTarget(targetHighlightObjectId, targetObjectIndex),
        'selection',
      );
      currentSelectionRef.current = {
        id: targetId,
        subType: targetSubType || null,
        objectIndex: targetObjectIndex,
        highlightObjectId: targetHighlightObjectId,
      };
    } else {
      currentSelectionRef.current = { id: null, subType: null };
    }
    syncHoverHighlight(latestHoverSelectionRef.current);
  }, [
    effectiveSelection?.helperKind,
    effectiveSelection?.highlightObjectId,
    effectiveSelection?.id,
    effectiveSelection?.objectIndex,
    effectiveSelection?.subType,
    effectiveSelection?.type,
    highlightGeometry,
    robot,
    robotVersion,
    resolveStoredHighlightTarget,
    showCollision,
    showVisual,
    syncHoverHighlight,
  ]);

  useEffect(() => {
    if (!robot) return;
    syncHelperInteractionHighlight(latestHoverSelectionRef.current);
  }, [
    robot,
    robotVersion,
    showInertia,
    showInertiaOverlay,
    showCenterOfMass,
    showCoMOverlay,
    showIkHandlesAlwaysOnTop,
    centerOfMassSize,
    showOrigins,
    showOriginsOverlay,
    originSize,
    showMjcfSites,
    showJointAxes,
    showJointAxesOverlay,
    jointAxisSize,
    effectiveSelection?.type,
    effectiveSelection?.id,
    effectiveSelection?.subType,
    effectiveSelection?.objectIndex,
    effectiveSelection?.helperKind,
    effectiveSelection?.highlightObjectId,
    syncHelperInteractionHighlight,
  ]);

  return { syncHoverHighlight };
}
