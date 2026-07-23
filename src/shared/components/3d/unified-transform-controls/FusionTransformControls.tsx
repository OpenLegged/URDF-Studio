import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Html } from '@react-three/drei';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { isRegressionDebugEnabled } from '@/shared/debug/regressionDebugEnabled';
import {
  registerRegressionTransformGizmoSummaryProvider,
  type RegressionTransformGizmoSummary,
} from '@/shared/debug/regressionState';
import {
  GIZMO_ARC_RENDER_ORDER,
  THICK_ROTATE_ARC_RADIUS,
  THICK_TRANSLATE_PICKER_RADIUS,
  THICK_TRANSLATE_SHAFT_RADIUS,
  TRANSLATE_CENTER_GAP,
  resolveAttachedTransformControlObject,
  type SharedControlRef,
  type TransformControlObjectTarget,
  type UnifiedTransformControlsProps,
} from './gizmoCore';
import {
  FUSION_ROTATE_ARC_RADIUS,
  FUSION_ROTATE_E_RING_RADIUS,
  FUSION_ROTATE_TRACKBALL_RADIUS,
  createFusionRotateFrontArcGeometry,
  createFusionRotateFullRingGeometry,
  getFusionRotateArcPoint,
  getFusionRotateFrontArcCenterAngle,
  getFusionRotateFrontArcQuaternion,
  getFusionRotateScreenQuaternion,
  resolveFusionTrackballQuaternion,
} from './fusionRotateGeometry';
import { resolveFusionTranslateShaftStart } from './fusionRotateKnob';
import {
  FUSION_TRANSLATE_CENTER_PICKER_RADIUS,
  FUSION_TRANSLATE_CENTER_RADIUS,
  FUSION_TRANSLATE_PLANE_PICKER_SCALE,
  type FusionTranslatePlaneName,
  createFusionTranslatePlaneGeometry,
  createFusionTranslatePlaneOutlineGeometry,
  getFusionTranslateAxisUnit,
  getFusionTranslateCenterDragPlane,
  getFusionTranslatePlaneAxes,
  getFusionTranslatePlaneDragPlane,
  getFusionTranslatePlaneNormalAxis,
  resolveFusionTranslatePlanarDelta,
} from './fusionTranslatePlane';

type AxisName = 'X' | 'Y' | 'Z';
type FusionOwner = 'translate' | 'rotate';
type RotateHandleName = AxisName | 'E' | 'XYZE';
type TranslateHandleName = AxisName | FusionTranslatePlaneName | 'XYZ';
type FusionHandleName = RotateHandleName | TranslateHandleName;
type DragKind = 'axis' | 'plane' | 'center' | 'trackball';

type ActiveHandle = {
  owner: FusionOwner;
  axis: FusionHandleName;
};

type FusionControlState = THREE.EventDispatcher & {
  axis: FusionHandleName | null;
  camera: THREE.Camera | null;
  domElement: HTMLElement | null;
  dragging: boolean;
  enabled: boolean;
  mode: FusionOwner;
  object: THREE.Object3D | undefined;
  pointerUp: (pointer?: { button?: number }) => void;
  userData: Record<string, unknown>;
};

type FusionTransformControlsProps = Omit<UnifiedTransformControlsProps, 'onObjectChange'> & {
  maxX?: number;
  maxY?: number;
  maxZ?: number;
  minX?: number;
  minY?: number;
  minZ?: number;
  onObjectChange?: UnifiedTransformControlsProps['onObjectChange'];
  rotationSnap?: number | null;
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  translationSnap?: number | null;
};

type DragState = {
  axis: FusionHandleName;
  axisLocal: THREE.Vector3;
  axisWorld: THREE.Vector3;
  cameraRightWorld: THREE.Vector3;
  cameraUpWorld: THREE.Vector3;
  control: FusionControlState;
  dragKind: DragKind;
  object: THREE.Object3D;
  owner: FusionOwner;
  parentWorldQuaternionInv: THREE.Quaternion;
  plane: THREE.Plane;
  planeAxesWorld: [THREE.Vector3, THREE.Vector3] | null;
  pointerId: number;
  accumulatedAngle: number;
  guideQuaternion: THREE.Quaternion;
  prevRawAngle: number;
  rotationAngle: number;
  rotationFeedbackStartDirection: THREE.Vector3;
  space: 'local' | 'world';
  startDirection: THREE.Vector3;
  startIntersection: THREE.Vector3;
  startPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  startWorldPosition: THREE.Vector3;
  translationDistance: number;
};

type DragSetup = {
  axisLocal: THREE.Vector3;
  axisWorld: THREE.Vector3;
  dragKind: DragKind;
  ownerSpace: 'local' | 'world';
  plane: THREE.Plane;
  planeAxesWorld: [THREE.Vector3, THREE.Vector3] | null;
};

type FusionRootGroup = THREE.Group & {
  activeOwner?: FusionOwner | null;
  axis?: FusionHandleName | null;
  dragging?: boolean;
};

