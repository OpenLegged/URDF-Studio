import type { RobotData, RobotState, UrdfJoint, UrdfLink, UrdfVisual } from '@/types';

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike };

type RobotSnapshotLike = RobotData;

function sortKeysDeep(value: unknown): JsonLike {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, JsonLike>>((acc, key) => {
        const nextValue = (value as Record<string, unknown>)[key];
        if (nextValue !== undefined) {
          acc[key] = sortKeysDeep(nextValue);
        }
        return acc;
      }, {});
  }

  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  ) {
    return value as JsonLike;
  }

  return null;
}

export function createStableJsonSnapshot(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function stripTransientJointMotionFromJoint(joint: UrdfJoint): UrdfJoint {
  const {
    angle: _angle,
    quaternion: _quaternion,
    jointValue: _jointValue,
    ...sourceJoint
  } = joint as UrdfJoint & { jointValue?: number };
  return sourceJoint as UrdfJoint;
}

export function stripTransientJointMotionFromJoints(
  joints: Record<string, UrdfJoint>,
): Record<string, UrdfJoint> {
  return Object.fromEntries(
    Object.entries(joints).map(([jointId, joint]) => [
      jointId,
      stripTransientJointMotionFromJoint(joint),
    ]),
  );
}

export function stripTransientJointMotionFromRobotData<T extends RobotSnapshotLike>(robot: T): T {
  return {
    ...robot,
    joints: stripTransientJointMotionFromJoints(robot.joints),
  };
}

function stripPresentationStateFromVisual<T extends UrdfVisual>(visual: T): T {
  const { visible: _visible, ...sourceVisual } = visual;
  return sourceVisual as T;
}

function stripPresentationStateFromLink<T extends UrdfLink>(link: T): T {
  const {
    visible: _visible,
    editorLocked: _editorLocked,
    visual,
    visualBodies,
    collision,
    collisionBodies,
    ...sourceLink
  } = link;

  return {
    ...sourceLink,
    visual: stripPresentationStateFromVisual(visual),
    visualBodies: visualBodies?.map((body) => stripPresentationStateFromVisual(body)),
    collision: stripPresentationStateFromVisual(collision),
    collisionBodies: collisionBodies?.map((body) => stripPresentationStateFromVisual(body)),
  } as T;
}

function stripEditorLockStateFromRobotData<T extends RobotSnapshotLike>(robot: T): T {
  return {
    ...robot,
    links: Object.fromEntries(
      Object.entries(robot.links).map(([linkId, link]) => {
        const { editorLocked: _editorLocked, ...sourceLink } = link;
        return [linkId, sourceLink];
      }),
    ),
  } as T;
}

export function stripPresentationStateFromRobotData<T extends RobotSnapshotLike>(robot: T): T {
  return {
    ...robot,
    links: Object.fromEntries(
      Object.entries(robot.links).map(([linkId, link]) => [
        linkId,
        stripPresentationStateFromLink(link),
      ]),
    ),
  };
}

export function stripRobotPersistenceState<T extends RobotSnapshotLike>(robot: T): T {
  return stripPresentationStateFromRobotData(
    stripTransientJointMotionFromRobotData(robot),
  );
}

export function createRobotSemanticSnapshot(robot: RobotSnapshotLike | RobotState): string {
  const { selection: _selection, ...robotData } = robot as RobotState;
  return createStableJsonSnapshot(
    stripEditorLockStateFromRobotData(
      stripTransientJointMotionFromRobotData({ ...robotData }),
    ),
  );
}

export function createRobotPersistenceSnapshot(robot: RobotSnapshotLike | RobotState): string {
  const { selection: _selection, ...robotData } = robot as RobotState;
  return createStableJsonSnapshot(stripRobotPersistenceState({ ...robotData }));
}
