import * as THREE from 'three';

export function shouldSyncDirectLinkChildVisibility(child: THREE.Object3D): boolean {
  if (!child.parent || !(child.parent as any).isURDFLink) {
    return false;
  }

  if ((child as any).isURDFJoint || (child as any).isURDFCollider || child.userData?.isGizmo === true) {
    return false;
  }

  if ((child as any).isURDFVisual || child.userData?.isVisualGroup || child instanceof THREE.Mesh) {
    return true;
  }

  let hasStructuralDescendant = false;
  let hasVisualMeshDescendant = false;

  child.traverse((descendant: any) => {
    if (descendant === child || hasStructuralDescendant) {
      return;
    }

    if (descendant.isURDFLink || descendant.isURDFJoint || descendant.isURDFCollider) {
      hasStructuralDescendant = true;
      return;
    }

    if (
      descendant.isMesh
      && !descendant.userData?.isCollision
      && !descendant.userData?.isCollisionMesh
    ) {
      hasVisualMeshDescendant = true;
    }
  });

  return hasVisualMeshDescendant && !hasStructuralDescendant;
}
