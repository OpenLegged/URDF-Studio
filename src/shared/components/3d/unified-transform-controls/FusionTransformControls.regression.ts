import * as THREE from 'three';

import type { RegressionTransformGizmoSummary } from '@/shared/debug/regressionState';
import { getFusionRotateArcPoint, FUSION_ROTATE_ARC_RADIUS, FUSION_ROTATE_E_RING_RADIUS } from './fusionRotateGeometry';
import { isAxisName, isWorldVisible } from './FusionTransformControls.utils';

export const getGizmoSummaryKind = (name: string) => {
  if (name.startsWith('rotate-front-arc-picker-')) return null;
  if (name.startsWith('rotate-front-arc-')) return 'rotate-front-arc';
  if (name.startsWith('rotate-guide-ring-')) return 'rotate-guide-ring';
  if (name === 'rotate-e-ring') return 'rotate-e-ring';
  if (name === 'rotate-e-ring-picker') return null;
  if (name === 'rotate-trackball') return 'rotate-trackball';
  if (name.startsWith('translate-plane-picker-')) return null;
  if (name.startsWith('translate-plane-outline-')) return null;
  if (name.startsWith('translate-plane-xy')) return 'translate-plane-xy';
  if (name.startsWith('translate-plane-yz')) return 'translate-plane-yz';
  if (name.startsWith('translate-plane-xz')) return 'translate-plane-xz';
  if (name === 'translate-center') return 'translate-center';
  if (name === 'translate-center-picker') return null;
  if (name.startsWith('translate-picker-')) return 'translate-picker';
  if (name.startsWith('translate-arrow-')) return 'translate-arrow';
  if (name.startsWith('translate-shaft-')) return 'translate-shaft';
  return null;
};

export const isActiveSummaryEntry = ({
  activeAxis,
  activeOwner,
  axis,
  kind,
  owner,
}: {
  activeAxis: unknown;
  activeOwner: unknown;
  axis: string | null;
  kind: string;
  owner: string | null;
}) => {
  if (!owner || !axis || owner !== activeOwner || axis !== activeAxis) return false;
  if (owner === 'rotate') {
    return kind === 'rotate-front-arc' || kind === 'rotate-e-ring' || kind === 'rotate-trackball';
  }
  return true;
};

export const projectWorldPointToClient = (
  point: THREE.Vector3,
  camera: THREE.Camera,
  rect: DOMRect,
) => {
  const projected = point.clone().project(camera);
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.y) ||
    projected.z < -1 ||
    projected.z > 1
  ) {
    return null;
  }

  return {
    x: rect.left + (projected.x + 1) * 0.5 * rect.width,
    y: rect.top + (1 - projected.y) * 0.5 * rect.height,
  };
};

export const estimateWorldRadius = (object: THREE.Object3D) => {
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return 0;
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }

  const localRadius = geometry.boundingSphere?.radius ?? 0;
  if (localRadius <= 0) return 0;

  const worldScale = object.getWorldScale(new THREE.Vector3());
  const worldRadius =
    localRadius * Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
  return worldRadius > 0 ? worldRadius : 0;
};

export const estimateProjectedRadius = (
  worldPosition: THREE.Vector3,
  worldRadius: number,
  camera: THREE.Camera,
  rect: DOMRect,
) => {
  if (worldRadius <= 0) return 0;
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const center = projectWorldPointToClient(worldPosition, camera, rect);
  const edge = projectWorldPointToClient(
    worldPosition.clone().addScaledVector(cameraRight, worldRadius),
    camera,
    rect,
  );
  if (!center || !edge) return 0;
  return Math.hypot(edge.x - center.x, edge.y - center.y);
};

export const getGeometryWorldCenter = (object: THREE.Object3D) => {
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return object.getWorldPosition(new THREE.Vector3());
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }

  const center = geometry.boundingSphere?.center;
  if (!center) return object.getWorldPosition(new THREE.Vector3());
  return center.clone().applyMatrix4(object.matrixWorld);
};

export const getSummaryWorldPosition = (
  object: THREE.Object3D,
  kind: string,
  axis: string | null,
) => {
  if (kind === 'rotate-front-arc' && isAxisName(axis)) {
    return getFusionRotateArcPoint(axis, 0).applyMatrix4(object.matrixWorld);
  }
  if (kind === 'rotate-guide-ring' && isAxisName(axis)) {
    return getFusionRotateArcPoint(axis, 0, FUSION_ROTATE_ARC_RADIUS).applyMatrix4(
      object.matrixWorld,
    );
  }
  if (kind === 'rotate-e-ring') {
    return new THREE.Vector3(FUSION_ROTATE_E_RING_RADIUS, 0, 0).applyMatrix4(
      object.matrixWorld,
    );
  }

  return getGeometryWorldCenter(object);
};

export const summarizeFusionTransformGizmo = (
  root: THREE.Object3D | null,
  camera: THREE.Camera,
  domElement: HTMLElement,
): RegressionTransformGizmoSummary[] => {
  if (!root) return [];

  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];

  root.updateMatrixWorld(true);
  const summaries: RegressionTransformGizmoSummary[] = [];
  const activeOwner = (root as THREE.Object3D & { activeOwner?: unknown }).activeOwner;
  const activeAxis = (root as THREE.Object3D & { axis?: unknown }).axis;

  root.traverse((node) => {
    const kind = getGizmoSummaryKind(node.name);
    if (!kind || !isWorldVisible(node)) return;

    const axis = typeof node.userData?.urdfAxis === 'string' ? node.userData.urdfAxis : null;
    const owner =
      typeof node.userData?.urdfOwner === 'string' ? node.userData.urdfOwner : null;
    const worldPosition = getSummaryWorldPosition(node, kind, axis);
    const clientPosition = projectWorldPointToClient(worldPosition, camera, rect);
    if (!clientPosition) return;

    const worldRadius = estimateWorldRadius(node);

    summaries.push({
      active: isActiveSummaryEntry({
        activeAxis,
        activeOwner,
        axis,
        kind,
        owner,
      }),
      axis,
      clientX: clientPosition.x,
      clientY: clientPosition.y,
      kind,
      name: node.name,
      owner,
      screenRadius: estimateProjectedRadius(worldPosition, worldRadius, camera, rect),
      visible: true,
      worldPosition: {
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
      },
      worldRadius,
    });
  });

  return summaries;
};