const AXES = ['X', 'Y', 'Z'] as const;
const TRANSLATE_PLANES = ['XY', 'YZ', 'XZ'] as const;
const AXIS_COLORS: Record<AxisName, string> = {
  X: '#ff4d5d',
  Y: '#45c95a',
  Z: '#2d8cff',
};
const ACTIVE_AXIS_COLOR = '#ff9500';
const ROTATE_GUIDE_RING_OPACITY = 0.28;
const ROTATE_FRONT_ARC_OPACITY = 0.95;
const ROTATE_E_RING_COLOR = '#f7f9ff';
const ROTATE_E_RING_OPACITY = 0.9;
const ROTATE_TRACKBALL_COLOR = '#f9fbff';
const ROTATE_TRACKBALL_OPACITY = 0.74;
const TRANSLATE_PLANE_OPACITY = 0.28;
const TRANSLATE_PLANE_ACTIVE_OPACITY = 0.42;
const TRANSLATE_CENTER_COLOR = '#f9fbff';
const TRANSLATE_CENTER_OPACITY = 0.86;
// Hover feedback is color-only (CAD convention: AutoCAD / 3ds Max / Blender
// highlight the hovered handle via ACTIVE_AXIS_COLOR, they never grow/scale the
// geometry). Keeping the target at 1 makes the hover-scale machinery a no-op so
// handles — especially the large screen-facing E-ring — no longer "move/grow"
// under the pointer.
const HOVER_TARGET_SCALE = 1;
const HOVER_SCALE_LERP = 0.26;
const FUSION_TRANSLATE_SHAFT_END = 0.9;
const FUSION_TRANSLATE_ARROW_LENGTH = 0.22;
const FUSION_TRANSLATE_ARROW_BASE_RADIUS = 0.052;
const FUSION_TRANSLATE_PICKER_START_PADDING = 0.035;
// Always-on pivot marker so the user can clearly see the transform center in
// universal / rotate modes (CAD/Blender convention: a small bright dot with a
// thin dark outline at the manipulation origin). Sized in rotate-group local
// space so it scales consistently with each gizmo.
const FUSION_PIVOT_RADIUS = 0.034;
const FUSION_PIVOT_OUTLINE_RADIUS = 0.045;
const FUSION_PIVOT_COLOR = '#ffffff';
const FUSION_PIVOT_OUTLINE_COLOR = '#10151f';
const FUSION_PIVOT_OPACITY = 1;
const FUSION_PIVOT_OUTLINE_OPACITY = 0.5;
const ROTATE_DRAG_SECTOR_RADIUS = 0.5;
const ROTATE_DRAG_SECTOR_OPACITY = 0.28;
const ROTATE_DRAG_SECTOR_SEGMENTS = 64;
const GUIDE_DASH_SEGMENTS = 22;
const GUIDE_DASH_DUTY = 0.62;
const GUIDE_MIN_HALF_LENGTH = 2.5;
const ROTATE_GUIDE_DASH_SEGMENTS = 52;
const ROTATE_GUIDE_DASH_DUTY = 0.48;

const AXIS_UNIT: Record<AxisName, THREE.Vector3> = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};

const createFusionControlState = (mode: FusionOwner): FusionControlState => {
  const state = new THREE.EventDispatcher() as FusionControlState;
  state.axis = null;
  state.camera = null;
  state.domElement = null;
  state.dragging = false;
  state.enabled = true;
  state.mode = mode;
  state.object = undefined;
  state.pointerUp = () => {};
  state.userData = {};
  return state;
};

const dispatchControlEvent = (control: FusionControlState, type: string, value?: unknown) => {
  (
    control.dispatchEvent as (event: {
      target: FusionControlState;
      type: string;
      value?: unknown;
    }) => void
  )({
    type,
    target: control,
    value,
  });
};

const createAxisAlignedCylinderGeometry = (
  axis: AxisName,
  startOffset: number,
  endOffset: number,
  radius: number,
) => {
  const segmentLength = endOffset - startOffset;
  const geometry = new THREE.CylinderGeometry(radius, radius, segmentLength, 16);
  const segmentCenter = startOffset + segmentLength * 0.5;

  if (axis === 'X') {
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(segmentCenter, 0, 0);
  } else if (axis === 'Y') {
    geometry.translate(0, segmentCenter, 0);
  } else {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, segmentCenter);
  }

  return geometry;
};

const createAxisAlignedConeGeometry = (
  axis: AxisName,
  startOffset: number,
  length: number,
  radius: number,
) => {
  const geometry = new THREE.CylinderGeometry(0, radius, length, 24);
  const segmentCenter = startOffset + length * 0.5;

  if (axis === 'X') {
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(segmentCenter, 0, 0);
  } else if (axis === 'Y') {
    geometry.translate(0, segmentCenter, 0);
  } else {
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0, segmentCenter);
  }

  return geometry;
};

