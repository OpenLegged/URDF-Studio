import { revokeBlobUrls } from '../import_blob_urls';

export class StaleImportRequestError extends Error {
  constructor() {
    super('A newer import request superseded this import.');
    this.name = 'StaleImportRequestError';
  }
}

export interface FileImportWorkflowContext<TOverlay> {
  clearOverlay: () => void;
  hasStateMutated: () => boolean;
  isCurrent: () => boolean;
  markStateMutated: () => void;
  setOverlay: (state: TOverlay | null) => void;
  throwIfStale: () => void;
  trackBlobUrls: (urls: Iterable<string>) => void;
}

interface RunFileImportWorkflowParams<TResult, TOverlay> {
  execute: (context: FileImportWorkflowContext<TOverlay>) => Promise<TResult>;
  isCurrent: () => boolean;
  onFailure: (error: unknown) => TResult;
  onOverlayChange?: (state: TOverlay | null) => void;
  skippedResult: TResult;
}

/** Owns stale-request, overlay and provisional Blob URL cleanup semantics. */
export async function runFileImportWorkflow<TResult, TOverlay>({
  execute,
  isCurrent,
  onFailure,
  onOverlayChange,
  skippedResult,
}: RunFileImportWorkflowParams<TResult, TOverlay>): Promise<TResult> {
  const createdBlobUrls = new Set<string>();
  let stateMutated = false;
  let overlayActive = false;

  const setOverlay = (state: TOverlay | null): void => {
    if (!isCurrent()) return;
    onOverlayChange?.(state);
    overlayActive = state !== null;
  };
  const clearOverlay = (): void => {
    if (!overlayActive) return;
    setOverlay(null);
  };
  const throwIfStale = (): void => {
    if (!isCurrent()) throw new StaleImportRequestError();
  };

  try {
    return await execute({
      clearOverlay,
      hasStateMutated: () => stateMutated,
      isCurrent,
      markStateMutated: () => {
        stateMutated = true;
      },
      setOverlay,
      throwIfStale,
      trackBlobUrls: (urls) => {
        for (const url of urls) createdBlobUrls.add(url);
      },
    });
  } catch (error) {
    if (!stateMutated) revokeBlobUrls([...createdBlobUrls]);
    if (error instanceof StaleImportRequestError) return skippedResult;
    return onFailure(error);
  } finally {
    clearOverlay();
  }
}
