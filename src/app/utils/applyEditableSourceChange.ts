import type { SourceCodeDirtyRange } from '@/features/code-editor';
import type { RobotState } from '@/types';
import type { EditableSourceIncrementalPatch } from './editableSourceIncrementalPatch';
import {
  buildEditableSourceIncrementalPatchDiagnostics,
  detectEditableSourceIncrementalPatchWithDiagnostics,
  type EditableSourceIncrementalPatchDiagnostics,
} from './editableSourceIncrementalPatchDetection';
import {
  parseEditableRobotSource,
  parseEditableRobotSourceAsync,
  type ParseEditableRobotSourceOptions,
} from './parseEditableRobotSource';

export interface ApplyEditableSourceChangeOptions extends ParseEditableRobotSourceOptions {
  previousContent: string;
  dirtyRanges?: SourceCodeDirtyRange[];
  attemptIncrementalPatch?: boolean;
  skipMjcfIncrementalPatch?: boolean;
}

export type ApplyEditableSourceChangeResult =
  | {
      mode: 'incremental-patch';
      patch: EditableSourceIncrementalPatch;
      diagnostics: EditableSourceIncrementalPatchDiagnostics;
    }
  | {
      mode: 'full-parse';
      state: RobotState | null;
      diagnostics: EditableSourceIncrementalPatchDiagnostics;
    };

export function applyEditableSourceChange(
  options: ApplyEditableSourceChangeOptions,
): ApplyEditableSourceChangeResult {
  const defaultDiagnostics = buildEditableSourceIncrementalPatchDiagnostics({
    previousContent: options.previousContent,
    nextContent: options.content,
    dirtyRanges: options.dirtyRanges ?? [],
    attempted: false,
    skipReason: options.attemptIncrementalPatch ? null : 'incremental-patch-not-requested',
  });

  if (options.attemptIncrementalPatch) {
    const detectionResult = detectEditableSourceIncrementalPatchWithDiagnostics({
      file: options.file,
      previousContent: options.previousContent,
      nextContent: options.content,
      dirtyRanges: options.dirtyRanges ?? [],
      skipMjcfPatch: options.skipMjcfIncrementalPatch,
    });
    const { patch } = detectionResult;
    if (patch) {
      return {
        mode: 'incremental-patch',
        patch,
        diagnostics: detectionResult.diagnostics,
      };
    }

    return {
      mode: 'full-parse',
      state: parseEditableRobotSource(options),
      diagnostics: detectionResult.diagnostics,
    };
  }

  return {
    mode: 'full-parse',
    state: parseEditableRobotSource(options),
    diagnostics: defaultDiagnostics,
  };
}

/** Async production counterpart that resolves asset-dependent MJCF physics. */
export async function applyEditableSourceChangeAsync(
  options: ApplyEditableSourceChangeOptions,
): Promise<ApplyEditableSourceChangeResult> {
  const defaultDiagnostics = buildEditableSourceIncrementalPatchDiagnostics({
    previousContent: options.previousContent,
    nextContent: options.content,
    dirtyRanges: options.dirtyRanges ?? [],
    attempted: false,
    skipReason: options.attemptIncrementalPatch ? null : 'incremental-patch-not-requested',
  });

  if (options.attemptIncrementalPatch) {
    const detectionResult = detectEditableSourceIncrementalPatchWithDiagnostics({
      file: options.file,
      previousContent: options.previousContent,
      nextContent: options.content,
      dirtyRanges: options.dirtyRanges ?? [],
      skipMjcfPatch: options.skipMjcfIncrementalPatch,
    });
    if (detectionResult.patch) {
      return {
        mode: 'incremental-patch',
        patch: detectionResult.patch,
        diagnostics: detectionResult.diagnostics,
      };
    }

    return {
      mode: 'full-parse',
      state: await parseEditableRobotSourceAsync(options),
      diagnostics: detectionResult.diagnostics,
    };
  }

  return {
    mode: 'full-parse',
    state: await parseEditableRobotSourceAsync(options),
    diagnostics: defaultDiagnostics,
  };
}
