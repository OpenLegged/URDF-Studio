import * as THREE from 'three';

import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import {
  getVisualGeometryEntries,
  resolveDirectManipulableLinkIkDescriptor,
  resolveLinkIkHandleDescriptor,
  resolveLinkKey,
} from '@/core/robot';
import { GIZMO_BASE_RENDER_ORDER } from '@/shared/components/3d/unified-transform-controls/gizmoCore.ts';
import { MathUtils as SharedMathUtils } from '@/shared/utils';
import { type RobotData, type UrdfJoint, type UrdfLink } from '@/types';

import { getRobotSceneNodeIndex } from '../robotSceneNodeIndex';
import {
  createLinkIkHandle,
  createCoMVisual,
  createInertiaBox,
  createJointAxisViz,
  createOriginAxes,
} from '../visualizationFactories.ts';

import {
  scratchLinkBox,
  scratchLinkSize,
  scratchEuler,
  scratchQuaternion,
} from './scratch';
import {
  disposeObject3DResources,
  updatePosition,
  updateQuaternion,
  updateMaterialState,
  updateRenderOrder,
  updateScale,
  updateVisible,
} from './objectPrimitives';
import {
  IK_HANDLE_STYLE_VERSION,
  updateBaseRenderOrder,
  updateInteractionColor,
} from './interactionPrimitives';

interface SyncOriginAxesVisualizationOptions {
  links: THREE.Object3D[];
  showOrigins: boolean;
  showOriginsOverlay: boolean;
  originSize: number;
}

interface SyncJointAxesVisualizationOptions {
  joints: THREE.Object3D[];
  showJointAxes: boolean;
  showJointAxesOverlay: boolean;
  jointAxisSize: number;
}

interface SyncInertiaVisualizationOptions {
  links: THREE.Object3D[];
  robotLinks?: Record<string, UrdfLink>;
  showInertia: boolean;
  showInertiaOverlay: boolean;
  showCenterOfMass: boolean;
  showCoMOverlay: boolean;
  centerOfMassSize: number;
  pooledLinkBox?: THREE.Box3;
  pooledLinkSize?: THREE.Vector3;
}

interface SyncIkHandleVisualizationOptions {
  links: THREE.Object3D[];
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  showIkHandles: boolean;
  showIkHandlesAlwaysOnTop: boolean;
  ikDragActive?: boolean;
}

const ORIGIN_OVERLAY_BASE_RENDER_ORDER = GIZMO_BASE_RENDER_ORDER - 60;

function resolveRobotRootLinkId(
  robotLinks?: Record<string, UrdfLink>,
  robotJoints?: Record<string, UrdfJoint>,
): string | null {
  if (!robotLinks || !robotJoints) {
    return null;
  }

  const linkIds = Object.keys(robotLinks);
  if (linkIds.length === 0) {
    return null;
  }

  const childLinkIds = new Set(Object.values(robotJoints).map((joint) => joint.childLinkId));
  return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
}

