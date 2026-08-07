import * as THREE from 'three';

import type { AxisName } from './FusionTransformControls.types';

export const AXES = ['X', 'Y', 'Z'] as const;
export const TRANSLATE_PLANES = ['XY', 'YZ', 'XZ'] as const;
export const AXIS_COLORS: Record<AxisName, string> = {
  X: '#ff4d5d',
  Y: '#45c95a',
  Z: '#2d8cff',
};
export const ACTIVE_AXIS_COLOR = '#ff9500';
export const ROTATE_GUIDE_RING_OPACITY = 0.28;
export const ROTATE_FRONT_ARC_OPACITY = 0.95;
export const ROTATE_E_RING_COLOR = '#f7f9ff';
export const ROTATE_E_RING_OPACITY = 0.9;
export const ROTATE_TRACKBALL_COLOR = '#f9fbff';
export const ROTATE_TRACKBALL_OPACITY = 0.74;
export const TRANSLATE_PLANE_OPACITY = 0.28;
export const TRANSLATE_PLANE_ACTIVE_OPACITY = 0.42;
export const TRANSLATE_CENTER_COLOR = '#f9fbff';
export const TRANSLATE_CENTER_OPACITY = 0.86;
// Hover feedback is color-only (CAD convention: AutoCAD / 3ds Max / Blender
// highlight the hovered handle via ACTIVE_AXIS_COLOR, they never grow/scale the
// geometry). Keeping the target at 1 makes the hover-scale machinery a no-op so
// handles — especially the large screen-facing E-ring — no longer "move/grow"
// under the pointer.
export const HOVER_TARGET_SCALE = 1;
export const HOVER_SCALE_LERP = 0.26;
export const FUSION_TRANSLATE_SHAFT_END = 0.9;
export const FUSION_TRANSLATE_ARROW_LENGTH = 0.22;
export const FUSION_TRANSLATE_ARROW_BASE_RADIUS = 0.052;
export const FUSION_TRANSLATE_PICKER_START_PADDING = 0.035;
// Always-on pivot marker so the user can clearly see the transform center in
// universal / rotate modes (CAD/Blender convention: a small bright dot with a
// thin dark outline at the manipulation origin). Sized in rotate-group local
// space so it scales consistently with each gizmo.
export const FUSION_PIVOT_RADIUS = 0.034;
export const FUSION_PIVOT_OUTLINE_RADIUS = 0.045;
export const FUSION_PIVOT_COLOR = '#ffffff';
export const FUSION_PIVOT_OUTLINE_COLOR = '#10151f';
export const FUSION_PIVOT_OPACITY = 1;
export const FUSION_PIVOT_OUTLINE_OPACITY = 0.5;
export const ROTATE_DRAG_SECTOR_RADIUS = 0.5;
export const ROTATE_DRAG_SECTOR_OPACITY = 0.28;
export const ROTATE_DRAG_SECTOR_SEGMENTS = 64;
export const GUIDE_DASH_SEGMENTS = 22;
export const GUIDE_DASH_DUTY = 0.62;
export const GUIDE_MIN_HALF_LENGTH = 2.5;
export const ROTATE_GUIDE_DASH_SEGMENTS = 52;
export const ROTATE_GUIDE_DASH_DUTY = 0.48;

export const AXIS_UNIT: Record<AxisName, THREE.Vector3> = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};