import {
  classifyImportInput,
  executeProjectImportIfPresent,
  executeRobotFileImportTransaction,
} from './executePreparedFileImportWorkflowStages';
import {
  runFileImportWorkflow,
} from './runFileImportWorkflow';
import type { ImportPreparationOverlayState } from './importPreparationOverlay';
import type {
  ExecutePreparedFileImportWorkflowParams,
  HandleImportResult,
} from './executePreparedFileImportWorkflowTypes';

export type { HandleImportResult, ImportInputFiles } from './executePreparedFileImportWorkflowTypes';

export async function executePreparedFileImportWorkflow({
  files,
  forceLoadRobot,
  isCurrentImport,
  lang,
  onImportPreparationStateChange,
  onLoadRobot,
  onProjectImported,
  onShowToast,
  ports,
  t,
}: ExecutePreparedFileImportWorkflowParams): Promise<HandleImportResult> {
  const classifiedInput = classifyImportInput(files);
  if (!classifiedInput) {
    return { status: 'skipped' };
  }

  return runFileImportWorkflow<HandleImportResult, ImportPreparationOverlayState>({
    isCurrent: isCurrentImport,
    onOverlayChange: onImportPreparationStateChange,
    skippedResult: { status: 'skipped' },
    onFailure: (error) => {
      console.error('Import failed:', error);
      const fallbackMessage = t.importFailedCheckFiles;
      const errorMessage = error instanceof Error ? error.message.trim() : '';
      alert(errorMessage ? `${fallbackMessage}\n${errorMessage}` : fallbackMessage);
      return { status: 'failed' };
    },
    execute: async (workflow) => {
      const projectImportResult = await executeProjectImportIfPresent({
        lang,
        onProjectImported,
        ports,
        projectInputFiles: classifiedInput.projectInputFiles,
        workflow,
      });
      if (projectImportResult) {
        return projectImportResult;
      }

      return executeRobotFileImportTransaction({
        classifiedInput,
        forceLoadRobot,
        isCurrentImport,
        onLoadRobot,
        onShowToast,
        ports,
        t,
        workflow,
      });
    },
  });
}
