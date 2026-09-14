import * as THREE from 'three';

import type { ViewerHelperKind } from '@/shared/components/3d/robot/types';

import { scratchHelperObjects } from '@/shared/components/3d/robot/utils/visualizationSync/scratch';

export const IK_HANDLE_STYLE_VERSION = 3;
export const IK_HANDLE_IDLE_COLOR = 0x16a34a;
export const IK_HANDLE_HOVER_COLOR = 0x22c55e;
export const IK_HANDLE_SELECTED_COLOR = 0x15803d;
export const ORIGIN_AXES_HOVER_LIFT = 0.32;
export const ORIGIN_AXES_SELECTED_LIFT = 0.18;

export type HelperInteractionState = 'idle' | 'selected' | 'hovered';

export function resolveHelperInteractionState(
  isHovered: boolean,
  isSelected: boolean,
): HelperInteractionState {
  if (isHovered) return 'hovered';
  if (isSelected) return 'selected';
  return 'idle';
}

export function updateInteractionScale(object: THREE.Object3D, multiplier: number): boolean {
  const previousMultiplier =
    typeof object.userData.__interactionScaleMultiplier === 'number'
      ? object.userData.__interactionScaleMultiplier
      : 1;
  const baseScaleX = object.scale.x / previousMultiplier;
  const baseScaleY = object.scale.y / previousMultiplier;
  const baseScaleZ = object.scale.z / previousMultiplier;
  const nextScaleX = baseScaleX * multiplier;
  const nextScaleY = baseScaleY * multiplier;
  const nextScaleZ = baseScaleZ * multiplier;

  if (
    object.scale.x === nextScaleX &&
    object.scale.y === nextScaleY &&
    object.scale.z === nextScaleZ
  ) {
    object.userData.__interactionScaleMultiplier = multiplier;
    return false;
  }

  object.scale.set(nextScaleX, nextScaleY, nextScaleZ);
  object.userData.__interactionScaleMultiplier = multiplier;
  return true;
}

export function updateInteractionRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  offset: number,
): boolean {
  const previousOffset =
    typeof object.userData.__interactionRenderOrderOffset === 'number'
      ? object.userData.__interactionRenderOrderOffset
      : 0;
  const baseRenderOrder =
    typeof object.userData.__interactionBaseRenderOrder === 'number'
      ? object.userData.__interactionBaseRenderOrder
      : object.renderOrder - previousOffset;
  const nextRenderOrder = baseRenderOrder + offset;

  if (object.renderOrder === nextRenderOrder) {
    object.userData.__interactionBaseRenderOrder = baseRenderOrder;
    object.userData.__interactionRenderOrderOffset = offset;
    return false;
  }

  object.renderOrder = nextRenderOrder;
  object.userData.__interactionBaseRenderOrder = baseRenderOrder;
  object.userData.__interactionRenderOrderOffset = offset;
  return true;
}

export function updateBaseRenderOrder(
  object: THREE.Object3D & { renderOrder?: number },
  baseRenderOrder: number,
): boolean {
  const interactionOffset =
    typeof object.userData.__interactionRenderOrderOffset === 'number'
      ? object.userData.__interactionRenderOrderOffset
      : 0;
  const nextRenderOrder = baseRenderOrder + interactionOffset;

  object.userData.__interactionBaseRenderOrder = baseRenderOrder;

  if (object.renderOrder === nextRenderOrder) {
    return false;
  }

  object.renderOrder = nextRenderOrder;
  return true;
}

export function updateInteractionOpacity(
  material: THREE.Material & {
    opacity?: number;
    transparent?: boolean;
    needsUpdate?: boolean;
  },
  multiplier: number,
): boolean {
  if (typeof material.opacity !== 'number') {
    return false;
  }

  const previousMultiplier =
    typeof material.userData.__interactionOpacityMultiplier === 'number'
      ? material.userData.__interactionOpacityMultiplier
      : 1;
  const baseOpacity = material.opacity / previousMultiplier;
  const nextOpacity = THREE.MathUtils.clamp(baseOpacity * multiplier, 0, 1);
  const nextTransparent = material.transparent || nextOpacity < 1;
  let changed = false;

  if (material.opacity !== nextOpacity) {
    material.opacity = nextOpacity;
    changed = true;
  }

  if (material.transparent !== nextTransparent) {
    material.transparent = nextTransparent;
    changed = true;
  }

  if (changed) {
    material.needsUpdate = true;
  }

  material.userData.__interactionOpacityMultiplier = multiplier;
  return changed;
}

