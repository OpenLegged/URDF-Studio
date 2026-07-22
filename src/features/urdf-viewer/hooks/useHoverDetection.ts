import { useRef, useEffect, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSelectionStore } from '@/store';
import type { InteractionSelection, UrdfJoint, UrdfLink } from '@/types';
import { setRegressionProjectedInteractionTargetsProvider } from '@/shared/debug/regressionState';
import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import { highlightFaceMaterial } from '../utils/materials';
import {
  collectGizmoRaycastTargets,
  shouldBlockBackgroundInteractionForGizmoHit,
} from '../utils/raycast';
import {
  collectPickTargets,
  collectSelectableHelperTargets,
  findPickIntersections,
  isCollisionPickObject,
  type PickTargetMode,
} from '../utils/pickTargets';
import { resolveInteractionSelectionHit } from '../utils/selectionTargets';
import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from '../utils/hoverInteractionResolution';
import {
  resolveTopLayerInteractionSubType,
  resolveTopLayerInteractionSubTypeFromHits,
} from '../utils/interactionMode';
import { collectRegressionProjectedInteractionTargets } from '../utils/regressionProjectionTargets';
import { resolveHelperSelectionPlan } from '../utils/helperSelectionPlan';
import { resolveDirectHelperInteraction } from '../utils/directHelperInteraction';
import { resolveHelperSelectionIdentity } from '../utils/helperSelectionIdentity';
import {
  collectProjectedHelperInteractionTargets,
  resolveScreenSpaceHelperInteraction,
  type ProjectedHelperInteractionTarget,
} from '../utils/screenSpaceHelperInteraction';
import type {
  ToolMode,
  ViewerProps,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  ViewerSceneMode,
} from '../types';
import { isRuntimeInteractionEditorLocked } from '../utils/editorInteractionLock';

export interface UseHoverDetectionOptions {
  robot: THREE.Object3D | null;
  robotVersion: number;
  toolMode: ToolMode;
  hoverSelectionEnabled?: boolean;
  mode?: ViewerSceneMode;
  showCollision: boolean;
  showVisual: boolean;
  showCollisionAlwaysOnTop: boolean;
  interactionLayerPriority?: ViewerInteractiveLayer[];
  selection?: ViewerProps['selection'];
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  linkMeshMapRef: React.RefObject<Map<string, THREE.Mesh[]>>;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  mouseRef: React.RefObject<THREE.Vector2>;
  raycasterRef: React.RefObject<THREE.Raycaster>;
  hoveredLinkRef: React.RefObject<string | null>;
  isDraggingJoint: React.RefObject<boolean>;
  needsRaycastRef: React.RefObject<boolean>;
  isOrbitDragging?: React.RefObject<boolean>;
  justSelectedRef?: React.RefObject<boolean>;
  isSelectionLockedRef?: React.RefObject<boolean>;
  rayIntersectsBoundingBox: (raycaster: THREE.Raycaster, forceRefresh?: boolean) => boolean;
  highlightGeometry: (
    linkName: string | null,
    revert: boolean,
    subType?: 'visual' | 'collision',
    meshToHighlight?: THREE.Object3D | null | number,
    intent?: 'hover' | 'selection',
  ) => void;
}

export interface UseHoverDetectionResult {
  highlightedFace: { mesh: THREE.Mesh; faceIndex: number } | null;
  setHighlightedFace: React.Dispatch<
    React.SetStateAction<{ mesh: THREE.Mesh; faceIndex: number } | null>
  >;
  highlightedFaceMeshRef: React.RefObject<THREE.Mesh | null>;
}

