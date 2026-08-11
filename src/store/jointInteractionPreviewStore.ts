import { create } from 'zustand';

import type { JointQuaternion, UrdfJoint } from '@/types';

export type JointInteractionPreviewSource = 'viewer' | 'tree-panel';

export interface WorkspaceJointInteractionPreview {
  activeJointId: string | null;
  jointAngles: Record<string, number>;
  jointQuaternions: Record<string, JointQuaternion>;
  jointOrigins: Record<string, UrdfJoint['origin']>;
}

export interface JointInteractionPreviewSnapshot {
  ownerId: string | null;
  source: JointInteractionPreviewSource | null;
  dragSessionId: string | null;
  activeJointId: string | null;
  jointAngles: Record<string, number>;
  jointQuaternions: Record<string, JointQuaternion>;
  jointOrigins: Record<string, UrdfJoint['origin']>;
  /** Canonical component-local payload; renderer-global keys remain above for runtime consumers. */
  workspaceByComponent?: Record<string, WorkspaceJointInteractionPreview>;
}

export interface JointInteractionPreviewMatch {
  ownerId?: string | null;
  source?: JointInteractionPreviewSource | null;
  dragSessionId?: string | null;
}

export const EMPTY_JOINT_INTERACTION_PREVIEW: JointInteractionPreviewSnapshot = {
  ownerId: null,
  source: null,
  dragSessionId: null,
  activeJointId: null,
  jointAngles: {},
  jointQuaternions: {},
  jointOrigins: {},
  workspaceByComponent: {},
};

interface JointInteractionPreviewState {
  preview: JointInteractionPreviewSnapshot;
  publishPreview: (preview: JointInteractionPreviewSnapshot) => void;
  clearPreview: (match?: JointInteractionPreviewMatch | null) => void;
}

function numbersEqual(left: number | undefined, right: number | undefined): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= 1e-9;
}

function quaternionsEqual(
  left: JointQuaternion | undefined,
  right: JointQuaternion | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    numbersEqual(left.x, right.x) &&
    numbersEqual(left.y, right.y) &&
    numbersEqual(left.z, right.z) &&
    numbersEqual(left.w, right.w)
  );
}

function originsEqual(
  left: UrdfJoint['origin'] | undefined,
  right: UrdfJoint['origin'] | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    numbersEqual(left.xyz.x, right.xyz.x) &&
    numbersEqual(left.xyz.y, right.xyz.y) &&
    numbersEqual(left.xyz.z, right.xyz.z) &&
    numbersEqual(left.rpy.r, right.rpy.r) &&
    numbersEqual(left.rpy.p, right.rpy.p) &&
    numbersEqual(left.rpy.y, right.rpy.y)
  );
}

function recordMapsEqual<T>(
  left: Record<string, T>,
  right: Record<string, T>,
  compare: (left: T | undefined, right: T | undefined) => boolean,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => compare(left[key], right[key]));
}

function previewsEqual(
  left: JointInteractionPreviewSnapshot,
  right: JointInteractionPreviewSnapshot,
): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.source === right.source &&
    left.dragSessionId === right.dragSessionId &&
    left.activeJointId === right.activeJointId &&
    recordMapsEqual(left.jointAngles, right.jointAngles, numbersEqual) &&
    recordMapsEqual(left.jointQuaternions, right.jointQuaternions, quaternionsEqual) &&
    recordMapsEqual(left.jointOrigins, right.jointOrigins, originsEqual) &&
    workspacePreviewMapsEqual(left.workspaceByComponent, right.workspaceByComponent)
  );
}

function workspacePreviewsEqual(
  left: WorkspaceJointInteractionPreview,
  right: WorkspaceJointInteractionPreview,
): boolean {
  return (
    left.activeJointId === right.activeJointId &&
    recordMapsEqual(left.jointAngles, right.jointAngles, numbersEqual) &&
    recordMapsEqual(left.jointQuaternions, right.jointQuaternions, quaternionsEqual) &&
    recordMapsEqual(left.jointOrigins, right.jointOrigins, originsEqual)
  );
}

function workspacePreviewMapsEqual(
  left: Record<string, WorkspaceJointInteractionPreview> | undefined,
  right: Record<string, WorkspaceJointInteractionPreview> | undefined,
): boolean {
  return recordMapsEqual(left ?? {}, right ?? {}, (leftPreview, rightPreview) =>
    leftPreview && rightPreview
      ? workspacePreviewsEqual(leftPreview, rightPreview)
      : leftPreview === rightPreview,
  );
}

export function hasJointInteractionPreview(
  preview: JointInteractionPreviewSnapshot | null | undefined,
): boolean {
  if (!preview) {
    return false;
  }

  return (
    Object.keys(preview.jointAngles).length > 0 ||
    Object.keys(preview.jointQuaternions).length > 0 ||
    Object.keys(preview.jointOrigins).length > 0 ||
    Object.keys(preview.workspaceByComponent ?? {}).some((componentId) => {
      const componentPreview = preview.workspaceByComponent?.[componentId];
      return Boolean(
        componentPreview &&
        (Object.keys(componentPreview.jointAngles).length > 0 ||
          Object.keys(componentPreview.jointQuaternions).length > 0 ||
          Object.keys(componentPreview.jointOrigins).length > 0),
      );
    })
  );
}

export const useJointInteractionPreviewStore = create<JointInteractionPreviewState>()((set) => ({
  preview: EMPTY_JOINT_INTERACTION_PREVIEW,
  publishPreview: (preview) =>
    set((state) => (previewsEqual(state.preview, preview) ? state : { preview })),
  clearPreview: (match) =>
    set((state) => {
      if (match && 'ownerId' in match && state.preview.ownerId !== match.ownerId) {
        return state;
      }

      if (match && 'source' in match && state.preview.source !== match.source) {
        return state;
      }

      if (
        match &&
        'dragSessionId' in match &&
        state.preview.dragSessionId !== match.dragSessionId
      ) {
        return state;
      }

      return previewsEqual(state.preview, EMPTY_JOINT_INTERACTION_PREVIEW)
        ? state
        : { preview: EMPTY_JOINT_INTERACTION_PREVIEW };
    }),
}));
