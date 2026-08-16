import { unstable_batchedUpdates } from 'react-dom';

import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import {
  buildAssemblyComponentIdentity,
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  isComponentSourceFormat,
  resolveAssemblyComponentBaseName,
} from '@/core/robot';
import { useAssetsStore, type DocumentLoadState } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type {
  AppMode,
  AssemblyComponent,
  RobotData,
  RobotFile,
  WorkspaceSelection,
} from '@/types';

import { resolveAppModeAfterRobotContentChange } from './contentChangeAppMode';
import { flushPendingHistory } from './pendingHistory';

type CommitResolvedRobotLoadResult = Extract<
  RobotImportResult,
  { status: 'ready' | 'needs_hydration' }
>;

export type WorkspaceLoadIntent = 'replace' | 'append';

export interface PendingUsdWorkspaceLoad {
  operationId: string;
  baseWorkspaceRevision: number;
  componentId: string;
  componentName: string;
  file: RobotFile;
  intent: WorkspaceLoadIntent;
  markWorkspaceBaselineSaved?: () => void;
  previousDocumentLoadState: DocumentLoadState;
  previousSelectedFile: RobotFile | null;
  previousSelection: WorkspaceSelection;
}

export type CommitResolvedRobotLoadOutcome =
  | { status: 'committed'; component: AssemblyComponent }
  | { status: 'hydration-pending'; operation: PendingUsdWorkspaceLoad };

interface CommitResolvedRobotLoadArgs {
  currentAppMode: AppMode;
  file: RobotFile;
  importResult: CommitResolvedRobotLoadResult;
  intent?: WorkspaceLoadIntent;
  markWorkspaceBaselineSaved?: () => void;
  onViewerReload?: () => void;
  previousDocumentLoadState?: DocumentLoadState;
  reloadViewer?: boolean;
  setAppMode: (mode: AppMode) => void;
}

let pendingUsdWorkspaceLoad: PendingUsdWorkspaceLoad | null = null;

function resolveComponentIdentity(
  file: RobotFile,
  robotData: RobotData | null,
  intent: WorkspaceLoadIntent,
): { componentId: string; componentName: string } {
  if (intent === 'replace') {
    return {
      componentId: 'component_1',
      componentName: robotData?.name || resolveAssemblyComponentBaseName(file),
    };
  }
  const workspace = useWorkspaceStore.getState().workspace;
  const identity = buildAssemblyComponentIdentity({
    fileName: file.name,
    baseName: resolveAssemblyComponentBaseName(file, robotData?.name),
    existingComponentIds: Object.keys(workspace.components),
    existingComponentNames: Object.values(workspace.components).map(
      (component) => component.name,
    ),
  });
  return {
    componentId: identity.componentId,
    componentName: identity.displayName,
  };
}

function cancelActiveOperationForReplacement(): void {
  const pending = pendingUsdWorkspaceLoad;
  if (pending) {
    cancelPendingUsdWorkspaceLoad(pending.operationId, {
      restoreDocumentSession: true,
    });
    return;
  }
  const workspaceStore = useWorkspaceStore.getState();
  const transaction = workspaceStore.transaction;
  if (transaction?.exclusive) {
    const transactionId = transaction.id;
    workspaceStore.cancelWorkspaceTransaction(transactionId);
  }
  pendingUsdWorkspaceLoad = null;
}

function assertWorkspaceAcceptsLoad(intent: WorkspaceLoadIntent): void {
  const transaction = useWorkspaceStore.getState().transaction;
  if (!transaction) {
    return;
  }
  if (!transaction.exclusive) {
    flushPendingHistory();
    const remainingTransaction = useWorkspaceStore.getState().transaction;
    if (!remainingTransaction) {
      return;
    }
    if (
      remainingTransaction.id === transaction.id
      && useWorkspaceStore.getState().commitWorkspaceTransaction(transaction.id)
    ) {
      return;
    }
  }
  if (intent === 'replace' && transaction.exclusive) {
    cancelActiveOperationForReplacement();
    return;
  }
  throw new Error('Workspace is busy with an exclusive operation.');
}