export function syncIkHandleVisualizationForLinks({
  links,
  robotLinks,
  robotJoints,
  showIkHandles,
  showIkHandlesAlwaysOnTop,
  ikDragActive = false,
}: SyncIkHandleVisualizationOptions): boolean {
  let changed = false;
  const rootLinkId = resolveRobotRootLinkId(robotLinks, robotJoints);
  const robotData =
    robotLinks && robotJoints && rootLinkId
      ? { links: robotLinks, joints: robotJoints, rootLinkId }
      : null;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    let ikHandle = link.userData.__ikHandle as THREE.Group | undefined;
    if (ikHandle && ikHandle.parent !== link) {
      ikHandle = undefined;
      link.userData.__ikHandle = undefined;
    }

    const scopedRobotData = robotData;
    const linkId = scopedRobotData ? resolveLinkKey(scopedRobotData.links, link.name) : null;
    const descriptor = linkId && scopedRobotData
      ? ikDragActive
        ? (resolveDirectManipulableLinkIkDescriptor(scopedRobotData, linkId) ??
          resolveLinkIkHandleDescriptor(scopedRobotData, linkId))
        : resolveLinkIkHandleDescriptor(scopedRobotData, linkId)
      : null;

    if (!descriptor) {
      if (ikHandle) {
        link.remove(ikHandle);
        disposeObject3DResources(ikHandle);
        link.userData.__ikHandle = undefined;
        changed = true;
      }
      return;
    }

    const currentRadius = Number(ikHandle?.userData?.radius ?? NaN);
    const currentStyleVersion = Number(ikHandle?.userData?.ikHandleStyleVersion ?? NaN);
    const needsReplacement =
      !ikHandle ||
      !Number.isFinite(currentRadius) ||
      Math.abs(currentRadius - descriptor.radius) > 1e-6 ||
      currentStyleVersion !== IK_HANDLE_STYLE_VERSION;

    if (needsReplacement) {
      if (ikHandle) {
        link.remove(ikHandle);
        disposeObject3DResources(ikHandle);
      }

      ikHandle = createLinkIkHandle(descriptor.radius);
      link.add(ikHandle);
      link.userData.__ikHandle = ikHandle;
      changed = true;
    }

    if (!ikHandle) {
      return;
    }

    ikHandle.userData.radius = descriptor.radius;
    ikHandle.userData.ikHandleStyleVersion = IK_HANDLE_STYLE_VERSION;
    ikHandle.userData.parentLinkName = link.name;
    ikHandle.userData.viewerHelperKind = 'ik-handle';
    changed = updateVisible(ikHandle, showIkHandles) || changed;
    changed =
      updatePosition(
        ikHandle,
        descriptor.anchorLocal.x,
        descriptor.anchorLocal.y,
        descriptor.anchorLocal.z,
      ) || changed;

    ikHandle.traverse((child: any) => {
      if (child === ikHandle) {
        return;
      }

      child.userData = {
        ...child.userData,
        ikHandleStyleVersion: IK_HANDLE_STYLE_VERSION,
        parentLinkName: link.name,
        viewerHelperKind: 'ik-handle',
      };
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            transparent: true,
            opacity: 0.68,
            depthTest: !showIkHandlesAlwaysOnTop,
            depthWrite: false,
          }) || changed;
        changed = updateInteractionColor(child.material, undefined) || changed;
      }

      if (child.isMesh || child.type === 'LineSegments') {
        changed = updateBaseRenderOrder(child, showIkHandlesAlwaysOnTop ? 10030 : 0) || changed;
      }
    });
  });

  return changed;
}

export function syncOriginAxesVisualizationForLinks({
  links,
  showOrigins,
  showOriginsOverlay,
  originSize,
}: SyncOriginAxesVisualizationOptions): boolean {
  let changed = false;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    let originAxes = link.userData.__originAxes as THREE.Group | undefined;
    if (originAxes && originAxes.parent !== link) {
      originAxes = undefined;
      link.userData.__originAxes = undefined;
    }

    if (!originAxes && showOrigins) {
      originAxes = createOriginAxes(originSize);
      link.add(originAxes);
      originAxes.userData.size = originSize;
      link.userData.__originAxes = originAxes;
      changed = true;
    }

    if (!originAxes) return;

    changed = updateVisible(originAxes, showOrigins) || changed;
    if (!showOrigins) return;

    changed = updateScale(originAxes, 1) || changed;

    const previousSize = originAxes.userData.size;
    if (typeof previousSize !== 'number' || Math.abs(previousSize - originSize) > 0.001) {
      while (originAxes.children.length > 0) {
        const child = originAxes.children[0];
        originAxes.remove(child);
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) (child as any).material.dispose();
      }

      const replacementAxes = createOriginAxes(originSize);
      while (replacementAxes.children.length > 0) {
        originAxes.add(replacementAxes.children[0]);
      }
      originAxes.userData.size = originSize;
      changed = true;
    }

    originAxes.traverse((child: any) => {
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            depthTest: !showOriginsOverlay,
            depthWrite: !showOriginsOverlay,
            transparent: showOriginsOverlay,
          }) || changed;
      }

      if (child.isMesh) {
        const nextRenderOrder = showOriginsOverlay ? ORIGIN_OVERLAY_BASE_RENDER_ORDER : 0;
        const didChange = updateRenderOrder(child, nextRenderOrder);
        changed = didChange || changed;
        if (didChange || child.renderOrder === nextRenderOrder) {
          child.userData.__interactionBaseRenderOrder = nextRenderOrder;
        }
      }
    });
  });

  return changed;
}

