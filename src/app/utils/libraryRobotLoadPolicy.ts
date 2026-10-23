export type LibraryRobotLoadIntent = 'direct' | 'preview' | 'discard';

export type LibraryRobotLoadAction =
  | 'load'
  | 'needs-preview-or-discard-confirm'
  | 'preview'
  | 'blocked';

interface ResolveLibraryRobotLoadActionOptions {
  shouldPreviewCurrentState: boolean;
  hasWorkspaceEdits: boolean;
  intent: LibraryRobotLoadIntent;
}

export function resolveLibraryRobotLoadAction({
  shouldPreviewCurrentState,
  hasWorkspaceEdits,
  intent,
}: ResolveLibraryRobotLoadActionOptions): LibraryRobotLoadAction {
  if (intent === 'preview') {
    return 'preview';
  }

  if (intent === 'direct' && shouldPreviewCurrentState) {
    return 'preview';
  }

  const shouldGuardLibraryLoad =
    !shouldPreviewCurrentState && hasWorkspaceEdits;

  if (!shouldGuardLibraryLoad || intent === 'discard') {
    return 'load';
  }

  if (intent === 'direct') {
    return 'needs-preview-or-discard-confirm';
  }

  return 'blocked';
}
