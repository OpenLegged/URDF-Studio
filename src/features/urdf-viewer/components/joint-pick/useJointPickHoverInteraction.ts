import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';

import type { AssemblySceneProjection } from '@/core/robot';
import type { SnapPointKind } from '@/core/geometry/meshSnapPoints';
import type { AssemblyState } from '@/types';
import type {
  JointPickSide,
  PickedSnapFrame,
} from '@/store/jointPickSessionStore';
import { resolveBridgePickAssignment } from '@/shared/utils/assembly/bridgePickAssignment';
import { throttle } from '@/shared/utils';

import {
  resolveJointSnapFromHit,
  type ResolvedJointSnap,
  type ResolvedJointSnapCandidate,
} from '../../utils/jointSnapResolver';
import {
  findCandidateNearPointer,
  isPointerInsideProjectedLoop,
  isPointerInsideProjectedRegion,
} from '../../utils/jointPickHoverProjection';

const PICK_THROTTLE_MS = 33;
const PICK_MOVE_THRESHOLD_PX = 2;
const PICK_CLICK_DRAG_THRESHOLD_PX = 5;
const PICK_CANDIDATE_RADIUS_PX = 14;
const PICK_POINTER_IGNORE_SELECTORS = [
  '.urdf-toolbar',
  '.urdf-options-panel',
  '.urdf-joint-panel',
  '.draggable-window',
];

export interface JointPickHoverState {
  valid: boolean;
  side: JointPickSide | null;
  snap: ResolvedJointSnap;
  chosen: ResolvedJointSnapCandidate;
}

interface JointPickRaycastContext {
  side: JointPickSide;
  snapFilter: SnapPointKind[] | null;
  parentComponentId: string | null;
  childComponentId: string | null;
  workspace: AssemblyState | null;
  sceneProjection: AssemblySceneProjection | null;
  robot: THREE.Object3D | null;
}

interface BindPointerInteractionOptions {
  camera: THREE.Camera;
  commitSnap: (frame: PickedSnapFrame) => void;
  domElement: HTMLElement;
  getContext: () => JointPickRaycastContext;
  getHover: () => JointPickHoverState | null;
  updateHover: (next: JointPickHoverState | null) => void;
}

interface JointPickRaycastResult {
  snap: ResolvedJointSnap;
  valid: boolean;
  side: JointPickSide | null;
}

interface UseJointPickHoverInteractionOptions extends JointPickRaycastContext {
  active: boolean;
  camera: THREE.Camera;
  commitSnap: (frame: PickedSnapFrame) => void;
  domElement: HTMLElement;
  hidden: boolean;
}

interface UseJointPickHoverInteractionResult {
  hover: JointPickHoverState | null;
  hoverRef: RefObject<JointPickHoverState | null>;
}

