import * as THREE from 'three';

import type { FusionTranslatePlaneName } from './fusionTranslatePlane';
import {
  getFusionRotateArcPoint,
  getFusionRotateFrontArcCenterAngle,
  getFusionRotateFrontArcQuaternion,
  getFusionRotateScreenQuaternion,
} from './fusionRotateGeometry';
import {
  getFusionTranslateAxisUnit,
  getFusionTranslateCenterDragPlane,
  getFusionTranslatePlaneAxes,
  getFusionTranslatePlaneDragPlane,
} from './fusionTranslatePlane';
import type {
  ActiveHandle,
  AxisName,
  DragSetup,
  DragState,
  FusionControlState,
  FusionHandleName,
  FusionOwner,
  FusionTransformControlsProps,
} from './FusionTransformControls.types';
import {
  AXIS_COLORS,
  AXIS_UNIT,
  GUIDE_DASH_DUTY,
  GUIDE_DASH_SEGMENTS,
  GUIDE_MIN_HALF_LENGTH,
  ROTATE_GUIDE_DASH_DUTY,
  ROTATE_GUIDE_DASH_SEGMENTS,
  ROTATE_DRAG_SECTOR_RADIUS,
  ROTATE_DRAG_SECTOR_SEGMENTS,
  HOVER_SCALE_LERP,
  HOVER_TARGET_SCALE,
} from './FusionTransformControls.constants';

// ---------------------------------------------------------------------------
// Control state & events
// ---------------------------------------------------------------------------

