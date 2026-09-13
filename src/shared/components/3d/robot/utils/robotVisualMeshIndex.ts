import * as THREE from 'three';

interface CachedRobotVisualMeshIndex {
  cacheVersion: number;
  meshes: THREE.Mesh[];
}

const robotVisualMeshIndexCache = new WeakMap<THREE.Object3D, CachedRobotVisualMeshIndex>();
const excludedParentNames = new Set([
  '__inertia_visual__',
  '__com_visual__',
  '__inertia_box__',
  '__origin_axes__',
  '__joint_axis_helper__',
]);

function isOpacityEligibleMesh(mesh: THREE.Object3D, robot: THREE.Object3D): mesh is THREE.Mesh {
  if (!(mesh as any).isMesh) return false;
  if (mesh.userData?.isGizmo) return false;
  if ((mesh as any).isURDFCollider || mesh.userData?.isCollisionMesh || mesh.userData?.isCollision) {
    return false;
  }

  let parent = mesh.parent;
  while (parent && parent !== robot) {
    if (
      parent.userData?.isGizmo
      || (parent as any).isURDFCollider
      || parent.userData?.isCollisionMesh
      || excludedParentNames.has(parent.name)
    ) {
      return false;
    }
    parent = parent.parent;
  }

  return true;
}

export function getRobotVisualMeshIndex(robot: THREE.Object3D, cacheVersion: number): THREE.Mesh[] {
  const cachedIndex = robotVisualMeshIndexCache.get(robot);
  if (cachedIndex?.cacheVersion === cacheVersion) {
    return cachedIndex.meshes;
  }

  const meshes: THREE.Mesh[] = [];
  robot.traverse((child) => {
    if (isOpacityEligibleMesh(child, robot)) {
      meshes.push(child);
    }
  });

  robotVisualMeshIndexCache.set(robot, {
    cacheVersion,
    meshes,
  });

  return meshes;
}