export function syncJointAxesVisualizationForJoints({
  joints,
  showJointAxes,
  showJointAxesOverlay,
  jointAxisSize,
}: SyncJointAxesVisualizationOptions): boolean {
  let changed = false;

  joints.forEach((joint: any) => {
    if (!joint.isURDFJoint || joint.jointType === 'fixed') return;

    let jointAxisViz = joint.userData.__jointAxisViz as THREE.Object3D | undefined;
    if (jointAxisViz && jointAxisViz.parent !== joint) {
      jointAxisViz = undefined;
      joint.userData.__jointAxisViz = undefined;
    }

    if (!jointAxisViz && showJointAxes) {
      const axis = joint.axis || new THREE.Vector3(0, 0, 1);
      jointAxisViz = createJointAxisViz(joint.jointType, axis, jointAxisSize);
      joint.add(jointAxisViz);
      jointAxisViz.userData.size = jointAxisSize;
      jointAxisViz.userData.axisX = axis.x;
      jointAxisViz.userData.axisY = axis.y;
      jointAxisViz.userData.axisZ = axis.z;
      jointAxisViz.userData.jointType = joint.jointType;
      joint.userData.__jointAxisViz = jointAxisViz;
      changed = true;
    }

    if (!jointAxisViz) return;

    changed = updateVisible(jointAxisViz, showJointAxes) || changed;
    if (!showJointAxes) return;

    const originalScale = jointAxisViz.userData.size;
    const origAxisX = jointAxisViz.userData.axisX;
    const origAxisY = jointAxisViz.userData.axisY;
    const origAxisZ = jointAxisViz.userData.axisZ;
    const origJointType = jointAxisViz.userData.jointType;
    const currentAxis = joint.axis || new THREE.Vector3(0, 0, 1);

    if (
      typeof originalScale !== 'number' ||
      Math.abs(jointAxisSize - originalScale) > 0.01 ||
      origAxisX !== currentAxis.x ||
      origAxisY !== currentAxis.y ||
      origAxisZ !== currentAxis.z ||
      origJointType !== joint.jointType
    ) {
      joint.remove(jointAxisViz);
      jointAxisViz.traverse((child: any) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });

      const replacement = createJointAxisViz(joint.jointType, currentAxis, jointAxisSize);
      joint.add(replacement);
      replacement.userData.size = jointAxisSize;
      replacement.userData.axisX = currentAxis.x;
      replacement.userData.axisY = currentAxis.y;
      replacement.userData.axisZ = currentAxis.z;
      replacement.userData.jointType = joint.jointType;
      joint.userData.__jointAxisViz = replacement;
      jointAxisViz = replacement;
      changed = true;
    }

    jointAxisViz.traverse((child: any) => {
      if (child.material) {
        changed =
          updateMaterialState(child.material, {
            depthTest: !showJointAxesOverlay,
            depthWrite: !showJointAxesOverlay,
            transparent: showJointAxesOverlay,
          }) || changed;
      }

      if (child.isMesh) {
        const nextRenderOrder = showJointAxesOverlay ? 10001 : 0;
        const didChange = updateRenderOrder(child, nextRenderOrder);
        changed = didChange || changed;
        if (didChange || child.renderOrder === nextRenderOrder) {
          child.userData.__interactionBaseRenderOrder = nextRenderOrder;
        }
      }
    });
  });

  return changed;
}

