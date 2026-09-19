import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExportDialogConfig, ExportFormat, ExportProgressState } from '@/features/file-io';
import type { TranslationKeys } from '@/shared/i18n';
import type {
  DisconnectedWorkspaceUrdfExportAction,
  ExportExecutionResult,
  ExportTarget,
  HandleExportWithConfigOptions,
  HandleProjectExportOptions,
  ProjectExportExecutionResult,
} from './file-export/types';
import { resolveExportErrorMessage } from '../utils/exportErrorMessage';
import { reportExportDiagnostics } from '../utils/exportDiagnostics';
import { waitForNextPaint } from '../utils/waitForNextPaint';

export type ExportSessionSurface = 'configure' | 'progress' | 'disconnected';

interface DisconnectedWorkspaceUrdfDialogState {
  config: ExportDialogConfig;
  request: DisconnectedWorkspaceUrdfExportAction;
}

interface ExportSessionState {
  step: 'closed' | 'configure' | 'disconnected';
  target: ExportTarget;
  defaultFormat: ExportFormat | undefined;
  busy: boolean;
  progress: ExportProgressState | null;
  disconnectedDialog: DisconnectedWorkspaceUrdfDialogState | null;
}

interface ExportSessionOperations {
  handleExportProject: (options?: HandleProjectExportOptions) => Promise<ProjectExportExecutionResult>;
  handleExportWithConfig: (
    config: ExportDialogConfig,
    target: ExportTarget,
    options?: HandleExportWithConfigOptions,
  ) => Promise<ExportExecutionResult>;
  handleExportDisconnectedWorkspaceUrdfBundle: (config: ExportDialogConfig) => Promise<ExportExecutionResult>;
}

interface UseExportSessionOptions {
  operations: ExportSessionOperations;
  preload: (surface: ExportSessionSurface) => void;
  showToast: (message: string, type: 'error' | 'info') => void;
  labels: Pick<TranslationKeys,
    'exportFailedParse' | 'exportUrdfJointUnsupported' |
    'exportProgressPreparing' | 'exportProgressPreparingDetail'>;
}

type ExportSessionRequest =
  | { type: 'configured'; config: ExportDialogConfig; target: ExportTarget }
  | { type: 'disconnected'; config: ExportDialogConfig }
  | { type: 'project' }
  | { type: 'project-blob' };

const INITIAL_STATE: ExportSessionState = {
  step: 'closed', target: { type: 'current' }, defaultFormat: undefined,
  busy: false, progress: null, disconnectedDialog: null,
};

function executeRequest(
  request: ExportSessionRequest,
  operations: ExportSessionOperations,
  onProgress: (progress: ExportProgressState) => void,
): Promise<ProjectExportExecutionResult> {
  switch (request.type) {
    case 'configured':
      return request.config.format === 'project'
        ? operations.handleExportProject({ onProgress })
        : operations.handleExportWithConfig(request.config, request.target, { onProgress });
    case 'disconnected':
      return operations.handleExportDisconnectedWorkspaceUrdfBundle(request.config);
    case 'project':
      return operations.handleExportProject({ onProgress });
    case 'project-blob':
      return operations.handleExportProject({ skipDownload: true });
  }
}