export const createFusionControlState = (mode: FusionOwner): FusionControlState => {
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

export const dispatchControlEvent = (
  control: FusionControlState,
  type: string,
  value?: unknown,
) => {
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

// ---------------------------------------------------------------------------
// Geometry factories
// ---------------------------------------------------------------------------

export const createAxisAlignedCylinderGeometry = (
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

export const createAxisAlignedConeGeometry = (
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

export const createRotateGuideRingGeometry = (axis: AxisName) => {
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

export const getFallbackRotateFeedbackDirection = (axisLocal: THREE.Vector3) => {
  const axis = axisLocal.clone().normalize();
  const reference =
    Math.abs(axis.dot(new THREE.Vector3(0, 1, 0))) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
  return reference.projectOnPlane(axis).normalize();
};

export const getRotateFeedbackStartDirection = ({
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

export const createRotateDragSectorGeometry = ({
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

// ---------------------------------------------------------------------------
// Math / formatting
// ---------------------------------------------------------------------------

export const wrapAngleDelta = (delta: number) => {
  let wrapped = delta;
  while (wrapped <= -Math.PI) wrapped += Math.PI * 2;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  return wrapped;
};

export const formatRotateDragAngle = (rotationAngle: number) => {
  const degrees = Math.round(THREE.MathUtils.radToDeg(rotationAngle) * 10) / 10;
  return `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`;
};

export const formatTranslateDragDistance = (distanceMeters: number) => {
  const sign = distanceMeters >= 0 ? '+' : '-';
  const absoluteDistance = Math.abs(distanceMeters);
  if (absoluteDistance < 0.1) {
    return `${sign}${(absoluteDistance * 1000).toFixed(2)} mm`;
  }
  return `${sign}${absoluteDistance.toFixed(3)} m`;
};

export const READOUT_NEUTRAL_COLOR = '#eef2f7';

// Resolve the crisp DOM drag readout (axis label + value, color-coded) shown
// during a drag. Driven directly from the live drag state so the rotation angle
// and translation distance update on every drag frame.
export const formatDragReadout = (
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

// ---------------------------------------------------------------------------
// Ray / plane / quaternion helpers
// ---------------------------------------------------------------------------

export const createGuideLineGeometry = (axis: AxisName) => {
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

export const createScreenRay = (
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

export const intersectRayWithPlane = (ray: THREE.Ray, plane: THREE.Plane) => {
  const target = new THREE.Vector3();
  return ray.intersectPlane(plane, target) ? target : null;
};

export const getParentWorldQuaternionInv = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  if (object.parent) {
    object.parent.updateMatrixWorld(true);
    object.parent.getWorldQuaternion(quaternion);
    quaternion.invert();
  }
  return quaternion;
};

export const getWorldQuaternion = (object: THREE.Object3D) => {
  const quaternion = new THREE.Quaternion();
  object.updateMatrixWorld(true);
  object.getWorldQuaternion(quaternion);
  return quaternion;
};

export const setObjectWorldPosition = (object: THREE.Object3D, worldPosition: THREE.Vector3) => {
  const nextPosition = worldPosition.clone();
  if (object.parent) {
    object.parent.worldToLocal(nextPosition);
  }
  object.position.copy(nextPosition);
};

export const getTranslateDragPlane = (
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

// ---------------------------------------------------------------------------
// Drag math helpers
// ---------------------------------------------------------------------------

export const getRotationDragPlane = (axisWorld: THREE.Vector3, origin: THREE.Vector3) =>
  new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld.clone().normalize(), origin);

export const objectBelongsToHandle = (
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

export const pointerStillHitsHandle = (
  event: import('@react-three/fiber').ThreeEvent<PointerEvent>,
  owner: FusionOwner,
  axis: FusionHandleName,
) =>
  event.intersections?.some((intersection) =>
    objectBelongsToHandle(intersection.object, owner, axis),
  ) ?? false;

export const getSignedAngleAroundAxis = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  axisWorld: THREE.Vector3,
) => {
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(axisWorld.dot(cross), THREE.MathUtils.clamp(from.dot(to), -1, 1));
};

export const applyTranslationSnap = (distance: number, snap: number | null | undefined) => {
  if (!snap || snap <= 0) return distance;
  return Math.round(distance / snap) * snap;
};

export const applyRotationSnap = (angle: number, snap: number | null | undefined) => {
  if (!snap || snap <= 0) return angle;
  return Math.round(angle / snap) * snap;
};

export const getVisualThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.35;

export const getPickerThicknessScale = (thicknessScale: number) =>
  1 + Math.max(0, thicknessScale - 1) * 0.55;

export const clampObjectPosition = (
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

// ---------------------------------------------------------------------------
// Visibility & scale helpers
// ---------------------------------------------------------------------------

export const resolveWorldGizmoScale = (size = 1) => (Number.isFinite(size) && size > 0 ? size : 1);

export const getAxisVisible = (
  axis: AxisName,
  props: Pick<FusionTransformControlsProps, 'showX' | 'showY' | 'showZ'>,
) => {
  if (axis === 'X') return props.showX !== false;
  if (axis === 'Y') return props.showY !== false;
  return props.showZ !== false;
};

// ---------------------------------------------------------------------------
// Type guards & camera helpers
// ---------------------------------------------------------------------------

export const isAxisName = (value: unknown): value is AxisName =>
  value === 'X' || value === 'Y' || value === 'Z';

export const isTranslatePlaneName = (value: unknown): value is FusionTranslatePlaneName =>
  value === 'XY' || value === 'YZ' || value === 'XZ';

export const getCameraDirection = (camera: THREE.Camera) =>
  camera.getWorldDirection(new THREE.Vector3()).normalize();

export const getCameraRight = (camera: THREE.Camera) =>
  new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();

export const getCameraUp = (camera: THREE.Camera) =>
  new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

export const getObjectToCameraVector = (camera: THREE.Camera, origin: THREE.Vector3) => {
  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const objectToCamera = cameraPosition.sub(origin);
  if (objectToCamera.lengthSq() > 1e-8) {
    return objectToCamera.normalize();
  }
  return getCameraDirection(camera).multiplyScalar(-1);
};

export const isWorldVisible = (object: THREE.Object3D) => {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Hover & scale utilities
// ---------------------------------------------------------------------------

export const collectActiveHoverTargets = (root: THREE.Object3D | null, active: ActiveHandle) => {
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

export const updateHoverScales = (root: THREE.Object3D | null, active: ActiveHandle | null) => {
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

export const updateRotateCameraFacingHandles = ({
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

// ---------------------------------------------------------------------------
// Drag setup resolution
// ---------------------------------------------------------------------------

export const resolveTranslateDragSetup = ({
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
        getFusionTranslateAxisUnit(planeAxis).applyQuaternion(spaceQuaternion).normalize(),
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

export const resolveRotateDragSetup = ({
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

// ---------------------------------------------------------------------------
// Layout application functions
// ---------------------------------------------------------------------------

export const prepareFusionRootLayout = ({
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
  root: import('./FusionTransformControls.types').FusionRootGroup | null;
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

export const resolveLayoutQuaternion = ({
  object,
  primaryObject,
  space,
}: {
  object: THREE.Object3D | undefined;
  primaryObject: THREE.Object3D;
  space: 'local' | 'world';
}) => (space === 'world' ? new THREE.Quaternion() : getWorldQuaternion(object ?? primaryObject));

export const applyTranslateGroupLayout = ({
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

export const applyRotateGroupLayout = ({
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

export const applyGuideGroupLayout = ({
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
    active.owner === 'rotate' ? rotateScale : Math.max(GUIDE_MIN_HALF_LENGTH, translateScale * 3),
  );
};

export const syncDefaultControlsSuppression = ({
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
