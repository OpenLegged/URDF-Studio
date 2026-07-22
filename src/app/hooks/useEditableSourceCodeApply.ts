import { useCallback, useRef } from 'react';

import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';
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
import { parseEditableRobotSourceWithWorker } from './robotImportWorkerBridge';

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
    draft.componentId !== componentId
    || draft.robotSnapshotHash !== createSourceSemanticRobotHash(normalizedRobot)
  ) {
    return false;
  }

  const before = useWorkspaceStore.getState();
  const component = before.workspace.components[componentId];
  if (!component || before.revision !== expectedWorkspaceRevision) return false;
  if (
    (before.transaction?.id ?? null)
    !== (workspaceMutationOptions?.operationId ?? null)
  ) {
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
    ? availableFiles.map((file) => file.name === sourceName ? sourceFile : file)
    : [...availableFiles, sourceFile];
  return {
    sourceFile,
    nextAvailableFiles,
    nextAllFileContents: { ...allFileContents, [sourceName]: newCode },
  };
}

export function useEditableSourceCodeApply({
  allFileContents,
  availableFiles,
}: UseEditableSourceCodeApplyOptions) {
  const requestIdsRef = useRef(new Map<string, number>());

  const handleCodeChange = useCallback(async (
    newCode: string,
    target: ComponentSourceCodeDocumentChangeTarget | undefined = undefined,
    _applyRequest: SourceCodeEditorApplyRequest | undefined = undefined,
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
    const { sourceFile, nextAvailableFiles, nextAllFileContents } = createParseInputs({
      componentId,
      draft: currentDraft,
      componentSourceFile: component.sourceFile,
      newCode,
      availableFiles,
      allFileContents,
    });

    try {
      const parsed = await parseEditableRobotSourceWithWorker({
        file: sourceFile,
        content: newCode,
        availableFiles: nextAvailableFiles,
        allFileContents: nextAllFileContents,
      });
      if (!parsed || requestIdsRef.current.get(componentId) !== requestId) return false;

      const robot = normalizeComponentRobot(
        toRobotData(rewriteRobotMeshPathsForSource(parsed, sourceFile.name)),
      );
      const draft = createComponentSourceDraft({
        componentId,
        format: currentDraft.format as ComponentSourceFormat,
        content: newCode,
        robot,
      });
      return commitPreparedComponentSourceApply({
        componentId,
        expectedWorkspaceRevision,
        robot,
        draft,
      });
    } catch (error) {
      console.error(`Failed to apply source draft for component "${componentId}".`, error);
      return false;
    }
  }, [allFileContents, availableFiles]);

  return { handleCodeChange };
}
