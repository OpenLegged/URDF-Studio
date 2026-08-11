import * as THREE from 'three';
import { resolveLinkKey } from '@/core/robot';
import type { InteractionHelperKind, UrdfLink } from '@/types';
import type { MeasureAnchorMode, MeasureTarget } from './measurements.ts';
import {
  createMeasureTarget,
  createRigidWorldPoseMatrix,
  getLinkCenterOfMassLocal,
  getLinkMeasurePoint,
  getLinkFrameWorldPoint,
  getObjectWorldPoseMatrix,
  getObjectWorldCenter,
  getPoseMatrixFromPointAndObjectOrientation,
} from './measurements.ts';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { getSyntheticGeomParentName, resolveRuntimeGeometryRoot } from './runtimeGeometrySelection';

export interface MeasureSelectionLike {
  type: 'link' | 'joint' | 'tendon' | null;
  id: string | null;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: InteractionHelperKind;
}

export interface ResolveUsdMeasureTargetOptions {
  resolution: ViewerRobotDataResolution | null | undefined;
  meshesByLinkKey: Map<string, THREE.Mesh[]>;
  linkWorldTransformResolver?: (linkPath: string) => THREE.Matrix4 | null | undefined;
}

function findRobotLinkObject(robotModel: THREE.Object3D, linkName: string): THREE.Object3D | null {
  const links = (
    robotModel as THREE.Object3D & {
      links?: Record<string, THREE.Object3D>;
    }
  ).links;
  if (links?.[linkName]) {
    return links[linkName];
  }

  let found: THREE.Object3D | null = null;
  robotModel.traverse((child) => {
    if (
      !found &&
      (child as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink &&
      child.name === linkName
    ) {
      found = child;
    }
  });

  return found;
}

function findRobotJointObject(
  robotModel: THREE.Object3D,
  jointName: string,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  robotModel.traverse((child) => {
    if (
      !found &&
      ((child as THREE.Object3D & { isURDFJoint?: boolean }).isURDFJoint ||
        child.type === 'URDFJoint') &&
      child.name === jointName
    ) {
      found = child;
    }
  });

  return found;
}

function getEffectiveMeasureSelection(
  selection?: MeasureSelectionLike,
  fallbackSelection?: MeasureSelectionLike,
): MeasureSelectionLike | null {
  if (!selection?.type || !selection.id) {
    return null;
  }

  if (selection.type === 'tendon') {
    return null;
  }

  if (
    fallbackSelection?.type === selection.type &&
    fallbackSelection.id === selection.id &&
    (selection.subType === undefined ||
      selection.objectIndex === undefined ||
      selection.helperKind === undefined)
  ) {
    return {
      ...selection,
      subType: selection.subType ?? fallbackSelection.subType,
      objectIndex: selection.objectIndex ?? fallbackSelection.objectIndex,
      helperKind: selection.helperKind ?? fallbackSelection.helperKind,
    };
  }

  return selection;
}

function getSelectionObjectType(selection: MeasureSelectionLike): 'visual' | 'collision' {
  return selection.subType === 'collision' ? 'collision' : 'visual';
}

function resolveMeasureAnchorMode(
  helperKind: InteractionHelperKind | undefined,
  anchorMode: MeasureAnchorMode,
): MeasureAnchorMode {
  switch (helperKind) {
    case 'center-of-mass':
    case 'inertia':
      return 'centerOfMass';
    case 'origin-axes':
      return 'frame';
    default:
      return anchorMode;
  }
}

function getLinkIkHandleWorldPoint(linkObject?: THREE.Object3D | null): THREE.Vector3 | null {
  const ikHandle = (
    linkObject as
      | (THREE.Object3D & {
          userData?: { __ikHandle?: THREE.Object3D };
        })
      | null
  )?.userData?.__ikHandle;
  if (!ikHandle) {
    return null;
  }

  ikHandle.updateMatrixWorld(true);
  return ikHandle.getWorldPosition(new THREE.Vector3());
}

function resolveRobotLinkData(
  robotLinks: Record<string, UrdfLink> | null | undefined,
  identity: string,
  linkObject?: THREE.Object3D | null,
): UrdfLink | null {
  if (!robotLinks) {
    return null;
  }

  const resolvedLinkKey =
    resolveLinkKey(robotLinks, identity) ?? resolveLinkKey(robotLinks, linkObject?.name) ?? null;
  if (resolvedLinkKey) {
    return robotLinks[resolvedLinkKey] ?? null;
  }

  return (
    Object.values(robotLinks).find(
      (link) => link.name === identity || link.name === linkObject?.name,
    ) ?? null
  );
}

function resolveRobotRuntimeLinkObject(
  robot: THREE.Object3D,
  selectionId: string,
  linkData?: UrdfLink | null,
): THREE.Object3D | null {
  const candidates = [
    selectionId,
    linkData?.id,
    linkData?.name,
    getSyntheticGeomParentName(selectionId),
    getSyntheticGeomParentName(linkData?.id),
    getSyntheticGeomParentName(linkData?.name),
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }

    const linkObject = findRobotLinkObject(robot, candidate);
    if (linkObject) {
      return linkObject;
    }
  }

  return null;
}

