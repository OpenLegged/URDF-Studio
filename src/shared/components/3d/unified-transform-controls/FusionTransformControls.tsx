import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Html } from '@react-three/drei';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import { registerRegressionTransformGizmoSummaryProvider } from '@/shared/debug/regressionState';
import {
  GIZMO_ARC_RENDER_ORDER,
  resolveAttachedTransformControlObject,
  type SharedControlRef,
  type TransformControlObjectTarget,
} from './gizmoCore';
import { FUSION_ROTATE_ARC_RADIUS, resolveFusionTrackballQuaternion } from './fusionRotateGeometry';
import {
  getFusionTranslatePlaneAxes,
  resolveFusionTranslatePlanarDelta,
} from './fusionTranslatePlane';
import type {
  ActiveHandle,
  AxisName,
  DragState,
  FusionControlState,
  FusionHandleName,
  FusionOwner,
  FusionTransformControlsProps,
} from './FusionTransformControls.types';
import {
  AXES,
  AXIS_COLORS,
  TRANSLATE_PLANES,
  FUSION_PIVOT_COLOR,
  FUSION_PIVOT_OPACITY,
  FUSION_PIVOT_OUTLINE_COLOR,
  FUSION_PIVOT_OUTLINE_OPACITY,
  FUSION_PIVOT_OUTLINE_RADIUS,
  FUSION_PIVOT_RADIUS,
  ROTATE_DRAG_SECTOR_OPACITY,
} from './FusionTransformControls.constants';
import {
  applyTranslateGroupLayout,
  applyRotateGroupLayout,
  applyGuideGroupLayout,
  applyRotationSnap,
  applyTranslationSnap,
  clampObjectPosition,
  collectActiveHoverTargets,
  createFusionControlState,
  createRotateDragSectorGeometry,
  createScreenRay,
  dispatchControlEvent,
  formatDragReadout,
  getAxisVisible,
  getCameraRight,
  getCameraUp,
  getParentWorldQuaternionInv,
  getRotateFeedbackStartDirection,
  getSignedAngleAroundAxis,
  getWorldQuaternion,
  intersectRayWithPlane,
  isAxisName,
  objectBelongsToHandle,
  pointerStillHitsHandle,
  prepareFusionRootLayout,
  READOUT_NEUTRAL_COLOR,
  resolveLayoutQuaternion,
  resolveRotateDragSetup,
  resolveTranslateDragSetup,
  resolveWorldGizmoScale,
  setObjectWorldPosition,
  syncDefaultControlsSuppression,
  updateHoverScales,
  wrapAngleDelta,
} from './FusionTransformControls.utils';
import { summarizeFusionTransformGizmo } from './FusionTransformControls.regression';
import { TranslateAxisHandle } from './handles/TranslateAxisHandle';
import { RotateAxisHandle } from './handles/RotateAxisHandle';
import { RotateScreenRingHandle } from './handles/RotateScreenRingHandle';
import { RotateTrackballHandle } from './handles/RotateTrackballHandle';
import { TranslatePlaneHandle } from './handles/TranslatePlaneHandle';
import { TranslateCenterHandle } from './handles/TranslateCenterHandle';
import { TranslateGuideLine } from './handles/TranslateGuideLine';
import { RotateGuideRing } from './handles/RotateGuideRing';