const createRotateGuideRingGeometry = (axis: AxisName) => {
  const positions: number[] = [];
  for (let index = 0; index < ROTATE_GUIDE_DASH_SEGMENTS; index += 1) {
    const segmentStart = (index / ROTATE_GUIDE_DASH_SEGMENTS) * Math.PI * 2;
    const segmentEnd =
      ((index + ROTATE_GUIDE_DASH_DUTY) / ROTATE_GUIDE_DASH_SEGMENTS) * Math.PI * 2;
    const start = getFusionRotateArcPoint(axis, segmentStart);
    const end = getFusionRotateArcPoint(axis, segmentEnd);
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
};

const getFallbackRotateFeedbackDirection = (axisLocal: THREE.Vector3) => {
  const axis = axisLocal.clone().normalize();
  const reference =
    Math.abs(axis.dot(new THREE.Vector3(0, 1, 0))) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  return reference.projectOnPlane(axis).normalize();
};

const getRotateFeedbackStartDirection = ({
  axisLocal,
  guideQuaternion,
  startDirection,
}: {
  axisLocal: THREE.Vector3;
  guideQuaternion: THREE.Quaternion;
  startDirection: THREE.Vector3;
}) => {
  const axis = axisLocal.clone().normalize();
  const direction = startDirection
    .clone()
    .applyQuaternion(guideQuaternion.clone().invert())
    .projectOnPlane(axis);
  if (direction.lengthSq() < 1e-10) {
    return getFallbackRotateFeedbackDirection(axis);
  }
  return direction.normalize();
};

const createRotateDragSectorGeometry = ({
  axisLocal,
  rotationAngle,
  startDirection,
}: {
  axisLocal: THREE.Vector3;
  rotationAngle: number;
  startDirection: THREE.Vector3;
}) => {
  const thetaLength = Math.min(Math.abs(rotationAngle), Math.PI * 2);
  const visualAngle = rotationAngle < 0 ? -thetaLength : thetaLength;
  const axis = axisLocal.clone().normalize();
  const segmentCount = Math.max(
    1,
    Math.min(384, Math.ceil((ROTATE_DRAG_SECTOR_SEGMENTS * thetaLength) / (Math.PI * 2))),
  );
  const positions = [0, 0, 0];
  const indices: number[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const point = startDirection
      .clone()
      .applyAxisAngle(axis, (visualAngle * index) / segmentCount)
      .multiplyScalar(ROTATE_DRAG_SECTOR_RADIUS);
    positions.push(point.x, point.y, point.z);
    if (index > 0) {
      indices.push(0, index, index + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
};

const wrapAngleDelta = (delta: number) => {
  let wrapped = delta;
  while (wrapped <= -Math.PI) wrapped += Math.PI * 2;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  return wrapped;
};

const formatRotateDragAngle = (rotationAngle: number) => {
  const degrees = Math.round(THREE.MathUtils.radToDeg(rotationAngle) * 10) / 10;
  return `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}\u00b0`;
};

const formatTranslateDragDistance = (distanceMeters: number) => {
  const sign = distanceMeters >= 0 ? '+' : '-';
  const absoluteDistance = Math.abs(distanceMeters);
  if (absoluteDistance < 0.1) {
    return `${sign}${(absoluteDistance * 1000).toFixed(2)} mm`;
  }
  return `${sign}${absoluteDistance.toFixed(3)} m`;
};

const READOUT_NEUTRAL_COLOR = '#eef2f7';

// Resolve the crisp DOM drag readout (axis label + value, color-coded) shown
// during a drag. Driven directly from the live drag state so the rotation angle
// and translation distance update on every drag frame.
const formatDragReadout = (
  drag: DragState | null,
): { text: string; color: string } | null => {
  if (!drag) return null;

  const axis = drag.axis;
  const isLetterAxis = axis === 'X' || axis === 'Y' || axis === 'Z';

  if (drag.owner === 'rotate') {
    const angle = formatRotateDragAngle(drag.rotationAngle);
    return {
      text: isLetterAxis ? `${axis}  ${angle}` : angle,
      color: isLetterAxis ? AXIS_COLORS[axis] : READOUT_NEUTRAL_COLOR,
    };
  }

  if (drag.dragKind === 'axis' && isLetterAxis) {
    return {
      text: `${axis}  ${formatTranslateDragDistance(drag.translationDistance)}`,
      color: AXIS_COLORS[axis],
    };
  }

  const distance = drag.object.position.distanceTo(drag.startPosition);
  return { text: formatTranslateDragDistance(distance), color: READOUT_NEUTRAL_COLOR };
};

const useDisposableGeometry = <T extends THREE.BufferGeometry>(
  createGeometry: () => T,
  deps: React.DependencyList,
) => {
  // Call sites provide explicit dependencies; this wrapper centralizes geometry disposal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(createGeometry, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
};

const createGuideLineGeometry = (axis: AxisName) => {
  const positions: number[] = [];
  for (let index = 0; index < GUIDE_DASH_SEGMENTS; index += 1) {
    const segmentStart = -1 + (index / GUIDE_DASH_SEGMENTS) * 2;
    const segmentEnd = -1 + ((index + GUIDE_DASH_DUTY) / GUIDE_DASH_SEGMENTS) * 2;
    const start = AXIS_UNIT[axis].clone().multiplyScalar(segmentStart);
    const end = AXIS_UNIT[axis].clone().multiplyScalar(segmentEnd);
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
};

const createScreenRay = (
  event: PointerEvent,
  domElement: HTMLElement,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
) => {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );

  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.clone();
};

const intersectRayWithPlane = (ray: THREE.Ray, plane: THREE.Plane) => {
  const target = new THREE.Vector3();
  return ray.intersectPlane(plane, target) ? target : null;
};

const getParentWorldQuaternionInv = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.parent.getWorldQuaternion(quaternion);
    quaternion.invert();
  }
  return quaternion;
};

const getWorldQuaternion = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  object.updateMatrixWorld(true);
  object.getWorldQuaternion(quaternion);
  return quaternion;
};

const setObjectWorldPosition = (object: THREE.Object3D, worldPosition: THREE.Vector3) => {
  const nextPosition = worldPosition.clone();
  if (object.parent) {
    object.parent.worldToLocal(nextPosition);
  }
  object.position.copy(nextPosition);
};

const getTranslateDragPlane = (
  axisWorld: THREE.Vector3,
  origin: THREE.Vector3,
  camera: THREE.Camera,
) => {
  const cameraDirection = new THREE.Vector3();
  camera.getWorldDirection(cameraDirection).normalize();

  const normal = cameraDirection
    .clone()
    .addScaledVector(axisWorld, -cameraDirection.dot(axisWorld));

  if (normal.lengthSq() < 1e-6) {
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    normal.copy(cameraUp).addScaledVector(axisWorld, -cameraUp.dot(axisWorld));
  }

  if (normal.lengthSq() < 1e-6) {
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    normal.copy(cameraRight).addScaledVector(axisWorld, -cameraRight.dot(axisWorld));
  }

  normal.normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
};

const getRotationDragPlane = (axisWorld: THREE.Vector3, origin: THREE.Vector3) =>
  new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld.clone().normalize(), origin);

const objectBelongsToHandle = (
  object: THREE.Object3D | null | undefined,
  owner: FusionOwner,
  axis: FusionHandleName,
) => {
  let current: THREE.Object3D | null | undefined = object;
  while (current) {
    if (current.userData?.urdfOwner === owner && current.userData?.urdfAxis === axis) {
      return true;
    }
    current = current.parent;
  }

  return false;
};

const pointerStillHitsHandle = (
  event: ThreeEvent<PointerEvent>,
  owner: FusionOwner,
  axis: FusionHandleName,
) =>
  event.intersections?.some((intersection) =>
    objectBelongsToHandle(intersection.object, owner, axis),
  ) ?? false;

const getSignedAngleAroundAxis = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  axisWorld: THREE.Vector3,
) => {
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(axisWorld.dot(cross), THREE.MathUtils.clamp(from.dot(to), -1, 1));
};

const applyTranslationSnap = (distance: number, snap: number | null | undefined) => {
  if (!snap || snap <= 0) return distance;
  return Math.round(distance / snap) * snap;
};

const applyRotationSnap = (angle: number, snap: number | null | undefined) => {
  if (!snap || snap <= 0) return angle;
  return Math.round(angle / snap) * snap;
};

const getVisualThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.35;

const getPickerThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.55;