function commitFileSessionState(file: RobotFile): void {
  useAssetsStore.getState().setSelectedFile(file);
}

function activateComponent(componentId: string): void {
  useWorkspaceStore.getState().setActiveComponent(componentId);
  useSelectionStore.getState().clearSelection();
}

function registerCommittedSourceDraft(
  component: AssemblyComponent,
  file: RobotFile,
  intent: WorkspaceLoadIntent,
): void {
  const assetsStore = useAssetsStore.getState();
  if (intent === 'replace') {
    assetsStore.clearComponentSourceDrafts();
  }
  if (!isComponentSourceFormat(file.format)) {
    return;
  }
  assetsStore.setComponentSourceDraft(createComponentSourceDraft({
    componentId: component.id,
    format: file.format,
    content: file.content,
    robot: component.robot,
  }));
}

function commitReadyRobot(
  file: RobotFile,
  robotData: RobotData,
  intent: WorkspaceLoadIntent,
): AssemblyComponent {
  const workspaceStore = useWorkspaceStore.getState();
  const identity = resolveComponentIdentity(file, robotData, intent);
  let component: AssemblyComponent;
  if (intent === 'replace') {
    const workspace = createSingleComponentWorkspace(robotData, {
      workspaceName: robotData.name,
      componentId: identity.componentId,
      componentName: identity.componentName,
      sourceFile: file.name,
    });
    workspaceStore.replaceWorkspace(workspace, { label: 'Open robot file' });
    component = workspace.components[identity.componentId]!;
  } else {
    component = workspaceStore.appendComponent(
      {
        id: identity.componentId,
        name: identity.componentName,
        sourceFile: file.name,
        robot: robotData,
      },
      { label: 'Add component' },
    );
  }
  activateComponent(component.id);
  return component;
}

function beginUsdWorkspaceLoad(
  file: RobotFile,
  intent: WorkspaceLoadIntent,
  previousDocumentLoadStateOverride?: DocumentLoadState,
  markWorkspaceBaselineSaved?: () => void,
): PendingUsdWorkspaceLoad {
  const workspaceStore = useWorkspaceStore.getState();
  const identity = resolveComponentIdentity(file, null, intent);
  const assetsState = useAssetsStore.getState();
  const previousSelectedFile = assetsState.selectedFile;
  const previousDocumentLoadState = structuredClone(
    previousDocumentLoadStateOverride ?? assetsState.documentLoadState,
  );
  const previousSelection = useSelectionStore.getState().selection;
  const operationId = workspaceStore.beginWorkspaceTransaction(
    intent === 'replace' ? 'Open USD stage' : 'Add USD component',
    {
      componentId: identity.componentId,
      exclusive: true,
    },
  );
  const transaction = useWorkspaceStore.getState().transaction;
  if (!transaction || transaction.id !== operationId) {
    throw new Error('Failed to begin USD workspace transaction.');
  }
  pendingUsdWorkspaceLoad = {
    operationId,
    baseWorkspaceRevision: transaction.startedRevision,
    componentId: identity.componentId,
    componentName: identity.componentName,
    file,
    intent,
    markWorkspaceBaselineSaved:
      intent === 'replace' ? markWorkspaceBaselineSaved : undefined,
    previousDocumentLoadState,
    previousSelectedFile,
    previousSelection,
  };
  return pendingUsdWorkspaceLoad;
}

export function getPendingUsdWorkspaceLoad(): PendingUsdWorkspaceLoad | null {
  return pendingUsdWorkspaceLoad;
}