export function useHoverDetection({
  robot,
  robotVersion,
  toolMode,
  hoverSelectionEnabled = true,
  mode,
  showCollision,
  showVisual,
  showCollisionAlwaysOnTop,
  interactionLayerPriority = [],
  selection,
  onHover,
  linkMeshMapRef,
  robotLinks,
  robotJoints,
  mouseRef,
  raycasterRef,
  hoveredLinkRef,
  isDraggingJoint,
  needsRaycastRef,
  isOrbitDragging,
  justSelectedRef,
  isSelectionLockedRef,
  rayIntersectsBoundingBox,
  highlightGeometry,
}: UseHoverDetectionOptions): UseHoverDetectionResult {
  const { scene, camera, gl } = useThree();
  const hoverFrozen = useSelectionStore((state) => state.hoverFrozen);
  type PickTargetCacheEntry = {
    key: string;
    updatedAt: number;
    targets: THREE.Object3D[];
  };
  type ProjectedHelperCacheEntry = {
    key: string;
    targets: ProjectedHelperInteractionTarget[];
  };

  const [highlightedFace, setHighlightedFace] = useState<{
    mesh: THREE.Mesh;
    faceIndex: number;
  } | null>(null);
  const highlightedFaceMeshRef = useRef<THREE.Mesh | null>(null);
  const emittedHoverSelectionRef = useRef<{
    type: InteractionSelection['type'];
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: ViewerHelperKind;
    highlightObjectId?: number;
  }>({ type: null, id: null });
  const gizmoTargetsRef = useRef<THREE.Object3D[]>([]);
  const gizmoTargetsCacheKeyRef = useRef('');
  const gizmoTargetsUpdatedAtRef = useRef(0);
  const helperTargetCacheRef = useRef<PickTargetCacheEntry>({
    key: '',
    updatedAt: 0,
    targets: [],
  });
  const projectedHelperCacheRef = useRef<ProjectedHelperCacheEntry>({
    key: '',
    targets: [],
  });
  const pickTargetCachesRef = useRef<Record<PickTargetMode, PickTargetCacheEntry>>({
    all: { key: '', updatedAt: 0, targets: [] },
    visual: { key: '', updatedAt: 0, targets: [] },
    collision: { key: '', updatedAt: 0, targets: [] },
  });

  // Track last camera position to detect camera movement
  const lastCameraPosRef = useRef(new THREE.Vector3());
  const lastCameraQuaternionRef = useRef(new THREE.Quaternion());
  // Track last toolMode to detect mode changes
  const lastToolModeRef = useRef(toolMode);
  const hoverSuppressedByDragRef = useRef(false);
  const useExternalHover = typeof onHover === 'function';
  const regressionDebugEnabled = isRegressionDebugEnabled();

  const clearRaycastTargetCaches = useCallback(() => {
    gizmoTargetsRef.current = [];
    gizmoTargetsCacheKeyRef.current = '';
    gizmoTargetsUpdatedAtRef.current = 0;
    helperTargetCacheRef.current.key = '';
    helperTargetCacheRef.current.updatedAt = 0;
    helperTargetCacheRef.current.targets = [];
    projectedHelperCacheRef.current.key = '';
    projectedHelperCacheRef.current.targets = [];

    pickTargetCachesRef.current.all.key = '';
    pickTargetCachesRef.current.all.updatedAt = 0;
    pickTargetCachesRef.current.all.targets = [];

    pickTargetCachesRef.current.visual.key = '';
    pickTargetCachesRef.current.visual.updatedAt = 0;
    pickTargetCachesRef.current.visual.targets = [];

    pickTargetCachesRef.current.collision.key = '';
    pickTargetCachesRef.current.collision.updatedAt = 0;
    pickTargetCachesRef.current.collision.targets = [];
  }, []);

  const getGizmoTargets = () => {
    const nextCacheKey = `${scene.children.length}:${toolMode}:${selection?.type ?? 'none'}:${selection?.id ?? ''}`;
    const now = performance.now();

    if (
      gizmoTargetsCacheKeyRef.current !== nextCacheKey ||
      now - gizmoTargetsUpdatedAtRef.current > 120
    ) {
      gizmoTargetsRef.current = collectGizmoRaycastTargets(scene);
      gizmoTargetsCacheKeyRef.current = nextCacheKey;
      gizmoTargetsUpdatedAtRef.current = now;
    }

    return gizmoTargetsRef.current;
  };

  const getHelperTargets = () => {
    if (!robot) {
      helperTargetCacheRef.current.key = '';
      helperTargetCacheRef.current.updatedAt = 0;
      helperTargetCacheRef.current.targets = [];
      return helperTargetCacheRef.current.targets;
    }

    const nextCacheKey = `${robotVersion}:${mode ?? 'editor'}`;
    const now = performance.now();
    if (
      helperTargetCacheRef.current.key !== nextCacheKey ||
      now - helperTargetCacheRef.current.updatedAt > 120
    ) {
      helperTargetCacheRef.current.targets = collectSelectableHelperTargets(robot);
      helperTargetCacheRef.current.key = nextCacheKey;
      helperTargetCacheRef.current.updatedAt = now;
    }

    return helperTargetCacheRef.current.targets;
  };

  const getProjectedHelperTargets = (forceRefresh = false) => {
    if (!robot) {
      projectedHelperCacheRef.current.key = '';
      projectedHelperCacheRef.current.targets = [];
      return projectedHelperCacheRef.current.targets;
    }

    const canvasRect = gl.domElement.getBoundingClientRect();
    const nextCacheKey = [
      robotVersion,
      mode ?? 'editor',
      interactionLayerPriority.join(','),
      canvasRect.x,
      canvasRect.y,
      canvasRect.width,
      canvasRect.height,
    ].join(':');

    if (forceRefresh || projectedHelperCacheRef.current.key !== nextCacheKey) {
      projectedHelperCacheRef.current.targets = collectProjectedHelperInteractionTargets({
        robot,
        camera,
        canvasRect,
      });
      projectedHelperCacheRef.current.key = nextCacheKey;
    }

    return projectedHelperCacheRef.current.targets;
  };

  const emitHoverSelection = useCallback(
    (
      type: InteractionSelection['type'],
      id: string | null,
      subType?: 'visual' | 'collision',
      objectIndex?: number,
      helperKind?: ViewerHelperKind,
      highlightObjectId?: number,
    ) => {
      if (!onHover) return;

      const previous = emittedHoverSelectionRef.current;
      if (
        previous.type === type &&
        previous.id === id &&
        previous.subType === subType &&
        (previous.objectIndex ?? 0) === (objectIndex ?? 0) &&
        previous.helperKind === helperKind &&
        (previous.highlightObjectId ?? null) === (highlightObjectId ?? null)
      ) {
        return;
      }

      emittedHoverSelectionRef.current = {
        type,
        id,
        subType,
        objectIndex,
        helperKind,
        highlightObjectId,
      };
      onHover(type, id, subType, objectIndex, helperKind, highlightObjectId);
    },
    [onHover],
  );

  const getPickTargets = (targetMode: PickTargetMode) => {
    const cache = pickTargetCachesRef.current[targetMode];
    const nextCacheKey = [
      robotVersion,
      targetMode,
      showCollision ? 'col:1' : 'col:0',
      showVisual ? 'vis:1' : 'vis:0',
      showCollisionAlwaysOnTop ? 'col-top:1' : 'col-top:0',
      linkMeshMapRef.current.size,
    ].join(':');
    const now = performance.now();

    if (cache.key !== nextCacheKey || now - cache.updatedAt > 120) {
      cache.targets = collectPickTargets(linkMeshMapRef.current, targetMode, robot);
      cache.key = nextCacheKey;
      cache.updatedAt = now;
    }

    return cache.targets;
  };

  const getSelectionHighlightSubType = useCallback(() => {
    const activeInteractionSubType = resolveTopLayerInteractionSubType({
      showVisual,
      showCollision,
      collisionAlwaysOnTop: showCollisionAlwaysOnTop,
    });

    return selection?.subType ?? activeInteractionSubType ?? undefined;
  }, [selection?.subType, showCollision, showCollisionAlwaysOnTop, showVisual]);

  const restoreSelectionHighlight = useCallback(() => {
    if (useExternalHover) return;
    if (selection?.type === 'link' && selection.id) {
      highlightGeometry(
        selection.id,
        false,
        getSelectionHighlightSubType(),
        selection.objectIndex,
        'selection',
      );
    }
  }, [getSelectionHighlightSubType, highlightGeometry, selection, useExternalHover]);

  const clearHoverHighlight = useCallback(() => {
    if (!hoveredLinkRef.current) return;
    if (!useExternalHover) {
      const hoveredSubType =
        ((hoveredLinkRef as any).currentSubType as 'visual' | 'collision' | null) ?? undefined;
      highlightGeometry(
        hoveredLinkRef.current,
        true,
        hoveredSubType,
        (hoveredLinkRef as any).currentMesh || (hoveredLinkRef as any).currentObjectIndex,
      );
    }
    hoveredLinkRef.current = null;
    (hoveredLinkRef as any).currentMesh = null;
    (hoveredLinkRef as any).currentObjectIndex = null;
    (hoveredLinkRef as any).currentSubType = null;
    emitHoverSelection(null, null);
    restoreSelectionHighlight();
  }, [
    emitHoverSelection,
    highlightGeometry,
    hoveredLinkRef,
    restoreSelectionHighlight,
    useExternalHover,
  ]);

  const resetHoverState = useCallback(() => {
    if (hoveredLinkRef.current) {
      clearHoverHighlight();
    } else {
      emitHoverSelection(null, null);
    }
  }, [clearHoverHighlight, emitHoverSelection, hoveredLinkRef]);

  const clearTransientHoverState = useCallback(() => {
    resetHoverState();
    setHighlightedFace((current) => (current ? null : current));
  }, [resetHoverState]);

  useEffect(() => {
    emittedHoverSelectionRef.current = { type: null, id: null };
    clearTransientHoverState();
    clearRaycastTargetCaches();
    needsRaycastRef.current = true;
  }, [clearRaycastTargetCaches, clearTransientHoverState, needsRaycastRef, robot, robotVersion]);

  useEffect(() => {
    setHighlightedFace((current) => (current ? null : current));
    clearRaycastTargetCaches();
    needsRaycastRef.current = true;
  }, [
    clearRaycastTargetCaches,
    interactionLayerPriority,
    needsRaycastRef,
    showCollision,
    showCollisionAlwaysOnTop,
    showVisual,
  ]);

  useEffect(() => {
    if (!regressionDebugEnabled || !robot) {
      return;
    }

    setRegressionProjectedInteractionTargetsProvider(() => {
      const canvasRect = gl.domElement.getBoundingClientRect();
      const candidates: Array<{
        object: THREE.Object3D;
        selection: {
          type: 'link' | 'joint';
          id: string;
          subType?: 'visual' | 'collision';
          objectIndex?: number;
          helperKind?: ViewerHelperKind;
        };
      }> = [];

      linkMeshMapRef.current.forEach((meshes, mapKey) => {
        const keyMatch = /^(.*):(visual|collision)$/.exec(mapKey);
        if (!keyMatch) {
          return;
        }

        const [, linkId, subType] = keyMatch;
        meshes.forEach((mesh, objectIndex) => {
          if (!mesh?.visible) {
            return;
          }

          candidates.push({
            object: mesh,
            selection: {
              type: 'link',
              id: linkId,
              subType: subType as 'visual' | 'collision',
              objectIndex,
            },
          });
        });
      });

      robot.traverseVisible((object) => {
        const explicitHelperKind = object.userData?.viewerHelperKind;
        const isHelperRoot =
          explicitHelperKind === 'ik-handle' ||
          explicitHelperKind === 'center-of-mass' ||
          explicitHelperKind === 'inertia' ||
          explicitHelperKind === 'origin-axes' ||
          explicitHelperKind === 'joint-axis' ||
          object.name === '__ik_handle__' ||
          object.name === '__com_visual__' ||
          object.name === '__inertia_box__' ||
          object.name === '__origin_axes__' ||
          object.name === '__joint_axis__' ||
          object.name === '__joint_axis_helper__';
        if (!isHelperRoot) {
          return;
        }

        const resolved = resolveInteractionSelectionHit(robot, object);
        if (!resolved || resolved.targetKind !== 'helper' || resolved.type === 'tendon') {
          return;
        }

        candidates.push({
          object,
          selection: {
            type: resolved.type,
            id: resolved.id,
            helperKind: resolved.helperKind,
          },
        });
      });

      return collectRegressionProjectedInteractionTargets({
        camera,
        canvasRect,
        candidates,
      });
    });

    return () => {
      setRegressionProjectedInteractionTargetsProvider(null);
    };
  }, [camera, gl, regressionDebugEnabled, robot]);

  // Update face highlight mesh
  useEffect(() => {
    if (!highlightedFace) {
      if (highlightedFaceMeshRef.current) {
        highlightedFaceMeshRef.current.visible = false;
      }
      return;
    }

    const { mesh, faceIndex } = highlightedFace;
    const geometry = mesh.geometry;

    if (!geometry) return;

    if (!highlightedFaceMeshRef.current) {
      highlightedFaceMeshRef.current = new THREE.Mesh(
        new THREE.BufferGeometry(),
        highlightFaceMaterial,
      );
      highlightedFaceMeshRef.current.renderOrder = 2000;
      scene.add(highlightedFaceMeshRef.current);
    }

    const highlightMesh = highlightedFaceMeshRef.current;
    highlightMesh.visible = true;

    const positionAttribute = geometry.getAttribute('position');
    const indexAttribute = geometry.getIndex();

    const facesToHighlight = [faceIndex];
    const positions: number[] = [];

    for (const fi of facesToHighlight) {
      let a: number, b: number, c: number;
      if (indexAttribute) {
        a = indexAttribute.getX(fi * 3);
        b = indexAttribute.getX(fi * 3 + 1);
        c = indexAttribute.getX(fi * 3 + 2);
      } else {
        a = fi * 3;
        b = fi * 3 + 1;
        c = fi * 3 + 2;
      }

      positions.push(
        positionAttribute.getX(a),
        positionAttribute.getY(a),
        positionAttribute.getZ(a),
        positionAttribute.getX(b),
        positionAttribute.getY(b),
        positionAttribute.getZ(b),
        positionAttribute.getX(c),
        positionAttribute.getY(c),
        positionAttribute.getZ(c),
      );
    }

    const highlightGeo = highlightMesh.geometry;
    const existingPosition = highlightGeo.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (
      existingPosition &&
      existingPosition.itemSize === 3 &&
      existingPosition.count * 3 === positions.length
    ) {
      existingPosition.copyArray(positions);
      existingPosition.needsUpdate = true;
    } else {
      // Release previous GPU buffer when replacing the attribute.
      const disposable = existingPosition as THREE.BufferAttribute & { dispose?: () => void };
      disposable?.dispose?.();
      highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }
    highlightGeo.computeVertexNormals();
  }, [highlightedFace, scene]);

  // Sync face highlight transform
  useFrame(() => {
    if (highlightedFace && highlightedFaceMeshRef.current) {
      const mesh = highlightedFace.mesh;
      const highlight = highlightedFaceMeshRef.current;
      mesh.updateMatrixWorld();
      highlight.matrix.copy(mesh.matrixWorld);
      highlight.matrixAutoUpdate = false;
    }
  });

  // Clean up face highlight mesh on unmount
  useEffect(() => {
    return () => {
      emitHoverSelection(null, null);
      if (highlightedFaceMeshRef.current) {
        scene.remove(highlightedFaceMeshRef.current);
        highlightedFaceMeshRef.current.geometry.dispose();
        highlightedFaceMeshRef.current = null;
      }
      clearRaycastTargetCaches();
    };
  }, [clearRaycastTargetCaches, emitHoverSelection, scene]);

  // Clean up face highlight when leaving face mode
  useEffect(() => {
    if (toolMode !== 'face' && highlightedFaceMeshRef.current) {
      highlightedFaceMeshRef.current.visible = false;
    }
  }, [toolMode]);

  // Continuous hover detection (OPTIMIZED: only run when needed)
  useFrame(() => {
    if (!robot) return;

    const hoverSuppressedByDrag =
      hoverFrozen || isDraggingJoint.current || Boolean(isOrbitDragging?.current);
    if (hoverSuppressedByDrag) {
      if (!hoverSuppressedByDragRef.current) {
        if (!justSelectedRef?.current) {
          clearTransientHoverState();
        }
        needsRaycastRef.current = false;
        hoverSuppressedByDragRef.current = true;
      }
      return;
    }

    hoverSuppressedByDragRef.current = false;

    if (!hoverSelectionEnabled) {
      clearTransientHoverState();
      needsRaycastRef.current = false;
      return;
    }

    // OPTIMIZATION: Check if raycast is needed (mouse moved, camera changed, or toolMode changed)
    const cameraMoved = !camera.position.equals(lastCameraPosRef.current);
    const cameraRotated = !camera.quaternion.equals(lastCameraQuaternionRef.current);
    const toolModeChanged = toolMode !== lastToolModeRef.current;

    if (cameraMoved || cameraRotated) {
      lastCameraPosRef.current.copy(camera.position);
      lastCameraQuaternionRef.current.copy(camera.quaternion);
      needsRaycastRef.current = true;
    }
    if (toolModeChanged) {
      lastToolModeRef.current = toolMode;
      needsRaycastRef.current = true;
    }

    // Skip raycast if no update needed
    if (!needsRaycastRef.current) return;

    const isStandardMode = [
      'view',
      'select',
      'translate',
      'rotate',
      'universal',
      'measure',
      'paint',
    ].includes(toolMode || 'select');
    const fallbackInteractionSubType = resolveTopLayerInteractionSubType({
      showVisual,
      showCollision,
      collisionAlwaysOnTop: showCollisionAlwaysOnTop,
    });
    const canvasRect = gl.domElement.getBoundingClientRect();
    const pointerClientX = canvasRect.x + (mouseRef.current.x + 1) * 0.5 * canvasRect.width;
    const pointerClientY = canvasRect.y + (1 - mouseRef.current.y) * 0.5 * canvasRect.height;
    let helperInteraction: ResolvedHoverInteractionCandidate | null | undefined;
    const getHelperInteraction = () => {
      if (helperInteraction !== undefined) {
        return helperInteraction;
      }

      helperInteraction = resolveDirectHelperInteraction({
        robot,
        raycaster: raycasterRef.current,
        helperTargets: getHelperTargets(),
        interactionLayerPriority,
      });
      const projectedHelperInteraction = resolveScreenSpaceHelperInteraction({
        pointerClientX,
        pointerClientY,
        projectedHelpers: getProjectedHelperTargets(cameraMoved || cameraRotated),
        interactionLayerPriority,
      });
      const helperCandidates = [helperInteraction, projectedHelperInteraction].filter(
        (candidate): candidate is ResolvedHoverInteractionCandidate =>
          candidate !== null &&
          !isRuntimeInteractionEditorLocked(candidate, robotLinks, robotJoints),
      );
      helperInteraction =
        helperCandidates.length > 0
          ? resolveHoverInteractionResolution(helperCandidates, interactionLayerPriority)
              .primaryInteraction
          : null;
      return helperInteraction;
    };
    const applyHelperHoverInteraction = (helperInteraction: ResolvedHoverInteractionCandidate) => {
      if (helperInteraction.type === 'tendon') {
        return;
      }

      const helperSelectionPlan = resolveHelperSelectionPlan({
        fallbackType: helperInteraction.type,
        fallbackId: helperInteraction.id,
        helperKind: helperInteraction.helperKind,
        linkObject: helperInteraction.linkObject,
      });
      const helperSelectionIdentity = resolveHelperSelectionIdentity(
        helperSelectionPlan.selectTarget,
        robotLinks,
        robotJoints,
      );

      if (hoveredLinkRef.current) {
        clearHoverHighlight();
      }

      hoveredLinkRef.current = null;
      (hoveredLinkRef as any).currentMesh = null;
      (hoveredLinkRef as any).currentObjectIndex = null;
      (hoveredLinkRef as any).currentSubType = null;
      emitHoverSelection(
        helperSelectionIdentity.type,
        helperSelectionIdentity.id,
        undefined,
        undefined,
        helperInteraction.helperKind,
        helperInteraction.highlightTarget?.id,
      );
    };

    if (isSelectionLockedRef?.current) {
      resetHoverState();
      if (highlightedFace) {
        setHighlightedFace(null);
      }
      return;
    }

    if (justSelectedRef?.current) return;

    needsRaycastRef.current = false;

    // Handle Face Selection Mode
    if (toolMode === 'face') {
      if (!fallbackInteractionSubType) {
        if (highlightedFace) setHighlightedFace(null);
        resetHoverState();
        return;
      }

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const gizmoTargets = getGizmoTargets();
      const pickTargets = getPickTargets('all');
      const nearestSceneHit =
        gizmoTargets.length > 0
          ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
          : undefined;
      if (shouldBlockBackgroundInteractionForGizmoHit(nearestSceneHit?.object ?? null)) {
        if (highlightedFace) setHighlightedFace(null);
        resetHoverState();
        return;
      }

      // Keep hover broad-phase in sync with click picking after runtime transforms.
      if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
        if (highlightedFace) setHighlightedFace(null);
        resetHoverState();
        return;
      }

      const intersects = findPickIntersections(
        robot,
        raycasterRef.current,
        pickTargets,
        'all',
        false,
        interactionLayerPriority,
      );
      const activeInteractionSubType = resolveTopLayerInteractionSubTypeFromHits({
        showVisual,
        showCollision,
        collisionAlwaysOnTop: showCollisionAlwaysOnTop,
        hits: intersects.map((hit) => ({
          isCollision: isCollisionPickObject(hit.object),
        })),
      });
      if (!activeInteractionSubType) {
        if (highlightedFace) setHighlightedFace(null);
        resetHoverState();
        return;
      }
      const isCollisionInteraction = activeInteractionSubType === 'collision';

      const hit = intersects.find((entry) => {
        if (isCollisionPickObject(entry.object) !== isCollisionInteraction) {
          return false;
        }
        const candidate = resolveInteractionSelectionHit(robot, entry.object);
        return !isRuntimeInteractionEditorLocked(candidate, robotLinks, robotJoints);
      });
      if (
        hit &&
        hit.faceIndex !== undefined &&
        hit.faceIndex !== null &&
        hit.object instanceof THREE.Mesh
      ) {
        if (highlightedFace?.faceIndex !== hit.faceIndex || highlightedFace?.mesh !== hit.object) {
          setHighlightedFace({ mesh: hit.object, faceIndex: hit.faceIndex as number });
        }
        if (hoveredLinkRef.current) {
          clearHoverHighlight();
        }
        return;
      }
      if (highlightedFace) setHighlightedFace(null);
      resetHoverState();
      return;
    }

    // Hide face highlight if not in face mode
    if ((toolMode as any) !== 'face' && highlightedFace) {
      setHighlightedFace(null);
    }

    if (!isStandardMode) {
      resetHoverState();
      return;
    }

    raycasterRef.current.setFromCamera(mouseRef.current, camera);
    const gizmoTargets = getGizmoTargets();
    const pickTargets = getPickTargets('all');
    const nearestSceneHit =
      gizmoTargets.length > 0
        ? raycasterRef.current.intersectObjects(gizmoTargets, false)[0]
        : undefined;
    if (shouldBlockBackgroundInteractionForGizmoHit(nearestSceneHit?.object ?? null)) {
      resetHoverState();
      return;
    }

    // Keep hover broad-phase in sync with click picking after runtime transforms.
    if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycasterRef.current, true)) {
      const helperInteraction = getHelperInteraction();
      if (helperInteraction) {
        applyHelperHoverInteraction(helperInteraction);
        return;
      }

      resetHoverState();
      return;
    }

    const intersections = findPickIntersections(
      robot,
      raycasterRef.current,
      pickTargets,
      'all',
      false,
      interactionLayerPriority,
    );
    const resolvedCandidates = (() => {
      const candidates: ResolvedHoverInteractionCandidate[] = [];
      for (const intersection of intersections) {
        const resolved = resolveInteractionSelectionHit(robot, intersection.object);
        if (
          resolved &&
          !isRuntimeInteractionEditorLocked(resolved, robotLinks, robotJoints)
        ) {
          candidates.push({
            ...resolved,
            distance: intersection.distance,
          });
        }
      }

      return candidates;
    })();
    const nextHelperInteraction = getHelperInteraction();
    const { primaryInteraction: resolvedInteraction } = resolveHoverInteractionResolution(
      nextHelperInteraction ? resolvedCandidates.concat(nextHelperInteraction) : resolvedCandidates,
      interactionLayerPriority,
    );

    if (resolvedInteraction?.targetKind === 'helper') {
      applyHelperHoverInteraction(resolvedInteraction);
      return;
    }

    if (resolvedInteraction?.type === 'tendon') {
      const newHoveredTendon = resolvedInteraction.id;
      const newHoveredMesh = resolvedInteraction.highlightTarget ?? null;
      const previousHoveredMesh = (hoveredLinkRef as any).currentMesh ?? null;

      if (
        hoveredLinkRef.current &&
        (hoveredLinkRef.current !== newHoveredTendon || previousHoveredMesh !== newHoveredMesh)
      ) {
        clearHoverHighlight();
      }

      if (
        !useExternalHover &&
        newHoveredTendon &&
        (newHoveredTendon !== selection?.id || selection?.type !== 'tendon')
      ) {
        highlightGeometry(newHoveredTendon, false, 'visual', newHoveredMesh);
      }

      hoveredLinkRef.current = newHoveredTendon;
      (hoveredLinkRef as any).currentMesh = newHoveredMesh;
      (hoveredLinkRef as any).currentObjectIndex = null;
      (hoveredLinkRef as any).currentSubType = 'visual';
      emitHoverSelection(
        'tendon',
        resolvedInteraction.id,
        undefined,
        undefined,
        undefined,
        resolvedInteraction.highlightTarget?.id,
      );
      return;
    }

    const activeInteractionSubType = resolvedInteraction?.subType ?? fallbackInteractionSubType;
    if (!activeInteractionSubType) {
      resetHoverState();
      return;
    }

    if (!resolvedInteraction) {
      resetHoverState();
      return;
    }

    const newHoveredLink = resolvedInteraction.id;
    const newHoveredMesh = resolvedInteraction.highlightTarget ?? null;
    const newHoveredObjectIndex = resolvedInteraction.objectIndex;

    const previousHoveredMesh = (hoveredLinkRef as any).currentMesh ?? null;
    const previousHoveredObjectIndex = (hoveredLinkRef as any).currentObjectIndex ?? null;
    const previousHoveredSubType = (hoveredLinkRef as any).currentSubType ?? null;
    const nextHoveredSubType = newHoveredLink ? activeInteractionSubType : null;

    if (
      newHoveredLink !== hoveredLinkRef.current ||
      newHoveredMesh !== previousHoveredMesh ||
      (newHoveredObjectIndex ?? null) !== previousHoveredObjectIndex ||
      nextHoveredSubType !== previousHoveredSubType
    ) {
      if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
        clearHoverHighlight();
      }

      if (!useExternalHover && newHoveredLink && newHoveredLink !== selection?.id) {
        highlightGeometry(newHoveredLink, false, activeInteractionSubType, newHoveredMesh);
      }

      hoveredLinkRef.current = newHoveredLink;
      (hoveredLinkRef as any).currentMesh = newHoveredMesh;
      (hoveredLinkRef as any).currentObjectIndex = newHoveredObjectIndex ?? null;
      (hoveredLinkRef as any).currentSubType = nextHoveredSubType;
      emitHoverSelection(
        newHoveredLink ? 'link' : null,
        newHoveredLink,
        newHoveredLink ? activeInteractionSubType : undefined,
        newHoveredObjectIndex,
        undefined,
        newHoveredMesh?.id,
      );
    }
  });

  return {
    highlightedFace,
    setHighlightedFace,
    highlightedFaceMeshRef,
  };
}