/** Owns the app export session; algorithms remain in the injected export operations. */
export function useExportSession({ operations, preload, showToast, labels }: UseExportSessionOptions) {
  const [state, setState] = useState(INITIAL_STATE);
  const executionRef = useRef({ operations, preload, showToast, labels });
  executionRef.current = { operations, preload, showToast, labels };
  // The synchronous state reference also guards commands issued before a render.
  const stateRef = useRef(state);
  const activeRunRef = useRef<symbol | null>(null);
  const mountedRef = useRef(true);
  const updateState = useCallback((patch: Partial<ExportSessionState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Export algorithms may finish, but their UI/progress callbacks no longer own this session.
      activeRunRef.current = null;
    };
  }, []);

  const prefetch = useCallback(() => preload('configure'), [preload]);
  const open = useCallback((target: ExportTarget = { type: 'current' }, defaultFormat?: ExportFormat) => {
    if (!mountedRef.current || stateRef.current.busy) return false;
    prefetch();
    updateState({ step: 'configure', target, defaultFormat, disconnectedDialog: null, progress: null });
    return true;
  }, [prefetch, updateState]);
  const close = useCallback(() => {
    if (!mountedRef.current || stateRef.current.busy) return;
    updateState({ step: 'closed', disconnectedDialog: null, progress: null });
  }, [updateState]);

  const run = useCallback(async (
    request: ExportSessionRequest,
    options?: HandleExportWithConfigOptions,
  ) => {
    if (!mountedRef.current || stateRef.current.busy) return undefined;
    const { operations, preload, showToast, labels } = executionRef.current;
    const token = Symbol('export-session');
    activeRunRef.current = token;
    const isCurrent = () => activeRunRef.current === token;
    const initialProgress = request.type === 'project' ? {
      stepLabel: labels.exportProgressPreparing,
      detail: labels.exportProgressPreparingDetail,
      progress: 0.05, currentStep: 1, totalSteps: 6, indeterminate: true,
    } : null;
    updateState({
      busy: true, progress: initialProgress,
      ...(request.type === 'project' ? { step: 'closed' as const, disconnectedDialog: null } : {}),
    });
    try {
      if (request.type === 'project') preload('progress');
      await waitForNextPaint();
      if (!isCurrent()) return undefined;
      const result = await executeRequest(request, operations, (progress) => {
        if (!isCurrent()) return;
        updateState({ progress });
        options?.onProgress?.(progress);
      });
      if (!isCurrent()) return result;
      if (request.type === 'configured' && result.actionRequired?.type === 'disconnected-workspace-urdf') {
        preload('disconnected');
        updateState({
          step: 'disconnected',
          disconnectedDialog: { config: request.config, request: result.actionRequired },
        });
      } else if (request.type !== 'project-blob') {
        reportExportDiagnostics(result);
        // Surface export compatibility notes (e.g. closed loops cut for URDF)
        // as a toast so they are not buried in the console.
        if (result.warnings?.length) {
          showToast([...new Set(result.warnings)].join('\n'), 'info');
        }
        updateState({ step: 'closed', disconnectedDialog: null });
      }
      return result;
    } catch (error) {
      if (request.type === 'project-blob') throw error;
      if (isCurrent()) showToast(resolveExportErrorMessage(error, labels), 'error');
      return undefined;
    } finally {
      if (isCurrent()) {
        activeRunRef.current = null;
        updateState({ busy: false, progress: null });
      }
    }
  }, [updateState]);

  const submit = useCallback(async (config: ExportDialogConfig, options?: HandleExportWithConfigOptions) => {
    if (stateRef.current.step !== 'configure') return;
    await run({ type: 'configured', config, target: stateRef.current.target }, options);
  }, [run]);
  const confirmDisconnected = useCallback(async () => {
    const current = stateRef.current;
    if (current.step !== 'disconnected' || !current.disconnectedDialog) return;
    await run({ type: 'disconnected', config: current.disconnectedDialog.config });
  }, [run]);
  const exportProject = useCallback(async () => { await run({ type: 'project' }); }, [run]);
  const exportProjectBlob = useCallback(async (): Promise<Blob> => {
    if (stateRef.current.busy) throw new Error('An export is already in progress.');
    const result = await run({ type: 'project-blob' });
    if (!result?.blob) throw new Error('Project export did not produce an archive blob.');
    return result.blob;
  }, [run]);

  return { ...state, open, close, prefetch, submit, confirmDisconnected, exportProject, exportProjectBlob };
}

export type ExportSession = ReturnType<typeof useExportSession>;