function resolveUsdLinkId(
  resolution: ViewerRobotDataResolution,
  selection: MeasureSelectionLike,
): string | null {
  if (selection.type === 'link') {
    return selection.id;
  }

  const childLinkPath = resolution.childLinkPathByJointId[selection.id || ''];
  if (!childLinkPath) {
    return null;
  }

  return resolution.linkIdByPath[childLinkPath] ?? null;
}

function resolveUsdLinkPath(
  resolution: ViewerRobotDataResolution,
  selection: MeasureSelectionLike,
): string | null {
  if (selection.type === 'link') {
    return resolution.linkPathById[selection.id || ''] ?? null;
  }

  return resolution.childLinkPathByJointId[selection.id || ''] ?? null;
}

function pickUsdMeasureMesh(meshes: THREE.Mesh[], objectIndex: number): THREE.Mesh | null {
  return (
    meshes.find((mesh) => mesh.userData?.usdObjectIndex === objectIndex) ??
    meshes[objectIndex] ??
    meshes[0] ??
    null
  );
}

function resolveUsdLinkData(
  resolution: ViewerRobotDataResolution,
  linkId: string,
): UrdfLink | null {
  const directLink = resolution.robotData.links[linkId];
  if (directLink) {
    return directLink;
  }

  return (
    Object.values(resolution.robotData.links).find(
      (link) => link.id === linkId || link.name === linkId,
    ) ?? null
  );
}

export function resolveRobotMeasureTargetFromSelection(
  robot: THREE.Object3D | null,
  robotLinksOrSelection?: Record<string, UrdfLink> | MeasureSelectionLike,
  selectionOrFallback?: MeasureSelectionLike,
  fallbackSelectionOrAnchorMode?: MeasureSelectionLike | MeasureAnchorMode,
  anchorMode: MeasureAnchorMode = 'frame',
): MeasureTarget | null {
  const hasRobotLinks = !robotLinksOrSelection || !('type' in robotLinksOrSelection);
  const robotLinks = hasRobotLinks
    ? (robotLinksOrSelection as Record<string, UrdfLink> | undefined)
    : undefined;
  const selection = hasRobotLinks
    ? selectionOrFallback
    : (robotLinksOrSelection as MeasureSelectionLike | undefined);
  const fallback = hasRobotLinks
    ? typeof fallbackSelectionOrAnchorMode === 'string'
      ? undefined
      : fallbackSelectionOrAnchorMode
    : selectionOrFallback;
  const effectiveAnchorMode =
    typeof fallbackSelectionOrAnchorMode === 'string' ? fallbackSelectionOrAnchorMode : anchorMode;
  const effectiveSelection = getEffectiveMeasureSelection(selection, fallback);
  if (!robot || !effectiveSelection?.type || !effectiveSelection.id) {
    return null;
  }

  const resolvedAnchorMode = resolveMeasureAnchorMode(
    effectiveSelection.helperKind,
    effectiveAnchorMode,
  );

  if (effectiveSelection.type === 'joint') {
    const jointObject = findRobotJointObject(robot, effectiveSelection.id);
    if (!jointObject) {
      return null;
    }

    return createMeasureTarget({
      linkName: effectiveSelection.id,
      objectType: 'visual',
      objectIndex: 0,
      point: getLinkFrameWorldPoint(jointObject),
      poseWorldMatrix: getObjectWorldPoseMatrix(jointObject),
    });
  }

  if (effectiveSelection.type !== 'link') {
    return null;
  }

  const linkData = resolveRobotLinkData(robotLinks, effectiveSelection.id);
  const linkObject = resolveRobotRuntimeLinkObject(robot, effectiveSelection.id, linkData);
  if (!linkObject) {
    return null;
  }

  const objectType = getSelectionObjectType(effectiveSelection);
  const objectIndex = effectiveSelection.objectIndex ?? 0;
  const resolvedLinkData =
    linkData ?? resolveRobotLinkData(robotLinks, effectiveSelection.id, linkObject);

  if (resolvedAnchorMode === 'geometry') {
    const targetGeometryRoot = resolveRuntimeGeometryRoot(
      linkObject,
      effectiveSelection.id,
      objectType,
      objectIndex,
    );
    if (targetGeometryRoot) {
      const targetPoint = getObjectWorldCenter(targetGeometryRoot);
      return createMeasureTarget({
        linkName: effectiveSelection.id,
        objectType,
        objectIndex,
        point: targetPoint,
        poseWorldMatrix: getPoseMatrixFromPointAndObjectOrientation(
          targetPoint,
          targetGeometryRoot,
        ),
      });
    }
  }

  if (effectiveSelection.helperKind === 'ik-handle') {
    const ikHandlePoint = getLinkIkHandleWorldPoint(linkObject);
    if (ikHandlePoint) {
      return createMeasureTarget({
        linkName: effectiveSelection.id,
        objectType,
        objectIndex,
        point: ikHandlePoint,
        poseWorldMatrix: getObjectWorldPoseMatrix(linkObject.userData.__ikHandle),
      });
    }
  }

  const targetPoint = getLinkMeasurePoint(
    linkObject,
    resolvedLinkData,
    resolvedAnchorMode,
    objectType,
    objectIndex,
  );
  return createMeasureTarget({
    linkName: effectiveSelection.id,
    objectType,
    objectIndex,
    point: targetPoint,
    poseWorldMatrix: getPoseMatrixFromPointAndObjectOrientation(targetPoint, linkObject),
  });
}