function isFreePointOverride(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

function visibleCandidates(snap: ResolvedJointSnap): ResolvedJointSnapCandidate[] {
  return snap.candidates.filter(
    (candidate) => candidate.kind !== 'surface',
  );
}

function commitCandidate(
  commitSnap: (frame: PickedSnapFrame) => void,
  snap: ResolvedJointSnap,
  candidate: ResolvedJointSnapCandidate,
  targetSide: JointPickSide,
): void {
  commitSnap({
    side: targetSide,
    componentId: snap.componentId,
    linkId: snap.linkId,
    kind: candidate.kind,
    pointWorld: {
      x: candidate.pointWorld.x,
      y: candidate.pointWorld.y,
      z: candidate.pointWorld.z,
    },
    poseWorldMatrix: candidate.poseWorld.toArray(),
    linkWorldMatrix: snap.linkWorldMatrix.toArray(),
  });
}

function createRaycastResolver({
  camera,
  domElement,
  getContext,
  pointer,
}: {
  camera: THREE.Camera;
  domElement: HTMLElement;
  getContext: () => JointPickRaycastContext;
  pointer: THREE.Vector2;
}): (freePointOverride?: boolean) => JointPickRaycastResult | null {
  const raycaster = new THREE.Raycaster();
  return (freePointOverride = false) => {
    const context = getContext();
    if (!context.robot || !context.workspace || !context.sceneProjection) {
      return null;
    }
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(context.robot, true);
    for (const hit of hits) {
      if (hit.object.userData?.isHelper || hit.object.userData?.isGizmo) {
        continue;
      }
      const snap = resolveJointSnapFromHit(
        { object: hit.object, point: hit.point, faceIndex: hit.faceIndex },
        context.sceneProjection,
        context.snapFilter,
        {
          camera,
          domSize: {
            width: domElement.clientWidth,
            height: domElement.clientHeight,
          },
          freePointOverride,
        },
      );
      if (!snap) {
        continue;
      }
      const targetSide = resolveBridgePickAssignment({
        selectedComponentId: snap.componentId,
        parentComponentId: context.parentComponentId,
        childComponentId: context.childComponentId,
        preferredTarget: context.side,
      });
      return { snap, valid: Boolean(targetSide), side: targetSide };
    }
    return null;
  };
}

function bindJointPickPointerInteraction({
  camera,
  commitSnap,
  domElement,
  getContext,
  getHover,
  updateHover,
}: BindPointerInteractionOptions): () => void {
  const pointer = new THREE.Vector2();
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  const viewport = () => ({ width: domElement.clientWidth, height: domElement.clientHeight });
  const raycastSnap = createRaycastResolver({ camera, domElement, getContext, pointer });
  const updatePointer = (event: MouseEvent): boolean => {
    const rect = domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  };
  const candidateNearPointer = (current: JointPickHoverState | null) =>
    current
      ? findCandidateNearPointer({
          candidates: visibleCandidates(current.snap),
          pointer,
          camera,
          viewport: viewport(),
          radiusPx: PICK_CANDIDATE_RADIUS_PX,
        })
      : null;

  const handleMoveCore = (event: MouseEvent) => {
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (dx * dx + dy * dy < PICK_MOVE_THRESHOLD_PX * PICK_MOVE_THRESHOLD_PX) {
      return;
    }
    lastX = event.clientX;
    lastY = event.clientY;
    if (!updatePointer(event)) {
      updateHover(null);
      return;
    }

    const current = getHover();
    const candidate = candidateNearPointer(current);
    if (current && candidate) {
      if (current.chosen.id !== candidate.id) {
        updateHover({ ...current, chosen: candidate });
      }
      return;
    }
    const insideHole = current?.snap.region.boundaryLoops.some(
      (loop) => loop.isHole
        && isPointerInsideProjectedLoop(loop.pointsWorld, pointer, camera, viewport()),
    );
    if (insideHole) {
      return;
    }

    const result = raycastSnap(isFreePointOverride(event));
    if (!result) {
      const insideRegion = current
        && isPointerInsideProjectedRegion(
          current.snap.region.boundaryLoops.map((loop) => loop.pointsWorld),
          pointer,
          camera,
          viewport(),
        );
      if (!insideRegion) {
        updateHover(null);
      }
      return;
    }
    updateHover({
      valid: result.valid,
      side: result.side,
      snap: result.snap,
      chosen: result.snap.chosen,
    });
  };
  const throttledMove = throttle(handleMoveCore, PICK_THROTTLE_MS);

  const handleDown = (event: MouseEvent) => {
    downX = event.clientX;
    downY = event.clientY;
  };
  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && PICK_POINTER_IGNORE_SELECTORS.some((selector) => target.closest(selector))) {
      return;
    }
    const ddx = event.clientX - downX;
    const ddy = event.clientY - downY;
    if (
      ddx * ddx + ddy * ddy
      > PICK_CLICK_DRAG_THRESHOLD_PX * PICK_CLICK_DRAG_THRESHOLD_PX
    ) {
      return;
    }
    if (!updatePointer(event)) {
      return;
    }
    const freePointOverride = isFreePointOverride(event);
    const current = getHover();
    const candidate = freePointOverride ? null : candidateNearPointer(current);
    if (current?.valid && current.side && candidate) {
      commitCandidate(commitSnap, current.snap, candidate, current.side);
      updateHover(null);
      return;
    }
    const result = raycastSnap(freePointOverride);
    if (!result || !result.valid || !result.side) {
      return;
    }
    commitCandidate(commitSnap, result.snap, result.snap.chosen, result.side);
    updateHover(null);
  };

  domElement.addEventListener('mousemove', throttledMove);
  domElement.addEventListener('mousedown', handleDown);
  domElement.addEventListener('click', handleClick);
  return () => {
    throttledMove.cancel();
    domElement.removeEventListener('mousemove', throttledMove);
    domElement.removeEventListener('mousedown', handleDown);
    domElement.removeEventListener('click', handleClick);
    updateHover(null);
  };
}

export function useJointPickHoverInteraction({
  active,
  camera,
  childComponentId,
  commitSnap,
  domElement,
  hidden,
  parentComponentId,
  robot,
  sceneProjection,
  side,
  snapFilter,
  workspace,
}: UseJointPickHoverInteractionOptions): UseJointPickHoverInteractionResult {
  const [hover, setHover] = useState<JointPickHoverState | null>(null);
  const hoverRef = useRef<JointPickHoverState | null>(null);
  const contextRef = useRef<JointPickRaycastContext>({
    side,
    snapFilter,
    parentComponentId,
    childComponentId,
    workspace,
    sceneProjection,
    robot,
  });
  useEffect(() => {
    contextRef.current = {
      side,
      snapFilter,
      parentComponentId,
      childComponentId,
      workspace,
      sceneProjection,
      robot,
    };
  }, [childComponentId, parentComponentId, robot, sceneProjection, side, snapFilter, workspace]);

  useEffect(() => {
    const updateHover = (next: JointPickHoverState | null) => {
      hoverRef.current = next;
      setHover(next);
    };
    if (!active || hidden || !robot || !workspace || !sceneProjection) {
      updateHover(null);
      return undefined;
    }
    return bindJointPickPointerInteraction({
      camera,
      commitSnap,
      domElement,
      getContext: () => contextRef.current,
      getHover: () => hoverRef.current,
      updateHover,
    });
  }, [active, camera, commitSnap, domElement, hidden, robot, sceneProjection, workspace]);

  return { hover, hoverRef };
}
