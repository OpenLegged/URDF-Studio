import * as THREE from 'three';
import { isBlockingGizmoNode, isSelectableHelperObject } from '@/shared/components/3d/robot/utils/pickFilter';
import type { ViewerHelperKind } from '@/shared/components/3d/robot/types';
import { resolveGeometryObjectIndexFromMetadata, subtreeContainsGeometryRole } from '@/shared/components/3d/runtimeGeometrySelection';

export interface ResolvedLinkTarget {
  linkId: string;
  linkObject: THREE.Object3D;
}

export interface ResolvedSelectionTarget {
  urdfElement: THREE.Object3D | null;
  subType: 'visual' | 'collision';
  objectIndex: number;
  highlightTarget: THREE.Object3D;
}

export interface ResolvedSelectionHit extends ResolvedSelectionTarget {
  linkId: string;
  linkObject: THREE.Object3D;
}

export interface ResolvedInteractionSelectionHit {
  type: 'link' | 'joint' | 'tendon';
  id: string;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  targetKind: 'geometry' | 'helper';
  helperKind?: ViewerHelperKind;
  linkId?: string;
  linkObject?: THREE.Object3D;
  highlightTarget?: THREE.Object3D;
}

function findAncestor(
  object: THREE.Object3D | null,
  predicate: (candidate: THREE.Object3D) => boolean,
): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    if (predicate(current)) {
      return current;
    }
    current = current.parent;
  }

  return null;
}

function isTaggedCollisionObject(object: THREE.Object3D | null): boolean {
  return Boolean(
    object &&
    ((object as any).isURDFCollider ||
      object.userData?.isCollisionGroup === true ||
      object.userData?.isCollisionMesh === true ||
      object.userData?.isCollision === true ||
      object.userData?.geometryRole === 'collision'),
  );
}

function isTaggedVisualObject(object: THREE.Object3D | null): boolean {
  return Boolean(
    object &&
    ((object as any).isURDFVisual ||
      object.userData?.isVisualGroup === true ||
      object.userData?.isVisualMesh === true ||
      object.userData?.isVisual === true ||
      object.userData?.geometryRole === 'visual'),
  );
}

function resolveMjcfTendonTarget(
  hitObject: THREE.Object3D,
): { name: string; object: THREE.Object3D } | null {
  let current: THREE.Object3D | null = hitObject;
  let tendonNode: THREE.Object3D | null = null;

  while (current) {
    if (
      current.userData?.isMjcfTendon === true &&
      typeof current.userData?.mjcfTendonName === 'string' &&
      current.userData.mjcfTendonName.trim().length > 0
    ) {
      tendonNode = current;
    }
    current = current.parent;
  }

  if (!tendonNode) {
    return null;
  }

  return {
    name: tendonNode.userData.mjcfTendonName.trim(),
    object: tendonNode,
  };
}

function resolveGeometrySubType(
  hitObject: THREE.Object3D,
  linkObject: THREE.Object3D,
): 'visual' | 'collision' {
  let current: THREE.Object3D | null = hitObject;

  while (current && current !== linkObject) {
    if (isTaggedCollisionObject(current)) {
      return 'collision';
    }
    if (isTaggedVisualObject(current)) {
      return 'visual';
    }
    current = current.parent;
  }

  return 'visual';
}

function findGeometryContainer(
  hitObject: THREE.Object3D,
  linkObject: THREE.Object3D,
  subType: 'visual' | 'collision',
): THREE.Object3D | null {
  let current: THREE.Object3D | null = hitObject;
  let matchedContainer: THREE.Object3D | null = null;
  const matchesRole = subType === 'collision' ? isTaggedCollisionObject : isTaggedVisualObject;

  while (current && current !== linkObject) {
    if (matchesRole(current)) {
      matchedContainer = current;
    }
    current = current.parent;
  }

  return matchedContainer;
}

function findImmediateChildUnderLink(
  object: THREE.Object3D | null,
  linkObject: THREE.Object3D,
): THREE.Object3D | null {
  let current = object;

  while (current?.parent && current.parent !== linkObject) {
    current = current.parent;
  }

  return current?.parent === linkObject ? current : null;
}

