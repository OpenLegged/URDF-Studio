import { useCallback } from 'react';

import type {
  LibraryRobotLoadIntent,
  LibraryRobotLoadResult,
} from '@/features/robot-tree';
import type { RobotFile } from '@/types';
import type { AppLayoutProps } from '../appLayoutTypes';
import { resolveLibraryRobotLoadAction } from '../utils/libraryRobotLoadPolicy';

interface UseLibraryRobotLoadRequestOptions {
  handlePreviewFileWithFeedback: (file: RobotFile) => void;
  hasWorkspaceEdits: boolean;
  onLoadRobot: AppLayoutProps['onLoadRobot'];
  shouldPreviewLibraryRobotLoad: boolean;
}

export function useLibraryRobotLoadRequest({
  handlePreviewFileWithFeedback,
  hasWorkspaceEdits,
  onLoadRobot,
  shouldPreviewLibraryRobotLoad,
}: UseLibraryRobotLoadRequestOptions) {
  return useCallback(
    async (
      file: RobotFile,
      intent: LibraryRobotLoadIntent,
    ): Promise<LibraryRobotLoadResult> => {
      const loadAction = resolveLibraryRobotLoadAction({
        shouldPreviewCurrentState: shouldPreviewLibraryRobotLoad,
        hasWorkspaceEdits,
        intent,
      });

      if (loadAction === 'preview') {
        handlePreviewFileWithFeedback(file);
        return 'loaded';
      }

      if (loadAction === 'load') {
        const outcome = await onLoadRobot(file);
        return outcome ? 'loaded' : 'blocked';
      }

      if (loadAction === 'needs-preview-or-discard-confirm') {
        return 'needs-preview-or-discard-confirm';
      }

      return 'blocked';
    },
    [
      handlePreviewFileWithFeedback,
      hasWorkspaceEdits,
      onLoadRobot,
      shouldPreviewLibraryRobotLoad,
    ],
  );
}
