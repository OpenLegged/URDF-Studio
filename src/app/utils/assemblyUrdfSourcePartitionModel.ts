import { createSourceSemanticRobotHash } from '@/core/robot';
import type { RobotData, RobotState } from '@/types';

export function toRobotData(state: RobotState): RobotData {
  const { selection: _selection, ...robot } = state;
  return robot;
}

/** Hash only the URDF-expressible entity partition, excluding whole-document diagnostics. */
export function createFlattenedComponentPartitionHash(robot: RobotData): string {
  return createSourceSemanticRobotHash({
    name: 'flattened-component-partition',
    links: robot.links,
    joints: robot.joints,
    rootLinkId: robot.rootLinkId,
    ...(robot.materials ? { materials: robot.materials } : {}),
  });
}
