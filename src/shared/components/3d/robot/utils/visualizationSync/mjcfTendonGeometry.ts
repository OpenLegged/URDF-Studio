import * as THREE from 'three';

import { GeometryType } from '@/types/index';

import {
  MJCF_TENDON_RENDER_ORDER,
  type MjcfSiteVisualizationData,
  type MjcfTendonVisualizationData,
} from '@/shared/components/3d/robot/utils/visualizationFactories';

import {
  scratchQuaternion,
  scratchMjcfSiteWorldPosition,
  scratchMjcfTendonLocalStart,
  scratchMjcfTendonLocalEnd,
  scratchMjcfTendonSegmentVector,
  scratchMjcfTendonSegmentMidpoint,
  scratchMjcfTendonSegmentDirection,
  scratchMjcfTendonProjectionVector,
  scratchMjcfTendonProjectionOffset,
  scratchMjcfTendonProjectionPoint,
  scratchMjcfTendonBasisU,
  scratchMjcfTendonBasisV,
  scratchMjcfTendonBasisCandidate,
  scratchMjcfTendonWorldScale,
  mjcfTendonYAxis,
  MJCF_TENDON_MIN_VISIBLE_RADIUS,
  MJCF_INVERSE_CYLINDER_SIDE_INSIDE_RATIO,
} from '@/shared/components/3d/robot/utils/visualizationSync/scratch';
import {
  updatePosition,
  updateQuaternion,
  updateRenderOrder,
  updateScale3,
  updateVisible,
  updateVisualMeshMetadata,
} from '@/shared/components/3d/robot/utils/visualizationSync/objectPrimitives';

export interface MjcfSiteAnchorData {
  worldPosition: THREE.Vector3;
  radius: number | null;
  linkName: string | null;
  wrapRadius?: number | null;
  wrapAxis?: THREE.Vector3 | null;
  wrapGeometryType?: GeometryType | null;
}

function resolveFiniteUserDataNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveMjcfWrapRadiusFromGeometryObject(object: THREE.Object3D): number | null {
  const geometryType = object.userData?.geometryType;
  if (
    geometryType !== GeometryType.SPHERE &&
    geometryType !== GeometryType.CYLINDER &&
    geometryType !== GeometryType.CAPSULE &&
    geometryType !== GeometryType.ELLIPSOID
  ) {
    return null;
  }

  const dimensions = object.userData?.geometryDimensions as
    | { x?: unknown; y?: unknown; z?: unknown }
    | undefined;
  const radius = resolveFiniteUserDataNumber(dimensions?.x);
  if (!radius || radius <= 0) {
    return null;
  }

  object.getWorldScale(scratchMjcfTendonWorldScale);
  const worldScale = Math.max(
    Math.abs(scratchMjcfTendonWorldScale.x),
    Math.abs(scratchMjcfTendonWorldScale.y),
    Math.abs(scratchMjcfTendonWorldScale.z),
  );
  return radius * (Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1);
}

function resolveMjcfWrapAxisFromGeometryObject(object: THREE.Object3D): THREE.Vector3 | null {
  const geometryType = object.userData?.geometryType;
  if (geometryType !== GeometryType.CYLINDER && geometryType !== GeometryType.CAPSULE) {
    return null;
  }

  object.getWorldQuaternion(scratchQuaternion);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(scratchQuaternion).normalize();
}

function resolveMjcfWrapGeometryTypeFromObject(object: THREE.Object3D): GeometryType | null {
  const geometryType = object.userData?.geometryType;
  return Object.values(GeometryType).includes(geometryType as GeometryType)
    ? (geometryType as GeometryType)
    : null;
}

