import { useCallback, useRef } from 'react';

import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
import { applyEditableSourceIncrementalPatch } from '@/app/utils/editableSourceIncrementalPatch';
import type {
  ApplyEditableSourceChangeOptions,
  ApplyEditableSourceChangeResult,
} from '@/app/utils/applyEditableSourceChange';
import type {
  ComponentSourceDraft,
  ComponentSourceFormat,
  RobotData,
  RobotFile,
  RobotState,
} from '@/types';
import type { SourceCodeEditorApplyRequest } from '@/features/code-editor';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore, type WorkspaceMutationOptions } from '@/store/workspaceStore';
import type { ComponentSourceCodeDocumentChangeTarget } from '@/app/utils/sourceCodeDocuments';
import { setRegressionEditableSourceApplyResult } from '@/shared/debug/regressionState';
import { applyEditableSourceChangeWithWorker } from './robotImportWorkerBridge';

export interface PreparedComponentSourceApply {
  componentId: string;
  expectedWorkspaceRevision: number;
  robot: RobotData;
  draft: ComponentSourceDraft;
  workspaceMutationOptions?: WorkspaceMutationOptions;
}

/** Synchronous CAS commit; validation failures mutate neither workspace nor drafts. */
export function commitPreparedComponentSourceApply({
  componentId,
  expectedWorkspaceRevision,
  robot,
  draft,
  workspaceMutationOptions,
}: PreparedComponentSourceApply): boolean {
  const normalizedRobot = normalizeComponentRobot(robot);
  if (
    draft.componentId !== componentId ||
    draft.robotSnapshotHash !== createSourceSemanticRobotHash(normalizedRobot)
  ) {
    return false;
  }

  const before = useWorkspaceStore.getState();
  const component = before.workspace.components[componentId];
  if (!component || before.revision !== expectedWorkspaceRevision) return false;
  if ((before.transaction?.id ?? null) !== (workspaceMutationOptions?.operationId ?? null)) {
    return false;
  }

  const robotChanged = createSourceSemanticRobotHash(component.robot) !== draft.robotSnapshotHash;
  if (robotChanged) {
    const replaced = before.replaceComponentRobotAtRevision(
      componentId,
      expectedWorkspaceRevision,
      normalizedRobot,
      { label: 'Apply component source', ...workspaceMutationOptions },
    );
    if (!replaced) return false;
  } else if (useWorkspaceStore.getState().revision !== expectedWorkspaceRevision) {
    return false;
  }

  useAssetsStore.getState().setComponentSourceDraft(draft);
  return true;
}

interface UseEditableSourceCodeApplyOptions {
  allFileContents: Record<string, string>;
  availableFiles: RobotFile[];
  onRecoveredSourceApply?: (fileName: string, recoveredItemCount: number) => void;
}

interface PreparedEditableSourceCodeChange {
  allFileContents: Record<string, string>;
  applyEditableSourceChange?: (
    options: ApplyEditableSourceChangeOptions,
  ) => Promise<ApplyEditableSourceChangeResult>;
  applyRequest?: SourceCodeEditorApplyRequest;
  availableFiles: RobotFile[];
  componentId: string;
  draft: ComponentSourceDraft;
  expectedWorkspaceRevision: number;
  isCurrentRequest?: () => boolean;
  robot: RobotData;
  sourceFileName: string | null;
  newCode: string;
}

function toRobotData(state: RobotState): RobotData {
  const { selection: _selection, ...robot } = state;
  return robot;
}

function createParseInputs({
  componentId,
  draft,
  componentSourceFile,
  newCode,
  availableFiles,
  allFileContents,
}: {
  componentId: string;
  draft: ComponentSourceDraft;
  componentSourceFile: string | null;
  newCode: string;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}) {
  const sourceName = componentSourceFile ?? `component-${componentId}.${draft.format}`;
  const sourceFile: RobotFile = {
    name: sourceName,
    format: draft.format,
    content: newCode,
  };
  const nextAvailableFiles = availableFiles.some((file) => file.name === sourceName)
    ? availableFiles.map((file) => (file.name === sourceName ? sourceFile : file))
    : [...availableFiles, sourceFile];
  return {
    sourceFile,
    nextAvailableFiles,
    nextAllFileContents: { ...allFileContents, [sourceName]: newCode },
  };
}

