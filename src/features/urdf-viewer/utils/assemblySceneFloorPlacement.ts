import * as THREE from 'three';

import { resolveMjcfWorldGround } from '@/core/robot/mjcfWorldGround';
import type { AssemblyState } from '@/types';

interface FloorPlacement {
  ground: THREE.Box3;
  obstacles: THREE.Box3[];
}

/** Measure the published geometry once, after all meshes of the assembly have loaded. */
export function measureSceneFloor(
  workspace: AssemblyState,
  targets: Map<string, { target: THREE.Object3D }>,
  pending: Set<string>,
): FloorPlacement | null {
  const existing = Array.from(targets).filter(([id]) => !pending.has(id));
  const ground = existing.map(([id, { target }]) =>
    resolveMjcfWorldGround(workspace.components[id]?.robot, target.matrixWorld),
  ).find((bounds) => bounds !== null);
  if (!ground) return null;
  const obstacles: THREE.Box3[] = [];
  for (const [, { target }] of existing) {
    target.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.isVisualMesh) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
      // The root support and a room floor can both occupy the same top plane.
      if (box && box.max.z > ground.max.z + 1e-4) obstacles.push(box);
    });
  }
  return { ground, obstacles };
}

/** Try the nearest clear spot along either axis from the initial placement. */
export function findSceneFloorOffset(
  floor: FloorPlacement,
  bounds: THREE.Box3,
  gap: number,
): THREE.Vector2 {
  const candidates = [new THREE.Vector2()];
  const obstacles = floor.obstacles.filter((box) =>
    box.min.z < floor.ground.max.z + bounds.max.z - bounds.min.z,
  );
  for (const box of obstacles) {
    candidates.push(
      new THREE.Vector2(box.min.x - gap - bounds.max.x, 0),
      new THREE.Vector2(box.max.x + gap - bounds.min.x, 0),
      new THREE.Vector2(0, box.min.y - gap - bounds.max.y),
      new THREE.Vector2(0, box.max.y + gap - bounds.min.y),
    );
  }
  candidates.sort((a, b) => a.lengthSq() - b.lengthSq());
  return candidates.find(({ x, y }) =>
    bounds.min.x + x >= floor.ground.min.x && bounds.max.x + x <= floor.ground.max.x &&
    bounds.min.y + y >= floor.ground.min.y && bounds.max.y + y <= floor.ground.max.y &&
    obstacles.every((box) =>
      bounds.max.x + x <= box.min.x || bounds.min.x + x >= box.max.x ||
      bounds.max.y + y <= box.min.y || bounds.min.y + y >= box.max.y,
    ),
  ) ?? new THREE.Vector2();
}