export function syncInertiaVisualizationForLinks({
  links,
  robotLinks,
  showInertia,
  showInertiaOverlay,
  showCenterOfMass,
  showCoMOverlay,
  centerOfMassSize,
  pooledLinkBox,
  pooledLinkSize,
}: SyncInertiaVisualizationOptions): boolean {
  let changed = false;
  const linkBox = pooledLinkBox ?? scratchLinkBox;
  const linkSize = pooledLinkSize ?? scratchLinkSize;

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;

    const linkData = robotLinks?.[link.name];
    const inertialData = linkData?.inertial;
    if (!inertialData || inertialData.mass <= 0) return;

    let vizGroup = link.userData.__inertiaVisualGroup as THREE.Group | undefined;
    if (vizGroup && vizGroup.parent !== link) {
      vizGroup = undefined;
      link.userData.__inertiaVisualGroup = undefined;
      link.userData.__comVisual = undefined;
      link.userData.__inertiaBox = undefined;
    }

    if (!vizGroup) {
      vizGroup = new THREE.Group();
      vizGroup.name = '__inertia_visual__';
      vizGroup.userData = { isGizmo: true, isSelectableHelper: true };
      link.add(vizGroup);
      link.userData.__inertiaVisualGroup = vizGroup;
      changed = true;
    }

    let comVisual = link.userData.__comVisual as THREE.Object3D | undefined;
    if (comVisual && comVisual.parent !== vizGroup) {
      comVisual = undefined;
      link.userData.__comVisual = undefined;
    }
    if (!comVisual) {
      comVisual = createCoMVisual();
      vizGroup.add(comVisual);
      link.userData.__comVisual = comVisual;
      changed = true;
    }

    const sizeScale = centerOfMassSize / 0.01;
    changed = updateScale(comVisual, sizeScale) || changed;
    changed = updateVisible(comVisual, showCenterOfMass) || changed;

    if (showCenterOfMass) {
      comVisual.traverse((child: any) => {
        if (child.material) {
          changed =
            updateMaterialState(child.material, {
              opacity: 0.95,
              transparent: true,
              depthTest: !showCoMOverlay,
              depthWrite: !showCoMOverlay,
            }) || changed;
        }

        if (child.isMesh) {
          const nextRenderOrder = showCoMOverlay ? 10001 : 0;
          const didChange = updateRenderOrder(child, nextRenderOrder);
          changed = didChange || changed;
          if (didChange || child.renderOrder === nextRenderOrder) {
            child.userData.__interactionBaseRenderOrder = nextRenderOrder;
          }
        }
      });
    }

    let inertiaBox = link.userData.__inertiaBox as THREE.Object3D | undefined;
    if (inertiaBox && inertiaBox.parent !== vizGroup) {
      inertiaBox = undefined;
      link.userData.__inertiaBox = undefined;
    }

    // Detect inertial data changes and re-create box
    const inertia = inertialData.inertia;
    const inertiaKey = `${inertialData.mass}:${inertia.ixx}:${inertia.ixy}:${inertia.ixz}:${inertia.iyy}:${inertia.iyz}:${inertia.izz}`;
    const prevInertiaKey = link.userData.__inertiaBoxKey as string | undefined;
    if (inertiaBox && prevInertiaKey !== undefined && prevInertiaKey !== inertiaKey) {
      inertiaBox.parent?.remove(inertiaBox);
      disposeObject3DResources(inertiaBox);
      link.userData.__inertiaBox = undefined;
      link.userData.__inertiaBoxKey = undefined;
      link.userData.__cachedMaxLinkSize = undefined;
      inertiaBox = undefined;
      changed = true;
    }

    if (!inertiaBox) {
      let maxLinkSize: number | undefined;
      try {
        const cachedMaxLinkSize = link.userData.__cachedMaxLinkSize;
        if (
          typeof cachedMaxLinkSize === 'number' &&
          isFinite(cachedMaxLinkSize) &&
          cachedMaxLinkSize > 0
        ) {
          maxLinkSize = cachedMaxLinkSize;
        } else {
          const sizeVector = linkBox.setFromObject(link).getSize(linkSize);
          maxLinkSize = Math.max(sizeVector.x, sizeVector.y, sizeVector.z);
          if (isFinite(maxLinkSize) && maxLinkSize > 0) {
            link.userData.__cachedMaxLinkSize = maxLinkSize;
          }
        }

        if (!isFinite(maxLinkSize) || maxLinkSize <= 0) {
          maxLinkSize = undefined;
        }
      } catch (e) {
        console.error('[visualizationObjectSync] Failed to compute maxLinkSize for inertia box:', e);
        maxLinkSize = undefined;
      }

      const boxData = SharedMathUtils.computeInertiaBox(inertialData, maxLinkSize);
      if (boxData) {
        const { width, height, depth, rotation } = boxData;
        inertiaBox = createInertiaBox(width, height, depth, rotation);
        vizGroup.add(inertiaBox);
        link.userData.__inertiaBox = inertiaBox;
        link.userData.__inertiaBoxKey = inertiaKey;
        changed = true;
      }
    }

    if (inertiaBox) {
      changed = updateVisible(inertiaBox, showInertia) || changed;

      if (showInertia) {
        inertiaBox.traverse((child: any) => {
          if (child.material) {
            changed =
              updateMaterialState(child.material, {
                opacity:
                  child.type === 'Mesh' ? 0.25 : child.type === 'LineSegments' ? 0.6 : undefined,
                transparent: true,
                depthTest: !showInertiaOverlay,
                depthWrite: false,
              }) || changed;
          }

          if (child.isMesh || child.type === 'LineSegments') {
            const nextRenderOrder = showInertiaOverlay ? 10001 : 0;
            const didChange = updateRenderOrder(child, nextRenderOrder);
            changed = didChange || changed;
            if (didChange || child.renderOrder === nextRenderOrder) {
              child.userData.__interactionBaseRenderOrder = nextRenderOrder;
            }
          }
        });
      }
    }

    const origin = inertialData.origin;
    if (origin) {
      const xyz = origin.xyz || { x: 0, y: 0, z: 0 };
      const rpy = origin.rpy || { r: 0, p: 0, y: 0 };

      changed = updatePosition(vizGroup, xyz.x, xyz.y, xyz.z) || changed;
      scratchEuler.set(rpy.r, rpy.p, rpy.y, 'ZYX');
      scratchQuaternion.setFromEuler(scratchEuler);
      changed = updateQuaternion(vizGroup, scratchQuaternion) || changed;
    }

    changed = updateVisible(vizGroup, showInertia || showCenterOfMass) || changed;
  });

  return changed;
}

