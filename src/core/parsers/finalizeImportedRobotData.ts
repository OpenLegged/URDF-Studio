import { salvageCanonicalRobotData } from '@/core/robot/canonicalRobotSalvage';
import { validateCanonicalRobotData } from '@/core/robot/canonicalWorkspace';
import { recoverImportedRobotData } from '@/core/robot/importedRobotRecovery';
import type {
  RobotData,
  RobotFile,
  RobotImportRecoveryDiagnostic,
  RobotImportRecoveryReport,
} from '@/types';

type RobotInspectionSourceFormat = NonNullable<RobotData['inspectionContext']>['sourceFormat'];

const CANONICAL_PATH = 'robot';
const MAX_REPORTED_ISSUES = 12;

export type FinalizeImportedRobotDataResult =
  | { status: 'ready'; robotData: RobotData }
  | {
      status: 'error';
      reason: 'parse_failed' | 'unsupported_format';
      detail: string;
    };

function isRobotInspectionSourceFormat(
  format: RobotFile['format'],
): format is RobotInspectionSourceFormat {
  return (
    format === 'urdf' ||
    format === 'mjcf' ||
    format === 'usd' ||
    format === 'xacro' ||
    format === 'sdf' ||
    format === 'mesh'
  );
}

function stampRobotDataSourceFormat(
  robotData: RobotData,
  format: RobotInspectionSourceFormat,
): RobotData {
  return {
    ...robotData,
    inspectionContext: {
      ...robotData.inspectionContext,
      sourceFormat: format,
    },
  };
}

export function finalizeImportedRobotData(
  robotData: RobotData,
  format: RobotFile['format'],
  recoveryDiagnostics: RobotImportRecoveryDiagnostic[] = [],
): FinalizeImportedRobotDataResult {
  if (!isRobotInspectionSourceFormat(format)) {
    return {
      status: 'error',
      reason: 'unsupported_format',
      detail: 'Unsupported robot source format.',
    };
  }

  const stampedRobotData = stampRobotDataSourceFormat(robotData, format);
  const ambiguousIdentityDiagnostics = collectAmbiguousIdentityDiagnostics(stampedRobotData);
  const allRecoveryDiagnostics = [
    ...(stampedRobotData.inspectionContext?.recovery?.diagnostics ?? []).filter(
      (recoveryDiagnostic) =>
        !ambiguousIdentityDiagnostics.some((sourceDiagnostic) =>
          describesSameDuplicateIdentity(recoveryDiagnostic, sourceDiagnostic),
        ),
    ),
    ...recoveryDiagnostics,
    ...ambiguousIdentityDiagnostics,
  ];

  const recoveredRobotData = preserveUnretainedRecoveryCounts(
    recoverImportedRobotData(stampedRobotData, format, allRecoveryDiagnostics),
    stampedRobotData.inspectionContext?.recovery,
  );
  const canonicalResult = validateCanonicalRobotData(recoveredRobotData, CANONICAL_PATH);
  if (canonicalResult.valid) {
    return { status: 'ready', robotData: recoveredRobotData };
  }

  // Showing the healthy part of a broken file beats refusing the whole import,
  // so drop the entities validation rejected and re-run recovery over the rest.
  const salvage = salvageCanonicalRobotData(
    recoveredRobotData,
    canonicalResult.issues,
    CANONICAL_PATH,
  );
  if (salvage) {
    // The second recovery pass rebuilds the report from scratch, so it has to be
    // seeded with what the first pass already found; otherwise repairs that only
    // pass one could see would vanish from what the user is told.
    const salvagedRobotData = preserveUnretainedRecoveryCounts(
      recoverImportedRobotData(salvage.robotData, format, [
        ...(recoveredRobotData.inspectionContext?.recovery?.diagnostics ?? allRecoveryDiagnostics),
        ...salvage.diagnostics,
      ]),
      recoveredRobotData.inspectionContext?.recovery,
    );
    if (validateCanonicalRobotData(salvagedRobotData, CANONICAL_PATH).valid) {
      return { status: 'ready', robotData: salvagedRobotData };
    }
  }

  return {
    status: 'error',
    reason: 'parse_failed',
    detail: `Imported robot could not be recovered safely. ${describeIssues(canonicalResult.issues)}`,
  };
}

