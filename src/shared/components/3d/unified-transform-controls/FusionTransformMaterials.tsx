import React from 'react';

import type { AxisName } from './FusionTransformControls.types';
import { ACTIVE_AXIS_COLOR, AXIS_COLORS, ROTATE_GUIDE_RING_OPACITY } from './FusionTransformControls.constants';

export function GizmoMaterial({
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

export function RotateRingMaterial({ active, axis }: { active?: boolean; axis: AxisName }) {
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

export function PlainGizmoMaterial({
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