function publishEditableSourceApplyRegressionResult(result: ApplyEditableSourceChangeResult): void {
  const { diagnostics } = result;
  setRegressionEditableSourceApplyResult({
    mode: result.mode,
    dirtyRangeCount: diagnostics.dirtyRangeCount,
    dirtySpanBytes: diagnostics.dirtySpanBytes,
    dirtySpanLimitBytes: diagnostics.dirtySpanLimitBytes,
    patchKind: diagnostics.patchKind,
    skipReason: diagnostics.skipReason,
  });
}

function publishIncrementalPatchApplyFallbackRegressionResult(
  result: ApplyEditableSourceChangeResult,
): void {
  const { diagnostics } = result;
  setRegressionEditableSourceApplyResult({
    mode: 'full-parse',
    dirtyRangeCount: diagnostics.dirtyRangeCount,
    dirtySpanBytes: diagnostics.dirtySpanBytes,
    dirtySpanLimitBytes: diagnostics.dirtySpanLimitBytes,
    patchKind: null,
    skipReason: 'incremental-patch-apply-failed',
  });
}

function createDraftForParsedRobot({
  componentId,
  content,
  format,
  robot,
  sourceFileName,
}: {
  componentId: string;
  content: string;
  format: ComponentSourceFormat;
  robot: RobotState;
  sourceFileName: string;
}): { draft: ComponentSourceDraft; robot: RobotData } {
  const normalizedRobot = normalizeComponentRobot(
    toRobotData(rewriteRobotMeshPathsForSource(robot, sourceFileName)),
  );
  return {
    draft: createComponentSourceDraft({
      componentId,
      format,
      content,
      robot: normalizedRobot,
    }),
    robot: normalizedRobot,
  };
}

async function parseFullEditableSourceChange({
  applyEditableSourceChange,
  applyRequest,
  previousContent,
  sourceFile,
  nextAvailableFiles,
  nextAllFileContents,
  newCode,
}: {
  applyEditableSourceChange: (
    options: ApplyEditableSourceChangeOptions,
  ) => Promise<ApplyEditableSourceChangeResult>;
  applyRequest?: SourceCodeEditorApplyRequest;
  previousContent: string;
  sourceFile: RobotFile;
  nextAvailableFiles: RobotFile[];
  nextAllFileContents: Record<string, string>;
  newCode: string;
}): Promise<ApplyEditableSourceChangeResult> {
  return applyEditableSourceChange({
    file: sourceFile,
    content: newCode,
    previousContent,
    dirtyRanges: applyRequest?.dirtyRanges ?? [],
    attemptIncrementalPatch: false,
    availableFiles: nextAvailableFiles,
    assets: useAssetsStore.getState().assets,
    allFileContents: nextAllFileContents,
  });
}

export async function applyPreparedEditableSourceCodeChange({
  allFileContents,
  applyEditableSourceChange = applyEditableSourceChangeWithWorker,
  applyRequest,
  availableFiles,
  componentId,
  draft: currentDraft,
  expectedWorkspaceRevision,
  isCurrentRequest = () => true,
  robot: currentRobot,
  sourceFileName,
  newCode,
}: PreparedEditableSourceCodeChange): Promise<boolean> {
  const { sourceFile, nextAvailableFiles, nextAllFileContents } = createParseInputs({
    componentId,
    draft: currentDraft,
    componentSourceFile: sourceFileName,
    newCode,
    availableFiles,
    allFileContents,
  });
  const previousContent = currentDraft.content;
  const result = await applyEditableSourceChange({
    file: sourceFile,
    content: newCode,
    previousContent,
    dirtyRanges: applyRequest?.dirtyRanges ?? [],
    attemptIncrementalPatch: true,
    availableFiles: nextAvailableFiles,
    assets: useAssetsStore.getState().assets,
    allFileContents: nextAllFileContents,
  });
  if (!isCurrentRequest()) return false;

  if (result.mode === 'incremental-patch') {
    const patched = applyEditableSourceIncrementalPatch({
      patch: result.patch,
      currentState: currentRobot,
    });

    if (patched) {
      const prepared = createDraftForParsedRobot({
        componentId,
        content: newCode,
        format: currentDraft.format as ComponentSourceFormat,
        robot: patched,
        sourceFileName: sourceFile.name,
      });
      const committed = commitPreparedComponentSourceApply({
        componentId,
        expectedWorkspaceRevision,
        robot: prepared.robot,
        draft: prepared.draft,
      });
      if (committed) {
        publishEditableSourceApplyRegressionResult(result);
      }
      return committed;
    }

    const fullResult = await parseFullEditableSourceChange({
      applyEditableSourceChange,
      applyRequest,
      previousContent,
      sourceFile,
      nextAvailableFiles,
      nextAllFileContents,
      newCode,
    });
    if (!isCurrentRequest()) return false;
    if (fullResult.mode !== 'full-parse' || !fullResult.state) {
      publishIncrementalPatchApplyFallbackRegressionResult(result);
      return false;
    }

    const prepared = createDraftForParsedRobot({
      componentId,
      content: newCode,
      format: currentDraft.format as ComponentSourceFormat,
      robot: fullResult.state,
      sourceFileName: sourceFile.name,
    });
    const committed = commitPreparedComponentSourceApply({
      componentId,
      expectedWorkspaceRevision,
      robot: prepared.robot,
      draft: prepared.draft,
    });
    if (committed) {
      publishIncrementalPatchApplyFallbackRegressionResult(result);
    }
    return committed;
  }

  if (!result.state) {
    publishEditableSourceApplyRegressionResult(result);
    return false;
  }

  const prepared = createDraftForParsedRobot({
    componentId,
    content: newCode,
    format: currentDraft.format as ComponentSourceFormat,
    robot: result.state,
    sourceFileName: sourceFile.name,
  });
  const committed = commitPreparedComponentSourceApply({
    componentId,
    expectedWorkspaceRevision,
    robot: prepared.robot,
    draft: prepared.draft,
  });
  if (committed) {
    publishEditableSourceApplyRegressionResult(result);
  }
  return committed;
}