export function collectMjcfTendonAnchorsByName(
  robot: THREE.Object3D,
): Map<string, MjcfSiteAnchorData> {
  const siteAnchors = new Map<string, MjcfSiteAnchorData>();

  robot.traverse((object) => {
    if (!(object as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink) {
      return;
    }

    const sitesData = Array.isArray(object.userData.__mjcfSitesData)
      ? (object.userData.__mjcfSitesData as MjcfSiteVisualizationData[])
      : [];
    if (sitesData.length === 0) {
      return;
    }

    sitesData.forEach((site) => {
      const linkName =
        typeof object.name === 'string' && object.name.trim().length > 0
          ? object.name.trim()
          : null;
      const localPosition = site.pos ?? [0, 0, 0];
      scratchMjcfSiteWorldPosition.set(localPosition[0], localPosition[1], localPosition[2]);
      object.localToWorld(scratchMjcfSiteWorldPosition);

      const anchor: MjcfSiteAnchorData = {
        worldPosition: scratchMjcfSiteWorldPosition.clone(),
        radius:
          typeof site.size?.[0] === 'number' && Number.isFinite(site.size[0]) ? site.size[0] : null,
        linkName,
      };

      if (!siteAnchors.has(site.name)) {
        siteAnchors.set(site.name, anchor);
      }

      if (
        typeof site.sourceName === 'string' &&
        site.sourceName.length > 0 &&
        !siteAnchors.has(site.sourceName)
      ) {
        siteAnchors.set(site.sourceName, anchor);
      }
    });

    object.children.forEach((child) => {
      const geometryName =
        typeof child.userData?.geometryName === 'string' ? child.userData.geometryName.trim() : '';
      if (!geometryName || siteAnchors.has(geometryName)) {
        return;
      }

      const linkName =
        typeof object.name === 'string' && object.name.trim().length > 0
          ? object.name.trim()
          : null;
      child.getWorldPosition(scratchMjcfSiteWorldPosition);
      siteAnchors.set(geometryName, {
        worldPosition: scratchMjcfSiteWorldPosition.clone(),
        radius: null,
        linkName,
        wrapRadius: resolveMjcfWrapRadiusFromGeometryObject(child),
        wrapAxis: resolveMjcfWrapAxisFromGeometryObject(child),
        wrapGeometryType: resolveMjcfWrapGeometryTypeFromObject(child),
      });
    });
  });

  return siteAnchors;
}

function resolveMjcfTendonRadius(
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): number {
  if (typeof tendon.width === 'number' && Number.isFinite(tendon.width) && tendon.width > 0) {
    return Math.max(tendon.width * 0.5, MJCF_TENDON_MIN_VISIBLE_RADIUS);
  }

  const siteRadii = tendon.attachmentRefs
    .map((attachmentRef) => siteAnchorsByName.get(attachmentRef)?.radius ?? null)
    .filter(
      (radius): radius is number =>
        typeof radius === 'number' && Number.isFinite(radius) && radius > 0,
    );
  if (siteRadii.length > 0) {
    return Math.max(Math.min(...siteRadii) * 0.5, MJCF_TENDON_MIN_VISIBLE_RADIUS);
  }

  return MJCF_TENDON_MIN_VISIBLE_RADIUS;
}

function cloneMjcfTendonAnchor(anchor: MjcfSiteAnchorData): MjcfSiteAnchorData {
  return {
    worldPosition: anchor.worldPosition.clone(),
    radius: anchor.radius,
    linkName: anchor.linkName,
    wrapRadius: anchor.wrapRadius,
    wrapAxis: anchor.wrapAxis?.clone() ?? null,
    wrapGeometryType: anchor.wrapGeometryType ?? null,
  };
}

function projectMjcfWrapAnchorOntoSitePath(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData {
  if (!previousSiteAnchor || !nextSiteAnchor) {
    return cloneMjcfTendonAnchor(wrapAnchor);
  }

  scratchMjcfTendonProjectionVector.subVectors(
    nextSiteAnchor.worldPosition,
    previousSiteAnchor.worldPosition,
  );
  const lengthSq = scratchMjcfTendonProjectionVector.lengthSq();
  if (lengthSq <= 1e-12) {
    return cloneMjcfTendonAnchor(wrapAnchor);
  }

  scratchMjcfTendonProjectionOffset.subVectors(
    wrapAnchor.worldPosition,
    previousSiteAnchor.worldPosition,
  );
  const t = THREE.MathUtils.clamp(
    scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonProjectionVector) / lengthSq,
    0,
    1,
  );

  return {
    worldPosition: previousSiteAnchor.worldPosition
      .clone()
      .addScaledVector(scratchMjcfTendonProjectionVector, t),
    radius: wrapAnchor.radius,
    linkName: wrapAnchor.linkName ?? previousSiteAnchor.linkName ?? nextSiteAnchor.linkName,
  };
}

function createMjcfTendonContactAnchor(
  wrapAnchor: MjcfSiteAnchorData,
  worldPosition: THREE.Vector3,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData {
  return {
    worldPosition,
    radius: wrapAnchor.radius,
    linkName: wrapAnchor.linkName ?? previousSiteAnchor?.linkName ?? nextSiteAnchor?.linkName ?? null,
    wrapRadius: wrapAnchor.wrapRadius,
    wrapAxis: wrapAnchor.wrapAxis?.clone() ?? null,
    wrapGeometryType: wrapAnchor.wrapGeometryType ?? null,
  };
}

function computeMjcfLineSphereSurfacePoint(
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  sphereCenterWorld: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const direction = toWorld.clone().sub(fromWorld);
  const a = direction.lengthSq();
  if (a <= 1e-12) {
    return null;
  }

  const fromOffset = fromWorld.clone().sub(sphereCenterWorld);
  const b = 2 * fromOffset.dot(direction);
  const c = fromOffset.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const roots = [
    (-b - sqrtDiscriminant) / (2 * a),
    (-b + sqrtDiscriminant) / (2 * a),
  ]
    .filter((root) => root >= 0 && root <= 1)
    .sort((left, right) => left - right);
  const t = roots[0];
  if (t === undefined) {
    return null;
  }

  return fromWorld.clone().addScaledVector(direction, t);
}

function computeMjcfLineCylinderSurfacePoint(
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  cylinderCenterWorld: THREE.Vector3,
  cylinderAxisWorld: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const direction = toWorld.clone().sub(fromWorld);
  const radialDirection = direction
    .clone()
    .addScaledVector(cylinderAxisWorld, -direction.dot(cylinderAxisWorld));
  const a = radialDirection.lengthSq();
  if (a <= 1e-12) {
    return null;
  }

  const fromOffset = fromWorld.clone().sub(cylinderCenterWorld);
  const radialOffset = fromOffset.addScaledVector(
    cylinderAxisWorld,
    -fromOffset.dot(cylinderAxisWorld),
  );
  const b = 2 * radialOffset.dot(radialDirection);
  const c = radialOffset.lengthSq() - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const roots = [
    (-b - sqrtDiscriminant) / (2 * a),
    (-b + sqrtDiscriminant) / (2 * a),
  ]
    .filter((root) => root >= 0 && root <= 1)
    .sort((left, right) => left - right);
  const t = roots[0];
  if (t === undefined) {
    return null;
  }

  return fromWorld.clone().addScaledVector(direction, t);
}

function resolveMjcfInverseSphereWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData,
  nextSiteAnchor: MjcfSiteAnchorData,
  sideAnchor: MjcfSiteAnchorData,
  radius: number,
): MjcfSiteAnchorData[] {
  const firstContact = computeMjcfLineSphereSurfacePoint(
    previousSiteAnchor.worldPosition,
    sideAnchor.worldPosition,
    wrapAnchor.worldPosition,
    radius,
  );
  const secondContact = computeMjcfLineSphereSurfacePoint(
    sideAnchor.worldPosition,
    nextSiteAnchor.worldPosition,
    wrapAnchor.worldPosition,
    radius,
  );

  if (!firstContact || !secondContact) {
    return [];
  }

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function resolveMjcfInverseCylinderWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData,
  nextSiteAnchor: MjcfSiteAnchorData,
  sideAnchor: MjcfSiteAnchorData,
  wrapAxis: THREE.Vector3,
  radius: number,
): MjcfSiteAnchorData[] {
  const firstContact = computeMjcfLineCylinderSurfacePoint(
    previousSiteAnchor.worldPosition,
    sideAnchor.worldPosition,
    wrapAnchor.worldPosition,
    wrapAxis,
    radius,
  );
  const secondContact = computeMjcfLineCylinderSurfacePoint(
    sideAnchor.worldPosition,
    nextSiteAnchor.worldPosition,
    wrapAnchor.worldPosition,
    wrapAxis,
    radius,
  );

  if (!firstContact || !secondContact) {
    return [];
  }

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function computeMjcfCircleTangentPoints2D(
  pointX: number,
  pointY: number,
  radius: number,
): THREE.Vector2[] {
  const distance = Math.hypot(pointX, pointY);
  if (!Number.isFinite(distance) || distance <= radius) {
    return [];
  }

  const baseAngle = Math.atan2(pointY, pointX);
  const tangentAngle = Math.acos(THREE.MathUtils.clamp(radius / distance, -1, 1));
  return [
    new THREE.Vector2(
      radius * Math.cos(baseAngle + tangentAngle),
      radius * Math.sin(baseAngle + tangentAngle),
    ),
    new THREE.Vector2(
      radius * Math.cos(baseAngle - tangentAngle),
      radius * Math.sin(baseAngle - tangentAngle),
    ),
  ];
}

function resolveStableMjcfTendonWrapPlaneBasis(
  previousWorld: THREE.Vector3,
  nextWorld: THREE.Vector3,
  wrapWorld: THREE.Vector3,
  sideWorld?: THREE.Vector3,
): boolean {
  scratchMjcfTendonBasisU.subVectors(nextWorld, previousWorld);
  const segmentLength = scratchMjcfTendonBasisU.length();
  if (segmentLength <= 1e-12) {
    return false;
  }
  scratchMjcfTendonBasisU.divideScalar(segmentLength);

  scratchMjcfTendonProjectionOffset.subVectors(wrapWorld, previousWorld);
  const projectionDistance = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisU);
  scratchMjcfTendonProjectionPoint
    .copy(previousWorld)
    .addScaledVector(scratchMjcfTendonBasisU, projectionDistance);
  scratchMjcfTendonBasisV.subVectors(wrapWorld, scratchMjcfTendonProjectionPoint);
  if (scratchMjcfTendonBasisV.lengthSq() > 1e-12) {
    scratchMjcfTendonBasisV.normalize();
    return true;
  }

  if (sideWorld) {
    scratchMjcfTendonBasisV.subVectors(sideWorld, scratchMjcfTendonProjectionPoint);
    scratchMjcfTendonBasisV.addScaledVector(
      scratchMjcfTendonBasisU,
      -scratchMjcfTendonBasisV.dot(scratchMjcfTendonBasisU),
    );
    if (scratchMjcfTendonBasisV.lengthSq() > 1e-12) {
      scratchMjcfTendonBasisV.normalize();
      return true;
    }
  }

  scratchMjcfTendonBasisCandidate.set(0, 0, 1);
  if (Math.abs(scratchMjcfTendonBasisCandidate.dot(scratchMjcfTendonBasisU)) > 0.95) {
    scratchMjcfTendonBasisCandidate.set(0, 1, 0);
  }
  scratchMjcfTendonBasisV
    .crossVectors(scratchMjcfTendonBasisU, scratchMjcfTendonBasisCandidate)
    .normalize();
  return scratchMjcfTendonBasisV.lengthSq() > 0;
}

function resolveMjcfWrapContactAnchors(
  wrapAnchor: MjcfSiteAnchorData,
  previousSiteAnchor: MjcfSiteAnchorData | undefined,
  nextSiteAnchor: MjcfSiteAnchorData | undefined,
  sideAnchor: MjcfSiteAnchorData | undefined,
): MjcfSiteAnchorData[] {
  if (!previousSiteAnchor || !nextSiteAnchor) {
    return [cloneMjcfTendonAnchor(wrapAnchor)];
  }

  const radius = wrapAnchor.wrapRadius;
  if (!radius || !Number.isFinite(radius) || radius <= 0) {
    return [
      projectMjcfWrapAnchorOntoSitePath(wrapAnchor, previousSiteAnchor, nextSiteAnchor),
    ];
  }

  const isCylindricalWrap =
    (wrapAnchor.wrapGeometryType === GeometryType.CYLINDER ||
      wrapAnchor.wrapGeometryType === GeometryType.CAPSULE) &&
    wrapAnchor.wrapAxis;
  const wrapAxis = isCylindricalWrap ? wrapAnchor.wrapAxis! : null;
  const previousPlanePoint = previousSiteAnchor.worldPosition.clone();
  const nextPlanePoint = nextSiteAnchor.worldPosition.clone();
  const sidePlanePoint = sideAnchor?.worldPosition.clone();

  if (wrapAxis) {
    previousPlanePoint.addScaledVector(
      wrapAxis,
      -scratchMjcfTendonProjectionOffset
        .subVectors(previousPlanePoint, wrapAnchor.worldPosition)
        .dot(wrapAxis),
    );
    nextPlanePoint.addScaledVector(
      wrapAxis,
      -scratchMjcfTendonProjectionOffset
        .subVectors(nextPlanePoint, wrapAnchor.worldPosition)
        .dot(wrapAxis),
    );
    if (sidePlanePoint) {
      sidePlanePoint.addScaledVector(
        wrapAxis,
        -scratchMjcfTendonProjectionOffset
          .subVectors(sidePlanePoint, wrapAnchor.worldPosition)
          .dot(wrapAxis),
      );
    }
  }

  if (
    !resolveStableMjcfTendonWrapPlaneBasis(
      previousPlanePoint,
      nextPlanePoint,
      wrapAnchor.worldPosition,
      sidePlanePoint,
    )
  ) {
    return [];
  }

  scratchMjcfTendonProjectionVector.subVectors(
    nextPlanePoint,
    previousPlanePoint,
  );
  const segmentLengthSq = scratchMjcfTendonProjectionVector.lengthSq();
  if (segmentLengthSq <= 1e-12) {
    return [];
  }

  scratchMjcfTendonProjectionOffset.subVectors(
    wrapAnchor.worldPosition,
    previousPlanePoint,
  );
  const projectionT =
    scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonProjectionVector) / segmentLengthSq;
  scratchMjcfTendonProjectionPoint
    .copy(previousPlanePoint)
    .addScaledVector(scratchMjcfTendonProjectionVector, projectionT);
  const lineDistance = scratchMjcfTendonProjectionPoint.distanceTo(wrapAnchor.worldPosition);
  const sideDistanceFromWrapCenter = sidePlanePoint
    ? sidePlanePoint.distanceTo(wrapAnchor.worldPosition)
    : Infinity;

  // MuJoCo uses an inside sidesite as inverse wrapping instead of outside tangency.
  if (sideAnchor && sideDistanceFromWrapCenter < radius) {
    if (wrapAxis) {
      return sideDistanceFromWrapCenter <= radius * MJCF_INVERSE_CYLINDER_SIDE_INSIDE_RATIO
        ? resolveMjcfInverseCylinderWrapContactAnchors(
            wrapAnchor,
            previousSiteAnchor,
            nextSiteAnchor,
            sideAnchor,
            wrapAxis,
            radius,
          )
        : [];
    }

    if (lineDistance >= radius) {
      return resolveMjcfInverseSphereWrapContactAnchors(
        wrapAnchor,
        previousSiteAnchor,
        nextSiteAnchor,
        sideAnchor,
        radius,
      );
    }

    return [];
  }

  if (
    projectionT <= 0 ||
    projectionT >= 1 ||
    (wrapAxis && (projectionT < 0.15 || projectionT > 0.85)) ||
    lineDistance >= radius
  ) {
    return [];
  }

  const previousLocalX = scratchMjcfTendonProjectionOffset
    .subVectors(previousPlanePoint, wrapAnchor.worldPosition)
    .dot(scratchMjcfTendonBasisU);
  const previousLocalY = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV);
  const nextLocalX = scratchMjcfTendonProjectionOffset
    .subVectors(nextPlanePoint, wrapAnchor.worldPosition)
    .dot(scratchMjcfTendonBasisU);
  const nextLocalY = scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV);
  const sideLocal =
    sidePlanePoint &&
    new THREE.Vector2(
      scratchMjcfTendonProjectionOffset
        .subVectors(sidePlanePoint, wrapAnchor.worldPosition)
        .dot(scratchMjcfTendonBasisU),
      scratchMjcfTendonProjectionOffset.dot(scratchMjcfTendonBasisV),
    );

  const previousTangents = computeMjcfCircleTangentPoints2D(
    previousLocalX,
    previousLocalY,
    radius,
  );
  const nextTangents = computeMjcfCircleTangentPoints2D(nextLocalX, nextLocalY, radius);
  if (!previousTangents.length || !nextTangents.length) {
    return [
      projectMjcfWrapAnchorOntoSitePath(wrapAnchor, previousSiteAnchor, nextSiteAnchor),
    ];
  }

  let bestPrevious = previousTangents[0]!;
  let bestNext = nextTangents[0]!;
  let bestScore = Infinity;
  let bestDistanceSq = Infinity;
  previousTangents.forEach((previousTangent) => {
    nextTangents.forEach((nextTangent) => {
      const distanceSq = previousTangent.distanceToSquared(nextTangent);
      const score = sideLocal
        ? previousTangent.clone().add(nextTangent).multiplyScalar(0.5).distanceToSquared(sideLocal)
        : distanceSq;
      if (score < bestScore || (score === bestScore && distanceSq < bestDistanceSq)) {
        bestScore = score;
        bestDistanceSq = distanceSq;
        bestPrevious = previousTangent;
        bestNext = nextTangent;
      }
    });
  });

  const buildContactPoint = (tangent: THREE.Vector2): THREE.Vector3 => {
    const point = wrapAnchor.worldPosition
      .clone()
      .addScaledVector(scratchMjcfTendonBasisU, tangent.x)
      .addScaledVector(scratchMjcfTendonBasisV, tangent.y);
    if (wrapAxis) {
      const denominator = nextLocalX - previousLocalX;
      const tangentT = Math.abs(denominator) > 1e-12 ? (tangent.x - previousLocalX) / denominator : 0;
      const previousAxisOffset = scratchMjcfTendonProjectionOffset
        .subVectors(previousSiteAnchor.worldPosition, wrapAnchor.worldPosition)
        .dot(wrapAxis);
      const nextAxisOffset = scratchMjcfTendonProjectionOffset
        .subVectors(nextSiteAnchor.worldPosition, wrapAnchor.worldPosition)
        .dot(wrapAxis);
      point.addScaledVector(
        wrapAxis,
        previousAxisOffset + (nextAxisOffset - previousAxisOffset) * tangentT,
      );
    }
    return point;
  };

  const firstContact = buildContactPoint(bestPrevious);
  const secondContact = buildContactPoint(bestNext);

  return [
    createMjcfTendonContactAnchor(
      wrapAnchor,
      firstContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
    createMjcfTendonContactAnchor(
      wrapAnchor,
      secondContact,
      previousSiteAnchor,
      nextSiteAnchor,
    ),
  ];
}

