import * as THREE from 'three';

export interface RobotSceneNodeIndex {
  links: THREE.Object3D[];
  joints: THREE.Object3D[];
}

interface CachedRobotSceneNodeIndex {
  sourceLinks: unknown;
  sourceJoints: unknown;
  index: RobotSceneNodeIndex;
}

const robotSceneNodeIndexCache = new WeakMap<THREE.Object3D, CachedRobotSceneNodeIndex>();

function getIndexedNodesFromTraversal(robot: THREE.Object3D): RobotSceneNodeIndex {
  const links: THREE.Object3D[] = [];
  const joints: THREE.Object3D[] = [];

  robot.traverse((child: THREE.Object3D) => {
    if ((child as any).isURDFLink) {
      links.push(child);
    }

    if ((child as any).isURDFJoint) {
      joints.push(child);
    }
  });

  return { links, joints };
}

export function getRobotSceneNodeIndex(robot: THREE.Object3D): RobotSceneNodeIndex {
  const sourceLinks = (robot as any).links;
  const sourceJoints = (robot as any).joints;
  const cachedIndex = robotSceneNodeIndexCache.get(robot);

  if (
    cachedIndex
    && cachedIndex.sourceLinks === sourceLinks
    && cachedIndex.sourceJoints === sourceJoints
  ) {
    return cachedIndex.index;
  }

  const index = sourceLinks && sourceJoints
    ? {
        links: Object.values(sourceLinks as Record<string, THREE.Object3D>),
        joints: Object.values(sourceJoints as Record<string, THREE.Object3D>),
      }
    : getIndexedNodesFromTraversal(robot);

  robotSceneNodeIndexCache.set(robot, {
    sourceLinks,
    sourceJoints,
    index,
  });

  return index;
}
