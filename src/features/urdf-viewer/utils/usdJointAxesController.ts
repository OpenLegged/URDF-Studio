import * as THREE from 'three';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { createJointAxisViz } from './visualizationFactories';

type RenderInterfaceLike = {
  getPreferredLinkWorldTransform?: (path: string) => unknown;
  getWorldTransformForPrimPath?: (path: string) => unknown;
};

type JointAxesRebuildOptions = {
  jointAxisSize: number;
  linkFrameResolver?: ((linkPath: string) => THREE.Matrix4 | null) | null;
  overlay?: boolean;
  renderInterface?: RenderInterfaceLike | null;
  resolution: ViewerRobotDataResolution | null;
  showJointAxes: boolean;
  usdRoot: THREE.Group;
};

function toMatrix4(value: unknown): THREE.Matrix4 | null {
  if (!value) return null;
  if (value instanceof THREE.Matrix4) return value.clone();

  const elementsSource = (value as { elements?: ArrayLike<number> }).elements;
  const elements = elementsSource && typeof elementsSource.length === 'number'
    ? Array.from(elementsSource)
    : (typeof (value as ArrayLike<number>).length === 'number'
        ? Array.from(value as ArrayLike<number>)
        : null);
  if (!elements || elements.length < 16) return null;

  const numeric = elements.slice(0, 16).map((entry) => Number(entry));
  return numeric.every((entry) => Number.isFinite(entry))
    ? new THREE.Matrix4().fromArray(numeric)
    : null;
}

function applyOverlayMaterialState(object: THREE.Object3D, overlay: boolean) {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => {
      if (!entry) return;
      entry.depthTest = !overlay;
      entry.depthWrite = !overlay;
      entry.transparent = overlay ? true : entry.transparent;
      entry.needsUpdate = true;
    });

    if ((child as THREE.Mesh).isMesh) {
      child.renderOrder = overlay ? 10001 : 0;
    }
  });
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => entry?.dispose?.());
  });
}

export class UsdJointAxesController {
  private jointAxesGroup: THREE.Group | null = null;

  clear(usdRoot: THREE.Group) {
    if (!this.jointAxesGroup) return;
    usdRoot.remove(this.jointAxesGroup);
    disposeObject(this.jointAxesGroup);
    this.jointAxesGroup = null;
  }

  rebuild({
    jointAxisSize,
    linkFrameResolver,
    overlay = true,
    renderInterface,
    resolution,
    showJointAxes,
    usdRoot,
  }: JointAxesRebuildOptions) {
    this.clear(usdRoot);
    if (!showJointAxes || !resolution) return;

    const group = new THREE.Group();
    group.name = 'USD Joint Axes';

    Object.entries(resolution.robotData.joints).forEach(([jointId, joint]) => {
      if (joint.type === 'fixed') return;

      const childLinkPath = resolution.childLinkPathByJointId[jointId];
      if (!childLinkPath) return;

      const linkWorldMatrix = linkFrameResolver?.(childLinkPath)
        || toMatrix4(renderInterface?.getPreferredLinkWorldTransform?.(childLinkPath))
        || toMatrix4(renderInterface?.getWorldTransformForPrimPath?.(childLinkPath));
      if (!linkWorldMatrix) return;

      const axisVisual = createJointAxisViz(
        joint.type,
        new THREE.Vector3(joint.axis?.x ?? 0, joint.axis?.y ?? 0, joint.axis?.z ?? 1),
        jointAxisSize,
      );
      axisVisual.userData = {
        ...axisVisual.userData,
        viewerHelperKind: 'joint-axis',
        usdJointId: jointId,
        usdLinkPath: childLinkPath,
      };
      applyOverlayMaterialState(axisVisual, overlay);

      const jointLocalMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(
          joint.origin.xyz.x,
          joint.origin.xyz.y,
          joint.origin.xyz.z,
        ),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            joint.origin.rpy.r,
            joint.origin.rpy.p,
            joint.origin.rpy.y,
            'XYZ',
          ),
        ),
        new THREE.Vector3(1, 1, 1),
      );

      axisVisual.matrixAutoUpdate = false;
      axisVisual.matrix.copy(linkWorldMatrix.clone().multiply(jointLocalMatrix));
      axisVisual.updateMatrixWorld(true);
      group.add(axisVisual);
    });

    if (group.children.length <= 0) {
      disposeObject(group);
      return;
    }

    this.jointAxesGroup = group;
    usdRoot.add(group);
  }
}