function resolveMjcfTendonAttachmentAnchor(
  attachmentRef: string | undefined,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): MjcfSiteAnchorData | undefined {
  if (!attachmentRef) {
    return undefined;
  }
  return siteAnchorsByName.get(attachmentRef);
}

function resolveMjcfTendonAttachmentRef(
  attachment: NonNullable<MjcfTendonVisualizationData['attachments']>[number],
): string | undefined {
  const attachmentRef = attachment.ref ?? attachment.sidesite;
  return typeof attachmentRef === 'string' && attachmentRef.length > 0 ? attachmentRef : undefined;
}

function findNeighborMjcfSiteAnchor(
  attachments: NonNullable<MjcfTendonVisualizationData['attachments']>,
  attachmentIndex: number,
  direction: -1 | 1,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): MjcfSiteAnchorData | undefined {
  for (
    let index = attachmentIndex + direction;
    index >= 0 && index < attachments.length;
    index += direction
  ) {
    const attachment = attachments[index];
    if (attachment?.type !== 'site') {
      continue;
    }
    const anchor = resolveMjcfTendonAttachmentAnchor(attachment.ref, siteAnchorsByName);
    if (anchor) {
      return anchor;
    }
  }
  return undefined;
}

function resolveMjcfTendonAnchorPath(
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): Array<MjcfSiteAnchorData | undefined> {
  const attachments = tendon.attachments
    ?.filter((attachment) => resolveMjcfTendonAttachmentRef(attachment))
    .slice();

  if (!attachments?.length || attachments.length !== tendon.attachmentRefs.length) {
    return tendon.attachmentRefs.map((attachmentRef) =>
      resolveMjcfTendonAttachmentAnchor(attachmentRef, siteAnchorsByName),
    );
  }

  return attachments.map((attachment, attachmentIndex) => {
    const anchor = resolveMjcfTendonAttachmentAnchor(
      resolveMjcfTendonAttachmentRef(attachment),
      siteAnchorsByName,
    );
    if (!anchor) {
      return anchor;
    }

    if (attachment.type !== 'geom') {
      return anchor;
    }

    return resolveMjcfWrapContactAnchors(
      anchor,
      findNeighborMjcfSiteAnchor(attachments, attachmentIndex, -1, siteAnchorsByName),
      findNeighborMjcfSiteAnchor(attachments, attachmentIndex, 1, siteAnchorsByName),
      resolveMjcfTendonAttachmentAnchor(attachment.sidesite, siteAnchorsByName),
    );
  }).flat();
}