export const FusionTransformControls = forwardRef<unknown, FusionTransformControlsProps>(
  function FusionTransformControls(
    {
      displayThicknessScale = 1,
      enableUniversalPriority: _enableUniversalPriority,
      enabled = true,
      hoverStyle: _hoverStyle,
      maxX,
      maxY,
      maxZ,
      minX,
      minY,
      minZ,
      mode,
      object,
      onChange,
      onDraggingChanged,
      onMouseDown,
      onMouseUp,
      onObjectChange,
      onRotateChange,
      rotateEnabled,
      rotateObject,
      rotateRef,
      rotateSize,
      rotateSpace,
      rotationSnap,
      showRotateFreeHandles = true,
      showX,
      showY,
      showZ,
      size,
      space = 'local',
      translateObject,
      translateSpace,
      translationSnap,
    },
    ref,
  ) {
    const camera = useThree((state) => state.camera);
    const defaultControls = useThree((state) => state.controls);
    const gl = useThree((state) => state.gl);
    const invalidate = useThree((state) => state.invalidate);
    const raycaster = useThree((state) => state.raycaster);
    const scene = useThree((state) => state.scene);

    const rootRef = useRef<THREE.Group>(null);
    const translateGroupRef = useRef<THREE.Group>(null);
    const rotateGroupRef = useRef<THREE.Group>(null);
    const guideGroupRef = useRef<THREE.Group>(null);
    const rotateDragSectorRef =
      useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
    const rotateDragSectorGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const rotateDragEmptyGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const rotateDragFeedbackStateRef = useRef<{
      axis: AxisName;
      startDirection: THREE.Vector3;
      rotationAngle: number;
    } | null>(null);
    const dragReadoutRef = useRef<HTMLDivElement>(null);
    const activeHandleRef = useRef<ActiveHandle | null>(null);
    const activeDragRef = useRef<DragState | null>(null);
    const defaultControlsSuppressedRef = useRef(false);
    const defaultControlsEnabledBeforeSuppressRef = useRef(true);
    const hoverRaycasterRef = useRef(new THREE.Raycaster());
    const translateControlRef = useRef<FusionControlState | null>(null);
    const rotateControlRef = useRef<FusionControlState | null>(null);
    const [activeHandle, setActiveHandleState] = useState<ActiveHandle | null>(null);

    if (!translateControlRef.current) {
      translateControlRef.current = createFusionControlState('translate');
    }
    if (!rotateControlRef.current) {
      rotateControlRef.current = createFusionControlState('rotate');
    }

    const translateControl = translateControlRef.current;
    const rotateControl = rotateControlRef.current;
    const activeDrag = activeDragRef.current;
    const hasActiveRotateDrag = activeDrag?.owner === 'rotate';
    const resolvedTranslateObject = translateObject ?? object;
    const resolvedRotateObject = rotateObject ?? object;
    const attachedTranslateObject =
      resolveAttachedTransformControlObject(
        scene,
        resolvedTranslateObject as TransformControlObjectTarget | undefined,
      ) ?? undefined;
    const attachedRotateObject =
      resolveAttachedTransformControlObject(
        scene,
        resolvedRotateObject as TransformControlObjectTarget | undefined,
      ) ?? undefined;
    const activeRotateDragObject = hasActiveRotateDrag ? activeDrag.object : undefined;
    const primaryObject =
      mode === 'rotate'
        ? (attachedRotateObject ?? activeRotateDragObject)
        : (attachedTranslateObject ?? activeRotateDragObject);
    const canRender =
      Boolean(primaryObject) &&
      (mode !== 'universal' || Boolean(attachedRotateObject) || hasActiveRotateDrag);

    useEffect(() => {
      if (!isRegressionDebugEnabled()) return undefined;

      return registerRegressionTransformGizmoSummaryProvider(() =>
        summarizeFusionTransformGizmo(rootRef.current, camera, gl.domElement),
      );
    }, [camera, gl.domElement]);

    const setActiveHandle = useCallback(
      (next: ActiveHandle | null) => {
        activeHandleRef.current = next;
        setActiveHandleState(next);

        translateControl.axis = next?.owner === 'translate' ? next.axis : null;
        rotateControl.axis = next?.owner === 'rotate' ? next.axis : null;

        dispatchControlEvent(translateControl, 'axis-changed', translateControl.axis);
        dispatchControlEvent(rotateControl, 'axis-changed', rotateControl.axis);

        const root = rootRef.current as
          | (THREE.Group & {
              activeOwner?: FusionOwner | null;
              axis?: FusionHandleName | null;
              dragging?: boolean;
            })
          | null;
        if (root) {
          root.activeOwner = next?.owner ?? null;
          root.axis = next?.axis ?? null;
          root.dragging = Boolean(activeDragRef.current);
        }
      },
      [rotateControl, translateControl],
    );

    const primaryControl = mode === 'rotate' ? rotateControl : translateControl;
    useImperativeHandle(ref, () => primaryControl, [primaryControl]);

    useEffect(() => {
      if (!rotateRef) return undefined;

      const mutableRef = rotateRef as SharedControlRef & {
        current: FusionControlState | null;
      };
      mutableRef.current = mode === 'universal' ? rotateControl : null;

      return () => {
        mutableRef.current = null;
      };
    }, [mode, rotateControl, rotateRef]);

    useEffect(() => {
      translateControl.camera = camera;
      translateControl.domElement = gl.domElement;
      translateControl.enabled = enabled && (mode === 'translate' || mode === 'universal');
      translateControl.mode = 'translate';
      translateControl.object = attachedTranslateObject;

      rotateControl.camera = camera;
      rotateControl.domElement = gl.domElement;
      rotateControl.enabled =
        (rotateEnabled ?? enabled) && (mode === 'rotate' || mode === 'universal');
      rotateControl.mode = 'rotate';
      rotateControl.object = attachedRotateObject;
    }, [
      attachedRotateObject,
      attachedTranslateObject,
      camera,
      enabled,
      gl.domElement,
      mode,
      rotateControl,
      rotateEnabled,
      translateControl,
    ]);

    const getRotateDragEmptyGeometry = useCallback(() => {
      if (!rotateDragEmptyGeometryRef.current) {
        rotateDragEmptyGeometryRef.current = new THREE.BufferGeometry();
      }
      return rotateDragEmptyGeometryRef.current;
    }, []);

    const hideRotateDragFeedback = useCallback(() => {
      const sector = rotateDragSectorRef.current;
      if (sector) {
        const emptyGeometry = getRotateDragEmptyGeometry();
        const previousGeometry = sector.geometry;
        sector.geometry = emptyGeometry;
        if (previousGeometry !== emptyGeometry) {
          previousGeometry.dispose();
        }
        sector.visible = false;
      }

      rotateDragSectorGeometryRef.current = null;
      rotateDragFeedbackStateRef.current = null;
    }, [getRotateDragEmptyGeometry]);

    const hideDragReadout = useCallback(() => {
      const element = dragReadoutRef.current;
      if (element) {
        element.style.display = 'none';
      }
    }, []);

    const updateDragReadout = useCallback((drag: DragState | null) => {
      const element = dragReadoutRef.current;
      if (!element) return;
      const readout = formatDragReadout(drag);
      if (!readout) {
        element.style.display = 'none';
        return;
      }
      element.textContent = readout.text;
      element.style.color = readout.color;
      element.style.display = 'block';
    }, []);

    const updateRotateDragFeedback = useCallback(
      (drag: DragState | null, active: ActiveHandle | null) => {
        if (
          !drag ||
          !active ||
          drag.owner !== 'rotate' ||
          active.owner !== 'rotate' ||
          !isAxisName(drag.axis) ||
          active.axis !== drag.axis
        ) {
          hideRotateDragFeedback();
          return;
        }

        const sector = rotateDragSectorRef.current;
        if (!sector) return;

        const axis = drag.axis;
        const rotationAngle = drag.rotationAngle;
        const startDirection = drag.rotationFeedbackStartDirection;
        const absAngle = Math.abs(rotationAngle);

        if (absAngle > 1e-5) {
          const previousState = rotateDragFeedbackStateRef.current;
          if (
            !previousState ||
            previousState.axis !== axis ||
            previousState.rotationAngle !== rotationAngle ||
            !previousState.startDirection.equals(startDirection)
          ) {
            const previousGeometry = sector.geometry;
            const nextGeometry = createRotateDragSectorGeometry({
              axisLocal: drag.axisLocal,
              rotationAngle,
              startDirection,
            });
            sector.geometry = nextGeometry;
            if (previousGeometry !== rotateDragEmptyGeometryRef.current) {
              previousGeometry.dispose();
            }
            rotateDragSectorGeometryRef.current = nextGeometry;
            rotateDragFeedbackStateRef.current = {
              axis,
              rotationAngle,
              startDirection: startDirection.clone(),
            };
          }
          sector.material.color.set(AXIS_COLORS[axis]);
          sector.material.opacity = ROTATE_DRAG_SECTOR_OPACITY;
          sector.visible = true;
        } else {
          const emptyGeometry = getRotateDragEmptyGeometry();
          const previousGeometry = sector.geometry;
          sector.geometry = emptyGeometry;
          if (previousGeometry !== emptyGeometry) {
            previousGeometry.dispose();
          }
          sector.visible = false;
          rotateDragSectorGeometryRef.current = null;
          rotateDragFeedbackStateRef.current = null;
        }
      },
      [getRotateDragEmptyGeometry, hideRotateDragFeedback],
    );

    useEffect(
      () => () => {
        rotateDragSectorGeometryRef.current?.dispose();
        rotateDragEmptyGeometryRef.current?.dispose();
      },
      [],
    );

    const restoreDefaultControls = useCallback(() => {
      if (
        defaultControls &&
        'enabled' in defaultControls &&
        typeof defaultControls.enabled === 'boolean' &&
        defaultControlsSuppressedRef.current
      ) {
        defaultControls.enabled = defaultControlsEnabledBeforeSuppressRef.current;
        defaultControlsSuppressedRef.current = false;
      }
    }, [defaultControls]);

    const suppressDefaultControls = useCallback(() => {
      if (
        !defaultControls ||
        !('enabled' in defaultControls) ||
        typeof defaultControls.enabled !== 'boolean'
      ) {
        return;
      }

      if (!defaultControlsSuppressedRef.current) {
        if (defaultControls.enabled) {
          defaultControlsEnabledBeforeSuppressRef.current = true;
        }
        defaultControlsSuppressedRef.current = true;
      }

      defaultControls.enabled = false;
    }, [defaultControls]);

    const clearActiveHandle = useCallback(() => {
      if (activeDragRef.current) return;
      setActiveHandle(null);
      restoreDefaultControls();
    }, [restoreDefaultControls, setActiveHandle]);

    const finishDrag = useCallback(
      (owner?: FusionOwner, pointer?: { button?: number }) => {
        const drag = activeDragRef.current;
        if (!drag || (owner && drag.owner !== owner)) return;
        if (pointer?.button !== undefined && pointer.button !== 0) return;

        drag.control.dragging = false;
        drag.control.axis = null;
        activeDragRef.current = null;
        hideRotateDragFeedback();
        hideDragReadout();
        setActiveHandle(null);
        restoreDefaultControls();
        dispatchControlEvent(drag.control, 'dragging-changed', false);
        dispatchControlEvent(drag.control, 'mouseUp');
        onDraggingChanged?.({ target: drag.control, value: false });
        (onMouseUp as ((event?: unknown) => void) | undefined)?.({
          mode: drag.control.mode,
          target: drag.control,
          type: 'mouseUp',
        });
        invalidate();
      },
      [
        hideRotateDragFeedback,
        hideDragReadout,
        invalidate,
        onDraggingChanged,
        onMouseUp,
        restoreDefaultControls,
        setActiveHandle,
      ],
    );

    useEffect(() => {
      translateControl.pointerUp = (pointer) => finishDrag('translate', pointer);
      rotateControl.pointerUp = (pointer) => finishDrag('rotate', pointer);
    }, [finishDrag, rotateControl, translateControl]);

    const emitObjectChange = useCallback(
      (control: FusionControlState) => {
        const event = { mode: control.mode, target: control, type: 'objectChange' };
        if (control.mode === 'rotate' && mode === 'universal') {
          (onRotateChange ?? onChange)?.(event as never);
        } else {
          onChange?.(event as never);
        }
        onObjectChange?.(event as never);
        invalidate();
      },
      [invalidate, mode, onChange, onObjectChange, onRotateChange],
    );

    const updateDragFromRay = useCallback(
      (ray: THREE.Ray) => {
        const drag = activeDragRef.current;
        if (!drag) return;

        const intersection = intersectRayWithPlane(ray, drag.plane);
        if (!intersection) return;

        if (drag.owner === 'translate') {
          let translationDelta: THREE.Vector3;
          if (drag.dragKind === 'plane' && drag.planeAxesWorld) {
            translationDelta = resolveFusionTranslatePlanarDelta({
              axesWorld: drag.planeAxesWorld,
              intersection,
              snap: translationSnap,
              startIntersection: drag.startIntersection,
            });
          } else if (drag.dragKind === 'center') {
            const rawDelta = intersection.clone().sub(drag.startIntersection);
            if (translationSnap && translationSnap > 0) {
              const rightDistance = applyTranslationSnap(
                rawDelta.dot(drag.cameraRightWorld),
                translationSnap,
              );
              const upDistance = applyTranslationSnap(
                rawDelta.dot(drag.cameraUpWorld),
                translationSnap,
              );
              translationDelta = drag.cameraRightWorld
                .clone()
                .multiplyScalar(rightDistance)
                .addScaledVector(drag.cameraUpWorld, upDistance);
            } else {
              translationDelta = rawDelta;
            }
          } else {
            const rawDistance = intersection
              .clone()
              .sub(drag.startIntersection)
              .dot(drag.axisWorld);
            const distance = applyTranslationSnap(rawDistance, translationSnap);
            drag.translationDistance = distance;
            translationDelta = drag.axisWorld.clone().multiplyScalar(distance);
          }

          const nextWorldPosition = drag.startWorldPosition.clone().add(translationDelta);

          setObjectWorldPosition(drag.object, nextWorldPosition);
          clampObjectPosition(drag.object, { maxX, maxY, maxZ, minX, minY, minZ });
          drag.object.updateMatrixWorld(true);
          emitObjectChange(drag.control);
          return;
        }

        if (drag.dragKind === 'trackball') {
          const deltaWorld = intersection.clone().sub(drag.startIntersection);
          drag.object.quaternion.copy(
            resolveFusionTrackballQuaternion({
              cameraRightWorld: drag.cameraRightWorld,
              cameraUpWorld: drag.cameraUpWorld,
              deltaWorld,
              parentWorldQuaternionInv: drag.parentWorldQuaternionInv,
              radius: FUSION_ROTATE_ARC_RADIUS,
              startQuaternion: drag.startQuaternion,
            }),
          );
          drag.rotationAngle = deltaWorld.length() / Math.max(FUSION_ROTATE_ARC_RADIUS, 1e-6);
          drag.object.updateMatrixWorld(true);
          emitObjectChange(drag.control);
          return;
        }

        const nextDirection = intersection.clone().sub(drag.startWorldPosition);
        if (nextDirection.lengthSq() < 1e-8) return;
        nextDirection.normalize();

        const rawAngle = getSignedAngleAroundAxis(
          drag.startDirection,
          nextDirection,
          drag.axisWorld,
        );
        drag.accumulatedAngle += wrapAngleDelta(rawAngle - drag.prevRawAngle);
        drag.prevRawAngle = rawAngle;
        const angle = applyRotationSnap(drag.accumulatedAngle, rotationSnap);
        drag.rotationAngle = angle;

        if (drag.space === 'local') {
          drag.object.quaternion
            .copy(drag.startQuaternion)
            .multiply(new THREE.Quaternion().setFromAxisAngle(drag.axisLocal, angle))
            .normalize();
        } else {
          const parentAxis = drag.axisWorld
            .clone()
            .applyQuaternion(drag.parentWorldQuaternionInv)
            .normalize();
          drag.object.quaternion
            .copy(new THREE.Quaternion().setFromAxisAngle(parentAxis, angle))
            .multiply(drag.startQuaternion)
            .normalize();
        }

        drag.object.updateMatrixWorld(true);
        emitObjectChange(drag.control);
      },
      [emitObjectChange, maxX, maxY, maxZ, minX, minY, minZ, rotationSnap, translationSnap],
    );

    const getOwnerObject = useCallback(
      (owner: FusionOwner) =>
        owner === 'translate' ? attachedTranslateObject : attachedRotateObject,
      [attachedRotateObject, attachedTranslateObject],
    );

    const getOwnerSpace = useCallback(
      (owner: FusionOwner): 'local' | 'world' => {
        const resolvedSpace =
          owner === 'translate' ? (translateSpace ?? space) : (rotateSpace ?? space);
        return resolvedSpace === 'world' ? 'world' : 'local';
      },
      [rotateSpace, space, translateSpace],
    );

    const isOwnerEnabled = useCallback(
      (owner: FusionOwner) => {
        if (!enabled) return false;
        if (owner === 'translate') return mode === 'translate' || mode === 'universal';
        if (mode !== 'rotate' && mode !== 'universal') return false;
        return rotateEnabled ?? enabled;
      },
      [enabled, mode, rotateEnabled],
    );

    const beginDrag = useCallback(
      (owner: FusionOwner, axis: FusionHandleName, ray: THREE.Ray, pointerId: number) => {
        if (!isOwnerEnabled(owner)) return;

        const objectToTransform = getOwnerObject(owner);
        if (!objectToTransform) return;

        objectToTransform.updateMatrixWorld(true);
        const startWorldPosition = new THREE.Vector3();
        objectToTransform.getWorldPosition(startWorldPosition);

        const ownerSpace = getOwnerSpace(owner);
        const startWorldQuaternion = getWorldQuaternion(objectToTransform);
        const cameraRightWorld = getCameraRight(camera);
        const cameraUpWorld = getCameraUp(camera);
        const dragSetup =
          owner === 'translate'
            ? resolveTranslateDragSetup({
                axis,
                camera,
                ownerSpace,
                startWorldPosition,
                startWorldQuaternion,
              })
            : resolveRotateDragSetup({
                axis,
                camera,
                mode,
                ownerSpace,
                startWorldPosition,
                startWorldQuaternion,
              });
        if (!dragSetup) return;

        const {
          axisLocal,
          axisWorld,
          dragKind,
          ownerSpace: resolvedOwnerSpace,
          plane,
          planeAxesWorld,
        } = dragSetup;
        const startIntersection = intersectRayWithPlane(ray, plane);
        if (!startIntersection) return;

        const startDirection = startIntersection.clone().sub(startWorldPosition);
        if (owner === 'rotate' && dragKind !== 'trackball') {
          if (startDirection.lengthSq() < 1e-8) return;
          startDirection.normalize();
        }

        const control = owner === 'translate' ? translateControl : rotateControl;
        const otherControl = owner === 'translate' ? rotateControl : translateControl;
        otherControl.dragging = false;
        otherControl.axis = null;
        control.dragging = true;
        control.axis = axis;

        const guideQuaternion =
          owner === 'rotate' && isAxisName(axis) && resolvedOwnerSpace === 'local'
            ? startWorldQuaternion.clone()
            : new THREE.Quaternion();
        const rotationFeedbackStartDirection =
          owner === 'rotate' && isAxisName(axis)
            ? getRotateFeedbackStartDirection({
                axisLocal,
                guideQuaternion,
                startDirection,
              })
            : new THREE.Vector3(1, 0, 0);

        const nextDrag: DragState = {
          axis,
          axisLocal,
          axisWorld,
          cameraRightWorld,
          cameraUpWorld,
          control,
          dragKind,
          object: objectToTransform,
          owner,
          parentWorldQuaternionInv: getParentWorldQuaternionInv(objectToTransform),
          plane,
          planeAxesWorld,
          pointerId,
          accumulatedAngle: 0,
          guideQuaternion,
          prevRawAngle: 0,
          rotationAngle: 0,
          rotationFeedbackStartDirection,
          space: resolvedOwnerSpace,
          startDirection,
          startIntersection,
          startPosition: objectToTransform.position.clone(),
          startQuaternion: objectToTransform.quaternion.clone(),
          startWorldPosition,
          translationDistance: 0,
        };

        activeDragRef.current = nextDrag;
        setActiveHandle({ owner, axis });
        suppressDefaultControls();
        dispatchControlEvent(control, 'mouseDown');
        dispatchControlEvent(control, 'dragging-changed', true);
        (onMouseDown as ((event?: unknown) => void) | undefined)?.({
          mode: control.mode,
          target: control,
          type: 'mouseDown',
        });
        onDraggingChanged?.({ target: control, value: true });
        invalidate();
      },
      [
        camera,
        getOwnerObject,
        getOwnerSpace,
        invalidate,
        isOwnerEnabled,
        mode,
        onDraggingChanged,
        onMouseDown,
        rotateControl,
        setActiveHandle,
        suppressDefaultControls,
        translateControl,
      ],
    );

    const handlePointerOver = useCallback(
      (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: FusionHandleName) => {
        if (activeDragRef.current || !isOwnerEnabled(owner)) return;

        event.stopPropagation();
        setActiveHandle({ owner, axis });
        suppressDefaultControls();
      },
      [isOwnerEnabled, setActiveHandle, suppressDefaultControls],
    );

    const handlePointerOut = useCallback(
      (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: FusionHandleName) => {
        const active = activeHandleRef.current;
        if (!active || active.owner !== owner || active.axis !== axis) return;
        if (pointerStillHitsHandle(event, owner, axis)) return;
        clearActiveHandle();
      },
      [clearActiveHandle],
    );

    const handlePointerDown = useCallback(
      (event: ThreeEvent<PointerEvent>, owner: FusionOwner, axis: FusionHandleName) => {
        if (event.button !== 0) {
          clearActiveHandle();
          return;
        }

        if (!isOwnerEnabled(owner)) return;

        event.stopPropagation();
        (event.target as Element).setPointerCapture?.(event.pointerId);
        beginDrag(owner, axis, event.ray.clone(), event.pointerId);
      },
      [beginDrag, clearActiveHandle, isOwnerEnabled],
    );

    useEffect(() => {
      const handlePointerMove = (event: PointerEvent) => {
        const drag = activeDragRef.current;
        if (!drag) {
          const active = activeHandleRef.current;
          if (!active) return;

          const hoverRaycaster = hoverRaycasterRef.current;
          const ray = createScreenRay(event, gl.domElement, camera, hoverRaycaster);
          if (!ray) {
            clearActiveHandle();
            return;
          }

          hoverRaycaster.ray.copy(ray);
          const activeTargets = collectActiveHoverTargets(rootRef.current, active);
          const stillHitsActiveHandle = hoverRaycaster
            .intersectObjects(activeTargets, false)
            .some((intersection) =>
              objectBelongsToHandle(intersection.object, active.owner, active.axis),
            );
          if (!stillHitsActiveHandle) {
            clearActiveHandle();
          }
          return;
        }

        if (event.pointerId !== drag.pointerId) return;

        const ray = createScreenRay(event, gl.domElement, camera, raycaster);
        if (!ray) return;

        updateDragFromRay(ray);
      };

      const handlePointerUp = (event: PointerEvent) => {
        const drag = activeDragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        finishDrag(drag.owner, { button: event.button });
      };

      const handleBlur = () => finishDrag();

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
      window.addEventListener('blur', handleBlur);

      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
        window.removeEventListener('blur', handleBlur);
      };
    }, [camera, clearActiveHandle, finishDrag, gl.domElement, raycaster, updateDragFromRay]);

    useEffect(() => {
      const domElement = (
        defaultControls as
          | {
              domElement?: HTMLElement;
            }
          | null
          | undefined
      )?.domElement;
      if (!domElement) return undefined;

      const handleOrbitIntentCapture = (event: PointerEvent) => {
        if (event.button === 0) return;
        clearActiveHandle();
        restoreDefaultControls();
      };

      domElement.addEventListener('pointerdown', handleOrbitIntentCapture, true);
      return () => {
        domElement.removeEventListener('pointerdown', handleOrbitIntentCapture, true);
      };
    }, [clearActiveHandle, defaultControls, restoreDefaultControls]);

    useEffect(() => {
      if (enabled) return;
      finishDrag();
      clearActiveHandle();
    }, [clearActiveHandle, enabled, finishDrag]);

    const finishDragOnUnmountRef = useRef(finishDrag);
    const restoreDefaultControlsOnUnmountRef = useRef(restoreDefaultControls);

    useEffect(() => {
      finishDragOnUnmountRef.current = finishDrag;
      restoreDefaultControlsOnUnmountRef.current = restoreDefaultControls;
    }, [finishDrag, restoreDefaultControls]);

    useEffect(() => () => {
      finishDragOnUnmountRef.current();
      restoreDefaultControlsOnUnmountRef.current();
    }, []);

    const applyControlLayout = useCallback(() => {
      const root = rootRef.current as
        | import('./FusionTransformControls.types').FusionRootGroup
        | null;
      const activeDrag = activeDragRef.current;
      const activeHandle = activeHandleRef.current;
      const origin = prepareFusionRootLayout({
        activeDrag,
        activeHandle,
        canRender,
        primaryObject,
        root,
      });
      if (!origin || !root || !primaryObject) {
        hideRotateDragFeedback();
        hideDragReadout();
        return;
      }

      const activeRotateDrag = activeDrag?.owner === 'rotate' ? activeDrag : null;
      const translateQuaternion = resolveLayoutQuaternion({
        object: attachedTranslateObject,
        primaryObject,
        space: (translateSpace ?? space) === 'world' ? 'world' : 'local',
      });
      const rotateQuaternion = resolveLayoutQuaternion({
        object: attachedRotateObject,
        primaryObject,
        space: (rotateSpace ?? space) === 'world' ? 'world' : 'local',
      });
      const effectiveRotateQuaternion = activeRotateDrag?.guideQuaternion ?? rotateQuaternion;

      const translateScale = resolveWorldGizmoScale(size ?? 1);
      const rotateScale = resolveWorldGizmoScale(rotateSize ?? size ?? 1);

      applyTranslateGroupLayout({
        group: translateGroupRef.current,
        mode,
        scale: translateScale,
        translateQuaternion,
      });
      applyRotateGroupLayout({
        camera,
        group: rotateGroupRef.current,
        mode,
        origin,
        rotateQuaternion: effectiveRotateQuaternion,
        scale: rotateScale,
      });
      applyGuideGroupLayout({
        active: activeHandle,
        effectiveRotateQuaternion,
        guideGroup: guideGroupRef.current,
        rotateScale,
        translateQuaternion,
        translateScale,
      });
      updateRotateDragFeedback(activeDrag, activeHandle);
      updateDragReadout(activeDrag);
      updateHoverScales(root, activeHandle);
      syncDefaultControlsSuppression({
        hasPointerIntent: Boolean(activeDrag || activeHandle),
        restoreDefaultControls,
        suppressDefaultControls,
      });

      root.visible = true;
      root.updateMatrixWorld(true);
    }, [
      attachedRotateObject,
      attachedTranslateObject,
      camera,
      canRender,
      mode,
      primaryObject,
      restoreDefaultControls,
      rotateSize,
      rotateSpace,
      hideRotateDragFeedback,
      hideDragReadout,
      size,
      space,
      suppressDefaultControls,
      translateSpace,
      updateRotateDragFeedback,
      updateDragReadout,
    ]);

    useLayoutEffect(() => {
      applyControlLayout();
      invalidate();
    });

    useFrame(() => {
      applyControlLayout();
    }, 1100);

    if (!canRender || mode === 'scale') {
      return null;
    }

    const visibleAxes = AXES.filter((axis) => getAxisVisible(axis, { showX, showY, showZ }));
    const visibleTranslatePlanes = TRANSLATE_PLANES.filter((plane) =>
      getFusionTranslatePlaneAxes(plane).every((axis) => visibleAxes.includes(axis)),
    );
    const activeAxis = isAxisName(activeHandle?.axis) ? activeHandle.axis : 'X';
    const showTranslateAxes = mode === 'translate' || mode === 'universal';
    const showTranslatePlanes = mode === 'translate';
    const showTranslateCenter = mode === 'translate';
    const showRotateAxes = mode === 'rotate' || mode === 'universal';
    const showRotateScreenRing = mode === 'rotate' && showRotateFreeHandles;
    const showRotateTrackball = mode === 'rotate' && showRotateFreeHandles;

    return (
      <group
        ref={rootRef}
        name="fusion-transform-controls"
        visible={false}
        userData={{ isGizmo: true }}
      >
        <group ref={guideGroupRef} name="fusion-transform-guide" visible={false}>
          {activeHandle?.owner === 'rotate' ? (
            <RotateGuideRing axis={activeAxis} />
          ) : (
            <TranslateGuideLine axis={activeAxis} />
          )}
          <mesh
            ref={rotateDragSectorRef}
            frustumCulled={false}
            name="rotate-drag-angle-sector"
            raycast={() => null}
            renderOrder={GIZMO_ARC_RENDER_ORDER + 2}
            visible={false}
          >
            <meshBasicMaterial
              color={AXIS_COLORS[activeAxis]}
              depthTest={false}
              depthWrite={false}
              opacity={ROTATE_DRAG_SECTOR_OPACITY}
              side={THREE.DoubleSide}
              toneMapped={false}
              transparent
            />
          </mesh>
        </group>

        <Html center position={[0, 0, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[60, 0]}>
          <div
            ref={dragReadoutRef}
            style={{
              display: 'none',
              transform: 'translateY(-78px)',
              padding: '3px 10px',
              borderRadius: '8px',
              background: 'rgba(15, 20, 28, 0.86)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
              color: READOUT_NEUTRAL_COLOR,
              font: '600 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        </Html>

        <group ref={translateGroupRef} name="fusion-transform-translate">
          {showTranslateAxes
            ? visibleAxes.map((axis) => (
                <TranslateAxisHandle
                  key={`translate-${axis}`}
                  active={activeHandle?.owner === 'translate' && activeHandle.axis === axis}
                  axis={axis}
                  onPointerDown={handlePointerDown}
                  onPointerOut={handlePointerOut}
                  onPointerOver={handlePointerOver}
                  thicknessScale={displayThicknessScale}
                />
              ))
            : null}
          {showTranslatePlanes
            ? visibleTranslatePlanes.map((plane) => (
                <TranslatePlaneHandle
                  key={`translate-plane-${plane}`}
                  active={activeHandle?.owner === 'translate' && activeHandle.axis === plane}
                  onPointerDown={handlePointerDown}
                  onPointerOut={handlePointerOut}
                  onPointerOver={handlePointerOver}
                  plane={plane}
                />
              ))
            : null}
          {showTranslateCenter ? (
            <TranslateCenterHandle
              active={activeHandle?.owner === 'translate' && activeHandle.axis === 'XYZ'}
              onPointerDown={handlePointerDown}
              onPointerOut={handlePointerOut}
              onPointerOver={handlePointerOver}
            />
          ) : null}
        </group>

        <group ref={rotateGroupRef} name="fusion-transform-rotate">
          {mode === 'universal' || mode === 'rotate' ? (
            <group name="fusion-transform-pivot">
              <mesh
                frustumCulled={false}
                name="transform-pivot-outline"
                raycast={() => null}
                renderOrder={GIZMO_ARC_RENDER_ORDER + 6}
              >
                <sphereGeometry args={[FUSION_PIVOT_OUTLINE_RADIUS, 20, 14]} />
                <meshBasicMaterial
                  color={FUSION_PIVOT_OUTLINE_COLOR}
                  depthTest={false}
                  depthWrite={false}
                  opacity={FUSION_PIVOT_OUTLINE_OPACITY}
                  toneMapped={false}
                  transparent
                />
              </mesh>
              <mesh
                frustumCulled={false}
                name="transform-pivot-core"
                raycast={() => null}
                renderOrder={GIZMO_ARC_RENDER_ORDER + 7}
              >
                <sphereGeometry args={[FUSION_PIVOT_RADIUS, 20, 14]} />
                <meshBasicMaterial
                  color={FUSION_PIVOT_COLOR}
                  depthTest={false}
                  depthWrite={false}
                  opacity={FUSION_PIVOT_OPACITY}
                  toneMapped={false}
                  transparent
                />
              </mesh>
            </group>
          ) : null}
          {showRotateAxes
            ? visibleAxes.map((axis) => (
                <RotateAxisHandle
                  key={`rotate-${axis}`}
                  active={activeHandle?.owner === 'rotate' && activeHandle.axis === axis}
                  axis={axis}
                  onPointerDown={handlePointerDown}
                  onPointerOut={handlePointerOut}
                  onPointerOver={handlePointerOver}
                  thicknessScale={displayThicknessScale}
                />
              ))
            : null}
          {showRotateScreenRing ? (
            <RotateScreenRingHandle
              active={activeHandle?.owner === 'rotate' && activeHandle.axis === 'E'}
              onPointerDown={handlePointerDown}
              onPointerOut={handlePointerOut}
              onPointerOver={handlePointerOver}
              thicknessScale={displayThicknessScale}
            />
          ) : null}
          {showRotateTrackball ? (
            <RotateTrackballHandle
              active={activeHandle?.owner === 'rotate' && activeHandle.axis === 'XYZE'}
              onPointerDown={handlePointerDown}
              onPointerOut={handlePointerOut}
              onPointerOver={handlePointerOver}
            />
          ) : null}
        </group>
      </group>
    );
  },
);
