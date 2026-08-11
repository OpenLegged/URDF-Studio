import type {
  RobotData,
  RobotImportRecoveryDiagnostic,
  RobotImportRecoveryReport,
  RobotSourceDiagnosticSeverity,
} from '@/types';
import type { MJCFSourceResolutionIssue } from './mjcf/mjcfSourceResolver';

const MAX_RETAINED_RECOVERY_DIAGNOSTICS = 120;

const MJCF_ATTACH_ISSUE_KINDS = new Set<MJCFSourceResolutionIssue['kind']>([
  'missing_attached_model_asset',
  'missing_attached_model_file',
  'circular_attach',
  'attached_xml_parse_failed',
  'missing_attached_body',
]);

/** Converts resolver failures for an omitted MJCF include/attach branch into user-visible recovery facts. */
export function createMJCFSourceResolutionRecoveryDiagnostics(
  issues: readonly MJCFSourceResolutionIssue[],
): RobotImportRecoveryDiagnostic[] {
  return issues.map((issue) => ({
    code: `mjcf_${issue.kind}_omitted`,
    severity: 'warning',
    category: 'source',
    message: `${issue.detail} The unresolved branch was omitted.`,
    relatedIds: issue.reference ? [issue.reference] : undefined,
    source: {
      tag: MJCF_ATTACH_ISSUE_KINDS.has(issue.kind) ? 'attach' : 'include',
      name: issue.reference || undefined,
    },
    action: 'omitted',
  }));
}

function createDiagnosticKey(diagnostic: RobotImportRecoveryDiagnostic): string {
  const source = diagnostic.source;
  return [
    diagnostic.code,
    diagnostic.action,
    diagnostic.message,
    source?.tag ?? '',
    source?.name ?? '',
    source?.attribute ?? '',
  ].join('\0');
}

function addDiagnosticCount(
  counts: Record<RobotSourceDiagnosticSeverity, number>,
  diagnostic: RobotImportRecoveryDiagnostic,
): void {
  counts[diagnostic.severity] += 1;
}

/**
 * Adds parser-stage recovery facts without changing the parsed robot graph.
 * Canonical recovery may run later and merges this report with its own repairs.
 */
export function attachParserRecoveryDiagnostics<T extends RobotData>(
  robot: T,
  diagnostics: readonly RobotImportRecoveryDiagnostic[],
): T {
  if (diagnostics.length === 0) {
    return robot;
  }

  const existing = robot.inspectionContext?.recovery;
  const retained: RobotImportRecoveryDiagnostic[] = [];
  const seen = new Set<string>();
  const counts: Record<RobotSourceDiagnosticSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };

  existing?.diagnostics.forEach((diagnostic) => {
    const key = createDiagnosticKey(diagnostic);
    if (seen.has(key)) return;
    seen.add(key);
    retained.push(structuredClone(diagnostic));
    addDiagnosticCount(counts, diagnostic);
  });

  let addedCount = 0;
  diagnostics.forEach((diagnostic) => {
    const key = createDiagnosticKey(diagnostic);
    if (seen.has(key)) return;
    seen.add(key);
    addedCount += 1;
    addDiagnosticCount(counts, diagnostic);
    if (retained.length < MAX_RETAINED_RECOVERY_DIAGNOSTICS) {
      retained.push(structuredClone(diagnostic));
    }
  });

  if (addedCount === 0) {
    return robot;
  }

  if (existing) {
    (['error', 'warning', 'info'] as const).forEach((severity) => {
      const retainedExistingCount = existing.diagnostics.filter(
        (diagnostic) => diagnostic.severity === severity,
      ).length;
      counts[severity] += Math.max(0, existing.diagnosticCounts[severity] - retainedExistingCount);
    });
  }

  const recoveredItemCount = (existing?.recoveredItemCount ?? 0) + addedCount;
  const report: RobotImportRecoveryReport = {
    diagnostics: retained,
    diagnosticCounts: counts,
    recoveredItemCount,
    ...(recoveredItemCount > retained.length
      ? { omittedDiagnosticCount: recoveredItemCount - retained.length }
      : {}),
  };

  return {
    ...robot,
    inspectionContext: {
      ...robot.inspectionContext,
      recovery: report,
    },
  };
}