export function useEditableSourceCodeApply({
  allFileContents,
  availableFiles,
  onRecoveredSourceApply,
}: UseEditableSourceCodeApplyOptions) {
  const requestIdsRef = useRef(new Map<string, number>());
  const reportedRecoverySignaturesRef = useRef(new Map<string, string>());

  const handleCodeChange = useCallback(
    async (
      newCode: string,
      target: ComponentSourceCodeDocumentChangeTarget | undefined = undefined,
      applyRequest: SourceCodeEditorApplyRequest | undefined = undefined,
    ): Promise<boolean> => {
      if (target?.kind !== 'component') return false;
      const componentId = target.componentId;

      const workspaceState = useWorkspaceStore.getState();
      const component = workspaceState.workspace.components[componentId];
      const currentDraft = useAssetsStore.getState().componentSourceDrafts[componentId];
      if (!component || !currentDraft || target.format !== currentDraft.format) return false;
      if (currentDraft.format === 'usd') return false;

      // Owned stale drafts remain editable so post-import normalization cannot
      // strand the source editor in read-only mode. The revision captured below
      // is checked again by commitPreparedComponentSourceApply after parsing, so
      // a concurrent workspace edit still prevents the source from overwriting it.
      const requestId = (requestIdsRef.current.get(componentId) ?? 0) + 1;
      requestIdsRef.current.set(componentId, requestId);
      const expectedWorkspaceRevision = workspaceState.revision;

      try {
        const applied = await applyPreparedEditableSourceCodeChange({
          allFileContents,
          applyRequest,
          availableFiles,
          componentId,
          draft: currentDraft,
          expectedWorkspaceRevision,
          isCurrentRequest: () => requestIdsRef.current.get(componentId) === requestId,
          robot: component.robot,
          sourceFileName: component.sourceFile,
          newCode,
        });
        if (applied) {
          const recovery =
            useWorkspaceStore.getState().workspace.components[componentId]?.robot.inspectionContext
              ?.recovery;
          const recoveredItemCount = recovery?.recoveredItemCount ?? 0;
          if (recoveredItemCount > 0) {
            const signature = [
              recoveredItemCount,
              ...(recovery?.diagnostics ?? []).map((diagnostic) =>
                [
                  diagnostic.code,
                  diagnostic.action,
                  diagnostic.source?.tag ?? '',
                  diagnostic.source?.name ?? '',
                ].join(':'),
              ),
            ].join('|');
            if (reportedRecoverySignaturesRef.current.get(componentId) !== signature) {
              reportedRecoverySignaturesRef.current.set(componentId, signature);
              onRecoveredSourceApply?.(component.sourceFile ?? target.name, recoveredItemCount);
            }
          } else {
            reportedRecoverySignaturesRef.current.delete(componentId);
          }
        }
        return applied;
      } catch (error) {
        console.error(`Failed to apply source draft for component "${componentId}".`, error);
        return false;
      }
    },
    [allFileContents, availableFiles, onRecoveredSourceApply],
  );

  return { handleCodeChange };
}
