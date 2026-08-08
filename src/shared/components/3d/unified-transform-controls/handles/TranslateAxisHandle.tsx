import React, { useMemo } from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import {
  GIZMO_ARC_RENDER_ORDER,
  THICK_TRANSLATE_PICKER_RADIUS,
  THICK_TRANSLATE_SHAFT_RADIUS,
  THICK_ROTATE_ARC_RADIUS,
  TRANSLATE_CENTER_GAP,
} from '../gizmoCore';
import { resolveFusionTranslateShaftStart } from '../fusionRotateKnob';
import { GizmoMaterial } from '../FusionTransformMaterials';
import {
  createAxisAlignedCylinderGeometry,
  createAxisAlignedConeGeometry,
  getVisualThicknessScale,
  getPickerThicknessScale,
} from '../FusionTransformControls.utils';
import type { AxisName, FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import {
  AXIS_COLORS,
  FUSION_TRANSLATE_ARROW_BASE_RADIUS,
  FUSION_TRANSLATE_ARROW_LENGTH,
  FUSION_TRANSLATE_PICKER_START_PADDING,
  FUSION_TRANSLATE_SHAFT_END,
} from '../FusionTransformControls.constants';

export function TranslateAxisHandle({
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