function updateMjcfTendonSegmentTransform(
  segment: THREE.Group,
  robot: THREE.Object3D,
  startWorld: THREE.Vector3,
  endWorld: THREE.Vector3,
  radius: number,
): boolean {
  scratchMjcfTendonLocalStart.copy(startWorld);
  robot.worldToLocal(scratchMjcfTendonLocalStart);
  scratchMjcfTendonLocalEnd.copy(endWorld);
  robot.worldToLocal(scratchMjcfTendonLocalEnd);

  scratchMjcfTendonSegmentVector.subVectors(scratchMjcfTendonLocalEnd, scratchMjcfTendonLocalStart);
  const segmentLength = scratchMjcfTendonSegmentVector.length();
  if (segmentLength <= 1e-9) {
    return updateVisible(segment, false);
  }

  scratchMjcfTendonSegmentMidpoint
    .copy(scratchMjcfTendonLocalStart)
    .add(scratchMjcfTendonLocalEnd)
    .multiplyScalar(0.5);
  scratchMjcfTendonSegmentDirection
    .copy(scratchMjcfTendonSegmentVector)
    .divideScalar(segmentLength);
  scratchQuaternion.setFromUnitVectors(mjcfTendonYAxis, scratchMjcfTendonSegmentDirection);

  let changed = false;
  changed = updateVisible(segment, true) || changed;
  changed =
    updatePosition(
      segment,
      scratchMjcfTendonSegmentMidpoint.x,
      scratchMjcfTendonSegmentMidpoint.y,
      scratchMjcfTendonSegmentMidpoint.z,
    ) || changed;
  changed = updateQuaternion(segment, scratchQuaternion) || changed;

  const shaft = segment.getObjectByName('__mjcf_tendon_shaft__');

  if (shaft) {
    changed = updateVisible(shaft, true) || changed;
    changed = updateScale3(shaft, radius, Math.max(segmentLength, 1e-6), radius) || changed;
  }

  return changed;
}