export function cancelPendingUsdWorkspaceLoad(
  operationId: string,
  options: { restoreDocumentSession?: boolean } = {},
): boolean {
  const pending = pendingUsdWorkspaceLoad;
  if (!pending || pending.operationId !== operationId) {
    return false;
  }
  const accepted = useWorkspaceStore
    .getState()
    .cancelWorkspaceTransaction(operationId);
  if (!accepted) {
    return false;
  }
  pendingUsdWorkspaceLoad = null;
  if (options.restoreDocumentSession) {
    unstable_batchedUpdates(() => {
      useAssetsStore.setState({
        selectedFile: pending.previousSelectedFile,
        documentLoadState: pending.previousDocumentLoadState,
      });
      useSelectionStore.getState().setSelection(pending.previousSelection);
    });
  }
  return true;
}

export function completePendingUsdWorkspaceLoad(
  operationId: string,
  file: RobotFile,
  robotData: RobotData,
): { status: 'committed'; component: AssemblyComponent } | { status: 'stale' } {
  const pending = pendingUsdWorkspaceLoad;
  const workspaceStore = useWorkspaceStore.getState();
  const transaction = workspaceStore.transaction;
  if (
    !pending
    || pending.operationId !== operationId
    || pending.file.name !== file.name
    || transaction?.id !== operationId
    || transaction.startedRevision !== pending.baseWorkspaceRevision
    || transaction.componentId !== pending.componentId
  ) {
    return { status: 'stale' };
  }

  try {
    let component: AssemblyComponent;
    if (pending.intent === 'replace') {
      const workspace = createSingleComponentWorkspace(robotData, {
        workspaceName: robotData.name,
        componentId: pending.componentId,
        componentName: pending.componentName,
        sourceFile: file.name,
      });
      workspaceStore.replaceWorkspace(workspace, {
        operationId,
        label: 'Hydrate USD stage',
      });
      component = workspace.components[pending.componentId]!;
    } else {
      component = workspaceStore.appendComponent(
        {
          id: pending.componentId,
          name: pending.componentName,
          sourceFile: file.name,
          robot: robotData,
        },
        { operationId, label: 'Add USD component' },
      );
    }
    if (!workspaceStore.commitWorkspaceTransaction(operationId)) {
      return { status: 'stale' };
    }
    pendingUsdWorkspaceLoad = null;
    unstable_batchedUpdates(() => {
      commitFileSessionState(file);
      activateComponent(component.id);
      registerCommittedSourceDraft(component, file, pending.intent);
    });
    if (pending.intent === 'replace') {
      pending.markWorkspaceBaselineSaved?.();
    }
    return { status: 'committed', component };
  } catch (error) {
    cancelPendingUsdWorkspaceLoad(operationId, {
      restoreDocumentSession: true,
    });
    throw error;
  }
}

export function commitResolvedRobotLoad({
  currentAppMode,
  file,
  importResult,
  intent = 'replace',
  markWorkspaceBaselineSaved,
  onViewerReload,
  previousDocumentLoadState,
  reloadViewer = true,
  setAppMode,
}: CommitResolvedRobotLoadArgs): CommitResolvedRobotLoadOutcome {
  assertWorkspaceAcceptsLoad(intent);
  if (intent === 'replace') {
    cancelActiveOperationForReplacement();
  }
  const nextAppMode = resolveAppModeAfterRobotContentChange(currentAppMode);
  let outcome: CommitResolvedRobotLoadOutcome;
  unstable_batchedUpdates(() => {
    if (importResult.status === 'ready') {
      const component = commitReadyRobot(file, importResult.robotData, intent);
      registerCommittedSourceDraft(component, file, intent);
      outcome = { status: 'committed', component };
      if (intent === 'replace') {
        markWorkspaceBaselineSaved?.();
      }
    } else {
      outcome = {
        status: 'hydration-pending',
        operation: beginUsdWorkspaceLoad(
          file,
          intent,
          previousDocumentLoadState,
          markWorkspaceBaselineSaved,
        ),
      };
    }
    if (outcome.status === 'committed') {
      commitFileSessionState(file);
      if (reloadViewer) {
        onViewerReload?.();
      }
    }
    if (nextAppMode !== currentAppMode) {
      setAppMode(nextAppMode);
    }
  });
  return outcome!;
}
