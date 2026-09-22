import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { InteractionSelection } from '@/types';
import type { ViewerSceneMode } from '@/shared/components/3d/robot/types';
import {
  resolveCameraAutoFrameScopeKey,
  shouldAutoFrameRobotChange,
} from '@/shared/components/3d/robot/utils/cameraAutoFrame';
import {
  computeCameraFrame,
  computeVisibleBounds,
  createCameraFrameStabilityKey,
} from '@/shared/components/3d/robot/utils/cameraFrame';
import { getSyntheticGeomParentName, resolveRuntimeGeometryRoot } from '@/shared/components/3d/runtimeGeometrySelection';
import { scheduleStabilizedAutoFrame } from '@/shared/components/3d/robot/utils/stabilizedAutoFrame';

export interface UseCameraFocusOptions {
  robot: THREE.Object3D | null;
  focusTarget: string | null | undefined;
  selection?: InteractionSelection | undefined;
  mode?: ViewerSceneMode;
  autoFrameOnRobotChange?: boolean;
  autoFrameScopeKey?: string | null;
  active?: boolean;
}

function collectLinkBodies(
  linkObject: THREE.Object3D,
  subType: 'visual' | 'collision',
): THREE.Object3D[] {
  const isMatchingBody = (child: THREE.Object3D) =>
    subType === 'collision'
      ? Boolean((child as any).isURDFCollider)
      : Boolean((child as any).isURDFVisual);

  const directBodies = linkObject.children.filter(isMatchingBody);
  if (directBodies.length > 0) {
    return directBodies;
  }

  const nestedBodies: THREE.Object3D[] = [];
  linkObject.traverse((child) => {
    if (child !== linkObject && isMatchingBody(child)) {
      nestedBodies.push(child);
    }
  });

  return nestedBodies;
}

function resolveFocusObject(
  robot: THREE.Object3D,
  focusTarget: string,
  selection?: InteractionSelection | undefined,
): THREE.Object3D | null {
  if (selection?.type === 'link' && selection.id === focusTarget && selection.subType) {
    const runtimeLinkCandidates = [selection.id, getSyntheticGeomParentName(selection.id)].filter(
      (candidate): candidate is string => Boolean(candidate),
    );
    const linkObject = runtimeLinkCandidates
      .map((candidate) => (robot as any).links?.[candidate] as THREE.Object3D | undefined)
      .find((candidate): candidate is THREE.Object3D => Boolean(candidate));
    if (linkObject) {
      const targetGeometryRoot = resolveRuntimeGeometryRoot(
        linkObject,
        selection.id,
        selection.subType,
        selection.objectIndex ?? 0,
      );
      if (targetGeometryRoot) {
        return targetGeometryRoot;
      }

      const targetBodies = collectLinkBodies(linkObject, selection.subType);
      const objectIndex = selection.objectIndex ?? 0;
      return targetBodies[objectIndex] ?? targetBodies[0] ?? null;
    }
  }

  if ((robot as any).links?.[focusTarget]) {
    return (robot as any).links[focusTarget] as THREE.Object3D;
  }

  if ((robot as any).joints?.[focusTarget]) {
    return (robot as any).joints[focusTarget] as THREE.Object3D;
  }

  return robot.getObjectByName(focusTarget) ?? null;
}