const clampObjectPosition = (
  object: THREE.Object3D,
  limits: Pick<FusionTransformControlsProps, 'maxX' | 'maxY' | 'maxZ' | 'minX' | 'minY' | 'minZ'>,
) => {
  object.position.x = THREE.MathUtils.clamp(
    object.position.x,
    limits.minX ?? -Infinity,
    limits.maxX ?? Infinity,
  );
  object.position.y = THREE.MathUtils.clamp(
    object.position.y,
    limits.minY ?? -Infinity,
    limits.maxY ?? Infinity,
  );
  object.position.z = THREE.MathUtils.clamp(
    object.position.z,
    limits.minZ ?? -Infinity,
    limits.maxZ ?? Infinity,
  );
};

const resolveWorldGizmoScale = (size = 1) =>
  Number.isFinite(size) && size > 0 ? size : 1;

const getAxisVisible = (
  axis: AxisName,
  props: Pick<FusionTransformControlsProps, 'showX' | 'showY' | 'showZ'>,
) => {
  if (axis === 'X') return props.showX !== false;
  if (axis === 'Y') return props.showY !== false;
  return props.showZ !== false;
};

function GizmoMaterial({
  active,
  axis,
  opacity = 1,
}: {
  active?: boolean;
  axis: AxisName;
  opacity?: number;
}) {
  return (
    <meshBasicMaterial
      color={active ? ACTIVE_AXIS_COLOR : AXIS_COLORS[axis]}
      depthTest={false}
      depthWrite={false}
      opacity={opacity}
      toneMapped={false}
      transparent
    />
  );
}

function RotateRingMaterial({ active, axis }: { active?: boolean; axis: AxisName }) {
  return (
    <meshBasicMaterial
      color={active ? ACTIVE_AXIS_COLOR : AXIS_COLORS[axis]}
      depthTest={false}
      depthWrite={false}
      opacity={ROTATE_GUIDE_RING_OPACITY}
      toneMapped={false}
      transparent
    />
  );
}

function PlainGizmoMaterial({
  active,
  color,
  opacity = 1,
}: {
  active?: boolean;
  color: string;
  opacity?: number;
}) {
  return (
    <meshBasicMaterial
      color={active ? ACTIVE_AXIS_COLOR : color}
      depthTest={false}
      depthWrite={false}
      opacity={opacity}
      toneMapped={false}
      transparent
    />
  );
}

function TranslateAxisHandle({
  active,
  axis,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  axis: AxisName;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const shaftStart = resolveFusionTranslateShaftStart({
    rotateArcTubeRadius: THICK_ROTATE_ARC_RADIUS * visualThicknessScale,
    translateShaftRadius: THICK_TRANSLATE_SHAFT_RADIUS * visualThicknessScale,
  });
  const shaftGeometry = useMemo(
    () =>
      createAxisAlignedCylinderGeometry(
        axis,
        shaftStart,
        FUSION_TRANSLATE_SHAFT_END,
        THICK_TRANSLATE_SHAFT_RADIUS * visualThicknessScale,
      ),
    [axis, shaftStart, visualThicknessScale],
  );
  const arrowGeometry = useMemo(
    () =>
      createAxisAlignedConeGeometry(
        axis,
        FUSION_TRANSLATE_SHAFT_END,
        FUSION_TRANSLATE_ARROW_LENGTH,
        FUSION_TRANSLATE_ARROW_BASE_RADIUS * visualThicknessScale,
      ),
    [axis, visualThicknessScale],
  );
  const pickerStart = Math.max(
    TRANSLATE_CENTER_GAP * 0.78,
    shaftStart - FUSION_TRANSLATE_PICKER_START_PADDING,
  );
  const pickerGeometry = useMemo(
    () =>
      createAxisAlignedCylinderGeometry(
        axis,
        pickerStart,
        FUSION_TRANSLATE_SHAFT_END + FUSION_TRANSLATE_ARROW_LENGTH,
        THICK_TRANSLATE_PICKER_RADIUS * pickerThicknessScale,
      ),
    [axis, pickerStart, pickerThicknessScale],
  );

  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', axis),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', axis),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', axis),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 2,
    userData: {
      isGizmo: true,
      urdfAxis: axis,
      urdfOwner: 'translate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name={`fusion-translate-${axis.toLowerCase()}`}
      userData={{ urdfAxis: axis, urdfHoverScaleTarget: true, urdfOwner: 'translate' }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={shaftGeometry}
        name={`translate-shaft-${axis.toLowerCase()}`}
      >
        <GizmoMaterial active={active} axis={axis} opacity={active ? 1 : 0.94} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={arrowGeometry}
        name={`translate-arrow-${axis.toLowerCase()}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 3}
      >
        <GizmoMaterial active={active} axis={axis} />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={pickerGeometry}
        name={`translate-picker-${axis.toLowerCase()}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 4}
      >
        <meshBasicMaterial
          color={AXIS_COLORS[axis]}
          depthTest={false}
          depthWrite={false}
          opacity={0}
          toneMapped={false}
          transparent
        />
      </mesh>
    </group>
  );
}

function RotateAxisHandle({
  active,
  axis,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  axis: AxisName;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const guideGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.32,
      ),
    [axis, visualThicknessScale],
  );
  const frontArcGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFrontArcGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.52,
      ),
    [axis, visualThicknessScale],
  );
  const fullRingPickerGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * Math.max(2.65, pickerThicknessScale * 2.1),
      ),
    [axis, pickerThicknessScale],
  );

  const frontArcHandleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', axis),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', axis),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', axis),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 5,
    userData: {
      isGizmo: true,
      urdfAxis: axis,
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name={`fusion-rotate-${axis.toLowerCase()}`}
      userData={{ urdfAxis: axis, urdfHoverScaleTarget: true, urdfOwner: 'rotate' }}
    >
      <mesh
        frustumCulled={false}
        geometry={guideGeometry}
        name={`rotate-guide-ring-${axis.toLowerCase()}`}
        raycast={() => null}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 1}
        userData={{
          urdfAxis: axis,
          urdfOwner: 'rotate',
        }}
      >
        <RotateRingMaterial active={active} axis={axis} />
      </mesh>
      <group userData={{ urdfRotateFrontArcAxis: axis }}>
        <mesh
          {...frontArcHandleProps}
          frustumCulled={false}
          geometry={frontArcGeometry}
          name={`rotate-front-arc-${axis.toLowerCase()}`}
          renderOrder={GIZMO_ARC_RENDER_ORDER + 5}
        >
          <GizmoMaterial active={active} axis={axis} opacity={ROTATE_FRONT_ARC_OPACITY} />
        </mesh>
        <mesh
          {...frontArcHandleProps}
          frustumCulled={false}
          geometry={fullRingPickerGeometry}
          name={`rotate-full-ring-picker-${axis.toLowerCase()}`}
          renderOrder={GIZMO_ARC_RENDER_ORDER + 8}
        >
          <PlainGizmoMaterial color={AXIS_COLORS[axis]} opacity={0} />
        </mesh>
      </group>
    </group>
  );
}

function RotateScreenRingHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const eRingGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        'Z',
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.82,
        FUSION_ROTATE_E_RING_RADIUS,
      ),
    [visualThicknessScale],
  );
  const eRingPickerGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        'Z',
        THICK_ROTATE_ARC_RADIUS * Math.max(2.9, pickerThicknessScale * 2.2),
        FUSION_ROTATE_E_RING_RADIUS,
      ),
    [pickerThicknessScale],
  );
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', 'E'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', 'E'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', 'E'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 6,
    userData: {
      isGizmo: true,
      urdfAxis: 'E',
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-rotate-e"
      userData={{
        urdfAxis: 'E',
        urdfHoverScaleTarget: true,
        urdfOwner: 'rotate',
        urdfRotateScreenRing: true,
      }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={eRingGeometry}
        name="rotate-e-ring"
      >
        <PlainGizmoMaterial
          active={active}
          color={ROTATE_E_RING_COLOR}
          opacity={ROTATE_E_RING_OPACITY}
        />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={eRingPickerGeometry}
        name="rotate-e-ring-picker"
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <PlainGizmoMaterial color={ROTATE_E_RING_COLOR} opacity={0} />
      </mesh>
    </group>
  );
}

function RotateTrackballHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
}: {
  active: boolean;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
}) {
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', 'XYZE'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', 'XYZE'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', 'XYZE'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 7,
    userData: {
      isGizmo: true,
      urdfAxis: 'XYZE',
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-rotate-trackball"
      userData={{ urdfAxis: 'XYZE', urdfHoverScaleTarget: true, urdfOwner: 'rotate' }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        name="rotate-trackball"
      >
        <sphereGeometry args={[FUSION_ROTATE_TRACKBALL_RADIUS, 32, 18]} />
        <PlainGizmoMaterial
          active={active}
          color={ROTATE_TRACKBALL_COLOR}
          opacity={ROTATE_TRACKBALL_OPACITY}
        />
      </mesh>
    </group>
  );
}

function TranslatePlaneHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  plane,
}: {
  active: boolean;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  plane: FusionTranslatePlaneName;
}) {
  const fillGeometry = useDisposableGeometry(
    () => createFusionTranslatePlaneGeometry({ plane }),
    [plane],
  );
  const outlineGeometry = useDisposableGeometry(
    () => createFusionTranslatePlaneOutlineGeometry({ plane }),
    [plane],
  );
  const pickerGeometry = useDisposableGeometry(
    () =>
      createFusionTranslatePlaneGeometry({
        plane,
        scale: FUSION_TRANSLATE_PLANE_PICKER_SCALE,
      }),
    [plane],
  );
  const color = AXIS_COLORS[getFusionTranslatePlaneNormalAxis(plane)];
  const planeName = plane.toLowerCase();
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', plane),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', plane),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', plane),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 4,
    userData: {
      isGizmo: true,
      urdfAxis: plane,
      urdfOwner: 'translate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name={`fusion-translate-plane-${planeName}`}
      userData={{ urdfAxis: plane, urdfHoverScaleTarget: true, urdfOwner: 'translate' }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={fillGeometry}
        name={`translate-plane-${planeName}`}
      >
        <PlainGizmoMaterial
          active={active}
          color={color}
          opacity={active ? TRANSLATE_PLANE_ACTIVE_OPACITY : TRANSLATE_PLANE_OPACITY}
        />
      </mesh>
      <lineSegments
        frustumCulled={false}
        geometry={outlineGeometry}
        name={`translate-plane-outline-${planeName}`}
        raycast={() => null}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 5}
      >
        <lineBasicMaterial
          color={active ? ACTIVE_AXIS_COLOR : color}
          depthTest={false}
          depthWrite={false}
          opacity={active ? 0.96 : 0.72}
          toneMapped={false}
          transparent
        />
      </lineSegments>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={pickerGeometry}
        name={`translate-plane-picker-${planeName}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <PlainGizmoMaterial color={color} opacity={0} />
      </mesh>
    </group>
  );
}

function TranslateCenterHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
}: {
  active: boolean;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
}) {
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', 'XYZ'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', 'XYZ'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', 'XYZ'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 7,
    userData: {
      isGizmo: true,
      urdfAxis: 'XYZ',
      urdfOwner: 'translate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-translate-center"
      userData={{ urdfAxis: 'XYZ', urdfHoverScaleTarget: true, urdfOwner: 'translate' }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        name="translate-center"
      >
        <sphereGeometry args={[FUSION_TRANSLATE_CENTER_RADIUS, 28, 16]} />
        <PlainGizmoMaterial
          active={active}
          color={TRANSLATE_CENTER_COLOR}
          opacity={TRANSLATE_CENTER_OPACITY}
        />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        name="translate-center-picker"
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <sphereGeometry args={[FUSION_TRANSLATE_CENTER_PICKER_RADIUS, 18, 12]} />
        <PlainGizmoMaterial color={TRANSLATE_CENTER_COLOR} opacity={0} />
      </mesh>
    </group>
  );
}

function TranslateGuideLine({ axis }: { axis: AxisName }) {
  const geometry = useMemo(() => createGuideLineGeometry(axis), [axis]);

  return (
    <lineSegments frustumCulled={false} geometry={geometry} raycast={() => null}>
      <lineBasicMaterial
        color={ACTIVE_AXIS_COLOR}
        depthTest={false}
        depthWrite={false}
        opacity={0.75}
        toneMapped={false}
        transparent
      />
    </lineSegments>
  );
}

function RotateGuideRing({
  axis,
}: {
  axis: AxisName;
}) {
  const guideGeometry = useMemo(() => createRotateGuideRingGeometry(axis), [axis]);

  return (
    <group name={`fusion-rotate-guide-${axis.toLowerCase()}`}>
      <lineSegments
        frustumCulled={false}
        geometry={guideGeometry}
        name={`rotate-guide-ring-${axis.toLowerCase()}`}
        raycast={() => null}
        userData={{ isGizmo: true }}
      >
        <lineBasicMaterial
          color={ACTIVE_AXIS_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.56}
          toneMapped={false}
          transparent
        />
      </lineSegments>
    </group>
  );
}

const isAxisName = (value: unknown): value is AxisName =>
  value === 'X' || value === 'Y' || value === 'Z';

const isTranslatePlaneName = (value: unknown): value is FusionTranslatePlaneName =>
  value === 'XY' || value === 'YZ' || value === 'XZ';

const getCameraDirection = (camera: THREE.Camera) =>
  camera.getWorldDirection(new THREE.Vector3()).normalize();

const getCameraRight = (camera: THREE.Camera) =>
  new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();

const getCameraUp = (camera: THREE.Camera) =>
  new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

const getObjectToCameraVector = (
  camera: THREE.Camera,
  origin: THREE.Vector3,
) => {
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const objectToCamera = cameraPosition.sub(origin);
  if (objectToCamera.lengthSq() > 1e-8) {
    return objectToCamera.normalize();
  }
  return getCameraDirection(camera).multiplyScalar(-1);
};

const isWorldVisible = (object: THREE.Object3D) => {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
};

const collectActiveHoverTargets = (
  root: THREE.Object3D | null,
  active: ActiveHandle,
) => {
  const targets: THREE.Object3D[] = [];
  root?.traverse((node) => {
    if (!isWorldVisible(node)) return;
    if (node.userData?.urdfOwner !== active.owner || node.userData?.urdfAxis !== active.axis) {
      return;
    }
    if (!node.userData?.urdfVisibleHandleTarget) return;
    targets.push(node);
  });
  return targets;
};

const updateHoverScales = (
  root: THREE.Object3D | null,
  active: ActiveHandle | null,
) => {
  root?.traverse((node) => {
    if (!node.userData?.urdfHoverScaleTarget) return;
    const isActive =
      Boolean(active) &&
      node.userData.urdfOwner === active?.owner &&
      node.userData.urdfAxis === active?.axis;
    const current =
      typeof node.userData.urdfHoverScale === 'number' ? node.userData.urdfHoverScale : 1;
    const target = isActive ? HOVER_TARGET_SCALE : 1;
    const next = THREE.MathUtils.lerp(current, target, HOVER_SCALE_LERP);
    node.userData.urdfHoverScale = next;
    node.scale.setScalar(next);
  });
};

const updateRotateCameraFacingHandles = ({
  camera,
  origin,
  rotateGroup,
  rotateQuaternion,
}: {
  camera: THREE.Camera;
  origin: THREE.Vector3;
  rotateGroup: THREE.Object3D | null;
  rotateQuaternion: THREE.Quaternion;
}) => {
  if (!rotateGroup) return;

  const rotateQuaternionInv = rotateQuaternion.clone().invert();
  const cameraVectorLocal = getObjectToCameraVector(camera, origin)
    .applyQuaternion(rotateQuaternionInv)
    .normalize();
  const screenQuaternion = getFusionRotateScreenQuaternion(getObjectToCameraVector(camera, origin));
  const localScreenQuaternion = rotateQuaternionInv.multiply(screenQuaternion);

  rotateGroup.traverse((node) => {
    const frontArcAxis = node.userData?.urdfRotateFrontArcAxis;
    if (isAxisName(frontArcAxis)) {
      const centerAngle = getFusionRotateFrontArcCenterAngle(frontArcAxis, cameraVectorLocal);
      node.quaternion.copy(getFusionRotateFrontArcQuaternion(frontArcAxis, centerAngle));
    }
    if (node.userData?.urdfRotateScreenRing) {
      node.quaternion.copy(localScreenQuaternion);
    }
  });
};

const resolveTranslateDragSetup = ({
  axis,
  camera,
  ownerSpace,
  startWorldPosition,
  startWorldQuaternion,
}: {
  axis: FusionHandleName;
  camera: THREE.Camera;
  ownerSpace: 'local' | 'world';
  startWorldPosition: THREE.Vector3;
  startWorldQuaternion: THREE.Quaternion;
}): DragSetup | null => {
  const cameraDirection = getCameraDirection(camera);
  const spaceQuaternion =
    ownerSpace === 'local' ? startWorldQuaternion.clone() : new THREE.Quaternion();

  if (isAxisName(axis)) {
    const axisLocal = AXIS_UNIT[axis].clone();
    const axisWorld =
      ownerSpace === 'local'
        ? axisLocal.clone().applyQuaternion(startWorldQuaternion).normalize()
        : axisLocal.clone();
    return {
      axisLocal,
      axisWorld,
      dragKind: 'axis',
      ownerSpace,
      plane: getTranslateDragPlane(axisWorld, startWorldPosition, camera),
      planeAxesWorld: null,
    };
  }

  if (isTranslatePlaneName(axis)) {
    const plane = getFusionTranslatePlaneDragPlane({
      origin: startWorldPosition,
      plane: axis,
      spaceQuaternion,
    });
    const planeAxes = getFusionTranslatePlaneAxes(axis);
    return {
      axisLocal: new THREE.Vector3(),
      axisWorld: plane.normal.clone(),
      dragKind: 'plane',
      ownerSpace,
      plane,
      planeAxesWorld: planeAxes.map((planeAxis) =>
        getFusionTranslateAxisUnit(planeAxis)
          .applyQuaternion(spaceQuaternion)
          .normalize(),
      ) as [THREE.Vector3, THREE.Vector3],
    };
  }

  if (axis !== 'XYZ') return null;
  return {
    axisLocal: new THREE.Vector3(),
    axisWorld: cameraDirection.clone(),
    dragKind: 'center',
    ownerSpace: 'world',
    plane: getFusionTranslateCenterDragPlane({
      cameraDirection,
      origin: startWorldPosition,
    }),
    planeAxesWorld: null,
  };
};

const resolveRotateDragSetup = ({
  axis,
  camera,
  mode,
  ownerSpace,
  startWorldPosition,
  startWorldQuaternion,
}: {
  axis: FusionHandleName;
  camera: THREE.Camera;
  mode: FusionTransformControlsProps['mode'];
  ownerSpace: 'local' | 'world';
  startWorldPosition: THREE.Vector3;
  startWorldQuaternion: THREE.Quaternion;
}): DragSetup | null => {
  const cameraDirection = getCameraDirection(camera);

  if (isAxisName(axis)) {
    const axisLocal = AXIS_UNIT[axis].clone();
    const axisWorld =
      ownerSpace === 'local'
        ? axisLocal.clone().applyQuaternion(startWorldQuaternion).normalize()
        : axisLocal.clone();
    return {
      axisLocal,
      axisWorld,
      dragKind: 'axis',
      ownerSpace,
      plane: getRotationDragPlane(axisWorld, startWorldPosition),
      planeAxesWorld: null,
    };
  }

  if (axis === 'E') {
    return {
      axisLocal: cameraDirection.clone(),
      axisWorld: cameraDirection.clone(),
      dragKind: 'axis',
      ownerSpace: 'world',
      plane: getRotationDragPlane(cameraDirection, startWorldPosition),
      planeAxesWorld: null,
    };
  }

  if (axis !== 'XYZE' || mode !== 'rotate') return null;
  return {
    axisLocal: cameraDirection.clone(),
    axisWorld: cameraDirection.clone(),
    dragKind: 'trackball',
    ownerSpace: 'world',
    plane: getFusionTranslateCenterDragPlane({
      cameraDirection,
      origin: startWorldPosition,
    }),
    planeAxesWorld: null,
  };
};

const prepareFusionRootLayout = ({
  activeDrag,
  activeHandle,
  canRender,
  primaryObject,
  root,
}: {
  activeDrag: DragState | null;
  activeHandle: ActiveHandle | null;
  canRender: boolean;
  primaryObject: THREE.Object3D | undefined;
  root: FusionRootGroup | null;
}) => {
  if (!root) return null;
  if (!canRender || !primaryObject) {
    root.visible = false;
    return null;
  }

  primaryObject.updateMatrixWorld(true);
  root.visible = false;
  const origin = new THREE.Vector3();
  primaryObject.getWorldPosition(origin);
  root.position.copy(origin);
  root.quaternion.identity();
  root.scale.setScalar(1);
  root.activeOwner = activeHandle?.owner ?? null;
  root.axis = activeHandle?.axis ?? null;
  root.dragging = Boolean(activeDrag);
  return origin;
};

const resolveLayoutQuaternion = ({
  object,
  primaryObject,
  space,
}: {
  object: THREE.Object3D | undefined;
  primaryObject: THREE.Object3D;
  space: 'local' | 'world';
}) => (space === 'world' ? new THREE.Quaternion() : getWorldQuaternion(object ?? primaryObject));

const applyTranslateGroupLayout = ({
  group,
  mode,
  scale,
  translateQuaternion,
}: {
  group: THREE.Group | null;
  mode: FusionTransformControlsProps['mode'];
  scale: number;
  translateQuaternion: THREE.Quaternion;
}) => {
  if (!group) return;
  group.quaternion.copy(translateQuaternion);
  group.scale.setScalar(scale);
  group.visible = mode === 'translate' || mode === 'universal';
};

const applyRotateGroupLayout = ({
  camera,
  group,
  mode,
  origin,
  rotateQuaternion,
  scale,
}: {
  camera: THREE.Camera;
  group: THREE.Group | null;
  mode: FusionTransformControlsProps['mode'];
  origin: THREE.Vector3;
  rotateQuaternion: THREE.Quaternion;
  scale: number;
}) => {
  if (!group) return;
  group.quaternion.copy(rotateQuaternion);
  group.scale.setScalar(scale);
  group.visible = mode === 'rotate' || mode === 'universal';
  updateRotateCameraFacingHandles({
    camera,
    origin,
    rotateGroup: group,
    rotateQuaternion,
  });
};

const applyGuideGroupLayout = ({
  active,
  effectiveRotateQuaternion,
  guideGroup,
  rotateScale,
  translateQuaternion,
  translateScale,
}: {
  active: ActiveHandle | null;
  effectiveRotateQuaternion: THREE.Quaternion;
  guideGroup: THREE.Group | null;
  rotateScale: number;
  translateQuaternion: THREE.Quaternion;
  translateScale: number;
}) => {
  if (!guideGroup) return;
  if (!active || !isAxisName(active.axis)) {
    guideGroup.visible = false;
    return;
  }

  guideGroup.visible = true;
  guideGroup.quaternion.copy(
    active.owner === 'translate' ? translateQuaternion : effectiveRotateQuaternion,
  );
  guideGroup.scale.setScalar(
    active.owner === 'rotate'
      ? rotateScale
      : Math.max(GUIDE_MIN_HALF_LENGTH, translateScale * 3),
  );
};

const syncDefaultControlsSuppression = ({
  hasPointerIntent,
  restoreDefaultControls,
  suppressDefaultControls,
}: {
  hasPointerIntent: boolean;
  restoreDefaultControls: () => void;
  suppressDefaultControls: () => void;
}) => {
  if (hasPointerIntent) {
    suppressDefaultControls();
    return;
  }
  restoreDefaultControls();
};

const getGizmoSummaryKind = (name: string) => {
  if (name.startsWith('rotate-front-arc-picker-')) return null;
  if (name.startsWith('rotate-front-arc-')) return 'rotate-front-arc';
  if (name.startsWith('rotate-guide-ring-')) return 'rotate-guide-ring';
  if (name === 'rotate-e-ring') return 'rotate-e-ring';
  if (name === 'rotate-e-ring-picker') return null;
  if (name === 'rotate-trackball') return 'rotate-trackball';
  if (name.startsWith('translate-plane-picker-')) return null;
  if (name.startsWith('translate-plane-outline-')) return null;
  if (name.startsWith('translate-plane-xy')) return 'translate-plane-xy';
  if (name.startsWith('translate-plane-yz')) return 'translate-plane-yz';
  if (name.startsWith('translate-plane-xz')) return 'translate-plane-xz';
  if (name === 'translate-center') return 'translate-center';
  if (name === 'translate-center-picker') return null;
  if (name.startsWith('translate-picker-')) return 'translate-picker';
  if (name.startsWith('translate-arrow-')) return 'translate-arrow';
  if (name.startsWith('translate-shaft-')) return 'translate-shaft';
  return null;
};

const isActiveSummaryEntry = ({
  activeAxis,
  activeOwner,
  axis,
  kind,
  owner,
}: {
  activeAxis: unknown;
  activeOwner: unknown;
  axis: string | null;
  kind: string;
  owner: string | null;
}) => {
  if (!owner || !axis || owner !== activeOwner || axis !== activeAxis) return false;
  if (owner === 'rotate') {
    return kind === 'rotate-front-arc' || kind === 'rotate-e-ring' || kind === 'rotate-trackball';
  }
  return true;
};

const projectWorldPointToClient = (
  point: THREE.Vector3,
  camera: THREE.Camera,
  rect: DOMRect,
) => {
  const projected = point.clone().project(camera);
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.y) ||
    projected.z < -1 ||
    projected.z > 1
  ) {
    return null;
  }

  return {
    x: rect.left + (projected.x + 1) * 0.5 * rect.width,
    y: rect.top + (1 - projected.y) * 0.5 * rect.height,
  };
};

const estimateWorldRadius = (object: THREE.Object3D) => {
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return 0;
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }

  const localRadius = geometry.boundingSphere?.radius ?? 0;
  if (localRadius <= 0) return 0;

  const worldScale = object.getWorldScale(new THREE.Vector3());
  const worldRadius =
    localRadius * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
  return worldRadius > 0 ? worldRadius : 0;
};

const estimateProjectedRadius = (
  worldPosition: THREE.Vector3,
  worldRadius: number,
  camera: THREE.Camera,
  rect: DOMRect,
) => {
  if (worldRadius <= 0) return 0;
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const center = projectWorldPointToClient(worldPosition, camera, rect);
  const edge = projectWorldPointToClient(
    worldPosition.clone().addScaledVector(cameraRight, worldRadius),
    camera,
    rect,
  );
  if (!center || !edge) return 0;
  return Math.hypot(edge.x - center.x, edge.y - center.y);
};

const getGeometryWorldCenter = (object: THREE.Object3D) => {
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return object.getWorldPosition(new THREE.Vector3());
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }

  const center = geometry.boundingSphere?.center;
  if (!center) return object.getWorldPosition(new THREE.Vector3());
  return center.clone().applyMatrix4(object.matrixWorld);
};

const getSummaryWorldPosition = (
  object: THREE.Object3D,
  kind: string,
  axis: string | null,
) => {
  if (kind === 'rotate-front-arc' && isAxisName(axis)) {
    return getFusionRotateArcPoint(axis, 0).applyMatrix4(object.matrixWorld);
  }
  if (kind === 'rotate-guide-ring' && isAxisName(axis)) {
    return getFusionRotateArcPoint(axis, 0, FUSION_ROTATE_ARC_RADIUS).applyMatrix4(
      object.matrixWorld,
    );
  }
  if (kind === 'rotate-e-ring') {
    return new THREE.Vector3(FUSION_ROTATE_E_RING_RADIUS, 0, 0).applyMatrix4(
      object.matrixWorld,
    );
  }

  return getGeometryWorldCenter(object);
};

const summarizeFusionTransformGizmo = (
  root: THREE.Object3D | null,
  camera: THREE.Camera,
  domElement: HTMLElement,
): RegressionTransformGizmoSummary[] => {
  if (!root) return [];

  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];

  root.updateMatrixWorld(true);
  const summaries: RegressionTransformGizmoSummary[] = [];
  const activeOwner = (root as THREE.Object3D & { activeOwner?: unknown }).activeOwner;
  const activeAxis = (root as THREE.Object3D & { axis?: unknown }).axis;

  root.traverse((node) => {
    const kind = getGizmoSummaryKind(node.name);
    if (!kind || !isWorldVisible(node)) return;

    const axis = typeof node.userData?.urdfAxis === 'string' ? node.userData.urdfAxis : null;
    const owner =
      typeof node.userData?.urdfOwner === 'string' ? node.userData.urdfOwner : null;
    const worldPosition = getSummaryWorldPosition(node, kind, axis);
    const clientPosition = projectWorldPointToClient(worldPosition, camera, rect);
    if (!clientPosition) return;

    const worldRadius = estimateWorldRadius(node);

    summaries.push({
      active: isActiveSummaryEntry({
        activeAxis,
        activeOwner,
        axis,
        kind,
        owner,
      }),
      axis,
      clientX: clientPosition.x,
      clientY: clientPosition.y,
      kind,
      name: node.name,
      owner,
      screenRadius: estimateProjectedRadius(worldPosition, worldRadius, camera, rect),
      visible: true,
      worldPosition: {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      },
      worldRadius,
    });
  });

  return summaries;
};

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
    const rotateDragSectorRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(
      null,
    );
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
        ? attachedRotateObject ?? activeRotateDragObject
        : attachedTranslateObject ?? activeRotateDragObject;
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
      const root = rootRef.current as FusionRootGroup | null;
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
    // Universal (万能) is a deliberately minimal combined manipulator: only the
    // three colored translate arrows + the three colored rotate rings. The white
    // center free-move dot and the white screen-rotate E-ring (plus translate
    // planes and the rotate trackball) stay out of universal to keep it clean —
    // they remain available in their dedicated single modes.
    const showTranslateAxes = mode === 'translate' || mode === 'universal';
    const showTranslatePlanes = mode === 'translate';
    const showTranslateCenter = mode === 'translate';
    const showRotateAxes = mode === 'rotate' || mode === 'universal';
    // Single-DOF joints disable the free-rotate handles (screen-space E-ring +
    // trackball): a joint can only rotate about its fixed axis, so these handles
    // are meaningless and — being the largest rings — visually swamp small robots.
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

        <Html
          center
          position={[0, 0, 0]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[60, 0]}
        >
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
