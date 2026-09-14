import type * as THREE from 'three';

import type { UrdfLink } from '@/types/index';

export interface RuntimeSceneLinkMetadataInput {
  scopeKey: string;
  robot: THREE.Object3D | null;
  robotVersion: number;
  robotLinks?: Record<string, UrdfLink>;
}

export interface RuntimeSceneLinkMetadataState extends RuntimeSceneLinkMetadataInput {}

export function createRuntimeSceneLinkMetadataState(
  input: RuntimeSceneLinkMetadataInput,
): RuntimeSceneLinkMetadataState {
  return {
    scopeKey: input.scopeKey,
    robot: input.robot,
    robotVersion: input.robotVersion,
    robotLinks: input.robotLinks,
  };
}

export function resolveRuntimeSceneLinkMetadataState(
  previousState: RuntimeSceneLinkMetadataState,
  input: RuntimeSceneLinkMetadataInput,
): RuntimeSceneLinkMetadataState {
  if (previousState.scopeKey === input.scopeKey) {
    return createRuntimeSceneLinkMetadataState(input);
  }

  const runtimeSceneChanged = previousState.robot !== input.robot
    || previousState.robotVersion !== input.robotVersion;

  if (!runtimeSceneChanged && previousState.robot) {
    return previousState;
  }

  return createRuntimeSceneLinkMetadataState(input);
}