export function resolveUsdMeasureTargetFromSelection(
  options: ResolveUsdMeasureTargetOptions,
  selection?: MeasureSelectionLike,
  fallbackSelection?: MeasureSelectionLike,
  anchorMode: MeasureAnchorMode = 'frame',
): MeasureTarget | null {
  const effectiveSelection = getEffectiveMeasureSelection(selection, fallbackSelection);
  const resolution = options.resolution;
  if (!resolution || !effectiveSelection?.type || !effectiveSelection.id) {
    return null;
  }

  const resolvedAnchorMode = resolveMeasureAnchorMode(effectiveSelection.helperKind, anchorMode);

  const linkId = resolveUsdLinkId(resolution, effectiveSelection);
  const linkPath = resolveUsdLinkPath(resolution, effectiveSelection);
  if (!linkId || !linkPath) {
    return null;
  }

  const objectType = getSelectionObjectType(effectiveSelection);
  const objectIndex = effectiveSelection.objectIndex ?? 0;
  const linkData = resolveUsdLinkData(resolution, linkId);
  const linkWorldMatrix = options.linkWorldTransformResolver?.(linkPath);
  const linkFramePoint = linkWorldMatrix
    ? new THREE.Vector3().setFromMatrixPosition(linkWorldMatrix)
    : null;
  const linkWorldQuaternion = linkWorldMatrix
    ? new THREE.Quaternion().setFromRotationMatrix(linkWorldMatrix)
    : null;

  if (resolvedAnchorMode === 'centerOfMass' && linkWorldMatrix) {
    const centerOfMassLocal = getLinkCenterOfMassLocal(linkData);
    if (centerOfMassLocal) {
      const targetPoint = centerOfMassLocal.applyMatrix4(linkWorldMatrix);
      return createMeasureTarget({
        linkName: linkId,
        objectType,
        objectIndex,
        point: targetPoint,
        poseWorldMatrix: linkWorldQuaternion
          ? createRigidWorldPoseMatrix(targetPoint, linkWorldQuaternion)
          : null,
      });
    }

    return null;
  }

  if (resolvedAnchorMode === 'centerOfMass') {
    return null;
  }

  if (resolvedAnchorMode === 'frame' && linkFramePoint) {
    return createMeasureTarget({
      linkName: linkId,
      objectType,
      objectIndex,
      point: linkFramePoint,
      poseWorldMatrix: linkWorldMatrix,
    });
  }

  if (resolvedAnchorMode === 'geometry') {
    const meshes = options.meshesByLinkKey.get(`${linkPath}:${objectType}`) || [];
    const targetMesh = pickUsdMeasureMesh(meshes, objectIndex);
    if (targetMesh) {
      const targetPoint = getObjectWorldCenter(targetMesh);
      return createMeasureTarget({
        linkName: linkId,
        objectType,
        objectIndex,
        point: targetPoint,
        poseWorldMatrix: getPoseMatrixFromPointAndObjectOrientation(targetPoint, targetMesh),
      });
    }

    return null;
  }

  return null;
}
