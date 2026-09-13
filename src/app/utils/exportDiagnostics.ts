import type { ExportExecutionResult } from '@/app/hooks/file-export/types';

/** Successful exports keep compatibility details available without interrupting editing. */
export function reportExportDiagnostics(result: Pick<ExportExecutionResult, 'warnings' | 'issues'>): void {
  const messages = [...new Set([
    ...result.warnings,
    ...result.issues.map(issue => issue.message),
  ].map(message => message.trim()).filter(Boolean))];
  if (messages.length === 0) return;
  const message = `[Export] Completed with compatibility notes:\n${messages.join('\n')}`;
  if (result.issues.length > 0) console.warn(message, result.issues);
  else console.warn(message);
}
