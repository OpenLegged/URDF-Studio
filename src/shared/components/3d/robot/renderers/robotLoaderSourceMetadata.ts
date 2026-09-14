import { buildColladaRootNormalizationHints, type ColladaRootNormalizationHints } from '@/core/loaders/index';
import { collectExplicitlyScaledMeshPathsFromLinks } from '@/core/loaders/meshScaleHints';
import { parseURDF } from '@/core/parsers/urdf/parser/index';
import type { RobotState, UrdfJoint, UrdfLink } from '@/types/index';

export interface ResolveRobotLoaderSourceMetadataOptions {
  urdfContent: string;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  parseRobot?: (content: string) => RobotState | null;
}

export interface RobotLoaderSourceMetadata {
  robotLinks: Record<string, UrdfLink> | null;
  robotJoints: Record<string, UrdfJoint> | null;
  explicitlyScaledMeshPaths: Set<string>;
  colladaRootNormalizationHints: ColladaRootNormalizationHints | null;
}

export function resolveRobotLoaderSourceMetadata({
  urdfContent,
  robotLinks,
  robotJoints,
  parseRobot = parseURDF,
}: ResolveRobotLoaderSourceMetadataOptions): RobotLoaderSourceMetadata {
  let resolvedRobotLinks = robotLinks ?? null;
  let resolvedRobotJoints = robotJoints ?? null;

  if (!resolvedRobotLinks || !resolvedRobotJoints) {
    const parsedRobot = parseRobot(urdfContent);
    resolvedRobotLinks ??= parsedRobot?.links ?? null;
    resolvedRobotJoints ??= parsedRobot?.joints ?? null;
  }

  return {
    robotLinks: resolvedRobotLinks,
    robotJoints: resolvedRobotJoints,
    explicitlyScaledMeshPaths: collectExplicitlyScaledMeshPathsFromLinks(resolvedRobotLinks),
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(resolvedRobotLinks),
  };
}