function resolveGeometryObjectIndex(
  linkObject: THREE.Object3D,
  geometryContainer: THREE.Object3D | null,
  subType: 'visual' | 'collision',
): number {
  const metadataObjectIndex = resolveGeometryObjectIndexFromMetadata(
    geometryContainer,
    linkObject,
    subType,
  );
  if (metadataObjectIndex !== null) {
    return metadataObjectIndex;
  }

  const directGeometryChild = findImmediateChildUnderLink(geometryContainer, linkObject);
  if (!directGeometryChild) {
    return 0;
  }

  const siblingGeometryRoots = linkObject.children.filter((child: any) => {
    if (child.isURDFJoint || child.isURDFLink) {
      return false;
    }
    return subtreeContainsGeometryRole(child, subType);
  });
  const siblingIndex = siblingGeometryRoots.indexOf(directGeometryChild);
  return siblingIndex >= 0 ? siblingIndex : 0;
}

function isJointAxisHelperObject(object: THREE.Object3D | null): boolean {
  return Boolean(
    findAncestor(
      object,
      (candidate) =>
        candidate.name === '__joint_axis__' || candidate.name === '__joint_axis_helper__',
    ),
  );
}

function resolveRenderableHelperTarget(hitObject: THREE.Object3D): THREE.Object3D {
  if (
    (hitObject as THREE.Mesh).isMesh ||
    (hitObject as THREE.Line).isLine ||
    hitObject.type === 'LineSegments'
  ) {
    return hitObject;
  }

  let renderableChild: THREE.Object3D | null = null;
  hitObject.traverse((child) => {
    if (renderableChild) {
      return;
    }

    if (
      (child as THREE.Mesh).isMesh ||
      (child as THREE.Line).isLine ||
      child.type === 'LineSegments'
    ) {
      renderableChild = child;
    }
  });

  return renderableChild ?? hitObject;
}

function resolveHelperKind(object: THREE.Object3D | null): ViewerHelperKind | undefined {
  const explicitHelperRoot = findAncestor(
    object,
    (candidate) =>
      candidate.userData?.viewerHelperKind === 'ik-handle' ||
      candidate.userData?.viewerHelperKind === 'center-of-mass' ||
      candidate.userData?.viewerHelperKind === 'inertia' ||
      candidate.userData?.viewerHelperKind === 'origin-axes' ||
      candidate.userData?.viewerHelperKind === 'joint-axis',
  );

  if (explicitHelperRoot?.userData?.viewerHelperKind) {
    return explicitHelperRoot.userData.viewerHelperKind as ViewerHelperKind;
  }

  const helperRoot = findAncestor(
    object,
    (candidate) =>
      candidate.name === '__ik_handle__' ||
      candidate.name === '__com_visual__' ||
      candidate.name === '__inertia_box__' ||
      candidate.name === '__origin_axes__' ||
      candidate.name === '__joint_axis__' ||
      candidate.name === '__joint_axis_helper__',
  );

  switch (helperRoot?.name) {
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
      return undefined;
  }
}

export function resolveHitLinkTarget(
  robot: THREE.Object3D | null,
  hitObject: THREE.Object3D,
): ResolvedLinkTarget | null {
  const robotLinks = (robot as { links?: Record<string, THREE.Object3D> } | null)?.links;
  const resolveObjectName = (object: THREE.Object3D | null): string => {
    if (!object?.name) {
      return '';
    }
    return object.name.trim();
  };
  const resolveNearestRuntimeLinkTarget = (): ResolvedLinkTarget | null => {
    let current: THREE.Object3D | null = hitObject;
    while (current) {
      if (isBlockingGizmoNode(current)) return null;
      const currentName = resolveObjectName(current);
      if (((current as any).isURDFLink || (current as any).type === 'URDFLink') && currentName) {
        return {
          linkId: currentName,
          linkObject: current,
        };
      }
      if (currentName && robotLinks?.[currentName]) {
        return {
          linkId: currentName,
          linkObject: current,
        };
      }
      if (current === robot) break;
      current = current.parent;
    }

    return null;
  };
  const metadataLinkId =
    typeof hitObject.userData?.parentLinkName === 'string'
      ? hitObject.userData.parentLinkName.trim()
      : '';

  if (metadataLinkId) {
    const metadataLinkObject = robotLinks?.[metadataLinkId] ?? null;
    if (metadataLinkObject) {
      return {
        linkId: metadataLinkId,
        linkObject: metadataLinkObject,
      };
    }

    const runtimeLinkTarget = resolveNearestRuntimeLinkTarget();
    if (runtimeLinkTarget) {
      return {
        linkId: metadataLinkId,
        linkObject: runtimeLinkTarget.linkObject,
      };
    }
  }

  return resolveNearestRuntimeLinkTarget();
}

