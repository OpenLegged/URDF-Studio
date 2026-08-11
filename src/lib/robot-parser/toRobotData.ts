import type { RobotData, RobotState } from '@/types/robot';

/**
 * Strip the workspace-only `selection` field from a parsed {@link RobotState}
 * to produce a portable {@link RobotData} DTO. Mirrors the private conversion
 * in `src/core/parsers/importRobotFile.ts` so this package does not need to
 * depend on that app workflow (mesh path rewriting, material sync, progress
 * reporting, etc.).
 */
export function toRobotData(robot: RobotState | RobotData): RobotData {
  return {
    name: robot.name,
    links: robot.links,
    joints: robot.joints,
    rootLinkId: robot.rootLinkId,
    materials: robot.materials,
    closedLoopConstraints: robot.closedLoopConstraints,
    inspectionContext: robot.inspectionContext,
  };
}
