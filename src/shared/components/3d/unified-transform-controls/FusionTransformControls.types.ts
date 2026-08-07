import type * as THREE from 'three';

import type { UnifiedTransformControlsProps } from './gizmoCore';
import type { FusionTranslatePlaneName } from './fusionTranslatePlane';

export type AxisName = 'X' | 'Y' | 'Z';
export type FusionOwner = 'translate' | 'rotate';
export type RotateHandleName = AxisName | 'E' | 'XYZE';
export type TranslateHandleName = AxisName | FusionTranslatePlaneName | 'XYZ';
export type FusionHandleName = RotateHandleName | TranslateHandleName;
export type DragKind = 'axis' | 'plane' | 'center' | 'trackball';

export type ActiveHandle = {
  owner: FusionOwner;
  axis: FusionHandleName;
};

export type FusionControlState = THREE.EventDispatcher & {
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

export type FusionTransformControlsProps = Omit<UnifiedTransformControlsProps, 'onObjectChange'> & {
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

export type DragState = {
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

export type DragSetup = {
  axisLocal: THREE.Vector3;
  axisWorld: THREE.Vector3;
  dragKind: DragKind;
  ownerSpace: 'local' | 'world';
  plane: THREE.Plane;
  planeAxesWorld: [THREE.Vector3, THREE.Vector3] | null;
};

export type FusionRootGroup = THREE.Group & {
  activeOwner?: FusionOwner | null;
  axis?: FusionHandleName | null;
  dragging?: boolean;
};