export function useCameraFocus({
  robot,
  focusTarget,
  selection,
  mode,
  autoFrameOnRobotChange = false,
  autoFrameScopeKey,
  active = true,
}: UseCameraFocusOptions): void {
  const { camera, controls, invalidate } = useThree();
  const controlsWithTarget = controls as unknown as {
    target: THREE.Vector3;
    update: () => void;
    addEventListener?: (type: 'start', listener: () => void) => void;
    removeEventListener?: (type: 'start', listener: () => void) => void;
  } | null;

  const focusTargetRef = useRef<THREE.Vector3 | null>(null);
  const cameraTargetPosRef = useRef<THREE.Vector3 | null>(null);
  const isFocusingRef = useRef(false);
  const previousCameraPositionRef = useRef(new THREE.Vector3());
  const previousOrbitTargetRef = useRef(new THREE.Vector3());
  const autoFramedScopeKeyRef = useRef<string | null>(null);
  const userInterruptedAutoFrameRef = useRef(false);
  const [focusTargetHasVisibleBounds, setFocusTargetHasVisibleBounds] = useState<boolean | null>(
    null,
  );
  const currentAutoFrameScopeKey = robot
    ? resolveCameraAutoFrameScopeKey(autoFrameScopeKey, robot.uuid)
    : null;
  const resolvedFocusObject = useMemo(() => {
    if (!robot || !focusTarget) return null;
    return resolveFocusObject(robot, focusTarget, selection);
  }, [focusTarget, robot, selection]);

  const cancelFocusAnimation = useCallback(() => {
    isFocusingRef.current = false;
    focusTargetRef.current = null;
    cameraTargetPosRef.current = null;
  }, []);

  const frameObject = useCallback(
    (targetObj: THREE.Object3D, bounds?: THREE.Box3 | null) => {
      if (!controlsWithTarget) return false;

      const frame = computeCameraFrame(targetObj, camera, controlsWithTarget.target, bounds);
      if (!frame) return false;

      focusTargetRef.current = frame.focusTarget;
      cameraTargetPosRef.current = frame.cameraPosition;
      isFocusingRef.current = true;
      invalidate();
      return true;
    },
    [camera, controlsWithTarget, invalidate],
  );

  useEffect(() => {
    if (active) {
      return;
    }

    cancelFocusAnimation();
  }, [active, cancelFocusAnimation]);

  useEffect(() => {
    if (!controlsWithTarget) return;

    // When the user starts orbiting, camera animation must yield immediately.
    const handleControlStart = () => {
      userInterruptedAutoFrameRef.current = true;
      cancelFocusAnimation();
    };

    controlsWithTarget.addEventListener?.('start', handleControlStart);

    return () => {
      controlsWithTarget.removeEventListener?.('start', handleControlStart);
    };
  }, [cancelFocusAnimation, controlsWithTarget]);

  // Handle focus target change
  useEffect(() => {
    if (!active) return;
    if (!focusTarget || !robot || !resolvedFocusObject) {
      setFocusTargetHasVisibleBounds(null);
      return;
    }

    const focusBounds = computeVisibleBounds(resolvedFocusObject);
    const hasVisibleBounds = Boolean(focusBounds && !focusBounds.isEmpty());
    setFocusTargetHasVisibleBounds(hasVisibleBounds);
    if (!hasVisibleBounds) {
      return;
    }

    frameObject(resolvedFocusObject, focusBounds);
  }, [active, focusTarget, frameObject, resolvedFocusObject, robot]);

  useEffect(() => {
    if (!active) return;
    if (!robot) return;
    const focusBlocksAutoFrame = Boolean(
      focusTarget && resolvedFocusObject && focusTargetHasVisibleBounds !== false,
    );
    if (
      !shouldAutoFrameRobotChange({
        autoFrameOnRobotChange,
        currentScopeKey: currentAutoFrameScopeKey,
        lastAutoFramedScopeKey: autoFramedScopeKeyRef.current,
        focusTarget: focusBlocksAutoFrame ? focusTarget : null,
        mode,
        active,
      })
    ) {
      return;
    }

    autoFramedScopeKeyRef.current = currentAutoFrameScopeKey;
    userInterruptedAutoFrameRef.current = false;

    return scheduleStabilizedAutoFrame({
      sample: () => {
        const bounds = computeVisibleBounds(robot);
        return {
          stabilityKey: createCameraFrameStabilityKey(bounds),
          state: bounds,
        };
      },
      applyFrame: ({ state }) => {
        if (
          (resolvedFocusObject && focusTargetHasVisibleBounds !== false) ||
          userInterruptedAutoFrameRef.current
        ) {
          return false;
        }

        return frameObject(robot, state);
      },
      isActive: () =>
        active &&
        (!resolvedFocusObject || focusTargetHasVisibleBounds === false) &&
        !userInterruptedAutoFrameRef.current,
      delays: [0, 96, 224],
    });
  }, [
    active,
    autoFrameOnRobotChange,
    currentAutoFrameScopeKey,
    focusTarget,
    focusTargetHasVisibleBounds,
    frameObject,
    mode,
    resolvedFocusObject,
    robot,
  ]);

  // Animate camera focus
  useFrame((state, delta) => {
    void state;
    if (!active) return;

    if (
      isFocusingRef.current &&
      focusTargetRef.current &&
      cameraTargetPosRef.current &&
      controlsWithTarget
    ) {
      const orbitControls = controlsWithTarget;
      const step = Math.min(1, 5 * delta);
      const previousCameraPosition = previousCameraPositionRef.current.copy(camera.position);
      const previousOrbitTarget = previousOrbitTargetRef.current.copy(orbitControls.target);

      orbitControls.target.lerp(focusTargetRef.current, step);
      camera.position.lerp(cameraTargetPosRef.current, step);
      orbitControls.update();
      invalidate();

      // Orbit limits can make the requested position unreachable. Preserve the
      // existing animation path, but stop when the constrained pose stops
      // changing, allowing only floating-point roundoff at the scene's scale.
      const settledTolerance = 32 * Number.EPSILON * Math.max(
        1, camera.position.length(), orbitControls.target.length(),
      );
      const constrainedPoseSettled = step > 0
        && camera.position.distanceToSquared(previousCameraPosition) <= settledTolerance ** 2
        && orbitControls.target.distanceToSquared(previousOrbitTarget) <= settledTolerance ** 2;

      if (
        constrainedPoseSettled || (
          camera.position.distanceTo(cameraTargetPosRef.current) < 0.01 &&
          orbitControls.target.distanceTo(focusTargetRef.current) < 0.01
        )
      ) {
        isFocusingRef.current = false;
      }
    }
  });
}
