import * as THREE from 'three';

import type { ViewerHelperKind } from '@/shared/components/3d/robot/types';

import {
  IK_HANDLE_IDLE_COLOR,
  IK_HANDLE_HOVER_COLOR,
  IK_HANDLE_SELECTED_COLOR,
  ORIGIN_AXES_HOVER_LIFT,
  ORIGIN_AXES_SELECTED_LIFT,
  getHelperOpacityMultiplier,
  getHelperRenderOrderOffset,
  getHelperScaleMultiplier,
  getJointHelperObjects,
  getLinkHelperObjects,
  resolveHelperInteractionState,
  resolveHelperKindFromObject,
  updateInteractionColor,
  updateInteractionColorLift,
  updateInteractionOpacity,
  updateInteractionRenderOrder,
  updateInteractionScale,
} from '@/shared/components/3d/robot/utils/visualizationSync/interactionPrimitives';

interface SyncLinkHelperInteractionStateOptions {
  links: THREE.Object3D[];
  hoveredLinkId?: string | null;
  hoveredHelperKind?: ViewerHelperKind | null;
  selectedLinkId?: string | null;
  selectedHelperKind?: ViewerHelperKind | null;
}

interface SyncJointHelperInteractionStateOptions {
  joints: THREE.Object3D[];
  hoveredJointId?: string | null;
  hoveredHelperKind?: ViewerHelperKind | null;
  selectedJointId?: string | null;
  selectedHelperKind?: ViewerHelperKind | null;
}

export function syncLinkHelperInteractionStateForLinks({
  links,
  hoveredLinkId = null,
  hoveredHelperKind = null,
  selectedLinkId = null,
  selectedHelperKind = null,
}: SyncLinkHelperInteractionStateOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;
    const helperObjects = getLinkHelperObjects(link);

    helperObjects.forEach((helperObject) => {
      const helperKind = resolveHelperKindFromObject(helperObject);
      const state = resolveHelperInteractionState(
        hoveredLinkId === link.name && (!hoveredHelperKind || hoveredHelperKind === helperKind),
        selectedLinkId === link.name && (!selectedHelperKind || selectedHelperKind === helperKind),
      );
      const helperName = helperObject.name;
      const scaleMultiplier =
        helperName === '__com_visual__'
          ? getHelperScaleMultiplier(state, 1.16, 1.08)
          : helperName === '__inertia_box__'
            ? getHelperScaleMultiplier(state, 1.02, 1.01)
            : helperName === '__ik_handle__'
              ? getHelperScaleMultiplier(state, 1.12, 1.06)
              : // Thin axis helpers should not change their hit footprint on hover,
                // otherwise the cursor can oscillate between hit/miss on dense scenes.
                helperName === '__origin_axes__'
                ? 1
                : getHelperScaleMultiplier(state, 1.14, 1.05);
      const renderOrderOffset = getHelperRenderOrderOffset(state);
      const activeColorHex =
        helperName === '__ik_handle__'
          ? state === 'hovered'
            ? IK_HANDLE_HOVER_COLOR
            : state === 'selected'
              ? IK_HANDLE_SELECTED_COLOR
              : IK_HANDLE_IDLE_COLOR
          : undefined;
      const originAxesColorLift =
        helperName === '__origin_axes__'
          ? state === 'hovered'
            ? ORIGIN_AXES_HOVER_LIFT
            : state === 'selected'
              ? ORIGIN_AXES_SELECTED_LIFT
              : 0
          : 0;

      changed = updateInteractionScale(helperObject, scaleMultiplier) || changed;

      helperObject.traverse((child: any) => {
        if (child.isMesh || child.type === 'LineSegments') {
          changed = updateInteractionRenderOrder(child, renderOrderOffset) || changed;
        }

        if (!child.material) {
          return;
        }

        const opacityMultiplier =
          helperName === '__inertia_box__'
            ? child.type === 'LineSegments'
              ? getHelperOpacityMultiplier(state, 1.45, 1.2)
              : getHelperOpacityMultiplier(state, 1.8, 1.45)
            : helperName === '__ik_handle__'
              ? getHelperOpacityMultiplier(state, 1.45, 1.2)
              : helperName === '__com_visual__'
                ? getHelperOpacityMultiplier(state, 1.08, 1.03)
                : getHelperOpacityMultiplier(state, 1, 1);

        changed = updateInteractionOpacity(child.material, opacityMultiplier) || changed;
        changed = updateInteractionColor(child.material, activeColorHex) || changed;
        if (helperName === '__origin_axes__') {
          changed = updateInteractionColorLift(child.material, originAxesColorLift) || changed;
        }
      });
    });
  });

  return changed;
}

export function syncJointHelperInteractionStateForJoints({
  joints,
  hoveredJointId = null,
  hoveredHelperKind = null,
  selectedJointId = null,
  selectedHelperKind = null,
}: SyncJointHelperInteractionStateOptions): boolean {
  let changed = false;

  joints.forEach((joint: any) => {
    if (!joint.isURDFJoint || joint.jointType === 'fixed') return;

    const state = resolveHelperInteractionState(
      hoveredJointId === joint.name && (!hoveredHelperKind || hoveredHelperKind === 'joint-axis'),
      selectedJointId === joint.name &&
        (!selectedHelperKind || selectedHelperKind === 'joint-axis'),
    );
    const helperObjects = getJointHelperObjects(joint);
    const activeColorHex =
      state === 'hovered' ? 0xfbbf24 : state === 'selected' ? 0xf472b6 : undefined;

    helperObjects.forEach((helperObject) => {
      changed = updateInteractionScale(helperObject, 1) || changed;

      helperObject.traverse((child: any) => {
        if (child.isMesh || child.type === 'LineSegments') {
          changed =
            updateInteractionRenderOrder(child, getHelperRenderOrderOffset(state)) || changed;
        }

        if (!child.material) {
          return;
        }

        changed = updateInteractionColor(child.material, activeColorHex) || changed;
      });
    });
  });

  return changed;
}