function updateMjcfTendonAnchorTransform(
  anchor: THREE.Object3D,
  robot: THREE.Object3D,
  anchorWorld: THREE.Vector3,
  radius: number,
): boolean {
  scratchMjcfTendonLocalStart.copy(anchorWorld);
  robot.worldToLocal(scratchMjcfTendonLocalStart);

  const anchorRadius = Math.max(radius * 1.18, radius + 0.0005);
  let changed = false;
  changed = updateVisible(anchor, true) || changed;
  changed =
    updatePosition(
      anchor,
      scratchMjcfTendonLocalStart.x,
      scratchMjcfTendonLocalStart.y,
      scratchMjcfTendonLocalStart.z,
    ) || changed;
  changed = updateScale3(anchor, anchorRadius, anchorRadius, anchorRadius) || changed;
  return changed;
}

function countSequentialMjcfTendonChildren(
  tendonObject: THREE.Object3D,
  namePrefix: string,
): number {
  let count = 0;
  while (tendonObject.getObjectByName(`${namePrefix}${count}`)) {
    count += 1;
  }
  return count;
}

export function updateMjcfTendonMeshGeometry(
  tendonObject: THREE.Group,
  robot: THREE.Object3D,
  tendon: MjcfTendonVisualizationData,
  siteAnchorsByName: Map<string, MjcfSiteAnchorData>,
): boolean {
  const radius = resolveMjcfTendonRadius(tendon, siteAnchorsByName);
  const fallbackLinkName =
    tendon.attachmentRefs
      .map((attachmentRef) => siteAnchorsByName.get(attachmentRef)?.linkName ?? null)
      .find(
        (linkName): linkName is string => typeof linkName === 'string' && linkName.length > 0,
      ) ?? null;
  const anchorPath = resolveMjcfTendonAnchorPath(tendon, siteAnchorsByName);
  let changed = false;

  changed = updateVisualMeshMetadata(tendonObject, fallbackLinkName) || changed;

  const segmentCount = countSequentialMjcfTendonChildren(
    tendonObject,
    '__mjcf_tendon_segment__:',
  );
  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const startAnchor = anchorPath[segmentIndex];
    const endAnchor = anchorPath[segmentIndex + 1];
    const segment = tendonObject.getObjectByName(`__mjcf_tendon_segment__:${segmentIndex}`) as
      | THREE.Group
      | undefined;
    if (!segment) {
      continue;
    }

    if (!startAnchor || !endAnchor) {
      changed = updateVisible(segment, false) || changed;
      continue;
    }

    const segmentLinkName = startAnchor.linkName ?? endAnchor.linkName ?? fallbackLinkName;
    changed = updateVisualMeshMetadata(segment, segmentLinkName) || changed;
    changed = updateRenderOrder(segment, MJCF_TENDON_RENDER_ORDER) || changed;

    const shaft = segment.getObjectByName('__mjcf_tendon_shaft__');
    if (shaft) {
      changed = updateVisualMeshMetadata(shaft, segmentLinkName) || changed;
      changed = updateRenderOrder(shaft, MJCF_TENDON_RENDER_ORDER) || changed;
    }

    changed =
      updateMjcfTendonSegmentTransform(
        segment,
        robot,
        startAnchor.worldPosition,
        endAnchor.worldPosition,
        radius,
      ) || changed;
  }

  const anchorCount = countSequentialMjcfTendonChildren(
    tendonObject,
    '__mjcf_tendon_anchor__:',
  );
  for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
    const anchor = tendonObject.getObjectByName(`__mjcf_tendon_anchor__:${anchorIndex}`);
    const anchorData = anchorPath[anchorIndex];
    if (!anchor) {
      continue;
    }

    if (!anchorData) {
      changed = updateVisible(anchor, false) || changed;
      continue;
    }

    changed = updateVisualMeshMetadata(anchor, anchorData.linkName ?? fallbackLinkName) || changed;
    changed = updateRenderOrder(anchor, MJCF_TENDON_RENDER_ORDER) || changed;
    changed =
      updateMjcfTendonAnchorTransform(anchor, robot, anchorData.worldPosition, radius) || changed;
  }

  return changed;
}
