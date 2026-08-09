import { useCallback, useRef } from 'react';
import { useJointInteractionPreviewStore } from '@/store';
import type {
  JointInteractionPreviewSnapshot,
  WorkspaceJointInteractionPreview,
} from '@/store/jointInteractionPreviewStore';
import type { ViewerJointMotionStateValue } from '../../types';

const APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED = true;

interface UseJointInteractionPreviewPublisherOptions {
  projectJointInteractionPreview?: (
    preview: Pick<
      JointInteractionPreviewSnapshot,
      'activeJointId' | 'jointAngles' | 'jointQuaternions' | 'jointOrigins'
    >,
  ) => Record<string, WorkspaceJointInteractionPreview>;
}

interface PublishJointInteractionPreviewInput {
  activeJointId: string | null;
  jointAngles?: Record<string, number>;
  jointQuaternions?: Record<string, ViewerJointMotionStateValue['quaternion']>;
}

/** Owns viewer drag-session IDs and compare-and-clear semantics for shared previews. */
export function useJointInteractionPreviewPublisher({
  projectJointInteractionPreview,
}: UseJointInteractionPreviewPublisherOptions) {
  const sessionCounterRef = useRef(0);
  const activeSessionRef = useRef<string | null>(null);

  const ensureSessionId = useCallback(() => {
    if (activeSessionRef.current !== null) {
      return activeSessionRef.current;
    }

    sessionCounterRef.current += 1;
    activeSessionRef.current = String(sessionCounterRef.current);
    return activeSessionRef.current;
  }, []);

  const publishJointInteractionPreview = useCallback(
    (preview: PublishJointInteractionPreviewInput) => {
      if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
        return;
      }

      const jointQuaternions = Object.fromEntries(
        Object.entries(preview.jointQuaternions ?? {}).filter(([, quaternion]) =>
          Boolean(quaternion),
        ),
      ) as Record<string, NonNullable<ViewerJointMotionStateValue['quaternion']>>;
      const rendererPreview = {
        activeJointId: preview.activeJointId,
        jointAngles: { ...(preview.jointAngles ?? {}) },
        jointQuaternions,
        jointOrigins: {},
      };
      useJointInteractionPreviewStore.getState().publishPreview({
        source: 'viewer',
        dragSessionId: ensureSessionId(),
        ...rendererPreview,
        workspaceByComponent: projectJointInteractionPreview?.(rendererPreview) ?? {},
      });
    },
    [ensureSessionId, projectJointInteractionPreview],
  );

  const clearJointInteractionPreview = useCallback(() => {
    if (!APP_WIDE_JOINT_INTERACTION_PREVIEW_ENABLED) {
      activeSessionRef.current = null;
      return;
    }

    const activeSessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    if (activeSessionId === null) {
      return;
    }

    useJointInteractionPreviewStore.getState().clearPreview({
      source: 'viewer',
      dragSessionId: activeSessionId,
    });
  }, []);

  return { clearJointInteractionPreview, publishJointInteractionPreview };
}
