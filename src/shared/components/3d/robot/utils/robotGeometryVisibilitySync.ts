import * as THREE from 'three';

import type { UrdfLink } from '@/types/index';

import { shouldSyncDirectLinkChildVisibility } from '@/shared/components/3d/robot/utils/runtimeVisibility';
import { syncCollisionGroupVisibility } from '@/shared/components/3d/robot/utils/collisionVisibilitySync';

function resolveLinkNameForNode(
  node: THREE.Object3D,
  inheritedLinkName: string | null,
): string | null {
  const explicitLinkName =
    typeof node.userData?.parentLinkName === 'string' && node.userData.parentLinkName
      ? node.userData.parentLinkName
      : null;

  return explicitLinkName ?? inheritedLinkName;
}

function shouldHideMjcfWorldRuntimeLink(
  sourceFormat: 'urdf' | 'mjcf',
  showMjcfWorldLink: boolean,
  runtimeLinkName: string | null,
): boolean {
  return sourceFormat === 'mjcf' && !showMjcfWorldLink && runtimeLinkName === 'world';
}

function isVisualGeometryVisible(
  linkData: UrdfLink | undefined,
  showVisual: boolean,
  forceHidden: boolean,
): boolean {
  if (forceHidden) {
    return false;
  }

  return showVisual && linkData?.visible !== false && linkData?.visual.visible !== false;
}

export interface SyncRobotGeometryVisibilityOptions {
  robot: THREE.Object3D;
  robotLinks?: Record<string, UrdfLink>;
  sourceFormat: 'urdf' | 'mjcf';
  showCollision: boolean;
  showVisual: boolean;
  showMjcfWorldLink?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  highlightedMeshes?: ReadonlyMap<THREE.Mesh, unknown>;
}

export function syncRobotGeometryVisibility({
  robot,
  robotLinks,
  sourceFormat,
  showCollision,
  showVisual,
  showMjcfWorldLink = false,
  showCollisionAlwaysOnTop = true,
  highlightedMeshes,
}: SyncRobotGeometryVisibilityOptions): boolean {
  let changed = false;
  const isCollisionGroup = (node: THREE.Object3D): boolean =>
    Boolean((node as any).isURDFCollider || node.userData?.isCollisionGroup === true);

  const walkNode = (node: THREE.Object3D, currentLinkName: string | null) => {
    const nextLinkName = (node as any).isURDFLink && node.name ? node.name : currentLinkName;
    const linkName = resolveLinkNameForNode(node, nextLinkName);
    const linkData = linkName ? robotLinks?.[linkName] : undefined;
    const forceHidden = shouldHideMjcfWorldRuntimeLink(sourceFormat, showMjcfWorldLink, linkName);

    if (isCollisionGroup(node)) {
      if (forceHidden) {
        if (node.visible !== false) {
          changed = true;
        }
        node.visible = false;
      } else {
        changed =
          syncCollisionGroupVisibility({
            collider: node,
            linkData,
            showCollision,
            showVisual,
            showCollisionAlwaysOnTop,
            // "Show Visual" is a presentation toggle and must not suppress
            // collision-only view. Respect per-link visibility only while
            // visuals are enabled.
            respectLinkVisibility: sourceFormat !== 'mjcf' && showVisual,
            highlightedMeshes,
          }) || changed;
      }

      if (!node.visible) {
        return;
      }
    }

    if (node.userData?.isVisualGroup) {
      const isVisible = isVisualGeometryVisible(linkData, showVisual, forceHidden);
      if (node.visible !== isVisible) {
        changed = true;
      }
      node.visible = isVisible;
    }

    if (shouldSyncDirectLinkChildVisibility(node)) {
      const isVisible = isVisualGeometryVisible(linkData, showVisual, forceHidden);
      if (node.visible !== isVisible) {
        changed = true;
      }
      node.visible = isVisible;
    }

    if (
      (node as any).isMesh &&
      node.userData?.isVisual &&
      !node.userData?.isCollision &&
      !node.userData?.isCollisionMesh
    ) {
      const isVisible = isVisualGeometryVisible(linkData, showVisual, forceHidden);
      if (node.visible !== isVisible) {
        changed = true;
      }
      node.visible = isVisible;
    }

    if ((node as any).isMesh && !node.userData?.isCollision && !node.userData?.isCollisionMesh) {
      let parent = node.parent;
      let isUrdfVisual = false;

      while (parent && parent !== robot) {
        if ((parent as any).isURDFVisual) {
          isUrdfVisual = true;
          break;
        }
        if (isCollisionGroup(parent)) {
          break;
        }
        parent = parent.parent;
      }

      if (isUrdfVisual) {
        const isVisible = isVisualGeometryVisible(linkData, showVisual, forceHidden);
        if (node.visible !== isVisible) {
          changed = true;
        }
        node.visible = isVisible;
      }
    }

    for (let index = 0; index < node.children.length; index += 1) {
      walkNode(node.children[index], nextLinkName);
    }
  };

  for (let index = 0; index < robot.children.length; index += 1) {
    walkNode(robot.children[index], null);
  }

  return changed;
}