/**
 * Sync visual mesh colors from robotLinks data to Three.js materials.
 * Detects when the stored color differs from the material color and updates in place.
 */
export function syncLinkVisualColors({
  robot,
  robotLinks,
  robotMaterials,
}: {
  robot: THREE.Object3D;
  robotLinks?: Record<string, UrdfLink>;
  robotMaterials?: RobotData['materials'];
}): boolean {
  if (!robotLinks) return false;
  let changed = false;
  const { links } = getRobotSceneNodeIndex(robot);

  const resolveLinkMaterialColor = (linkData: UrdfLink): string | undefined => {
    const materialColor =
      robotMaterials?.[linkData.id]?.color ||
      (linkData.name ? robotMaterials?.[linkData.name]?.color : undefined);
    return materialColor?.trim() || undefined;
  };

  const syncVisualRootColor = (visualRoot: THREE.Object3D, targetColor: string): void => {
    const parsedTargetColor = parseThreeColorWithOpacity(targetColor);
    if (!parsedTargetColor) return;

    visualRoot.traverse((child: any) => {
      if (!child.isMesh || !child.userData.isVisualMesh) return;
      if (child.userData.hasVertexColors) return;
      if (child.userData.__urdfHighlightSnapshot) return;

      const mat = child.material as THREE.MeshStandardMaterial | undefined;
      if (!mat?.color) return;

      const lastSynced = child.userData.__syncedColor as string | undefined;
      if (lastSynced === targetColor) return;

      const nextOpacity = parsedTargetColor.opacity;
      const colorMatches = mat.color.equals(parsedTargetColor.color);
      const opacityMatches =
        nextOpacity == null || Math.abs((mat.opacity ?? 1) - nextOpacity) <= 1e-6;

      if (colorMatches && opacityMatches) {
        child.userData.__syncedColor = targetColor;
        return;
      }

      if (!colorMatches) {
        mat.color.copy(parsedTargetColor.color);
      }
      if (nextOpacity != null && !opacityMatches) {
        mat.opacity = nextOpacity;
        if (nextOpacity < 1) {
          mat.transparent = true;
        }
      }
      mat.needsUpdate = true;
      child.userData.__syncedColor = targetColor;
      changed = true;
    });
  };

  links.forEach((link: any) => {
    if (!link.isURDFLink) return;
    const linkData = robotLinks[link.name];
    if (!linkData) return;

    const visualEntries = getVisualGeometryEntries(linkData);
    const visualGroups = link.children.filter((child: any) => child.isURDFVisual);
    const linkMaterialColor = resolveLinkMaterialColor(linkData);
    if (visualGroups.length > 0) {
      visualEntries.forEach((entry, index) => {
        const targetColor =
          index === 0 ? linkMaterialColor || entry.geometry.color : entry.geometry.color;
        const visualGroup = visualGroups[index];
        if (!targetColor || !visualGroup) return;
        syncVisualRootColor(visualGroup, targetColor);
      });
      return;
    }

    const primaryTargetColor = linkMaterialColor || visualEntries[0]?.geometry.color;
    if (!primaryTargetColor) return;
    syncVisualRootColor(link, primaryTargetColor);
  });

  return changed;
}