export function resolveHelperKindFromObject(object: THREE.Object3D): ViewerHelperKind | null {
  if (object.userData?.viewerHelperKind === 'ik-handle') {
    return 'ik-handle';
  }

  switch (object.name) {
    case '__ik_handle__':
      return 'ik-handle';
    case '__com_visual__':
      return 'center-of-mass';
    case '__inertia_box__':
      return 'inertia';
    case '__origin_axes__':
      return 'origin-axes';
    case '__joint_axis__':
    case '__joint_axis_helper__':
      return 'joint-axis';
    default:
      return null;
  }
}

export function updateInteractionColor(
  material: THREE.Material & {
    color?: THREE.Color;
    needsUpdate?: boolean;
  },
  activeColorHex?: number,
): boolean {
  if (!material.color?.isColor) {
    return false;
  }

  const previousOverride =
    typeof material.userData.__interactionColorOverride === 'number'
      ? material.userData.__interactionColorOverride
      : null;
  const baseColorHex =
    previousOverride !== null
      ? Number(material.userData.__interactionBaseColorHex ?? material.color.getHex())
      : material.color.getHex();
  const nextColorHex = activeColorHex ?? baseColorHex;

  material.userData.__interactionBaseColorHex = baseColorHex;
  material.userData.__interactionColorOverride = activeColorHex ?? null;

  if (material.color.getHex() === nextColorHex) {
    return false;
  }

  material.color.setHex(nextColorHex);
  material.needsUpdate = true;
  return true;
}

export function updateInteractionColorLift(
  material: THREE.Material & {
    color?: THREE.Color;
    needsUpdate?: boolean;
  },
  liftAmount: number,
): boolean {
  if (!material.color?.isColor) {
    return false;
  }

  const storedBaseColorHex = material.userData.__interactionLiftBaseColorHex;
  const baseColorHex =
    typeof storedBaseColorHex === 'number' ? storedBaseColorHex : material.color.getHex();
  const nextColor = new THREE.Color(baseColorHex).lerp(new THREE.Color(0xffffff), liftAmount);

  material.userData.__interactionLiftBaseColorHex = baseColorHex;
  material.userData.__interactionColorLift = liftAmount;

  if (material.color.equals(nextColor)) {
    return false;
  }

  material.color.copy(nextColor);
  material.needsUpdate = true;
  return true;
}

export function collectUniqueHelperObjects(
  ...objects: Array<THREE.Object3D | null | undefined>
): THREE.Object3D[] {
  scratchHelperObjects.clear();

  objects.forEach((object) => {
    if (object) {
      scratchHelperObjects.add(object);
    }
  });

  return Array.from(scratchHelperObjects);
}

export function getLinkHelperObjects(link: any): THREE.Object3D[] {
  return collectUniqueHelperObjects(
    link.userData.__ikHandle as THREE.Object3D | undefined,
    link.userData.__originAxes as THREE.Object3D | undefined,
    link.children.find((child: any) => child.name === '__link_axes_helper__'),
    link.userData.__comVisual as THREE.Object3D | undefined,
    link.userData.__inertiaBox as THREE.Object3D | undefined,
  );
}

export function getJointHelperObjects(joint: any): THREE.Object3D[] {
  return collectUniqueHelperObjects(
    joint.userData.__jointAxisViz as THREE.Object3D | undefined,
    joint.children.find((child: any) => child.name === '__joint_axis_helper__'),
  );
}

export function shouldHideMjcfWorldRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf',
  showMjcfWorldLink: boolean,
  runtimeLinkName: string | undefined,
): boolean {
  return sourceFormat === 'mjcf' && !showMjcfWorldLink && runtimeLinkName === 'world';
}

export function getHelperScaleMultiplier(
  state: HelperInteractionState,
  hoveredScale: number,
  selectedScale: number,
): number {
  if (state === 'hovered') return hoveredScale;
  if (state === 'selected') return selectedScale;
  return 1;
}

export function getHelperRenderOrderOffset(state: HelperInteractionState): number {
  if (state === 'hovered') return 40;
  if (state === 'selected') return 20;
  return 0;
}

export function getHelperOpacityMultiplier(
  state: HelperInteractionState,
  hoveredOpacity: number,
  selectedOpacity: number,
): number {
  if (state === 'hovered') return hoveredOpacity;
  if (state === 'selected') return selectedOpacity;
  return 1;
}