export function resolveSelectionTarget(
  hitObject: THREE.Object3D,
  linkObject: THREE.Object3D,
): ResolvedSelectionTarget {
  const subType = resolveGeometrySubType(hitObject, linkObject);
  const urdfElement = findGeometryContainer(hitObject, linkObject, subType);

  const objectIndex = resolveGeometryObjectIndex(linkObject, urdfElement, subType);

  let highlightTarget = hitObject;
  if (urdfElement) {
    if ((urdfElement as any).isMesh || urdfElement === hitObject) {
      highlightTarget = urdfElement;
    } else {
      let bodyRoot = hitObject;
      while (bodyRoot.parent && bodyRoot.parent !== urdfElement) {
        bodyRoot = bodyRoot.parent;
      }
      highlightTarget = bodyRoot;
    }
  }

  return {
    urdfElement,
    subType,
    objectIndex,
    highlightTarget,
  };
}

export function resolveSelectionHit(
  robot: THREE.Object3D | null,
  hitObject: THREE.Object3D,
): ResolvedSelectionHit | null {
  const resolvedLink = resolveHitLinkTarget(robot, hitObject);
  if (!resolvedLink) {
    return null;
  }

  return {
    ...resolveSelectionTarget(hitObject, resolvedLink.linkObject),
    linkId: resolvedLink.linkId,
    linkObject: resolvedLink.linkObject,
  };
}

export function resolveInteractionSelectionHit(
  robot: THREE.Object3D | null,
  hitObject: THREE.Object3D,
): ResolvedInteractionSelectionHit | null {
  const mjcfTendonTarget = resolveMjcfTendonTarget(hitObject);
  if (mjcfTendonTarget) {
    const resolvedLink = resolveHitLinkTarget(robot, hitObject);
    return {
      type: 'tendon',
      id: mjcfTendonTarget.name,
      targetKind: 'geometry',
      linkId: resolvedLink?.linkId,
      linkObject: resolvedLink?.linkObject,
      highlightTarget: mjcfTendonTarget.object,
    };
  }

  if (isSelectableHelperObject(hitObject)) {
    const helperKind = resolveHelperKind(hitObject);
    if (isJointAxisHelperObject(hitObject)) {
      const jointObject = findAncestor(
        hitObject,
        (candidate) => (candidate as any).isURDFJoint || (candidate as any).type === 'URDFJoint',
      );

      if (jointObject?.name) {
        return {
          type: 'joint',
          id: jointObject.name,
          targetKind: 'helper',
          helperKind: helperKind ?? 'joint-axis',
          highlightTarget: resolveRenderableHelperTarget(hitObject),
        };
      }
    }

    const resolvedHelperLink = resolveHitLinkTarget(robot, hitObject);
    if (resolvedHelperLink) {
      return {
        type: 'link',
        id: resolvedHelperLink.linkId,
        targetKind: 'helper',
        helperKind,
        linkId: resolvedHelperLink.linkId,
        linkObject: resolvedHelperLink.linkObject,
        highlightTarget: hitObject,
      };
    }
  }

  const resolvedGeometryHit = resolveSelectionHit(robot, hitObject);
  if (!resolvedGeometryHit) {
    return null;
  }

  return {
    type: 'link',
    id: resolvedGeometryHit.linkId,
    subType: resolvedGeometryHit.subType,
    objectIndex: resolvedGeometryHit.objectIndex,
    targetKind: 'geometry',
    linkId: resolvedGeometryHit.linkId,
    linkObject: resolvedGeometryHit.linkObject,
    highlightTarget: resolvedGeometryHit.highlightTarget,
  };
}