function preserveUnretainedRecoveryCounts(
  robotData: RobotData,
  previousReport: RobotImportRecoveryReport | undefined,
): RobotData {
  if (!previousReport) return robotData;

  const retainedCounts = { error: 0, warning: 0, info: 0 };
  previousReport.diagnostics.forEach((diagnostic) => {
    retainedCounts[diagnostic.severity] += 1;
  });
  const missingCounts = {
    error: Math.max(0, previousReport.diagnosticCounts.error - retainedCounts.error),
    warning: Math.max(0, previousReport.diagnosticCounts.warning - retainedCounts.warning),
    info: Math.max(0, previousReport.diagnosticCounts.info - retainedCounts.info),
  };
  const missingCount = missingCounts.error + missingCounts.warning + missingCounts.info;
  if (missingCount === 0) return robotData;

  const currentReport = robotData.inspectionContext?.recovery;
  const diagnostics = currentReport?.diagnostics ?? [];
  const recoveredItemCount = (currentReport?.recoveredItemCount ?? 0) + missingCount;
  return {
    ...robotData,
    inspectionContext: {
      ...(robotData.inspectionContext ?? { sourceFormat: 'urdf' }),
      recovery: {
        diagnostics,
        diagnosticCounts: {
          error: (currentReport?.diagnosticCounts.error ?? 0) + missingCounts.error,
          warning: (currentReport?.diagnosticCounts.warning ?? 0) + missingCounts.warning,
          info: (currentReport?.diagnosticCounts.info ?? 0) + missingCounts.info,
        },
        recoveredItemCount,
        ...(recoveredItemCount > diagnostics.length
          ? { omittedDiagnosticCount: recoveredItemCount - diagnostics.length }
          : {}),
      },
    },
  };
}

/**
 * Source names that collapsed onto one entity during parsing.
 *
 * The parser keeps the last definition of a duplicated name, so the earlier one
 * is already lost by the time we get here. That is reported rather than treated
 * as fatal: an otherwise valid robot stays importable and the user can see
 * which identity was dropped.
 */
function collectAmbiguousIdentityDiagnostics(
  robotData: RobotData,
): RobotImportRecoveryDiagnostic[] {
  const diagnostics = robotData.inspectionContext?.urdf?.diagnostics ?? [];
  return diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code === 'duplicate_link_name' || diagnostic.code === 'duplicate_joint_name',
    )
    .map((diagnostic) => ({
      ...diagnostic,
      severity: 'warning',
      message: `${diagnostic.message} Only the last definition was kept.`,
      action: 'omitted',
    }));
}

function describesSameDuplicateIdentity(
  recoveryDiagnostic: RobotImportRecoveryDiagnostic,
  sourceDiagnostic: RobotImportRecoveryDiagnostic,
): boolean {
  const matchingCodes =
    (recoveryDiagnostic.code === 'urdf_duplicate_link_omitted' &&
      sourceDiagnostic.code === 'duplicate_link_name') ||
    (recoveryDiagnostic.code === 'urdf_duplicate_joint_omitted' &&
      sourceDiagnostic.code === 'duplicate_joint_name');
  return (
    matchingCodes &&
    recoveryDiagnostic.source?.tag === sourceDiagnostic.source?.tag &&
    recoveryDiagnostic.source?.name === sourceDiagnostic.source?.name
  );
}

function describeIssues(issues: readonly { path: string; message: string }[]): string {
  const reportedIssues = issues.slice(0, MAX_REPORTED_ISSUES);
  const detail = reportedIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  const omittedIssueCount = issues.length - reportedIssues.length;
  return omittedIssueCount > 0 ? `${detail}; and ${omittedIssueCount} more issue(s)` : detail;
}
